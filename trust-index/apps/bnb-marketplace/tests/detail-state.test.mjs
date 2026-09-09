import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  normaliseDetailStatus, isCallable, isEndpointUnknown, isNotCallable, detailGapReason,
} from '../src/lib/detail-state.ts';

test('legacy and invalid statuses keep both the endpoint and gap cause unknown', () => {
  for (const value of [undefined, null, '', 'invalid', 'unread_unknown']) {
    const detail_status = normaliseDetailStatus(value);
    assert.equal(detail_status, 'unread_unknown');
    const row = { endpoint: null, protocols: [], detail_status };
    assert.equal(isEndpointUnknown(row), true);
    assert.equal(isNotCallable(row), false);
    assert.doesNotMatch(detailGapReason(detail_status), /rate limit/);
  }
});

test('only an explicitly read record establishes an absent declaration', () => {
  for (const detail_status of ['read', 'unread_rate_limited', 'unread_unknown', undefined]) {
    const row = { endpoint: null, protocols: [], detail_status };
    assert.equal(isNotCallable(row), detail_status === 'read');
    assert.equal(isEndpointUnknown(row), detail_status !== 'read');
  }
  assert.match(detailGapReason('unread_rate_limited'), /rate limit/);
});

test('an interface declaration survives missing detail without proving behaviour', () => {
  for (const row of [
    { endpoint: null, protocols: ['MCP'], detail_status: 'unread_unknown' },
    { endpoint: 'https://example.invalid', protocols: [], detail_status: 'unread_unknown' },
  ]) {
    assert.equal(isCallable(row), true);
    assert.equal(isEndpointUnknown(row), false);
    assert.equal(isNotCallable(row), false);
  }
});

test('snapshot rows partition without counting a gap as an absent declaration', () => {
  const { agents } = JSON.parse(readFileSync(new URL('../data/agents.json', import.meta.url), 'utf8'));
  for (const raw of agents) {
    const row = { ...raw, detail_status: normaliseDetailStatus(raw.detail_status) };
    assert.equal(Number(isCallable(row)) + Number(isEndpointUnknown(row)) + Number(isNotCallable(row)), 1);
    if (raw.detail_status !== 'read') assert.equal(isNotCallable(row), false);
  }
});
