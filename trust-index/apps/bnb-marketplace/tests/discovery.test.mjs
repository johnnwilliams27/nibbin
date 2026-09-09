import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as discovery from '../src/lib/sorting.ts';

function agent(overrides = {}) {
  return {
    agent_id: '56:1', chain_id: 56, token_id: '1', name: 'Liquidity Keeper',
    description: 'Monitors positions', owner_address: '0xabc', image_url: null,
    category: 'yield', category_confidence: 0.6, category_evidence: 'self-description',
    protocols: ['MCP'], endpoint: null, x402_supported: false,
    detail_status: 'read', scan_total_score: null, scan_feedbacks: 0,
    scan_endpoint_verified: false, assessment: null, is_reference_agent: false,
    ...overrides,
  };
}

test('endpoint filter does not turn a protocol declaration into a connection URL', () => {
  assert.equal(discovery.passesFilter(agent(), 'callable'), false);
  assert.equal(discovery.passesFilter(agent({ endpoint: 'https://example.com/mcp' }), 'callable'), true);
});

test('search finds endpoint and capability terms together, ignoring case and extra whitespace', () => {
  assert.equal(typeof discovery.matchesSearch, 'function');
  const row = agent({ endpoint: 'https://venus.example/mcp', assessment: { tools_or_skills: ['get_health_factor'] } });
  assert.equal(discovery.matchesSearch(row, ' VENUS   health_factor '), true);
  assert.equal(discovery.matchesSearch(row, 'venus missing'), false);
  assert.equal(discovery.matchesSearch(agent(), 'null'), false);
  assert.equal(discovery.matchesSearch(agent(), '0xABC'), true);
});

test('URL state validates options, deduplicates filters and ignores category filters on a category page', () => {
  assert.equal(typeof discovery.readExplorerState, 'function');
  const state = discovery.readExplorerState('?q=venus&filter=callable,callable,bogus&category=yield,other&sort=bogus&view=table', 'grid', true);
  assert.deepEqual(state, { query: 'venus', filters: ['callable'], categories: ['yield'], sort: 'evidence', view: 'table' });
  assert.deepEqual(discovery.readExplorerState('?category=yield', 'table', false).categories, []);
  assert.equal(discovery.readExplorerState('?view=invalid', 'table', true).view, 'table');
});

test('shareable state round-trips and preserves unrelated query parameters', () => {
  assert.equal(typeof discovery.writeExplorerState, 'function');
  const state = { query: 'health + debt', filters: ['assessed'], categories: ['health_factor'], sort: 'tools', view: 'table' };
  const query = discovery.writeExplorerState(state, '?utm_source=demo&filter=old');
  assert.equal(new URLSearchParams(query).get('utm_source'), 'demo');
  assert.deepEqual(discovery.readExplorerState(query, 'grid', true), state);
  const cleared = discovery.writeExplorerState({ query: '', filters: [], categories: [], sort: 'name', view: 'grid' }, query);
  assert.equal(new URLSearchParams(cleared).has('q'), false);
  assert.equal(new URLSearchParams(cleared).has('filter'), false);
});

test('discovery keeps missing measurements and reference agents out of the ranked group', () => {
  assert.equal(typeof discovery.discoverAgents, 'function');
  const rows = [agent(), agent({ agent_id: 'ref', is_reference_agent: true }), agent({ agent_id: 'rated', assessment: { composite: 0 } })];
  const state = { query: '', filters: [], categories: [], sort: 'assessment', view: 'grid' };
  const result = discovery.discoverAgents(rows, state);
  assert.deepEqual(result.ranked.map(a => a.agent_id), ['rated']);
  assert.deepEqual(result.unranked.map(a => a.agent_id), ['56:1']);
});

test('default evidence order prefers observed exchanges, then declarations, then response records', () => {
  const row = (id, name, evidence_state, extra = {}) => agent({ agent_id: id, name, assessment: { composite: null, evidence_state, ...extra } });
  const rows = [
    row('response', 'C response', 'response_received'), row('card', 'B card', 'card_retrieved'),
    row('auth', 'A auth', 'auth_walled'), row('protocol-z', 'Z protocol', 'protocol_confirmed'),
    row('descriptor', 'A descriptor', 'descriptor_read'), row('protocol-a', 'A protocol', 'protocol_confirmed'),
    row('rate', 'B rate limit', 'rate_limited'), agent({ agent_id: 'missing', name: 'A missing' }),
    row('gap', 'B gap', 'unmeasured', { reachable: true }), row('unsupported', 'C unsupported', 'unsupported_transport'),
    row('ref', 'A reference', 'protocol_confirmed', { composite: 99 }),
  ];
  rows[rows.length - 1].is_reference_agent = true;
  const snapshot = JSON.stringify(rows);
  const state = discovery.readExplorerState('');
  assert.equal(state.sort, 'evidence');
  const result = discovery.discoverAgents(rows, state);
  assert.deepEqual(result.ranked.map(a => a.agent_id), ['protocol-a', 'protocol-z', 'descriptor', 'card', 'auth', 'rate', 'response']);
  assert.deepEqual(result.unranked.map(a => a.agent_id), ['missing', 'gap', 'unsupported']);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('explicit alphabetical and score sorts survive default changes and preserve real zero scores', () => {
  const rows = [agent({ agent_id: 'z', name: 'Zebra', assessment: { composite: 0, evidence_state: 'protocol_confirmed' } }), agent({ agent_id: 'a', name: 'Alpha' }), agent({ agent_id: 'high', name: 'Higher', assessment: { composite: 70 } })];
  const named = discovery.readExplorerState('?sort=name');
  assert.equal(named.sort, 'name');
  assert.deepEqual(discovery.discoverAgents(rows, named).ranked.map(a => a.agent_id), ['a', 'high', 'z']);
  const scored = discovery.discoverAgents(rows, discovery.readExplorerState('?sort=assessment'));
  assert.deepEqual(scored.ranked.map(a => a.assessment.composite), [70, 0]);
  assert.deepEqual(scored.unranked.map(a => a.agent_id), ['a']);
  assert.equal(discovery.readExplorerState(discovery.writeExplorerState(discovery.readExplorerState('?sort=evidence'))).sort, 'evidence');
});
