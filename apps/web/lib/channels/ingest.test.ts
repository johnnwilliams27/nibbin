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
});
