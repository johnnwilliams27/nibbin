import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceSummary, populationSummary } from '../src/lib/evidence.ts';

test('legacy protocol labels cannot establish a confirmed handshake', () => {
  const result = evidenceSummary({ assessment: { protocol_spoken: 'mcp', reachable: true } });
  assert.equal(result.state, 'response_received');
  assert.equal(result.confirmed, false);
});

test('a retrieved card and authentication wall stay distinct from protocol confirmation', () => {
  for (const state of ['card_retrieved', 'auth_walled', 'descriptor_read']) {
    assert.equal(evidenceSummary({ assessment: { evidence_state: state, protocol_spoken: 'mcp' } }).confirmed, false);
  }
  assert.equal(evidenceSummary({ assessment: { evidence_state: 'protocol_confirmed', protocol_spoken: 'mcp' } }).confirmed, true);
});

test('missing measurement and failed reading do not become an agent failure', () => {
  assert.equal(evidenceSummary({ assessment: null }).state, 'unmeasured');
  assert.equal(evidenceSummary({ assessment: { reachable: null } }).state, 'unmeasured');
});

test('population counts distinguish registrations, unique endpoints, and reference agents', () => {
  const rows = [
    { category: 'yield', endpoint: 'https://one.example/mcp', assessment: { evidence_state: 'protocol_confirmed' } },
    { category: 'yield', endpoint: 'https://one.example/mcp', assessment: { evidence_state: 'protocol_confirmed' } },
    { category: 'other', endpoint: 'https://two.example/mcp', assessment: null },
    { category: 'yield', endpoint: null, assessment: null },
    { category: 'yield', endpoint: 'https://reference.example', is_reference_agent: true, assessment: { evidence_state: 'protocol_confirmed' } },
  ];
  assert.deepEqual(populationSummary(rows), {
    registrations: 4, listed: 3, outsideCategories: 1, endpoints: 2,
    listedEndpoints: 1, checkedEndpoints: 1, confirmedEndpoints: 1,
  });
});
