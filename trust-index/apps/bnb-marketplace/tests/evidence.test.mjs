import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceSummary, populationSummary } from '../src/lib/evidence.ts';

test('legacy protocol labels cannot establish a confirmed handshake', () => {
  const result = evidenceSummary({ assessment: { protocol_spoken: 'mcp', reachable: true } });
  assert.equal(result.state, 'response_received');
  assert.equal(result.confirmed, false);
});

test('rated uncategorised registrations remain listed and shared ratings count once per URL', () => {
  const rows = [
    { category: 'other', endpoint: 'https://shared.example', assessment: { composite: 70 } },
    { category: 'yield', endpoint: 'https://shared.example', assessment: { composite: 70 } },
    { category: 'other', endpoint: null, assessment: null },
  ];
  const summary = populationSummary(rows);
  assert.equal(summary.listed, 2);
  assert.equal(summary.ratedRegistrations, 2);
  assert.equal(summary.ratedEndpoints, 1);
});

test('recorded card-to-service links count the tested service rather than discovery URLs', () => {
  const rows = ['one', 'two'].map((name) => ({
    category: 'yield', endpoint: `https://${name}.example/card.json`,
    assessment: { composite: 77.5, evidence_state: 'protocol_confirmed', evidence_endpoint: 'https://shared.example/a2a' },
  }));
  const summary = populationSummary(rows);
  assert.equal(summary.listedEndpoints, 2);
  assert.equal(summary.checkedEndpoints, 1);
  assert.equal(summary.confirmedEndpoints, 1);
  assert.equal(summary.ratedEndpoints, 1);
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
    listedEndpoints: 1, checkedEndpoints: 1, confirmedEndpoints: 1, ratedRegistrations: 0, ratedEndpoints: 0,
  });
});
