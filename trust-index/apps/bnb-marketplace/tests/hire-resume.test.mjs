import assert from 'node:assert/strict';
import { test } from 'node:test';
const resume = await import('../src/lib/hire-resume.ts').catch(() => ({}));

test('resume deep link accepts a canonical positive uint256 job without losing precision', () => {
  assert.equal(typeof resume.readResumeJob, 'function');
  assert.equal(resume.readResumeJob('?job=1179'), '1179');
  assert.equal(resume.readResumeJob('?job=9007199254740993'), '9007199254740993');
  const largest = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  assert.equal(resume.readResumeJob(`?job=${largest}`), largest);
});

test('malformed, repeated, signed, zero and overflowing job parameters cannot prefill a resume', () => {
  assert.equal(typeof resume.readResumeJob, 'function');
  for (const query of ['', '?job=', '?job=0', '?job=01179', '?job=-1', '?job=+1', '?job=1.0', '?job=1e3', '?job=1179&job=1180', '?job=0x49b', '?job=1179%20', '?job=115792089237316195423570985008687907853269984665640564039457584007913129639936']) assert.equal(resume.readResumeJob(query), null, query);
});
