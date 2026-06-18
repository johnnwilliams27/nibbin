import type { InboundChannelMessage } from '../inbound/types';

export type Intent =
  | { kind: 'approval'; requestId: string; decision: 'approve' | 'deny' }
  | { kind: 'status'; text: string }
  | { kind: 'work'; text: string };

const WORK_VERBS = /\b(draft|write|send|chase|schedule|follow ?up|create|reply|cancel|pay|book|update)\b/i;
const QUESTION = /\?|\b(what|when|why|how|did|is|are|status|show|tell me)\b/i;

export function classifyIntent(inbound: InboundChannelMessage): Intent {
  if (inbound.inReplyTo && inbound.action) {
    return { kind: 'approval', requestId: inbound.inReplyTo, decision: inbound.action };
  }
  // imperative work verbs win over question words ("draft and send me X")
  if (WORK_VERBS.test(inbound.text)) return { kind: 'work', text: inbound.text };
  if (QUESTION.test(inbound.text)) return { kind: 'status', text: inbound.text };
  return { kind: 'status', text: inbound.text };
}
