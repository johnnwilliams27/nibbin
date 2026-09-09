import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/lib/activation.ts';

test('external connection links reject executable, credentialed and local destinations', () => {
  assert.equal(typeof api.publicEndpoint, 'function');
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@example.com', 'http://localhost:9000', 'http://127.1', 'http://2130706433', 'http://[::1]', 'http://10.1.2.3', 'http://192.168.1.4', 'http://169.254.169.254', 'http://[::ffff:127.0.0.1]', 'https://demo.local']) {
    assert.equal(api.publicEndpoint(url), null, url);
  }
  assert.equal(api.publicEndpoint('https://example.com/mcp'), 'https://example.com/mcp');
});

test('missing protocol never becomes an invented MCP configuration', () => {
  assert.equal(typeof api.connectionPlan, 'function');
  const plan = api.connectionPlan({ name: 'Sample', endpoint: 'https://example.com', protocols: [], assessment: null });
  assert.equal(plan.protocol, null);
  assert.equal(plan.config, null);
});

test('declared MCP creates connection details but descriptor limitations do not', () => {
  const row = { name: 'Sample agent', endpoint: 'https://example.com/mcp', protocols: ['MCP'], assessment: null };
  assert.deepEqual(JSON.parse(api.connectionPlan(row).config), { mcpServers: { 'sample-agent': { url: 'https://example.com/mcp' } } });
  assert.equal(api.connectionPlan({ ...row, assessment: { protocol_spoken: null, withheld_reason: 'transport stdio: harness_capability_missing' } }).config, null);
});

test('A2A stays an endpoint reference and unsafe URLs never enter configuration', () => {
  const row = { name: 'Sample', endpoint: 'https://example.com/card.json', protocols: ['A2A'], assessment: null };
  assert.equal(api.connectionPlan(row).protocol, 'a2a');
  assert.equal(api.connectionPlan(row).config, null);
  assert.equal(api.connectionPlan({ ...row, endpoint: 'javascript:alert(1)' }).url, null);
});
