/**
 * Listing grouping: collapsing what is one thing, and refusing to collapse what
 * is two.
 *
 * The cases here are taken from the live snapshot, because the whole risk in
 * this file is a rule that looks right in the abstract and merges strangers in
 * practice. `bubbleupdappos.workers.dev` is the one that decides it: twelve
 * deployments on one Cloudflare account must cluster, while two unrelated
 * accounts on the same `workers.dev` platform must not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroups,
  collapse,
  endpointHost,
  groupBadge,
  groupIndex,
  groupSummary,
  registrableDomain,
} from '../src/lib/grouping.ts';

let seq = 0;
function agent(over = {}) {
  seq += 1;
  return {
    agent_id: over.agent_id ?? `a${seq}`,
    name: 'Agent',
    description: 'does a thing',
    endpoint: 'https://one.example/mcp',
    assessment: null,
    ...over,
  };
}
const rated = (score) => ({ composite: score, coverage: 'thin', gates_fired: [] });

test('registrableDomain keeps the tenant label on a multi-tenant platform', () => {
  assert.equal(
    registrableDomain('cm-5268dad98979f28b-site-3d068a2fc837.bubbleupdappos.workers.dev'),
    'bubbleupdappos.workers.dev',
  );
  assert.equal(registrableDomain('my-app.vercel.app'), 'my-app.vercel.app');
  assert.equal(registrableDomain('svc.hevo-grid.fly.dev'), 'hevo-grid.fly.dev');
});

test('registrableDomain does not merge separate tenants of one platform', () => {
  const a = registrableDomain('x.alpha.workers.dev');
  const b = registrableDomain('y.beta.workers.dev');
  assert.notEqual(a, b);
  // The failure this guards: last-two-labels would make both `workers.dev`.
  assert.ok(a !== 'workers.dev' && b !== 'workers.dev');
});

test('registrableDomain handles ordinary domains, bare platforms and IPs', () => {
  assert.equal(registrableDomain('api.q402.quackai.ai'), 'quackai.ai');
  assert.equal(registrableDomain('quackai.ai'), 'quackai.ai');
  assert.equal(registrableDomain('workers.dev'), null, 'the platform itself names no tenant');
  assert.equal(registrableDomain('192.0.2.7'), '192.0.2.7');
  assert.equal(registrableDomain('localhost'), null);
  assert.equal(registrableDomain(''), null);
});

test('endpointHost rejects anything that is not a URL', () => {
  assert.equal(endpointHost('https://a.test/mcp'), 'a.test');
  assert.equal(endpointHost('not a url'), null);
  assert.equal(endpointHost(null), null);
  assert.equal(endpointHost(''), null);
});

test('many registrations on one endpoint collapse to a fan-out', () => {
  const rows = Array.from({ length: 4874 }, () => agent({ endpoint: 'https://q402.test/api' }));
  const [g, ...rest] = buildGroups(rows);
  assert.equal(rest.length, 0, 'one endpoint is one group');
  assert.equal(g.kind, 'fanout');
  assert.equal(g.registrations, 4874);
  assert.equal(g.endpoints, 1);
  assert.match(groupBadge(g), /4,874 registrations · one service/);
  assert.match(groupSummary(g), /measured the service once/);
});

test('one template across many endpoints on one account is a fleet, not a fan-out', () => {
  // The bubbleaiagent case: 12 URLs, 12 wallets, one Cloudflare account,
  // identical name and description, ten rated at 77.5 and two never assessed.
  const rows = Array.from({ length: 12 }, (_, i) =>
    agent({
      name: 'bubbleaiagent',
      description: 'ERC-8183 seller agent (bubbleai-agent)',
      endpoint: `https://cm-${i}-site.bubbleupdappos.workers.dev/.well-known/agent-card.json`,
      assessment: i < 10 ? rated(77.5) : null,
    }),
  );
  const groups = buildGroups(rows);
  assert.equal(groups.length, 1, 'twelve deployments read as one template');
  const [g] = groups;
  assert.equal(g.kind, 'fleet');
  assert.equal(g.registrations, 12);
  assert.equal(g.endpoints, 12, 'each deployment was measured at its own URL');
  assert.equal(g.rated, 10);
  assert.deepEqual(g.scores, [77.5]);
  assert.match(groupBadge(g), /12 deployments · measured separately/);
  const summary = groupSummary(g);
  assert.match(summary, /10 rated, all at 77.5/);
  assert.match(summary, /2 not assessed/, 'the gap is stated, never rounded into the pass');
});

test('a fleet reports a range when its deployments disagree', () => {
  const rows = [40, 55, 77.5].map((s, i) =>
    agent({
      name: 'fleeter',
      description: 'same text',
      endpoint: `https://n${i}.acct.workers.dev/a`,
      assessment: rated(s),
    }),
  );
  const [g] = buildGroups(rows);
  assert.equal(g.kind, 'fleet');
  assert.match(groupSummary(g), /3 rated, from 40 to 77.5/);
});

test('identical names on different operators never cluster', () => {
  const rows = [
    agent({ name: 'Agent', description: 'same', endpoint: 'https://a.alpha.workers.dev/x' }),
    agent({ name: 'Agent', description: 'same', endpoint: 'https://b.beta.workers.dev/x' }),
  ];
  assert.equal(buildGroups(rows).length, 2, 'a shared platform is not a shared operator');
});

test('a row without a name or description is never clustered', () => {
  const rows = [
    agent({ name: '', description: '', endpoint: 'https://a.acct.workers.dev/x' }),
    agent({ name: '', description: '', endpoint: 'https://b.acct.workers.dev/x' }),
  ];
  assert.equal(buildGroups(rows).length, 2);
});

test('an endpoint that is already a fan-out is not folded into a fleet', () => {
  // Two registrations share one URL, a third has its own on the same account
  // with matching text. The fan-out must stay visible as a service rather than
  // disappearing into a template cluster.
  const rows = [
    agent({ name: 'T', description: 'd', endpoint: 'https://a.acct.workers.dev/x' }),
    agent({ name: 'T', description: 'd', endpoint: 'https://a.acct.workers.dev/x' }),
    agent({ name: 'T', description: 'd', endpoint: 'https://b.acct.workers.dev/x' }),
  ];
  const groups = buildGroups(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.kind).sort(), ['fanout', 'single']);
});

test('a row with no usable endpoint stands alone', () => {
  const rows = [agent({ endpoint: null }), agent({ endpoint: null })];
  const groups = buildGroups(rows);
  assert.equal(groups.length, 2, 'we cannot say two unreachable rows share anything');
  assert.ok(groups.every((g) => g.kind === 'single'));
  assert.equal(groupBadge(groups[0]), null);
});

test('grouping preserves the order it was given, so the reader’s sort survives', () => {
  const rows = [
    agent({ agent_id: 'first', endpoint: 'https://z.test/a' }),
    agent({ agent_id: 'second', endpoint: 'https://y.test/a' }),
    agent({ agent_id: 'third', endpoint: 'https://z.test/a' }),
  ];
  const groups = buildGroups(rows);
  assert.deepEqual(groups.map((g) => g.leadId), ['first', 'second']);
});

test('collapse shows one lead per group, and members only when expanded', () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    agent({ agent_id: `m${i}`, endpoint: 'https://one.test/a' }),
  );
  const groups = buildGroups(rows);
  assert.deepEqual(collapse(rows, groups, new Set()).map((a) => a.agent_id), ['m0']);
  const open = collapse(rows, groups, new Set([groups[0].key])).map((a) => a.agent_id);
  assert.deepEqual(open, ['m0', 'm1', 'm2', 'm3', 'm4'], 'every registration stays reachable');
});

test('groupIndex finds a group from any member, not just its lead', () => {
  const rows = [
    agent({ agent_id: 'lead', endpoint: 'https://one.test/a' }),
    agent({ agent_id: 'member', endpoint: 'https://one.test/a' }),
  ];
  const index = groupIndex(buildGroups(rows));
  assert.equal(index.get('member').leadId, 'lead');
});

test('a single listing carries no badge and no summary', () => {
  const [g] = buildGroups([agent()]);
  assert.equal(g.kind, 'single');
  assert.equal(groupBadge(g), null);
  assert.equal(groupSummary(g), null);
});
