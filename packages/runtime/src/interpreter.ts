/**
 * interpretSpec — run a declarative capability `steps[]` as a ProgramFn.
 *
 * SAFETY (load-bearing, design §2): this interpreter ONLY *yields* ProgramSteps
 * — it never executes a side effect. The same runner.ts consumes them and
 * applies every wall: toolsAllowlist, quarantine, action-level gating
 * (owner-set observe/draft/act via runner.ts), write-grants, idempotency,
 * ceilings, repetition kill. A steps-spec is gated identically to a template
 * program; the interpreter cannot bypass any boundary.
 *
 * It handles the linear primitive shapes Composer (Slice 2) emits
 * (detect-and-nudge / template-fill-and-send / summarize):
 *  - a `read` capability → a ReadStep (path from inputs.path); the runner
 *    feeds the quarantined result back as the generator's next() value.
 *  - a `draft`/`write` capability → a DraftStep the runner gates (draft vs
 *    execute by School). When the step carries a `prompt`, it FIRST yields a
 *    ComposeStep (the runner owns the model call, clamps tokens, quarantines
 *    the reply) and uses the returned text as the draft — exactly the
 *    compose→draft handoff echoProgram does, so token accounting + quarantine
 *    match byte-for-byte.
 *
 * Each capability is validated against the registry; an unknown one throws so
 * the run fails cleanly (runner catch → 'failed') rather than yielding an
 * ungated step.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import { QUARANTINE_PREFIX } from '@nibbin/connectors';
import { capability, PRIMITIVE_IMPLS, type CapabilityDescriptor, type PrimitiveInputField } from './capabilities';
import type { ProgramFn } from './runner';
import type { AgentSpec, CapabilityStep, ProgramStep } from './types';

type ConnectionMap = Record<string, string | undefined>;

/** Longest body a model draft may contribute; beyond this, no draft text.
 *  Mirrors echoProgram's MODEL_DRAFT_MAX_CHARS. */
const MODEL_DRAFT_MAX_CHARS = 1200;

/**
 * Per-string cap on neutralized effectArgs values. Matches the header-line
 * convention RFC 5322 §2.1.1 caps a line at (998 chars + CRLF); a composed
 * spec's args may become the recipient/subject of a real side effect, so a
 * single attacker-controlled value can never exceed one header line.
 */
const EFFECT_ARG_MAX_CHARS = 998;

/**
 * Neutralize a connector/composed STRING before it becomes the parameters of a
 * real side effect: strip CR/LF (header / MIME injection — an injected `Bcc:`
 * or header break) and cap length. Numbers/booleans/null pass through. This is
 * the runtime-side mirror of programs.ts's safeHeaderValue/safeAddress — the
 * interpreter passes inputs straight to effectArgs, so without it a composed
 * spec would reopen the injection boundary the templates close (red-team P2-2).
 *
 * Shallow by intent, but recurses ONE level into nested objects/arrays so a
 * value tucked inside `{ headers: { Bcc: '…\r\n…' } }` is still neutralized.
 */
function neutralizeString(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').slice(0, EFFECT_ARG_MAX_CHARS);
}

function sanitizeEffectArgValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return neutralizeString(v);
  if (v === null || typeof v !== 'object') return v; // numbers/booleans/undefined untouched
  if (depth <= 0) return v; // stop after one level of recursion
  if (Array.isArray(v)) return v.map((item) => sanitizeEffectArgValue(item, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = sanitizeEffectArgValue(val, depth - 1);
  }
  return out;
}

/**
 * Reserved native-draft control keys. These are runtime-internal flags the
 * runner/executor key on (createDraft vs sendDraft(ref) vs deleteDraft(ref)).
 * A composed/LLM/primitive spec MUST NEVER be able to supply them via
 * effectArgs — a forged `nativeDraftRef` could make a DRAFT-level step SEND an
 * arbitrary Gmail draft (red-team P1-2). We strip them unconditionally at the
 * interpreter boundary so no spec-supplied value can ride into the executor.
 * The runner sets `nativeDraft:true` itself, AFTER sanitization, from the
 * capability descriptor.
 */
const RESERVED_EFFECT_KEYS = ['nativeDraft', 'nativeDraftRef', 'dismiss'] as const;

/** Sanitize every string in effectArgs (top level + one nested level) and strip
 *  the reserved native-draft control keys.
 *  Strings are always neutralized; the depth budget bounds how far we descend
 *  into nested objects/arrays (the args object itself counts as the first
 *  level, so depth 2 reaches values one container deep, e.g. headers.Bcc). */
function sanitizeEffectArgs(args: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...args };
  for (const k of RESERVED_EFFECT_KEYS) delete stripped[k];
  return sanitizeEffectArgValue(stripped, 2) as Record<string, unknown>;
}

/**
 * Reject a read path that could escape the connector's host or directory
 * (red-team P2-1). A composed spec yields `inputs.path` verbatim as the GET
 * path; this is the generic guard (no per-capability schema) that closes the
 * SSRF / path-traversal surface. Throws so the run fails cleanly.
 */
export function assertSafeReadPath(path: unknown, capability: string): asserts path is string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`read step ${capability} missing inputs.path`);
  }
  if (path.includes('://')) {
    throw new Error(`read step ${capability} path must be connector-relative, not an absolute URL`);
  }
  if (path.startsWith('//')) {
    throw new Error(`read step ${capability} path must not be protocol-relative`);
  }
  if (!path.startsWith('/')) {
    throw new Error(`read step ${capability} path must start with '/'`);
  }
  if (path.includes('..')) {
    throw new Error(`read step ${capability} path must not contain '..' (traversal)`);
  }
}

/**
 * Extract the raw payload text from a quarantine wrap, replicating
 * @nibbin/scan's unwrapQuarantined WITHOUT depending on that package (scan
 * depends on runtime — the reverse edge would be a cycle). Exact-string
 * matching only; the tag never reaches a regex engine.
 */
function unwrap(content: QuarantinedContent): string {
  const openPrefix = `<<<${QUARANTINE_PREFIX}:${content.tag} source="`;
  const headerEnd = '">>>\n';
  const close = `\n<<<END-${QUARANTINE_PREFIX}:${content.tag}>>>`;
  const text = content.wrapped;
  const q = text.startsWith(openPrefix) ? text.indexOf('"', openPrefix.length) : -1;
  const headerLen = q === -1 ? -1 : text.startsWith(headerEnd, q) ? q + headerEnd.length : -1;
  if (headerLen === -1 || !text.trimEnd().endsWith(close.trim())) {
    throw new Error('content is not a quarantine wrap from this connection');
  }
  const body = text.slice(headerLen, text.lastIndexOf(close));
  return body.split('\n').slice(2).join('\n');
}

/**
 * Use the runner-fed model draft when one came back and is sane, else ''.
 * Same fail-safe contract as echoProgram.modelDraftOr: any irregularity in the
 * fed content is treated as "no draft" — a run never fails over prose.
 */
function modelDraftOr(fallback: string, fed: QuarantinedContent | undefined): string {
  if (!fed) return fallback;
  try {
    const t = unwrap(fed).trim();
    if (t.length === 0 || t.length > MODEL_DRAFT_MAX_CHARS) return fallback;
    return t;
  } catch {
    return fallback;
  }
}

/**
 * Validate + coerce a primitive step's `inputs` against the descriptor's
 * inputSchema (design §1/§2.2): every supplied key must be declared; values
 * must match the field type and stay within bounds; defaults fill omitted
 * optional fields; a required field with no value throws. Fail-closed — any
 * mismatch throws so the run fails cleanly rather than running with attacker-
 * shaped params. Shared verbatim by validateComposedSpec (single source of the
 * schema check). Returns the resolved (coerced + defaulted) inputs.
 */
export function resolvePrimitiveInputs(
  cap: CapabilityDescriptor,
  inputs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schema = cap.inputSchema ?? {};
  const given = inputs ?? {};
  for (const key of Object.keys(given)) {
    // Object.hasOwn (not `in`) so prototype-chain keys like '__proto__' /
    // 'constructor' are rejected as unknown rather than slipping the guard.
    if (!Object.hasOwn(schema, key)) throw new Error(`primitive ${cap.id} got unknown input "${key}"`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const present = key in given;
    const raw = present ? given[key] : field.default;
    if (raw === undefined || raw === null) {
      if (field.required) throw new Error(`primitive ${cap.id} missing required input "${key}"`);
      continue;
    }
    out[key] = coerceField(cap.id, key, field, raw);
  }
  return out;
}

function coerceField(capId: string, key: string, field: PrimitiveInputField, raw: unknown): unknown {
  if (field.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`primitive ${capId} input "${key}" must be a finite number`);
    }
    if (field.min !== undefined && raw < field.min) {
      throw new Error(`primitive ${capId} input "${key}" below min ${field.min}`);
    }
    if (field.max !== undefined && raw > field.max) {
      throw new Error(`primitive ${capId} input "${key}" above max ${field.max}`);
    }
    return raw;
  }
  if (field.type === 'string') {
    if (typeof raw !== 'string') throw new Error(`primitive ${capId} input "${key}" must be a string`);
    return raw;
  }
  // enum
  if (typeof raw !== 'string' || !(field.values ?? []).includes(raw)) {
    throw new Error(`primitive ${capId} input "${key}" must be one of ${(field.values ?? []).join(', ')}`);
  }
  return raw;
}

/**
 * Run a linear capability `steps[]` as a ProgramFn. Yields ProgramSteps ONLY —
 * the runner applies every gate. Unknown capability / missing connection /
 * missing read path throws (run fails cleanly).
 *
 * A PRIMITIVE step (cap.kind === 'primitive', design §1) dispatches to its
 * trusted server-side implementation: inputs are schema-validated/coerced, then
 * the implementation's steps are delegated with `yield*` so the runner gates
 * every read/compose/draft it yields exactly as for an atomic step. The
 * implementation — not the spec — owns the read paths + effectArgs, which is
 * why the untrusted Composer can never inject either.
 */
export function interpretSpec(spec: AgentSpec, connMap: ConnectionMap, nowMs: number = Date.now()): ProgramFn {
  const steps = spec.steps ?? [];
  return async function* (ctx): AsyncGenerator<ProgramStep, void, QuarantinedContent | undefined> {
    let idx = -1;
    for (const s of steps) {
      idx += 1;
      const cap = capability(s.capability);
      if (!cap) throw new Error(`unknown capability ${s.capability}`);
      const connectionId = connMap[cap.requiredConnector];
      if (!connectionId) throw new Error(`no active ${cap.requiredConnector} connection`);

      if (cap.kind === 'primitive') {
        const impl = PRIMITIVE_IMPLS[cap.id];
        if (!impl) throw new Error(`primitive ${cap.id} has no implementation`);
        const resolved = resolvePrimitiveInputs(cap, (s as CapabilityStep).inputs);
        // The primitive's ProgramFn ignores ctx (it yields the same step shapes
        // the runner gates); forward it for signature parity all the same.
        //
        // Defense-in-depth (FIX 3): every primitive already sanitizes its own
        // attacker-influenceable strings (safeAddress on `to`, safeHeaderValue
        // on subjects) before they reach effectArgs. We add a BACKSTOP here:
        // each primitive-yielded draft/write step's effectArgs are passed
        // through the same sanitizeEffectArgs the atomic composed path uses. It
        // is idempotent on already-safe strings, so byte-for-byte parity with
        // the templates is preserved — if it ever changed a value, that would
        // mean a primitive failed to sanitize something (investigate, not
        // suppress). We drive the impl generator manually (rather than `yield*`)
        // so we can intercept its yielded steps while still forwarding each
        // next() value the runner feeds back.
        const gen = impl(resolved, connMap, nowMs)(ctx);
        let fed: QuarantinedContent | undefined;
        for (;;) {
          const r = await gen.next(fed as QuarantinedContent);
          if (r.done) break;
          const step = r.value;
          // STRUCTURAL read↔presentation invariant (FIX 3): a read-sideEffect
          // primitive may yield a side-effect (draft/write) step ONLY as a
          // PRESENTATION — the runner gates presentation steps as draft ALWAYS,
          // never executing. (A draft/write capability surfaces as a DraftStep,
          // `kind:'draft'`; ProgramStep has no separate 'write' kind.) A
          // non-presentation draft from a read-classified capability would
          // reach the action-level gate as an EXECUTABLE draft, promoting a read into
          // an autonomous write. Reject it so the run fails cleanly rather than
          // relying on every primitive author's convention. Belt-and-suspenders:
          // the two shipped digests already satisfy this — a no-op for them.
          if (cap.sideEffect === 'read' && step.kind === 'draft' && step.presentation !== true) {
            throw new Error(
              `read-capability primitive '${cap.id}' yielded a non-presentation side effect`,
            );
          }
          const safe =
            step.kind === 'draft'
              ? ({ ...step, effectArgs: sanitizeEffectArgs(step.effectArgs) } satisfies ProgramStep)
              : step;
          fed = yield safe;
        }
        continue;
      }

      if (cap.sideEffect === 'read') {
        // Guard the verbatim GET path (SSRF / traversal — red-team P2-1).
        assertSafeReadPath(s.inputs?.path, s.capability);
        const path = s.inputs.path as string;
        // The runner returns the quarantined read result as the next() value;
        // a linear interpreter does not consume it (the draft uses inputs/prompt),
        // but yielding it runs the read through the allowlist + quarantine gate.
        yield { kind: 'read', capability: s.capability, connectionId, path } satisfies ProgramStep;
        continue;
      }

      // draft | write → a DraftStep the runner gates (draft-vs-execute by School).
      // Per-step patternKey so two distinct drafts in one composed spec keep
      // distinct routine identities (logic-skeptic P2-3). An author/Composer
      // may pin a semantic key via s.patternKey; otherwise derive a unique
      // prefix:templateKey#idx so steps never collapse into one identity.
      const patternKey =
        s.patternKey ?? `${cap.patternKeyPrefix ?? s.capability}:${spec.templateKey ?? 'custom'}#${idx}`;

      // Generative drafts: when the step carries a prompt, ask the runner for a
      // model draft FIRST (it owns the call: token clamp, quarantine, real
      // counts) and capture the quarantined reply as the generator's next()
      // value — exactly echoProgram's compose→draft handoff.
      let draftText = '';
      if (s.prompt) {
        const fed = yield {
          kind: 'compose',
          payload: { note: `drafting ${s.capability}`, patternKey },
          prompt: s.prompt,
        } satisfies ProgramStep;
        draftText = modelDraftOr('', fed);
      }

      yield {
        kind: 'draft',
        capability: s.capability,
        connectionId,
        patternKey,
        presentation: s.presentation ?? false,
        title: s.title ?? cap.resource,
        draft: draftText,
        // Neutralize strings before they can become a side effect's args
        // (header / MIME injection — red-team P2-2).
        effectArgs: sanitizeEffectArgs((s.inputs ?? {}) as Record<string, unknown>),
      } satisfies ProgramStep;
    }
  };
}
