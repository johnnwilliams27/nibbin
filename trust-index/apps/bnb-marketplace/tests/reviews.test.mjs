import assert from 'node:assert/strict';
import { test } from 'node:test';

const reviews = await import('../src/lib/reviews.ts').catch(() => ({}));
const input = { subject: 'reference:97:health-factor', jobId: '1179', buyer: '0x51e048a166D22e2898790a4806652bCFf6F03A36', rating: 4, comment: 'Useful result.' };
const challenge = { id: 'challenge-1', nonce: 'a'.repeat(64), issuedAt: 1788945540, expiresAt: 1788946140 };
const api = 'https://reviews.example/api/reviews';
const expected = 'Nibbin buyer review v1\nAudience: https://reviews.example\nSubject: reference:97:health-factor\nChain: 97\nCommerce: 0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de\nJob: 1179\nBuyer: 0x51e048a166d22e2898790a4806652bcff6f03a36\nRating: 4/5\nComment: "Useful result."\nNonce: ' + 'a'.repeat(64) + '\nIssued at: 1788945540\nExpires at: 1788946140\nPublic review. No transaction or spending approval.';

test('review endpoint configuration rejects credential-bearing, insecure and redirected-path URLs', () => {
  assert.equal(typeof reviews.reviewEndpoint, 'function');
  assert.equal(reviews.reviewEndpoint(undefined), null);
  for (const value of ['http://reviews.example/api/reviews', 'https://user:secret@reviews.example/api/reviews', 'https://reviews.example/api/reviews?q=1', 'https://reviews.example/api/other']) assert.equal(reviews.reviewEndpoint(value), null);
  assert.equal(reviews.reviewEndpoint(api), api);
  assert.equal(reviews.reviewEndpoint('http://localhost:3201/api/reviews'), 'http://localhost:3201/api/reviews');
});

test('browser independently reconstructs signed audience, identity and literal review fields', () => {
  assert.equal(typeof reviews.buildReviewMessage, 'function');
  assert.equal(reviews.buildReviewMessage(input, challenge, api), expected);
  assert.throws(() => reviews.validateChallenge({ ...challenge, message: expected.replace('Rating: 4/5', 'Rating: 5/5') }, input, api, 1788945550), /message/i);
  assert.throws(() => reviews.validateChallenge({ ...challenge, message: expected }, { ...input, comment: 'Other' }, api, 1788945550), /message/i);
  assert.throws(() => reviews.validateChallenge({ ...challenge, message: expected }, input, 'https://other.example/api/reviews', 1788945550), /message/i);
  assert.throws(() => reviews.validateChallenge({ ...challenge, message: expected }, input, api, 1788946140), /expired/i);
});

test('review input rejects ratings, controls, oversize comments, wrong subjects and noncanonical jobs', () => {
  assert.equal(typeof reviews.validateReviewInput, 'function');
  for (const patch of [{ rating: 0 }, { rating: 6 }, { rating: 1.5 }, { comment: 'a'.repeat(1001) }, { comment: 'bad\u0000text' }, { jobId: '01179' }, { subject: 'erc8004:56:1' }]) assert.throws(() => reviews.validateReviewInput({ ...input, ...patch }));
  assert.equal(reviews.validateReviewInput({ ...input, comment: '<b>Only text</b>' }).comment, '<b>Only text</b>');
});

test('signature guard refuses wrong wallet or chain and never requests a transaction', async () => {
  assert.equal(typeof reviews.signReview, 'function');
  const payload = { ...challenge, message: expected };
  for (const [account, chain] of [[input.buyer, '0x38'], ['0x1111111111111111111111111111111111111111', '0x61']]) {
    const wallet = { request: async ({ method }) => { if (method === 'eth_accounts') return [account]; if (method === 'eth_chainId') return chain; throw new Error('Unexpected signing request'); } };
    await assert.rejects(() => reviews.signReview(wallet, input, payload, api, 1788945550), /wallet|network/i);
  }
  const requests = [];
  const wallet = { request: async (request) => { requests.push(request); return request.method === 'eth_accounts' ? [input.buyer] : request.method === 'eth_chainId' ? '0x61' : '0x' + 'b'.repeat(130); } };
  const signed = await reviews.signReview(wallet, input, payload, api, 1788945550);
  assert.equal(signed.challengeId, 'challenge-1');
  assert.equal(requests.filter((r) => r.method === 'personal_sign').length, 1);
  assert.equal(requests.some((r) => r.method.includes('Transaction') || r.method.includes('approve')), false);
  assert.equal(Buffer.from(requests.find((r) => r.method === 'personal_sign').params[0].slice(2), 'hex').toString('utf8'), expected);
});

test('wallet rejection or account change after signing never yields a publishable payload', async () => {
  assert.equal(typeof reviews.signReview, 'function');
  let signed = false;
  const wallet = { request: async ({ method }) => method === 'eth_accounts' ? [signed ? '0x1111111111111111111111111111111111111111' : input.buyer] : method === 'eth_chainId' ? '0x61' : (signed = true, '0x' + 'b'.repeat(130)) };
  await assert.rejects(() => reviews.signReview(wallet, input, { ...challenge, message: expected }, api, 1788945550), /wallet/i);
  const rejected = { request: async ({ method }) => { if (method === 'eth_accounts') return [input.buyer]; if (method === 'eth_chainId') return '0x61'; throw Object.assign(new Error('Rejected'), { code: 4001 }); } };
  await assert.rejects(() => reviews.signReview(rejected, input, { ...challenge, message: expected }, api, 1788945550), /Rejected/);
});

test('summaries never mix testnet into mainnet or infer zeros from invalid service data', () => {
  assert.equal(typeof reviews.reviewSummary, 'function');
  const summary = { subject: input.subject, enabled: true, mainnet: { count: 0, average: null, uniqueBuyers: 0 }, testnet: { count: 1, average: 4, uniqueBuyers: 1 } };
  assert.equal(reviews.reviewSummary(summary, 97).label, 'Testnet reviews');
  assert.equal(reviews.reviewSummary(summary, 56).count, 0);
  assert.equal(reviews.reviewSummary(summary, 97).average, 4);
  assert.throws(() => reviews.parseSummaries({ summaries: [{ ...summary, mainnet: { count: 1, average: null, uniqueBuyers: 0 } }] }));
});

test('public response must match signed fields before publication is confirmed', () => {
  assert.equal(typeof reviews.confirmPublishedReview, 'function');
  const review = { id: '1', ...input, chainId: 97, createdAt: '2026-09-09T12:00:00Z' };
  assert.equal(reviews.confirmPublishedReview({ review, replayed: true }, input).review.id, '1');
  assert.throws(() => reviews.confirmPublishedReview({ review: { ...review, rating: 5 }, replayed: false }, input), /match/i);
  assert.throws(() => reviews.confirmPublishedReview({ review: { ...review, chainId: 56 }, replayed: false }, input), /match/i);
});

test('uncertain publication retries the identical signature without requesting another signature', async () => {
  const originalFetch = globalThis.fetch;
  const sent = []; let attempts = 0;
  const signed = { challengeId: 'challenge-1', signature: '0x' + 'b'.repeat(130) };
  const wallet = { request: async ({ method }) => { if (method === 'eth_accounts') return [input.buyer]; if (method === 'eth_chainId') return '0x61'; throw new Error('Retry requested a signature or transaction'); } };
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); if (++attempts === 1) throw new Error('Connection interrupted'); return Response.json({ review: { id: '1', ...input, chainId: 97, createdAt: '2026-09-09T12:00:00Z' }, replayed: true }); };
  try {
    await assert.rejects(() => reviews.publishReview(wallet, input, signed, api), /did not confirm/i);
    assert.equal((await reviews.publishReview(wallet, input, signed, api)).replayed, true);
    assert.deepEqual(sent, [{ action: 'publish', ...signed }, { action: 'publish', ...signed }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('review HTTP client refuses oversized, invalid and failed responses instead of fabricating reviews', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x'.repeat(131073));
    await assert.rejects(() => reviews.requestReviews(api), /size/i);
    globalThis.fetch = async () => Response.json({ error: 'Storage unavailable' }, { status: 503 });
    await assert.rejects(() => reviews.requestReviews(api), /Storage unavailable/);
    globalThis.fetch = async () => new Response('invalid json');
    await assert.rejects(() => reviews.requestReviews(api), /did not confirm/i);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid review cursors and reviews belonging to another subject are rejected', () => {
  const review = { id: '1', ...input, chainId: 97, createdAt: '2026-09-09T12:00:00Z' };
  assert.throws(() => reviews.parseReviewPage({ reviews: [review], nextCursor: 'bad' }, input.subject));
  assert.throws(() => reviews.parseReviewPage({ reviews: [{ ...review, subject: 'erc8004:56:1' }], nextCursor: null }, input.subject));
  assert.deepEqual(reviews.parseReviewPage({ reviews: [review], nextCursor: null }, input.subject).reviews, [review]);
});
