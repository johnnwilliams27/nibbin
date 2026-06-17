import { describe, it, expect, vi } from 'vitest';

vi.mock('@nibbin/redaction', () => ({
  segmentStudy: vi.fn(async (studyId: string) => ({
    version: 1, studyId, studyDays: 1, capturedFrom: '2026-06-19', capturedTo: '2026-06-20', workflows: [],
  })),
}));

import { syncStudy, filterPacket, type DiagnosisPacket, type ReviewDecision } from '../src/ui/sync-study.js';

function packet(keys: string[] = ['email.general', 'payments.invoices']): DiagnosisPacket {
  return {
    version: 1,
    studyId: 's',
    studyDays: 14,
    capturedFrom: '2026-06-01T00:00:00Z',
    capturedTo: '2026-06-15T00:00:00Z',
    workflows: keys.map((key) => ({
      key,
      label: key,
      category: 'other',
      apps: ['App'],
      minutesObserved: 10,
      sessions: 1,
    })),
  } as DiagnosisPacket;
}

function bridge() {
  return {
    reviewEvents: async () => [],
    accessToken: async () => 'tok',
    sendControl: vi.fn(async () => {}),
  };
}

const okFetch = () =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    ({ ok: true, status: 200 }) as unknown as Response);

describe('syncStudy review gate', () => {
  it('does not upload until the review resolves', async () => {
    const fetchFn = okFetch();
    let resolveReview!: (d: ReviewDecision) => void;
    const review = (_p: DiagnosisPacket) =>
      new Promise<ReviewDecision>((res) => { resolveReview = res; });

    const pending = syncStudy({ studyId: 's', bridge: bridge(), now: 'n', fetchFn, review });
    await new Promise((r) => setTimeout(r, 0)); // let build + review start
    expect(fetchFn).not.toHaveBeenCalled();

    resolveReview({ action: 'send', packet: packet() });
    await pending;
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('uploads exactly the reviewed (filtered) packet', async () => {
    const fetchFn = okFetch();
    const reviewed = packet(['payments.invoices']);
    const res = await syncStudy({
      studyId: 's', bridge: bridge(), now: 'n', fetchFn,
      review: async () => ({ action: 'send', packet: reviewed }),
    });
    expect(res.ok).toBe(true);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.workflows.map((w: { key: string }) => w.key)).toEqual(['payments.invoices']);
  });

  it('cancel uploads nothing and deletes nothing', async () => {
    const fetchFn = okFetch();
    const b = bridge();
    const res = await syncStudy({
      studyId: 's', bridge: b, now: 'n', fetchFn,
      review: async () => ({ action: 'cancel' }),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(b.sendControl).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'review_cancelled' });
  });

  it('delete instead wipes locally and uploads nothing', async () => {
    const fetchFn = okFetch();
    const b = bridge();
    const res = await syncStudy({
      studyId: 's', bridge: b, now: 'n', fetchFn,
      review: async () => ({ action: 'delete' }),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(b.sendControl).toHaveBeenCalledWith('delete_everything');
    expect(res).toEqual({ ok: true, deleted: true });
  });

  it('filterPacket drops workflows by key', () => {
    const filtered = filterPacket(packet(['a', 'b']), new Set(['a']));
    expect(filtered.workflows.map((w) => w.key)).toEqual(['b']);
  });
});

describe('syncStudy (C3 ordering)', () => {
  it('advances the study only after a 200', async () => {
    const b = bridge();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: b, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(true);
    expect(b.sendControl).toHaveBeenCalledWith('synthesis_complete');
    expect(onState).toHaveBeenCalledWith('done');
  });

  it('does NOT advance the study when upload fails (raw data preserved)', async () => {
    const b = bridge();
    const fetchFn = vi.fn(async () => new Response('err', { status: 502 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: b, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(false);
    expect(b.sendControl).not.toHaveBeenCalled(); // C3: no deletion before packet is off-device
    expect(onState).toHaveBeenCalledWith('error');
  });
});
