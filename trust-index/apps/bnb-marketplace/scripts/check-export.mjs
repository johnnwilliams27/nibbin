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

// A check that inspects nothing must not SAY it inspected something.
//
// This loop only examines rows with a NULL endpoint — the ones whose pages must
// say "we do not know whether this agent can be hired" rather than assert an
// absence we never measured. It verified 653 pages, then a dataset rebuild left
// every row with a non-null endpoint, so it verified 0 and still printed a pass.
// Nothing was broken; the guard had stopped guarding and reported that in a
// sentence which reads like it had checked something.
//
// The fix is not a fixed floor — zero is a legitimate count for a snapshot in
// which every registration declares an interface. It is to state the
// denominator and check against it: the export must cover exactly the rows that
// need the copy, and when no row needs it, the output has to say so plainly
// instead of implying a verification that did not happen.
const needing = agents.filter(
  (row) => row.category !== 'other' && !row.is_reference_agent && row.endpoint === null,
).length;
assert.equal(
  checked,
  needing,
  `check-export inspected ${checked} pages but ${needing} rows require the null-endpoint copy.`,
);
if (needing === 0) {
  console.log(
    'check-export: 0 of ' +
      `${agents.length} rows declare no endpoint, so no page needs the "we do not know whether ` +
      'this agent can be hired" copy. Nothing was verified — this is not a pass for that check. ' +
      'Homepage absence-claim check passed.',
  );
  process.exit(0);
}
console.log(`Verified evidence-limited hire copy on ${checked} exported agent pages and homepage.`);
