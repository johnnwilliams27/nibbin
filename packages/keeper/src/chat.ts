/**
 * Freeform Grovekeeper chat (post-onboarding). When a model caller is wired,
 * every request goes through the §6.3 router first; the decision (tier, model,
 * degradation notice) comes back with the reply so surfaces stay transparent
 * about cost decisions.
 *
 * M2 ships a local scripted responder as the T0 floor — zero tokens, honest
 * about what exists today. A real model call slots in through `generate`
 * (given the routed model id) without changing this interface. C10 holds
 * regardless of what the model says: there are no tools here to call.
 *
 * Without `generate` there is nothing to dispatch, so the router is never
 * consulted: consuming frontier budget or claiming degradation for work that
 * is never performed would both be dishonest (gate finding #25).
 */
import type { RouteDecision, RouteRequest } from '@nibbin/router';
import { CHAT } from './copy';
import type { KeeperExpression, KeeperMessage } from './types';

export interface KeeperChatContext {
  userId: string;
  keeperName?: string | null;
  timezone?: string;
}

export interface KeeperChatDeps {
  route: (req: RouteRequest) => Promise<RouteDecision>;
  /**
   * Optional model caller for the routed model. Returns the reply text, or
   * null to fall back to the local scripted responder. Never receives tools.
   */
  generate?: (model: string, text: string) => Promise<string | null>;
}

export interface KeeperChatReply {
  message: KeeperMessage;
  decision: RouteDecision;
  expression: KeeperExpression;
  /**
   * The tier a model was ACTUALLY dispatched at this turn, or null if no
   * model ran (scripted floor, or a routed call that came back empty/failed
   * — `decision` reports the scripted floor in that case for the user, but a
   * real call may still have been billed). COGS recording keys on THIS, never
   * `decision.tier`, so a degraded/failed turn can't mislabel a paid call as
   * t0 (gate finding logic-skeptic P2).
   */
  dispatchedTier: import('@nibbin/router').Tier | null;
  /** The model id actually called, or null — pairs with dispatchedTier. */
  dispatchedModel: string | null;
  /**
   * Whether the route that was ACTUALLY dispatched was degraded (budget forced
   * T2→T1), captured BEFORE the empty/failed-completion fallback resets
   * `decision` to the scripted floor (which is always degraded:false). The
   * failure-ledger keys on THIS, not `decision.degraded`, so a degraded-then-
   * failed chat turn is recorded as degraded:true (gate finding P3). False when
   * no model was dispatched.
   */
  dispatchedDegraded: boolean;
}

export const CHAT_INPUT_MAX = 2000;

/** The zero-cost local responder — the floor under T0. */
function scriptedReply(text: string): string {
  const t = text.toLowerCase();
  if (t.length === 0) return CHAT.empty;
  if (/(what can you do|help|what do you do|abilities|what are you|who are you)/.test(t)) return CHAT.abilities;
  if (/(credit|cost|price|charge|bill)/.test(t)) return CHAT.credits;
  if (/(privacy|data|read my|access|permission|secure)/.test(t)) return CHAT.privacy;
  return CHAT.fallback;
}

/**
 * The decision reported when no model caller is wired: the reply is the
 * scripted floor, no model is invoked, no budget is consulted. Honest by
 * construction — there is nothing to route.
 */
const SCRIPTED_FLOOR_DECISION: RouteDecision = {
  tier: 't0',
  model: 'scripted-floor',
  requestedTier: 't0',
  degraded: false,
  notice: null,
};

let chatSeq = 0;

export async function keeperChat(
  rawText: string,
  ctx: KeeperChatContext,
  deps: KeeperChatDeps,
): Promise<KeeperChatReply> {
  const text = rawText.trim().slice(0, CHAT_INPUT_MAX);

  let decision: RouteDecision = SCRIPTED_FLOOR_DECISION;
  let reply: string | null = null;
  // The tier/model a model was genuinely dispatched at — captured BEFORE any
  // empty-completion fallback rewrites `decision`, so COGS keys on the truth.
  let dispatchedTier: import('@nibbin/router').Tier | null = null;
  let dispatchedModel: string | null = null;
  let dispatchedDegraded = false;
  if (deps.generate) {
    decision = await deps.route({
      userId: ctx.userId,
      task: 'chat',
      origin: 'chat',
      text,
      timezone: ctx.timezone,
    });
    dispatchedTier = decision.tier;
    dispatchedModel = decision.model;
    dispatchedDegraded = decision.degraded;
    reply = await deps.generate(decision.model, text);
  }
  if (reply === null || reply === undefined || reply.trim() === '') {
    reply = scriptedReply(text);
    // #25 on the real path: the surface must describe what the user actually
    // received. A model failure after routing means the scripted floor
    // answered — report that, not the tier we tried to serve, and never the
    // degradation notice. The budget consult (and any spent unit) stays in
    // `budget`: the attempt happened, telemetry should say so.
    decision = { ...SCRIPTED_FLOOR_DECISION, classification: decision.classification, budget: decision.budget };
  }

  // Degradation is never silent (§6.3): the notice leads the reply.
  const full = decision.degraded && decision.notice ? `${decision.notice} ${reply}` : reply;

  chatSeq = (chatSeq + 1) % Number.MAX_SAFE_INTEGER;
  return {
    message: {
      id: `c-${chatSeq}`,
      from: 'keeper',
      card: { kind: 'prose', text: full, transcript: full },
    },
    decision,
    expression: 'presenting',
    dispatchedTier,
    dispatchedModel,
    dispatchedDegraded,
  };
}
