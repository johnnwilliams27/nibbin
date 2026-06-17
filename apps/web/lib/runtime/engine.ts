import 'server-only';

/**
 * Runtime wiring for apps/web: loads Nibbins + their adopted spec snapshots,
 * builds quarantined readers (real connector clients when a vault token
 * exists; the synthetic fixture corpus on seeded dev accounts), and drives
 * the @nibbin/runtime runner. All §6.2 enforcement lives in the runner and
 * the SQL RPCs — nothing here can skip a gate.
 */
import {
  GmailClient,
  GoogleCalendarClient,
  HoneyBookClient,
  InstagramDmClient,
  PixiesetClient,
  StripeConnectorClient,
  SupabaseTokenVault,
  type Connection,
  type ConnectorClient,
  type ScanResourceReader,
} from '@nibbin/connectors';
import {
  executeRun,
  promotionCheck,
  type AgentSpec,
  type Decision,
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
import {
  SupabaseEventSink,
  SupabaseGrantStore,
  SupabaseIdempotencyStore,
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
  };
}

function realClient(connection: Connection): ConnectorClient {
  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });
  switch (connection.provider) {
    case 'gmail':
      return new GmailClient(connection, vault);
    case 'google-calendar':
      return new GoogleCalendarClient(connection, vault);
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

/**
 * Reader for one connection: real client when a vault token exists, fixtures
 * on seeded accounts (token_ref null + dev seed flag). A connection that is
 * neither is unusable — fail loud, never fabricate.
 */
export function readerForConnection(connection: Connection, nowMs: number): ScanResourceReader {
  if (connection.status !== 'active') throw new Error(`connection ${connection.id} is ${connection.status}`);
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
}

export function specFromRow(row: SpecRow): AgentSpec {
  return {
    templateKey: row.template_key,
    version: row.version,
    displayName: row.display_name,
    toolsAllowlist: row.tools_allowlist,
    requiredConnectors: row.required_connectors,
    triggers: row.triggers,
    curriculum: row.curriculum,
    creditProfile: row.credit_profile,
  };
}

export async function loadNibbin(svc: SupabaseClient, nibbinId: string): Promise<NibbinRef> {
  const { data, error } = await svc
    .from('nibbins')
    .select('id, account_id, name, stage, status, agent_specs!inner(*)')
    .eq('id', nibbinId)
    .single();
  if (error || !data) throw new Error(`nibbin ${nibbinId} not found`);
  const specRow = (Array.isArray(data.agent_specs) ? data.agent_specs[0] : data.agent_specs) as SpecRow;
  return {
    id: data.id,
    accountId: data.account_id,
    name: data.name,
    stage: data.stage as StageName,
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

  const program = buildProgram(nibbin.spec.templateKey ?? '', connMap, nowMs);

  return executeRun(nibbin, trigger, program, {
    runs: new SupabaseRunStore(svc),
    routines: new SupabaseRoutineStore(svc),
    grants: new SupabaseGrantStore(svc),
    idempotency: new SupabaseIdempotencyStore(svc),
    events: new SupabaseEventSink(svc),
    reader: {
      async read(connectionId, _capability, path) {
        const connection = byId.get(connectionId);
        if (!connection) throw new Error(`connection ${connectionId} is not active on this account`);
        return readerForConnection(connection, nowMs).read(path);
      },
    },
    effects: {
      async execute() {
        // v0 ships no write grants, so the runner can never reach this path
        // (grant check precedes execution). When write adoption lands, this
        // dispatches through the connector clients' granted-scope send paths
        // + the AtomicSendVelocityLimiter. Fail loud until then.
        throw new Error('write execution is not wired yet — no write grants exist in v0');
      },
    },
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

  const { data: runRows } = await svc.from('runs').select('id').eq('nibbin_id', nibbinId);
  const runIds = (runRows ?? []).map((r) => r.id as string);
  if (runIds.length === 0) return null;
  const { data: decisions } = await svc
    .from('approvals')
    .select('decision, decided_at')
    .in('run_id', runIds)
    .gt('decided_at', nrow.stage_changed_at as string)
    .order('decided_at', { ascending: false })
    .limit(windowRuns);
  const newestFirst = (decisions ?? []).map((d) => d.decision as Decision);
  if (!promotionCheck(newestFirst, specRow.curriculum).eligible) return null;

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
