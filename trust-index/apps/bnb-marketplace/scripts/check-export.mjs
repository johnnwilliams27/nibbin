// Verify the actual public HTML, after npm run build, not just helper outputs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = process.env.TRUST_INDEX_DATA || 'data/agents.json';
const { agents } = JSON.parse(readFileSync(resolve(source), 'utf8'));
let checked = 0;
for (const row of agents) {
  if (row.category === 'other' || row.is_reference_agent || row.endpoint !== null) continue;
  const html = readFileSync(resolve('out/agent', String(row.chain_id), String(row.token_id), 'index.html'), 'utf8');
  const expected = row.detail_status === 'read'
    ? 'No endpoint declared in the registry detail we read'
    : 'We do not know whether this agent can be hired';
  assert.ok(html.includes(expected), `Missing evidence-limited copy for ${row.agent_id}`);
  assert.ok(!html.includes('This agent cannot be hired'), `Unproven hiring claim for ${row.agent_id}`);
  assert.ok(!html.includes('exists in the registry and nowhere else'), `Unproven existence claim for ${row.agent_id}`);
  checked++;
}
const homepage = readFileSync(resolve('out/index.html'), 'utf8');
assert.ok(!homepage.includes('The rest cannot be hired at all'), 'Old homepage absence claim remains');
console.log(`Verified evidence-limited hire copy on ${checked} exported agent pages and homepage.`);
