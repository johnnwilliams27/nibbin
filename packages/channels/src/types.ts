export const CHANNEL_KINDS = ['push', 'email', 'sms', 'telegram', 'whatsapp'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export type Urgency = 'normal' | 'high' | 'urgent';
export type OutboundKind = 'escalation' | 'beat' | 'news' | 'reply';

/** A channel-agnostic action affordance (Telegram inline button / WA button /
 *  SMS reply-keyword). `open`/`deepLink` is how the secret boundary (N-P2) is
 *  honored: sensitive steps deep-link to the app instead of collecting on-channel. */
export interface ChannelAction {
  id: string;
  label: string;
  kind: 'approve' | 'deny' | 'open' | 'reply';
  deepLink?: string;
}

export interface OutboundChannelMessage {
  accountId: string;
  channel: ChannelKind;
  externalId: string;            // resolved verified destination (chat id / phone / device token)
  kind: OutboundKind;
  urgency: Urgency;
  body: string;                  // already channel-rendered text; never a secret
  deepLink?: string;
  actions?: ChannelAction[];
  requestId?: string;            // links a runtime AgentRequest/escalation
  expiresAt?: number;            // epoch ms
}

export interface DeliveryResult {
  delivered: boolean;
  providerMessageId?: string;
  costMicroUsd?: number;         // delivery COGS (SMS/WhatsApp); 0 for free channels
  error?: string;                // set when delivered=false
}

/** One per channel, behind a uniform interface (spec §5 "register, not rewrite"). */
export interface ChannelPort {
  readonly channel: ChannelKind;
  deliver(msg: OutboundChannelMessage): Promise<DeliveryResult>;
}
