/**
 * Freeform Grovekeeper chat (post-onboarding). Every request goes through the
 * §6.3 router first; the decision (tier, model, degradation notice) comes back
 * with the reply so surfaces stay transparent about cost decisions.
 *
 * M2 ships a local scripted responder as the T0 floor — zero tokens, honest
 * about what exists today. A real model call slots in through `generate`
 * (given the routed model id) without changing this interface. C10 holds
 * regardless of what the model says: there are no tools here to call.
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

let chatSeq = 0;

export async function keeperChat(
  rawText: string,
  ctx: KeeperChatContext,
  deps: KeeperChatDeps,
): Promise<KeeperChatReply> {
  const text = rawText.trim().slice(0, CHAT_INPUT_MAX);

  const decision = await deps.route({
    userId: ctx.userId,
    task: 'chat',
    origin: 'chat',
    text,
    timezone: ctx.timezone,
  });

  let reply: string | null = null;
  if (deps.generate) {
    reply = await deps.generate(decision.model, text);
  }
  if (reply === null || reply === undefined || reply.trim() === '') {
    reply = scriptedReply(text);
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
  };
}
