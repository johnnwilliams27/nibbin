import assert from 'node:assert/strict';
import test from 'node:test';
const { hireProgress } = await import('../src/lib/hire-progress.ts').catch(() => ({}));

test('hire progress follows confirmed state, not a pending action or quote alone', () => {
  assert.equal(typeof hireProgress, 'function');
  for (const [connected, quoted, status, current] of [
    [false, false, null, 0], [true, false, null, 1], [true, true, null, 2],
    [true, true, 0, 2], [true, true, 1, 3], [true, true, 2, 3],
    [true, true, 3, 4], [false, false, 3, 4],
  ]) assert.equal(hireProgress(connected, quoted, status).current, current);
});

test('rejected, expired and unknown jobs never appear ready for a completed-hire review', () => {
  assert.equal(typeof hireProgress, 'function');
  for (const status of [4, 5, 6, -1]) {
    const progress = hireProgress(true, true, status);
    assert.equal(progress.current, null);
    assert.ok(progress.notice);
  }
});
