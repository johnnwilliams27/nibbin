import { serviceClient } from '../supabase/service';
import {
  gateTurn,
  classifyIntent,
  type TurnGateDeps,
  type TurnGateConfig,
  type ChannelKind,
} from '@nibbin/channels';
import { buildPorts } from './ports';
import { handleInbound, type HandleInboundDeps } from './conversation';
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

function inboundHourlyCapFromEnv(): number {
  const v = Number(process.env.CHANNELS_INBOUND_HOURLY_CAP);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
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
  const inboundHourlyCap = inboundHourlyCapFromEnv();

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
        return { granted: false, turns: 0, channelSpent: 0 };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        granted: Boolean(row?.granted),
        turns: Number(row?.turns ?? 0),
        channelSpent: Number(row?.channel_spent ?? 0),
      };
    },

    async anomaly(accountId, channel) {
      // v1 fixed-threshold anomaly check (AS-§18.4 baseline).
      // Count verified inbound channel_messages for (account, channel) in the
      // last hour; return true (anomalous) when it exceeds the hourly cap.
      // The full per-account, per-channel baseline model (AS-§18.4 "adaptive
      // threshold + deviation scoring") is a follow-up — this is a conservative
      // fixed cap that catches runaway inbound floods before any model call.
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error } = await svc
        .from('channel_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('channel', channel)
        .eq('direction', 'inbound')
        .eq('verified', true)
        .gte('created_at', since);
      if (error) {
        // Fail open here: anomaly detection is advisory; a query failure should
        // not block all turns. The budget gate (take) is the hard stop.
        console.error('[channels] anomaly count query failed — failing open', error.message);
        return false;
      }
      return (count ?? 0) > inboundHourlyCap;
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

  const generate = llm
    ? async (model: string, userText: string): Promise<string | null> => {
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
          return result.text;
        } catch (err) {
          // Provider outage → scripted floor; the turn never fails the user.
          console.error(
            '[keeper/channel] model call failed — scripted floor',
            err instanceof Error ? err.message : err,
          );
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

      const deps: HandleInboundDeps = {
        classify: classifyIntent,

        gate: (accountId, channel) => gateTurn(accountId, channel, gateDeps, cfg),

        // P2-B: signature drops `text` — raw inbound text can structurally
        // never reach the model. The quarantined text is bound in the closure.
        answer: (accountId, channel) =>
          buildAnswer(accountId, channel, textForKeeper),

        reply: buildReply,

        // P2-A: UUID-guard runId before it reaches decideViaChannel. A
        // non-UUID from attacker-influenced callback_data resolves to null
        // (treated as "couldn't action") instead of relying on a Postgres
        // type error as the only defence.
        decide: (channel, externalId, runId, decision) =>
          asUuid(runId)
            ? decideViaChannel(channel, externalId, runId, decision)
            : Promise.resolve(null),

        workEnabled: process.env.CHANNELS_INITIATED_WORK_ENABLED === 'true',
      };

      await handleInbound(
        { accountId: verified.accountId, inbound: verified.inbound },
        deps,
      );
    },
  };
}
