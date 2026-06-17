import { describe, it, expect, vi } from 'vitest';
import { fetchGmailDelta } from './gmail-delta';
import type { GmailDeltaDeps } from './gmail-delta';

const connectionId = 'conn-1';
const accountId = 'acct-1';

describe('fetchGmailDelta', () => {
  it('uses the stored historyId as the cursor', async () => {
    const historyList = vi.fn().mockResolvedValue({
      messages: [{ id: 'msg-1', threadId: 'thr-1' }],
      historyId: '9999',
    });
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId: vi.fn() };
    const result = await fetchGmailDelta(connectionId, accountId, { historyId: '1234' }, deps);
    expect(historyList).toHaveBeenCalledWith('1234', undefined);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      provider: 'gmail',
      connectionId,
      accountId,
      kind: 'message.received',
      dedupeKey: 'gmail:conn-1:msg-1',
      historyId: '9999',
    });
    expect(result.newHistoryId).toBe('9999');
  });

  it('seeds cursor from getProfileHistoryId when webhook_state has no historyId', async () => {
    const getProfileHistoryId = vi.fn().mockResolvedValue('5000');
    const historyList = vi.fn().mockResolvedValue({ messages: [], historyId: '5001' });
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId };
    await fetchGmailDelta(connectionId, accountId, {}, deps);
    expect(getProfileHistoryId).toHaveBeenCalledOnce();
    expect(historyList).toHaveBeenCalledWith('5000', undefined);
  });

  it('returns empty events and preserves cursor when history.list returns no messages', async () => {
    const historyList = vi.fn().mockResolvedValue({ messages: [], historyId: '2000' });
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId: vi.fn() };
    const result = await fetchGmailDelta(connectionId, accountId, { historyId: '1999' }, deps);
    expect(result.events).toHaveLength(0);
    expect(result.newHistoryId).toBe('2000');
  });

  it('passes the AbortSignal through to historyList', async () => {
    const historyList = vi.fn().mockResolvedValue({ messages: [], historyId: '1' });
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId: vi.fn() };
    const ctrl = new AbortController();
    await fetchGmailDelta(connectionId, accountId, { historyId: '0' }, deps, ctrl.signal);
    expect(historyList).toHaveBeenCalledWith('0', ctrl.signal);
  });

  it('resyncs from the current historyId when history.list 404s on an expired cursor', async () => {
    const err = Object.assign(new Error('Requested entity was not found.'), { status: 404 });
    const historyList = vi.fn().mockRejectedValue(err);
    const getProfileHistoryId = vi.fn().mockResolvedValue('7000');
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId };
    const result = await fetchGmailDelta(connectionId, accountId, { historyId: '1234' }, deps);
    expect(historyList).toHaveBeenCalledWith('1234', undefined);
    expect(getProfileHistoryId).toHaveBeenCalledOnce();
    expect(result.events).toHaveLength(0);
    expect(result.newHistoryId).toBe('7000');
  });

  it('rethrows non-404 errors from history.list', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const historyList = vi.fn().mockRejectedValue(err);
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId: vi.fn() };
    await expect(
      fetchGmailDelta(connectionId, accountId, { historyId: '1234' }, deps),
    ).rejects.toThrow('rate limited');
  });

  it('deduplicates messageIds that appear more than once in the history delta', async () => {
    const historyList = vi.fn().mockResolvedValue({
      messages: [
        { id: 'msg-1', threadId: 'thr-1' },
        { id: 'msg-1', threadId: 'thr-1' },
      ],
      historyId: '3000',
    });
    const deps: GmailDeltaDeps = { historyList, getProfileHistoryId: vi.fn() };
    const result = await fetchGmailDelta(connectionId, accountId, { historyId: '2999' }, deps);
    expect(result.events).toHaveLength(1);
  });
});
