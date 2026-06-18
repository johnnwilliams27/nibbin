import type { ChannelPort, DeliveryResult, OutboundChannelMessage } from '../types.js';

export interface NotificationsFloorStore {
  /** Insert an in-app notifications-leaf row (idempotent on its own anchor). */
  insertNotification(
    accountId: string,
    n: { kind: string; sourceId: string; title: string; body: string; payload: Record<string, unknown> },
  ): Promise<void>;
}

const TITLE: Record<OutboundChannelMessage['kind'], string> = {
  escalation: 'A Nibbin needs you',
  beat: 'A note from your grove',
  news: 'News from your grove',
  reply: 'A reply from your grove',
};

/** The terminal fallback (§10): the in-app leaf always succeeds. */
export function floorAdapter(store: NotificationsFloorStore): ChannelPort {
  return {
    channel: 'push',
    async deliver(msg: OutboundChannelMessage): Promise<DeliveryResult> {
      await store.insertNotification(msg.accountId, {
        kind: 'beat',
        sourceId: msg.requestId ?? `${msg.kind}:${msg.expiresAt ?? ''}:${msg.body.slice(0, 32)}`,
        title: TITLE[msg.kind],
        body: msg.body,
        payload: { deepLink: msg.deepLink ?? null, actions: msg.actions ?? [], requestId: msg.requestId ?? null },
      });
      return { delivered: true, costMicroUsd: 0 };
    },
  };
}
