import type { ChannelKind } from '../types';

export interface InboundChannelMessage {
  channel: ChannelKind;
  externalId: string;
  text: string;
  inReplyTo?: string;      // a requestId, parsed from a button/keyword
  action?: 'approve' | 'deny';
  startNonce?: string;     // a linking nonce
  receivedAt: number;      // epoch ms
  /** Plan-session callback action (Task 4: Telegram button callback_data). */
  planAction?: 'ps:go' | 'ps:cancel' | 'pw:approve' | 'pw:reject';
}

export interface InboundResult {
  status: 'accepted' | 'ignored_unverified' | 'ignored_expired' | 'bad_signature' | 'linked';
}
