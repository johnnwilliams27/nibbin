import { serviceClient } from '../supabase/service';
import {
  gateTurn,
  classifyIntent,
  type TurnGateDeps,
  type TurnGateConfig,
  type ChannelKind,
  type ChannelAction,
} from '@nibbin/channels';
import { buildPorts } from './ports';
import { handleInbound, type HandleInboundDeps, type WorkSession } from './conversation';
import { decideViaChannel } from '../runtime/decide';
import { asUuid } from './ingest';
import { anthropicGenerate, recordModelCall } from '../llm/client';
import { groveRouter } from '../grove/router';
import {
  keeperChat,
  buildKeeperContext,
  KEEPER_SYSTEM_PROMPT,
} from '@nibbin/keeper';
import type { TokenUsage } from '@nibbin/router';
import type { IngestDeps } from './ingest';
import {
  proposePlanForChannel,
  startPlanRunForChannel,
  respondToPlanRunForChannel,
} from '../planner/channel';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function turnLimitFromEnv(): number {
  const v = Number(process.env.CHANNELS_TURN_LIMIT_PER_DAY);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 50;
}

function smsSpendCapFromEnv(): number {
  const v = Number(process.env.CHANNELS_SMS_SPEND_CAP_MICROUSD);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 200_000;
}

function defaultSpendCapFromEnv(): number {
  const v = Number(process.env.CHANNELS_SPEND_CAP_MICROUSD);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1_000_000;
}

function anomalyMultiplierFromEnv(): number {
  const v = Number(process.env.CHANNELS_ANOMALY_MULTIPLIER);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function anomalyFloorFromEnv(): number {
  const v = Number(process.env.CHANNELS_ANOMALY_FLOOR);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
}

/** UTC YYYY-MM-DD for today — used as the channel_turn_take p_day key. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Gate deps — built over the service client
// ---------------------------------------------------------------------------

export function buildGateDeps(svc: ReturnType<typeof serviceClient>): TurnGateDeps {
  const smsSpendCap = smsSpendCapFromEnv();
  const defaultSpendCap = defaultSpendCapFromEnv();
  const turnLimit = turnLimitFromEnv();
  const anomalyMultiplier = anomalyMultiplierFromEnv();
  const anomalyFloor = anomalyFloorFromEnv();

  return {
    async take(accountId, channel) {
      const spendCap = channel === 'sms' ? smsSpendCap : defaultSpendCap;
      const { data, error } = await svc.rpc('channel_turn_take', {
        p_account: accountId,
        p_day: todayUtc(),
        p_channel: channel,
        p_turn_limit: turnLimit,
        p_channel_spend_cap_microusd: spendCap,
      });
      if (error) {
        // Fail closed: if the RPC errors, deny the turn rather than allow
        // an ungated call (AS-§11 / N15).
        console.error('[channels] channel_turn_take rpc failed — failing closed', error.message);
        return { granted: false, turns: 0, channelSpent: 0, warn: false };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        granted: Boolean(row?.granted),
        turns: Number(row?.turns ?? 0),
        channelSpent: Number(row?.channel_spent ?? 0),
        warn: Boolean(row?.warn),
      };
    },

    async anomaly(accountId, channel) {
      // AS-§18.4 adaptive baseline: anomalous when today's verified inbound far
      // exceeds the account's 7-day norm. Fail OPEN — advisory; the budget gate
      // (take) is the hard stop.
      const { data, error } = await svc.rpc('channel_inbound_anomaly', {
        p_account: accountId,
        p_channel: channel,
        p_multiplier: anomalyMultiplier,
        p_floor: anomalyFloor,
      });
      if (error) {
        console.error('[channels] anomaly baseline rpc failed — failing open', error.message);
        return false;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.is_anomalous) return false;
      // breather + audit flag (no auto-pause).
      const { error: auditErr } = await svc.from('audit_log').insert({
        account_id: accountId, actor: 'system', actor_id: 'channel-anomaly',
        action: 'channel.anomaly_detected', subject: accountId,
        meta: { channel, today: row.today_count, baseline_per_day: row.baseline_per_day },
      });
      if (auditErr) console.error('[channels] anomaly audit insert failed', auditErr.message);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Answer dep — keeperChat pattern from keeperChatAction, channel-aware
// ---------------------------------------------------------------------------

async function buildAnswer(
  accountId: string,
  channel: ChannelKind,
  text: string,
): Promise<{ reply: string }> {
  const svc = serviceClient();

  // Fetch keeper name for the account (best-effort; null is fine).
  const { data: row } = await svc
    .from('grove_state')
    .select('keeper_name')
    .eq('account_id', accountId)
    .maybeSingle<{ keeper_name: string | null }>();

  // M6.5: null → no API key → keeperChat falls back to scripted floor (zero
  // cost, honest degradation, no tokens debited).
  const llm = anthropicGenerate();
  let lastCall: { model: string; usage: TokenUsage } | null = null;
  // Slice A signals captured in the closure (mirrors keeperChatAction).
  let lastLatencyMs: number | null = null;
  let failedCall: { model: string } | null = null;

  const generate = llm
    ? async (model: string, userText: string): Promise<string | null> => {
        const t0 = Date.now();
        try {
          const result = await llm({
            model,
            system: [
              { text: KEEPER_SYSTEM_PROMPT, cache: true },
              { text: buildKeeperContext({ keeperName: row?.keeper_name }) },
            ],
            messages: [{ role: 'user', content: userText }],
            maxTokens: 400,
            temperature: 0.7,
          });
          lastCall = { model: result.model, usage: result.usage };
          lastLatencyMs = Date.now() - t0;
          return result.text;
        } catch (err) {
          // Provider outage → scripted floor; the turn never fails the user.
          console.error(
            '[keeper/channel] model call failed — scripted floor',
            err instanceof Error ? err.message : err,
          );
          failedCall = { model };
          return null;
        }
      }
    : undefined;

  // Channel-originated chat: userId is null (no user session). The keeper
  // context omits the user id; the account id carries attribution for COGS.
  const reply = await keeperChat(
    text,
    { userId: '', keeperName: row?.keeper_name ?? null },
    { route: (r) => groveRouter.route(r), ...(generate ? { generate } : {}) },
  );

  if (lastCall !== null && reply.dispatchedTier !== null) {
    const call = lastCall as { model: string; usage: TokenUsage };
    // Key COGS on the tier the model was ACTUALLY dispatched at — same logic
    // as keeperChatAction (gate finding logic-skeptic P2). origin:'chat' +
    // channel lets the admin COGS view break down channel usage (N17).
    await recordModelCall({
      accountId,
      userId: null,
      tier: reply.dispatchedTier,
      task: 'chat',
      model: call.model,
      usage: call.usage,
      origin: 'chat',
      channel,
      degraded: reply.decision.degraded,
      latencyMs: lastLatencyMs,
      outcome: 'ok',
    });
  } else if (failedCall !== null) {
    // The dispatched chat call failed gracefully (scripted floor served) —
    // ledger the previously-invisible failure (Slice A): zero tokens, no content.
    const fc = failedCall as { model: string };
    await recordModelCall({
      accountId,
      userId: null,
      tier: reply.dispatchedTier ?? reply.decision.tier,
      task: 'chat',
      model: fc.model,
      usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      origin: 'chat',
      channel,
      outcome: 'error',
      // dispatchedDegraded, NOT decision.degraded — chat.ts resets decision to
      // the scripted floor (degraded:false) on a failed call (gate finding P3).
      degraded: reply.dispatchedDegraded,
      latencyMs: null,
    });
  }

  // Extract the plain-text reply from the keeper message card.
  const card = reply.message.card;
  const replyText = 'text' in card ? card.text : card.transcript;

  return { reply: replyText };
}

// ---------------------------------------------------------------------------
// Reply dep — deliver back on the originating channel
// ---------------------------------------------------------------------------

async function buildReply(
  channel: ChannelKind,
  externalId: string,
  body: string,
): Promise<void> {
  const { ports } = buildPorts(process.env as Record<string, string | undefined>);
  const port = ports.get(channel);
  if (!port) {
    // No live port for this channel in this environment (e.g. no Twilio env
    // vars for SMS, or WhatsApp not yet enabled). For replies we MUST use the
    // same channel the user wrote on — the floor adapter is NOT appropriate
    // here (it would deliver via push, not via the originating channel).
    // Log and no-op; the inbound is already persisted for observability.
    console.warn(`[channels] no live port for reply on ${channel} — no-op`);
    return;
  }
  await port.deliver({
    accountId: '',  // not used by the port adapters for replies
    channel,
    externalId,
    kind: 'reply',
    urgency: 'normal',
    body,
  });
}

/**
 * Reply with inline button actions (for plan propose / approval flows).
 * Mirrors buildReply but populates the `actions` field on the outbound message
 * so adapters (Telegram) can render inline keyboard buttons.
 * No-ops with a logged warning if no live port exists for the channel.
 */
async function buildReplyWithActions(
  channel: ChannelKind,
  externalId: string,
  body: string,
  actions: ChannelAction[],
): Promise<void> {
  const { ports } = buildPorts(process.env as Record<string, string | undefined>);
  const port = ports.get(channel);
  if (!port) {
    console.warn(`[channels] no live port for replyWithActions on ${channel} — no-op`);
    return;
  }
  await port.deliver({
    accountId: '',  // not used by the port adapters for replies
    channel,
    externalId,
    kind: 'reply',
    urgency: 'normal',
    body,
    actions,
  });
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function supabaseIngestDeps(): IngestDeps {
  const svc = serviceClient();
  const cfg: TurnGateConfig = {
    turnLimit: turnLimitFromEnv(),
    smsSpendCapMicroUsd: smsSpendCapFromEnv(),
    defaultSpendCapMicroUsd: defaultSpendCapFromEnv(),
  };

  return {
    async resolveAccount(channel, externalId) {
      const { data } = await svc.from('notification_channels')
        .select('account_id').eq('channel', channel).eq('external_id', externalId).eq('status', 'verified').maybeSingle();
      return data?.account_id ?? null;
    },
    async verifyBinding(nonce, externalId, label) {
      const { data } = await svc.rpc('verify_channel_binding', { p_nonce: nonce, p_external_id: externalId, p_external_label: label ?? null });
      return (data as string | null) ?? null;
    },
    async persistInbound(row) {
      const { error } = await svc.from('channel_messages').insert({
        account_id: row.accountId, channel: row.channel, direction: 'inbound', kind: 'inbound',
        status: 'received', verified: true, redacted_text: row.redactedText, redaction_rules: row.redactionRules,
        request_id: row.inReplyTo ?? null,
      });
      if (error) { console.error('channel_messages persistInbound failed', error); throw error; }
    },

    async handoff(verified) {
      // PRIVACY: feed the QUARANTINED text to the keeper — never raw inbound.text.
      // The quarantined wrapper (from Plan 03's ingest) strips PII/secrets before
      // any LLM call. Raw text stays in memory only; it is never persisted here.
      const textForKeeper = verified.quarantined.wrapped;

      const gateDeps = buildGateDeps(svc);

      // ── userId: resolve linked_by from the verified binding ───────────────
      // Mirrors decideViaChannel step (a)/(b): query notification_channels for
      // the status='verified' row and extract linked_by. If null (no attributable
      // actor), leave userId undefined — the work branch honest-degrades without
      // an authenticated user id (never initiates work without a linked user).
      const { data: binding } = await svc
        .from('notification_channels')
        .select('linked_by')
        .eq('channel', verified.inbound.channel)
        .eq('external_id', verified.inbound.externalId)
        .eq('status', 'verified')
        .maybeSingle();
      const linkedBy = (binding?.linked_by as string | null | undefined) ?? null;

      const deps: HandleInboundDeps = {
        classify: classifyIntent,

        gate: (accountId, channel) => gateTurn(accountId, channel, gateDeps, cfg),

        // P2-B: signature drops `text` — raw inbound text can structurally
        // never reach the model. The quarantined text is bound in the closure.
        answer: (accountId, channel) =>
          buildAnswer(accountId, channel, textForKeeper),

        reply: buildReply,

        replyWithActions: buildReplyWithActions,

        // P2-A: UUID-guard runId before it reaches decideViaChannel. A
        // non-UUID from attacker-influenced callback_data resolves to null
        // (treated as "couldn't action") instead of relying on a Postgres
        // type error as the only defence.
        decide: (channel, externalId, runId, decision) =>
          asUuid(runId)
            ? decideViaChannel(channel, externalId, runId, decision)
            : Promise.resolve(null),

        workEnabled: process.env.CHANNELS_INITIATED_WORK_ENABLED === 'true',

        // ── userId: linked_by from the verified binding ───────────────────
        // undefined when no linked_by — the work branch never initiates work
        // without an attributable actor (honest-degrade).
        ...(linkedBy !== null ? { userId: linkedBy } : {}),

        // ── session: channel_work_session store ───────────────────────────
        session: {
          async get(channel, externalId): Promise<WorkSession | null> {
            const { data: row } = await svc
              .from('channel_work_session')
              .select('*')
              .eq('channel', channel)
              .eq('external_id', externalId)
              .maybeSingle();
            if (!row) return null;
            return {
              accountId: row.account_id as string,
              channel: row.channel as string,
              externalId: row.external_id as string,
              kind: row.kind as 'proposed' | 'awaiting',
              plan: row.plan ?? undefined,
              planRunId: (row.plan_run_id as string | null) ?? undefined,
              requestId: (row.request_id as string | null) ?? undefined,
              requestKind: (row.request_kind as WorkSession['requestKind'] | null) ?? undefined,
            };
          },
          async set(s: WorkSession): Promise<void> {
            await svc.rpc('channel_work_session_set', {
              p_account: s.accountId,
              p_channel: s.channel,
              p_external_id: s.externalId,
              p_kind: s.kind,
              p_plan: s.plan ?? null,
              p_run: s.planRunId ?? null,
              p_request_id: s.requestId ?? null,
              p_request_kind: s.requestKind ?? null,
            });
          },
          async clear(channel, externalId): Promise<void> {
            await svc.rpc('channel_work_session_clear', {
              p_channel: channel,
              p_external_id: externalId,
            });
          },
        },

        // ── Planner delegates (Task 2 channel wrappers) ───────────────────
        proposeWork: (accountId, userId, text) =>
          proposePlanForChannel(accountId, userId, text),

        startWork: (accountId, userId, plan) =>
          startPlanRunForChannel(accountId, userId, plan),

        respondWork: (accountId, userId, runId, response) =>
          respondToPlanRunForChannel(accountId, userId, runId, response),
      };

      await handleInbound(
        { accountId: verified.accountId, inbound: verified.inbound },
        deps,
      );
    },
  };
}
