/**
 * interpretSpec — run a declarative capability `steps[]` as a ProgramFn.
 *
 * SAFETY (load-bearing, design §2): this interpreter ONLY *yields* ProgramSteps
 * — it never executes a side effect. The same runner.ts consumes them and
 * applies every wall: toolsAllowlist, quarantine, School gateSideEffect,
 * write-grants, idempotency, ceilings, repetition kill. A steps-spec is gated
 * identically to a template program; the interpreter cannot bypass any
 * boundary.
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
import { capability } from './capabilities';
import type { ProgramFn } from './runner';
import type { AgentSpec, ProgramStep } from './types';

type ConnectionMap = Record<string, string | undefined>;

/** Longest body a model draft may contribute; beyond this, no draft text.
 *  Mirrors echoProgram's MODEL_DRAFT_MAX_CHARS. */
const MODEL_DRAFT_MAX_CHARS = 1200;

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
 * Run a linear capability `steps[]` as a ProgramFn. Yields ProgramSteps ONLY —
 * the runner applies every gate. Unknown capability / missing connection /
 * missing read path throws (run fails cleanly).
 */
export function interpretSpec(spec: AgentSpec, connMap: ConnectionMap): ProgramFn {
  const steps = spec.steps ?? [];
  return async function* (): AsyncGenerator<ProgramStep, void, QuarantinedContent | undefined> {
    for (const s of steps) {
      const cap = capability(s.capability);
      if (!cap) throw new Error(`unknown capability ${s.capability}`);
      const connectionId = connMap[cap.requiredConnector];
      if (!connectionId) throw new Error(`no active ${cap.requiredConnector} connection`);

      if (cap.sideEffect === 'read') {
        const path = typeof s.inputs?.path === 'string' ? s.inputs.path : '';
        if (!path) throw new Error(`read step ${s.capability} missing inputs.path`);
        // The runner returns the quarantined read result as the next() value;
        // a linear interpreter does not consume it (the draft uses inputs/prompt),
        // but yielding it runs the read through the allowlist + quarantine gate.
        yield { kind: 'read', capability: s.capability, connectionId, path } satisfies ProgramStep;
        continue;
      }

      // draft | write → a DraftStep the runner gates (draft-vs-execute by School).
      const patternKey = `${cap.patternKeyPrefix ?? s.capability}:${spec.templateKey ?? 'custom'}`;

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
        effectArgs: (s.inputs ?? {}) as Record<string, unknown>,
      } satisfies ProgramStep;
    }
  };
}
