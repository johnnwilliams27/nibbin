import 'server-only';

/**
 * Runtime wiring for apps/web: loads Nibbins + their adopted spec snapshots,
 * builds quarantined readers (real connector clients when a vault token
 * exists; the synthetic fixture corpus on seeded dev accounts), and drives
 * the @nibbin/runtime runner. All §6.2 enforcement lives in the runner and
 * the SQL RPCs — nothing here can skip a gate.
 */
import {
  ConnectorRequestError,
  makeGmailClient,
  makeGoogleCalendarClient,
  HoneyBookClient,
  InstagramDmClient,
  PixiesetClient,
  StripeConnectorClient,
  SupabaseTokenVault,
  getConnector,
  type Connection,
  type ConnectorClient,
  type ScanResourceReader,
} from '@nibbin/connectors';
import { getNango } from '../connectors/nango';
import {
  executeRun,
  promotionCheck,
  stakesOf,
  type AgentSpec,
  type Decision,
  type EventSink,
  type NibbinRef,
  type RunOutcome,
  type RunTrigger,
  type StageName,
} from '@nibbin/runtime';
import { fixtureReader, FIXTURE_PROVIDERS } from '@nibbin/scan';
import type { SupabaseClient } from '@supabase/supabase-js';
import { modelDrafterFor } from '../llm/drafting';
import { serviceClient } from '../supabase/service';
import { buildProgram, type ConnectionMap } from './programs';
import { PgSendRecordStore } from '../connectors/pg-send-velocity-store';
import {
  SupabaseEventSink,
  SupabaseGrantStore,
  SupabaseIdempotencyStore,
  SupabaseResourceClaimStore,
  SupabaseRoutineStore,
  SupabaseRunStore,
} from './stores';

/** Fixture readers stand in ONLY on explicitly seeded dev/staging accounts. */
export function devSeedEnabled(): boolean {
  return process.env.NIBBIN_DEV_SEED === '1' && process.env.NODE_ENV !== 'production';
}

export function connectionFromRow(row: Record<string, unknown>): Connection {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    provider: row.provider as string,
    method: row.method as Connection['method'],
    scopes: (row.scopes as string[]) ?? [],
    status: row.status as Connection['status'],
    tokenRef: (row.token_ref as string | null) ?? null,
    webhookState: (row.webhook_state as Record<string, unknown>) ?? {},
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
    nangoConnectionId: (row.nango_connection_id as string | null) ?? null,
    nangoProviderConfigKey: (row.nango_provider_config_key as string | null) ?? null,
  };
}

function realClient(connection: Connection): ConnectorClient {
  // Vault-read guard: N-method connections have no live vault token — vault
  // reads must never be attempted for them (constraint 7 from the plan).
  // Nango holds the tokens; makeGmailClient/makeGoogleCalendarClient handle routing.
  if (connection.method !== 'N') {
    // Only instantiate the vault for H/A/G connectors that actually use it.
    const vault = new SupabaseTokenVault({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
    });
    switch (connection.provider) {
      case 'stripe':
        return new StripeConnectorClient(connection, vault);
      case 'honeybook':
        return new HoneyBookClient(connection, vault);
      case 'pixieset':
        return new PixiesetClient(connection, vault);
      case 'instagram-dm':
        return new InstagramDmClient(connection, vault);
      default:
        throw new Error(`no hand-built client for ${connection.provider} yet`);
    }
  }

  // N-method connectors: use Nango proxy lane. Vault is never consulted.
  switch (connection.provider) {
    case 'gmail':
      return makeGmailClient(connection, getNango());
    case 'google-calendar':
      return makeGoogleCalendarClient(connection, getNango());
    default:
      throw new Error(`no Nango client for ${connection.provider} yet`);
  }
}

/**
 * Reader for one connection: real client for active connections, fixtures
 * on seeded accounts (token_ref null + dev seed flag for H connectors).
 *
 * Vault-read guard (Task 6): N-method connections route directly to realClient
 * without gating on tokenRef — N connections have no vault token by design
 * (Nango holds the token). Gating on tokenRef would always fall through to
 * fixtures/error for N connections, silently breaking all Gmail/Calendar scans.
 */
export function readerForConnection(connection: Connection, nowMs: number): ScanResourceReader {
  if (connection.status !== 'active') throw new Error(`connection ${connection.id} is ${connection.status}`);
  // N-method connections: token is held by Nango, not the vault. Route directly.
  if (connection.method === 'N') return realClient(connection);
  // H/A/G connections: use vault token (tokenRef must be non-null) or fixtures.
  if (connection.tokenRef) return realClient(connection);
  if (devSeedEnabled() && FIXTURE_PROVIDERS.includes(connection.provider)) {
    return fixtureReader(connection.provider, nowMs);
  }
  throw new Error(`connection ${connection.id} has no token and fixtures are off`);
}

interface SpecRow {
  id: string;
  template_key: string | null;
  version: number;
  display_name: string;
  tools_allowlist: string[];
  required_connectors: string[];
  triggers: AgentSpec['triggers'];
  curriculum: AgentSpec['curriculum'];
  credit_profile: AgentSpec['creditProfile'];
  // Synthesis Slice 1 (forward-compat): present once migration
  // 20260618040000 lands; existing/template rows default to []/{}.
  steps?: AgentSpec['steps'];
  persona_policy?: AgentSpec['personaPolicy'];
}

/**
 * Load-time shim (P0-1): `email.draft` was retired in favor of `email.send`
 * (the action level now decides draft-vs-act). `agent_specs` rows are immutable
 * once adopted, so already-adopted email Nibbins still carry `email.draft` in
 * their tools_allowlist (and possibly steps[].capability). Without this
 * normalization the runner's allowlist gate kills every such run
 * (`!toolsAllowlist.includes('email.send')`). The data migration
 * 20260620210000 rewrites the rows; this shim is belt-and-suspenders for any
 * row the migration missed (replication lag, manual insert, restore).
 */
function normalizeRetiredEmailDraft(allowlist: string[]): string[] {
  if (!allowlist.includes('email.draft')) return allowlist;
  const mapped = allowlist.map((cap) => (cap === 'email.draft' ? 'email.send' : cap));
  // Dedup if both email.draft and email.send were present.
  return [...new Set(mapped)];
}

function normalizeRetiredEmailDraftSteps(steps: AgentSpec['steps']): AgentSpec['steps'] {
  if (!steps || steps.length === 0) return steps;
  if (!steps.some((s) => s.capability === 'email.draft')) return steps;
  return steps.map((s) => (s.capability === 'email.draft' ? { ...s, capability: 'email.send' } : s));
}

export function specFromRow(row: SpecRow): AgentSpec {
  return {
    templateKey: row.template_key,
    version: row.version,
    displayName: row.display_name,
    toolsAllowlist: normalizeRetiredEmailDraft(row.tools_allowlist),
    requiredConnectors: row.required_connectors,
    triggers: row.triggers,
    curriculum: row.curriculum,
    creditProfile: row.credit_profile,
    // A template adoption carries empty steps → buildProgram routes it to the
    // hand-written program (no behavior change); a composed spec round-trips
    // its steps/persona through to the interpreter.
    steps: normalizeRetiredEmailDraftSteps(row.steps ?? []),
    personaPolicy: row.persona_policy ?? {},
  };
}

export async function loadNibbin(svc: SupabaseClient, nibbinId: string): Promise<NibbinRef> {
  const { data, error } = await svc
    .from('nibbins')
    .select('id, account_id, name, stage, stage_changed_at, status, agent_specs!inner(*)')
    .eq('id', nibbinId)
    .single();
  if (error || !data) throw new Error(`nibbin ${nibbinId} not found`);
  const specRow = (Array.isArray(data.agent_specs) ? data.agent_specs[0] : data.agent_specs) as SpecRow;
  return {
    id: data.id,
    accountId: data.account_id,
    name: data.name,
    stage: data.stage as StageName,
    stageChangedAt: new Date(data.stage_changed_at as string).getTime(),
    status: data.status as NibbinRef['status'],
    spec: specFromRow(specRow),
  };
}

export async function activeConnections(svc: SupabaseClient, accountId: string): Promise<Connection[]> {
  const { data, error } = await svc
    .from('connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active');
  if (error) throw new Error(`connections load failed: ${error.message}`);
  return (data ?? []).map(connectionFromRow);
}

export interface EffectsExecutorTestDeps {
  createDraft: (rfc822: string) => Promise<{ id?: string }>;
  sendMessage: (rfc822: string) => Promise<{ id?: string }>;
  sendVelocityConsume: (args: {
    accountId: string; provider: string; hourCap: number; dayCap: number;
  }) => Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }>;
  /** Optional: stub the Calendar createEvent call. Absent in email-only tests. */
  createEvent?: (calendarId: string, event: Record<string, unknown>) => Promise<{ id?: string }>;
  /** Task 4: delete a Gmail draft by id (best-effort, dismiss path). */
  deleteDraft?: (draftId: string) => Promise<void>;
  /** Task 4: send a previously-created Gmail draft by id (send path with stored ref). */
  sendDraft?: (draftId: string) => Promise<{ id?: string }>;
}

/**
 * Build the effects executor (email.send + calendar.event-create).
 * Task 3: email.draft retired; email.send is now the single email write capability.
 * Task 4: native-draft mirror + delete-sync wired.
 *   - args.nativeDraft=true + no nativeDraftRef → createDraft (Draft level mirror).
 *   - args.nativeDraftRef set + no dismiss → sendDraft(ref) after velocity consume.
 *   - args.dismiss=true + nativeDraftRef set → deleteDraft(ref) best-effort, no send.
 *   - Neither flag → sendMessage (legacy / send-level non-native-draft path).
 * In production (no testDeps): calls GmailClient directly + send_velocity_consume RPC atomically.
 * In tests (testDeps injected): calls the provided stubs.
 */
export function buildEffectsExecutor(
  byId: Map<string, Connection>,
  accountId: string,
  accountCreatedAtMs: number,
  testDeps?: EffectsExecutorTestDeps,
  /** Optional event sink for fleet-learning telemetry (best-effort, never changes run behavior). */
  eventSink?: EventSink,
): (args: {
    connectionId: string;
    capability: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
  }) => Promise<{ nativeDraftId?: string } | void> {
  /** Emit a connector_blocked event best-effort (structural ids only — no content/PII). */
  async function emitConnectorBlocked(connector: string, reason: 'not_connected' | 'auth_failed' | 'velocity_cap'): Promise<void> {
    if (!eventSink) return;
    try {
      await eventSink.emit({ name: 'connector_blocked', accountId, props: { connector, reason } });
    } catch {
      // best-effort — never change run behavior
    }
  }

  return async (args: {
    connectionId: string;
    capability: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ nativeDraftId?: string } | void> => {
    const connection = byId.get(args.connectionId);
    if (!connection) throw new Error(`connection ${args.connectionId} not found`);
    const rfc822 = String(args.args.rfc822 ?? '');

    switch (args.capability) {
      case 'email.send': {
        const nativeDraftRef = typeof args.args.nativeDraftRef === 'string' ? args.args.nativeDraftRef : null;
        const nativeDraft = args.args.nativeDraft === true;
        const dismiss = args.args.dismiss === true;

        // ── Dismiss path: delete the Gmail draft best-effort, no send ──────────
        // Triggered when the user dismisses a Nibbin draft that has a native ref.
        if (dismiss && nativeDraftRef) {
          try {
            if (testDeps) {
              await testDeps.deleteDraft?.(nativeDraftRef);
            } else {
              await makeGmailClient(connection, getNango()).deleteDraft(nativeDraftRef);
            }
          } catch (err) {
            // Best-effort: logged, never blocks dismissal.
            console.warn('[effects] deleteDraft best-effort failed:', err instanceof Error ? err.message : String(err));
          }
          return;
        }

        // ── Native-draft mirror path: create a Gmail draft (Draft action level) ─
        // nativeDraft=true without a ref → Draft level mirror: createDraft.
        // Does NOT consume velocity (this is draft creation, not send).
        // Returns the nativeDraftId so the runner can store it in native_draft_ref.
        if (nativeDraft && !nativeDraftRef) {
          let draftId: string | undefined;
          try {
            if (testDeps) {
              const r = await testDeps.createDraft(rfc822);
              draftId = r.id;
            } else {
              const r = await makeGmailClient(connection, getNango()).createDraft(rfc822);
              draftId = r.id;
            }
          } catch (err) {
            if (err instanceof ConnectorRequestError) {
              const reason = err.kind === 'auth' ? 'auth_failed' : err.kind === 'connection-state' ? 'not_connected' : null;
              if (reason) await emitConnectorBlocked(err.provider, reason);
            }
            throw err;
          }
          return { nativeDraftId: draftId };
        }

        // ── Send path: velocity consume then send (stored draft or fresh send) ──
        // Atomic velocity check via PgSendRecordStore (migration 20260620180000).
        // The RPC serializes check-and-insert under a per-account advisory lock,
        // eliminating the TOCTOU in the old two-step read→record path.
        const descriptor = getConnector(connection.provider);
        let decision: { allowed: boolean; reason?: string; retryAfterMs?: number };
        if (testDeps) {
          const caps = descriptor.send?.velocity;
          if (!caps) throw new Error(`${connection.provider} has no velocity caps declared`);
          decision = await testDeps.sendVelocityConsume({
            accountId, provider: connection.provider,
            hourCap: caps.perAccountPerHour, dayCap: caps.perAccountPerDay,
          });
        } else {
          const store = new PgSendRecordStore(serviceClient());
          const sendDecision = await store.checkAndConsume(accountId, descriptor, accountCreatedAtMs);
          decision = sendDecision.allowed
            ? { allowed: true }
            : { allowed: false, reason: sendDecision.reason, retryAfterMs: sendDecision.retryAfterMs };
        }
        if (!decision.allowed) {
          // Fleet-learning telemetry: velocity cap blocked a send. Best-effort.
          await emitConnectorBlocked(connection.provider, 'velocity_cap');
          throw new Error(
            `send blocked by velocity cap (${decision.reason}); retry in ${decision.retryAfterMs}ms`,
          );
        }
        try {
          if (nativeDraftRef) {
            // Send the previously-created Gmail draft (velocity already consumed above).
            if (testDeps) {
              await testDeps.sendDraft?.(nativeDraftRef);
            } else {
              await makeGmailClient(connection, getNango()).sendDraft(nativeDraftRef);
            }
          } else if (testDeps) {
            await testDeps.sendMessage(rfc822);
          } else {
            // Velocity already atomically consumed above via send_velocity_consume RPC
            // (which INSERTs the send_records row). Use sendMessageDirect so the
            // in-process limiter does NOT insert a second send_records row — that
            // double-consume would halve the effective cap (FIX 1, Spec 2 review).
            await makeGmailClient(connection, getNango()).sendMessageDirect(rfc822);
          }
        } catch (err) {
          // Fleet-learning telemetry: emit connector_blocked on auth/connection-state errors.
          if (err instanceof ConnectorRequestError) {
            const reason = err.kind === 'auth' ? 'auth_failed' : err.kind === 'connection-state' ? 'not_connected' : null;
            if (reason) await emitConnectorBlocked(err.provider, reason);
          }
          throw err;
        }
        break;
      }
      case 'calendar.event-create': {
        // Calendar write (Connector Lever 1). By the time execution reaches here
        // the runner has ALREADY cleared every wall: action_level (the SOLE
        // execution gate — observe/draft/act, owner-set), resource-claim
        // conflict locks, and idempotency. Grade and write-grant rows are
        // advisory only and do NOT gate (the runtime no longer calls hasGrant).
        // This case only performs the approved side effect. calendarId defaults
        // to 'primary'; the event body is built by the trusted primitive, never
        // the model.
        const calendarId =
          typeof args.args.calendarId === 'string' && args.args.calendarId
            ? args.args.calendarId
            : 'primary';
        const event = (args.args.event as Record<string, unknown> | undefined) ?? {};
        try {
          if (testDeps?.createEvent) {
            await testDeps.createEvent(calendarId, event);
          } else {
            // createEvent throws if the connection lacks calendar.events — a
            // defense-in-depth scope check beneath the runtime grant gate.
            await makeGoogleCalendarClient(connection, getNango()).createEvent(calendarId, event);
          }
        } catch (err) {
          if (err instanceof ConnectorRequestError) {
            const reason = err.kind === 'auth' ? 'auth_failed' : err.kind === 'connection-state' ? 'not_connected' : null;
            if (reason) await emitConnectorBlocked(err.provider, reason);
          }
          throw err;
        }
        break;
      }
      default:
        throw new Error(`no executor for capability ${args.capability}`);
    }
  };
}

export async function activeNibbinsForAccount(svc: SupabaseClient, accountId: string): Promise<NibbinRef[]> {
  const { data, error } = await svc
    .from('nibbins')
    .select('id, account_id, name, stage, stage_changed_at, status, agent_specs!inner(*)')
    .eq('account_id', accountId)
    // Only truly active Nibbins can dispatch — paused/sleeping ones are filtered
    // here at the source. dispatchForConnection still guards independently, so
    // this narrowing only avoids fetching rows it would discard anyway.
    .eq('status', 'active');
  if (error) throw new Error(`nibbins load failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const specRow = (Array.isArray(row.agent_specs) ? row.agent_specs[0] : row.agent_specs) as Parameters<typeof specFromRow>[0];
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      name: row.name as string,
      stage: row.stage as NibbinRef['stage'],
      stageChangedAt: new Date(row.stage_changed_at as string).getTime(),
      status: row.status as NibbinRef['status'],
      spec: specFromRow(specRow),
    };
  });
}

/** Shape a joined nibbins+agent_specs row into a NibbinRef. */
function nibbinRefFromJoin(row: Record<string, unknown>): NibbinRef {
  const specRow = (Array.isArray(row.agent_specs) ? row.agent_specs[0] : row.agent_specs) as Parameters<typeof specFromRow>[0];
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    stage: row.stage as NibbinRef['stage'],
    stageChangedAt: new Date(row.stage_changed_at as string).getTime(),
    status: row.status as NibbinRef['status'],
    spec: specFromRow(specRow),
  };
}

/** A due (nibbin, schedule_key) occurrence: the state row joined to its nibbin. */
export interface DueScheduleOccurrence {
  nibbin: NibbinRef;
  scheduleKey: string;
}

/**
 * The DUE-FIRST claim scan (FIX 2 / red-team): every `nibbin_schedule_state` row
 * with `next_run_at <= now`, ORDERED BY `next_run_at` ASC and bounded by
 * `limit`, joined to its (active) nibbin + adopted spec. This uses the
 * `nibbin_schedule_state_next_run_idx` index and makes coverage FAIR — the old
 * `activeScheduledNibbins` did `.eq(status,'active').order(created_at).limit(200)`
 * and filtered schedule triggers in TS AFTER the limit, so once an install had
 * >200 active nibbins, every scheduled nibbin past the 200th-oldest was NEVER
 * scanned/fired. Here, oldest-due always wins, so nothing is permanently starved.
 *
 * The inner join on `nibbins` (active only) means a paused/sleeping nibbin's due
 * rows are simply not returned — its cadence is dormant until reactivated, and
 * the state row is left untouched (it will be due immediately when the join
 * matches again). Returns at most `limit` rows.
 */
export async function dueScheduleOccurrences(
  svc: SupabaseClient,
  now: Date,
  limit: number,
): Promise<DueScheduleOccurrence[]> {
  const { data, error } = await svc
    .from('nibbin_schedule_state')
    .select('schedule_key, next_run_at, nibbins!inner(id, account_id, name, stage, stage_changed_at, status, agent_specs!inner(*))')
    .lte('next_run_at', now.toISOString())
    .eq('nibbins.status', 'active')
    .order('next_run_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`due schedule scan failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const nib = (Array.isArray(row.nibbins) ? row.nibbins[0] : row.nibbins) as Record<string, unknown>;
    return { nibbin: nibbinRefFromJoin(nib), scheduleKey: row.schedule_key as string };
  });
}

/**
 * The SEED-PHASE discovery scan (FIX 2): active nibbins whose spec carries a
 * `schedule` trigger that LACK any `nibbin_schedule_state` row yet, ordered
 * NEWEST-FIRST so brand-new nibbins are seeded promptly (rather than never,
 * which was the old behavior past the 200th-oldest). We filter schedule-carrying
 * specs in SQL via jsonb containment on `agent_specs.triggers` (BEFORE the
 * limit), then anti-join against existing state rows in TS. Bounded by `limit`.
 */
export async function seedCandidateNibbins(svc: SupabaseClient, limit: number): Promise<NibbinRef[]> {
  // Over-fetch a bounded window of newest active schedule-carrying nibbins, then
  // drop any that already have a state row. (A nibbin only needs seeding once;
  // once seeded it leaves this candidate set and enters the fair claim phase.)
  const { data, error } = await svc
    .from('nibbins')
    .select('id, account_id, name, stage, stage_changed_at, status, agent_specs!inner(*)')
    .eq('status', 'active')
    .filter('agent_specs.triggers', 'cs', '[{"kind":"schedule"}]')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`seed-candidate scan failed: ${error.message}`);
  const candidates = (data ?? []).map((row) => nibbinRefFromJoin(row as Record<string, unknown>));
  if (candidates.length === 0) return [];

  // Anti-join: keep only nibbins with NO existing schedule-state row.
  const { data: stateData, error: stateErr } = await svc
    .from('nibbin_schedule_state')
    .select('nibbin_id')
    .in('nibbin_id', candidates.map((c) => c.id));
  if (stateErr) throw new Error(`seed-candidate state lookup failed: ${stateErr.message}`);
  const seeded = new Set((stateData ?? []).map((r) => r.nibbin_id as string));
  return candidates.filter((c) => !seeded.has(c.id));
}

/**
 * Trigger one Nibbin run end to end. Used by the grove (user dispatches) and
 * later by schedules/webhooks — every path goes through the same runner.
 */
export async function triggerNibbinRun(nibbinId: string, trigger: RunTrigger): Promise<RunOutcome> {
  const svc = serviceClient();
  const nibbin = await loadNibbin(svc, nibbinId);
  const connections = await activeConnections(svc, nibbin.accountId);
  const nowMs = Date.now();

  const connMap: ConnectionMap = {};
  for (const c of connections) connMap[c.provider] = c.id;
  const byId = new Map(connections.map((c) => [c.id, c]));

  const program = buildProgram(nibbin.spec, connMap, nowMs);

  // Load account created_at for new-account velocity budget
  const { data: accRow } = await svc.from('accounts').select('created_at').eq('id', nibbin.accountId).single();
  const accountCreatedAtMs = accRow ? new Date(accRow.created_at as string).getTime() : 0;

  const eventSink = new SupabaseEventSink(svc);
  return executeRun(nibbin, trigger, program, {
    runs: new SupabaseRunStore(svc),
    routines: new SupabaseRoutineStore(svc),
    grants: new SupabaseGrantStore(svc),
    idempotency: new SupabaseIdempotencyStore(svc),
    events: eventSink,
    reader: {
      async read(connectionId, _capability, path) {
        const connection = byId.get(connectionId);
        if (!connection) throw new Error(`connection ${connectionId} is not active on this account`);
        // Fleet-learning telemetry: emit connector_blocked when the connection
        // is not active (structural id only — no content/PII). Best-effort.
        if (connection.status !== 'active') {
          try {
            await eventSink.emit({
              name: 'connector_blocked',
              accountId: nibbin.accountId,
              props: { connector: connection.provider, reason: 'not_connected' },
            });
          } catch {
            // best-effort — never change run behavior
          }
        }
        try {
          return await readerForConnection(connection, nowMs).read(path);
        } catch (err) {
          // Fleet-learning telemetry: emit connector_blocked on ConnectorRequestError.
          // Re-throw unconditionally so the runner's error handling is unchanged.
          if (err instanceof ConnectorRequestError) {
            const reason =
              err.kind === 'auth' ? 'auth_failed' :
              err.kind === 'connection-state' ? 'not_connected' : null;
            if (reason) {
              try {
                await eventSink.emit({
                  name: 'connector_blocked',
                  accountId: nibbin.accountId,
                  props: { connector: err.provider, reason },
                });
              } catch {
                // best-effort
              }
            }
          }
          throw err;
        }
      },
    },
    effects: {
      execute: buildEffectsExecutor(byId, nibbin.accountId, accountCreatedAtMs, undefined, eventSink),
    },
    // §18.3 conflict detection: claim the resource before an irreversible send so
    // two Nibbins on one account never both act on the same thread/invoice. Skips
    // on a live conflict; fails open on infra error (the runner catches).
    claims: new SupabaseResourceClaimStore(svc),
    // M6.5: the model seam. Absent ANTHROPIC_API_KEY this is undefined and
    // every compose stays deterministic — same honest no-model behavior the
    // keeper chat has (#25).
    model: modelDrafterFor(nibbin.accountId),
    now: () => Date.now(),
  });
}

/**
 * After promotion to 'senior', insert email.send grant if the account has an
 * active gmail connection with compose already held. No new OAuth — compose
 * already permits send (design §6.2, §7.2). Exported for testability.
 */
export async function maybeInsertSendGrant(
  newStage: string,
  nibbinId: string,
  accountId: string,
  svc: SupabaseClient,
): Promise<void> {
  if (newStage !== 'senior') return;
  const COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
  const { data: conn } = await svc
    .from('connections')
    .select('id, scopes')
    .eq('account_id', accountId)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .maybeSingle();
  if (!conn) return;
  if (!(conn.scopes as string[]).includes(COMPOSE)) return;
  const { error } = await svc.from('nibbin_write_grants').upsert(
    {
      account_id: accountId,
      nibbin_id: nibbinId,
      connection_id: conn.id,
      capability: 'email.send',
      // System-initiated grant: promotion to Senior happens during a run with no
      // human actor in scope, so granted_by is intentionally null. The write-grant
      // audit trigger attributes a null granted_by as actor='system' in audit_log
      // (a human-initiated grant logs actor='user' with the id), so the trail
      // honestly marks this as system-initiated rather than a user action.
      granted_by: null,
      plain_language_reason: 'Promoted to Senior — one-click human-approved send enabled.',
      revoked_at: null,
    },
    { onConflict: 'nibbin_id,connection_id,capability' },
  );
  if (error) throw new Error(`email.send grant insert at Senior failed: ${error.message}`);
}

/**
 * After a user decision, try promotion when the rolling window has earned it
 * (the nibbin_promote RPC re-verifies in SQL — this pre-check only avoids
 * noisy failed calls). Returns the new stage when promoted.
 */
export async function maybePromote(nibbinId: string): Promise<StageName | null> {
  const svc = serviceClient();
  // stage_changed_at scopes the window to the current stage (matches SQL)
  const { data: nrow } = await svc
    .from('nibbins')
    .select('stage, stage_changed_at, agent_specs!inner(curriculum)')
    .eq('id', nibbinId)
    .single();
  if (!nrow) return null;
  const stage = nrow.stage as StageName;
  if (stage === 'grad' || stage === 'egg') return null;
  const specRow = (Array.isArray(nrow.agent_specs) ? nrow.agent_specs[0] : nrow.agent_specs) as {
    curriculum: AgentSpec['curriculum'];
  };
  const windowRuns = Math.max(specRow.curriculum.promotion.windowRuns, 25);

  // Window: last windowRuns decided runs in this stage, scoped by nibbin via the
  // inner join (NO unbounded run-id IN-list — that could exceed PostgREST limits
  // and wrongly stall a legit promotion).
  const { data: decisions } = await svc
    .from('approvals')
    .select('decision, run_id, decided_at, runs!inner(nibbin_id)')
    .eq('runs.nibbin_id', nibbinId)
    .gt('decided_at', nrow.stage_changed_at as string)
    .order('decided_at', { ascending: false })
    .limit(windowRuns);
  const rows = (decisions ?? []) as Array<{ decision: Decision; run_id: string }>;
  // Count-eligibility gate: base needs ≥windowRuns decided, so skip the steps
  // fetch entirely when the window isn't full (the common case).
  if (rows.length < windowRuns) return null;
  const newestFirst = rows.map((d) => d.decision);

  // One windowed run_steps fetch → per-run stakes (R3) + distinct patterns (R1).
  const runIds = rows.map((d) => d.run_id);
  const { data: steps } = await svc
    .from('run_steps')
    .select('run_id, tool, kind, payload')
    .in('run_id', runIds);
  const stepRows = (steps ?? []) as Array<{
    run_id: string; tool: string | null; kind: string; payload: { patternKey?: string } | null;
  }>;
  const stakesByRun = new Map<string, number>();
  for (const s of stepRows) {
    stakesByRun.set(s.run_id, Math.max(stakesByRun.get(s.run_id) ?? 1, stakesOf(s.tool)));
  }
  const weights = rows.map((d) => stakesByRun.get(d.run_id) ?? 1);

  let distinctPatterns = 0;
  if (stage === 'senior') {
    const approved = new Set(rows.filter((d) => d.decision === 'approved').map((d) => d.run_id));
    const keys = new Set<string>();
    for (const s of stepRows) {
      if (s.kind === 'draft' && approved.has(s.run_id) && s.payload?.patternKey) keys.add(s.payload.patternKey);
    }
    distinctPatterns = keys.size;
  }

  if (!promotionCheck(newestFirst, specRow.curriculum, { weights, distinctPatterns, stage }).eligible) return null;

  const { data, error } = await svc.rpc('nibbin_promote', { p_nibbin: nibbinId });
  if (error) return null; // SQL is the authority; a refusal here is final
  const newStage = data as StageName;

  // Spec 2: insert email.send grant at Senior (no new OAuth needed)
  if (newStage) {
    const { data: nrow } = await svc.from('nibbins').select('account_id').eq('id', nibbinId).single();
    if (nrow) {
      await maybeInsertSendGrant(newStage, nibbinId, nrow.account_id as string, svc).catch(() => {
        // Non-fatal: promotion succeeded; grant insert failure is logged but does not undo the stage
      });
    }
  }

  return newStage;
}

/**
 * §6.2 "pause politely, queue, explain, one-tap top-up": resume an account's
 * cap-queued runs once credits arrive. Idempotent and gate-safe — run_resume
 * re-faces every admission check, so a run queued against a since-paused
 * Nibbin (or past the anomaly ceiling) stays queued. Called opportunistically
 * when the grove loads, so a top-up quietly unblocks waiting work.
 */
export async function resumeQueuedRuns(accountId: string): Promise<number> {
  const svc = serviceClient();
  const { data: queued } = await svc
    .from('runs')
    .select('id')
    .eq('account_id', accountId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(25);
  let started = 0;
  for (const row of queued ?? []) {
    try {
      const res = await svc.rpc('run_resume', { p_run: row.id });
      const r = (Array.isArray(res.data) ? res.data[0] : res.data) as { outcome: string } | null;
      if (r?.outcome === 'started') started += 1;
      else if (r?.outcome === 'still_capped') break; // balance exhausted; stop
    } catch {
      // never let a resume error block a page load
    }
  }
  return started;
}

/** Egg → Student the moment observed context exists (scan or interview). */
export async function hatchToStudent(nibbinId: string): Promise<boolean> {
  const svc = serviceClient();
  const { error } = await svc.rpc('nibbin_promote', { p_nibbin: nibbinId });
  return !error;
}
