import 'server-only';

/**
 * Agent-initiated long-term memory WRITE (Planner `memory.write`): an agent,
 * mid-plan, proposes ONE derived, durable fact/preference/entity worth keeping
 * for future retrieval. This is the write counterpart to memory.retrieve — and
 * it holds the EXACT same #135 stance, because the row lands in the same
 * memory_entries table the drafter's retrieval reads:
 *
 *   • Derived-not-raw, redaction-BEFORE-persist: the LLM proposes derived text,
 *     but it is re-checked here by `isClean` (the SAME exported predicate the
 *     #135 decision writer uses — applyBattery's regex battery + a deterministic
 *     HeuristicNer person-name pass) BEFORE it is embedded or stored. Anything
 *     that still trips a rule is DROPPED, not stored. The LLM cannot smuggle raw
 *     connector/message content into memory: a name/email/token/etc. fails the
 *     guard. (The plan loop's own observations are already quarantined; this is
 *     the durable-write defense-in-depth.)
 *   • Per-account isolation: account-scoped, service-role write into the #135
 *     table under its per-account RLS; the LLM never controls account_id or any
 *     SQL — trusted code sets the account/scope/source and shapes the row.
 *   • Bounded + non-abusable: dedup on the #135 natural key (bump last_seen_at
 *     instead of spamming a new row); the harness additionally caps writes per
 *     run (MAX_MEMORY_WRITES). The proposed text is clamped to the column's
 *     400-char limit.
 *   • Human-transparent: stamped `source='agent'` (vs the pipeline's 'ingested')
 *     so an agent-written memory is auditable/queryable as agent-authored, and
 *     every outcome is logged. First cut = logged + redacted + per-account
 *     derived write (no human confirmation gate); a future confirmation gate can
 *     hang off the `source='agent'` marker without a schema change.
 *
 * Best-effort throughout: a failure NEVER throws into the plan loop. With no
 * VOYAGE_API_KEY the entry stores with embedding = null (FTS/recency-retrievable),
 * mirroring the #135 writer.
 */
import { serviceClient } from '../supabase/service';
import { embedTexts } from '../llm/embed';
import { isClean } from './extract';

type Kind = 'fact' | 'preference' | 'entity';
type Scope = 'agent' | 'user';

const KINDS: readonly Kind[] = ['fact', 'preference', 'entity'];
const SCOPES: readonly Scope[] = ['agent', 'user'];

/** Mirror the column's char_length(text) <= 400 check. */
const MAX_TEXT = 400;

/** The result the harness surfaces back to the loop as an observation. */
export type MemoryWriteResult =
  | { ok: true; status: 'created' | 'updated'; text: string }
  | { ok: false; reason: string };

/**
 * Persist one agent-proposed derived memory. `accountId`/`scope`/`source` are
 * set by trusted code (this function), NEVER by the LLM — the LLM only ever
 * proposes `text` + `kind` (+ optional confidence), all schema-checked by the
 * utility arg validator before they reach here. (The `scope`/`nibbinId` params
 * exist for trusted in-process callers; the memory.write arg schema does NOT
 * expose them, so a planner pick can never set scope — it always resolves to the
 * account's 'user' scope via the fallback below.)
 *
 * A plan run is ephemeral (no nibbin), so an 'agent'-scoped write has no
 * nibbin_id to anchor to and the table's scope-integrity check (agent ⇒
 * nibbin_id not null) would reject it. We therefore coerce a plan-run write to
 * the account's 'user' scope when no nibbinId is in scope — durable, account-
 * level, and retrievable by the ephemeral planner's null-nibbin retrieve path.
 */
export async function writeAgentMemory(args: {
  accountId: string;
  /** The acting user — anchors a 'user'-scoped row (table check: user ⇒ user_id
   *  not null). Trusted code supplies this; the LLM never sees or sets it. */
  userId: string;
  text: string;
  kind: Kind;
  scope?: Scope;
  confidence?: number;
  nibbinId?: string | null;
  sourceRunId?: string | null;
}): Promise<MemoryWriteResult> {
  try {
    const text = (args.text ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return { ok: false, reason: 'empty memory text' };
    if (!KINDS.includes(args.kind)) return { ok: false, reason: `invalid kind "${String(args.kind)}"` };

    // Resolve the durable owner. 'agent' scope needs a nibbin (table check);
    // a nibbin-less plan run falls back to account-level 'user' memory.
    let scope: Scope = SCOPES.includes(args.scope as Scope) ? (args.scope as Scope) : 'user';
    const nibbinId = scope === 'agent' && args.nibbinId ? args.nibbinId : null;
    if (scope === 'agent' && nibbinId === null) scope = 'user';
    // A 'user'-scoped row MUST anchor to a user (table's scope-integrity check).
    if (scope === 'user' && !args.userId) return { ok: false, reason: 'no acting user for a user-scoped memory write' };

    // DERIVED-NOT-RAW GUARD — redaction BEFORE embed/store, the SAME predicate
    // the #135 decision writer trusts (regex battery + NER name pass). Drop, do
    // not store, anything that still carries structured PII or a person-name run.
    if (!(await isClean(text))) {
      return { ok: false, reason: 'memory text was rejected by the derived-not-raw guard (looked like raw/PII content)' };
    }

    const confidence = Number.isFinite(args.confidence)
      ? Math.min(Math.max(args.confidence as number, 0), 1)
      : 0.5;

    const svc = serviceClient();
    const nowIso = new Date().toISOString();
    // Owner anchor satisfying the table's memory_scope_owner check: an 'agent'
    // row carries the nibbin (user_id null); a 'user' row carries the acting
    // user (nibbin_id null). The plan run's nibbin-less write resolves to 'user'
    // above, so it anchors to args.userId.
    const userId: string | null = scope === 'user' ? args.userId : null;

    // Dedup on the #135 natural key (account+scope+owner+kind+ci-exact text):
    // bump last_seen_at + keep the higher confidence rather than spam a new row.
    // ilike with escaped LIKE metacharacters = exact, case-insensitive match —
    // mirrors the writer in extract.ts and the migration's lower(text) index.
    const likeLiteral = text.replace(/([\\%_])/g, '\\$1');
    let q = svc
      .from('memory_entries')
      .select('id, confidence')
      .eq('account_id', args.accountId)
      .eq('scope', scope)
      .eq('kind', args.kind)
      .ilike('text', likeLiteral);
    q = nibbinId !== null ? q.eq('nibbin_id', nibbinId) : q.is('nibbin_id', null);
    q = userId !== null ? q.eq('user_id', userId) : q.is('user_id', null);
    const { data: match } = await q.limit(1);

    // Best-effort embedding (null without VOYAGE_API_KEY → FTS/recency).
    const vectors = await embedTexts([text]);
    const vec = vectors?.[0] ?? null;
    const embedding = vec ? `[${vec.join(',')}]` : null;

    if (match && match.length > 0) {
      const row = match[0] as { id: string; confidence: number };
      const update: Record<string, unknown> = {
        last_seen_at: nowIso,
        confidence: Math.max(row.confidence ?? 0, confidence),
        source_run_id: args.sourceRunId ?? null,
        source: 'agent',
      };
      if (embedding !== null) update.embedding = embedding;
      const { error } = await svc.from('memory_entries').update(update).eq('id', row.id);
      if (error) {
        console.error('[memory.write] update failed', error.message);
        return { ok: false, reason: 'memory update failed' };
      }
      console.info('[memory.write] updated derived memory', { accountId: args.accountId, scope, kind: args.kind });
      return { ok: true, status: 'updated', text };
    }

    const base = {
      account_id: args.accountId,
      scope,
      nibbin_id: nibbinId,
      user_id: userId,
      kind: args.kind,
      text,
      // LLM-proposed durable fact → inferred provenance (modest, like #135).
      provenance: 'inferred' as const,
      confidence,
      source: 'agent' as const,
      source_run_id: args.sourceRunId ?? null,
      last_seen_at: nowIso,
    };
    const { error } = await svc.from('memory_entries').insert({ ...base, embedding });
    // Dimension-mismatch / cast resilience: retry ONCE without the embedding so
    // a bad vector never loses the row (it stays FTS/recency-retrievable).
    if (error && embedding !== null) {
      const retry = await svc.from('memory_entries').insert({ ...base, embedding: null });
      if (retry.error) {
        console.error('[memory.write] insert failed (retry w/o embedding)', retry.error.message);
        return { ok: false, reason: 'memory insert failed' };
      }
    } else if (error) {
      console.error('[memory.write] insert failed', error.message);
      return { ok: false, reason: 'memory insert failed' };
    }
    console.info('[memory.write] stored derived memory', { accountId: args.accountId, scope, kind: args.kind });
    return { ok: true, status: 'created', text };
  } catch (err) {
    console.error('[memory.write] failed (best-effort)', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'memory write is unavailable' };
  }
}
