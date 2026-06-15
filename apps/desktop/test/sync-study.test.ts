// apps/desktop/test/sync-study.test.ts
import { describe, it, expect, vi } from 'vitest';

// Orchestration test: segmentation is covered in packages/redaction. Mock it so
// this file tests only build→upload→advance ordering (the C3 guard).
vi.mock('@nibbin/redaction', () => ({
  segmentStudy: vi.fn(async (studyId: string) => ({
    version: 1, studyId, studyDays: 1, capturedFrom: '2026-06-19', capturedTo: '2026-06-20', workflows: [],
  })),
}));

import { syncStudy } from '../src/ui/sync-study.js';

const events = [{ redaction: { review_state: 'auto' } } as never];

function bridgeStub(over: Partial<Record<string, unknown>> = {}) {
  return {
    reviewEvents: vi.fn(async () => events),
    accessToken: vi.fn(async () => 'tok'),
    sendControl: vi.fn(async () => {}),
    ...over,
  };
}

describe('syncStudy (C3 ordering)', () => {
  it('advances the study only after a 200', async () => {
    const bridge = bridgeStub();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: bridge as never, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(true);
    expect(bridge.sendControl).toHaveBeenCalledWith('synthesis_complete');
    expect(onState).toHaveBeenCalledWith('done');
  });

  it('does NOT advance the study when upload fails (raw data preserved)', async () => {
    const bridge = bridgeStub();
    const fetchFn = vi.fn(async () => new Response('err', { status: 502 }));
    const onState = vi.fn();
    const res = await syncStudy({ studyId: 's1', bridge: bridge as never, fetchFn, now: '2026-06-20T00:00:00Z', onState });
    expect(res.ok).toBe(false);
    expect(bridge.sendControl).not.toHaveBeenCalled(); // C3: no deletion before packet is off-device
    expect(onState).toHaveBeenCalledWith('error');
  });
});
