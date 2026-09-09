import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../api/agent.mjs';
import { createRuntime } from '../lib/runtime.mjs';

function response() {
  return { headers: {}, code: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; } };
}

test('untrusted origins and unsupported methods cannot initialize signing runtime', async () => {
  assert.equal(typeof api.createHandler, 'function');
  const handler = api.createHandler(() => { throw new Error('must not initialize'); });
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://evil.example' } }, res);
  assert.equal(res.code, 403);
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  const method = response();
  await handler({ method: 'DELETE', headers: {} }, method);
  assert.equal(method.code, 405);
});

test('HTTP A2A negotiation returns real signed zero-price envelope and explicit reference card', async () => {
  assert.equal(typeof api.createHandler, 'function');
  const runtime = createRuntime({ REFERENCE_SELLER_PRIVATE_KEY: `0x${'0'.repeat(63)}1`, REFERENCE_SELLER_ORIGIN: 'https://reference.example' });
  const handler = api.createHandler(() => runtime);
  const card = response();
  await handler({ method: 'GET', headers: {} }, card);
  assert.equal(card.body.extensions.nibbin.reference_agent, true);
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://www.nibbin.com' }, body: {
    jsonrpc: '2.0', id: 'test-quote', method: 'message/send', params: { message: { parts: [
      { kind: 'data', data: { skill: 'negotiate', task_description: 'collateral=12500 debt=6200 threshold=0.825' } },
    ] } },
  } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://www.nibbin.com');
  assert.equal(res.body.result.parts[0].data.response.terms.price, '0');
  assert.match(res.body.result.parts[0].data.provider_sig, /^0x[0-9a-f]{130}$/i);
});
