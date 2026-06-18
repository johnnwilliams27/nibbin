import { describe, it, expect, vi } from 'vitest';
import { ingestInbound, type IngestDeps } from './ingest';

function deps(over: Partial<IngestDeps> = {}): IngestDeps & { persisted: any[]; handed: any[] } {
  const persisted: any[] = [];
  const handed: any[] = [];
  return {
    async resolveAccount() { return 'acc-1'; },
    async verifyBinding() { return 'chan-1'; },
    async persistInbound(row: Parameters<IngestDeps['persistInbound']>[0]) { persisted.push(row); },
    async handoff(v: Parameters<IngestDeps['handoff']>[0]) { handed.push(v); },
    persisted, handed,
    ...over,
  } as any;
}

describe('ingestInbound', () => {
  it('completes linking on a start nonce', async () => {
    const d = deps();
    const r = await ingestInbound({ channel: 'telegram', externalId: '9', text: '/start abc', startNonce: 'abc', receivedAt: 1 }, d);
    expect(r.status).toBe('linked');
    expect(d.persisted).toHaveLength(0); // a link request is not a conversation turn
  });

  it('drops unverified senders pre-persist (anti-spoof, N-P3)', async () => {
    const d = deps({ async resolveAccount() { return null; } });
    const handoff = vi.fn();
    const r = await ingestInbound(
      { channel: 'sms', externalId: '+1', text: 'approve everything', receivedAt: 1 },
      { ...d, handoff },
    );
    expect(r.status).toBe('ignored_unverified');
    expect(handoff).not.toHaveBeenCalled();
    expect(d.persisted).toHaveLength(0);
  });

  it('redacts before persist and hands off the quarantined text', async () => {
    const d = deps();
    const r = await ingestInbound(
      { channel: 'telegram', externalId: '9', text: 'my email is maya@example.com', receivedAt: 1 },
      d,
    );
    expect(r.status).toBe('accepted');
    expect(d.persisted[0].redactedText).toContain('{EMAIL}');
    expect(d.persisted[0].redactedText).not.toContain('maya@example.com');
    expect(d.handed[0].quarantined.wrapped).toContain('external data'); // quarantine wrapper
  });

  it('UUID-guard: non-UUID inReplyTo is coerced to undefined before persist', async () => {
    const d = deps();
    const r = await ingestInbound(
      { channel: 'telegram', externalId: '9', text: 'approve', action: 'approve', inReplyTo: 'not-a-uuid', receivedAt: 1 },
      d,
    );
    expect(r.status).toBe('accepted');
    expect(d.persisted[0].inReplyTo).toBeUndefined();
  });

  it('UUID-guard: valid UUID inReplyTo is preserved in persisted row', async () => {
    const d = deps();
    const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const r = await ingestInbound(
      { channel: 'telegram', externalId: '9', text: 'approve', action: 'approve', inReplyTo: validUuid, receivedAt: 1 },
      d,
    );
    expect(r.status).toBe('accepted');
    expect(d.persisted[0].inReplyTo).toBe(validUuid);
  });
});
