import type { Agent } from './types';
import type { Eip1193Provider } from './wallet';

export const REFERENCE_REVIEW_SUBJECT = 'reference:97:health-factor';
export const REVIEW_COMMERCE = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de';
export interface ReviewInput { subject: string; jobId: string; buyer: string; rating: number; comment: string }
export interface ReviewChallenge { id: string; nonce: string; issuedAt: number; expiresAt: number; message: string }
export interface SignedReview { challengeId: string; signature: string }
export interface PublicReview extends ReviewInput { id: string; chainId: number; createdAt: string }
export interface NetworkReviews { count: number; average: number | null; uniqueBuyers: number }
export interface SubjectReviews { subject: string; enabled: boolean; mainnet: NetworkReviews; testnet: NetworkReviews }
export class ReviewApiError extends Error { status: number; constructor(message: string, status = 0) { super(message); this.status = status; } }

const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review response.'); return value as Record<string, unknown>; };
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const decimal = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const subjectValid = (value: unknown): value is string => typeof value === 'string' && (value === REFERENCE_REVIEW_SUBJECT || /^erc8004:[1-9][0-9]{0,9}:[0-9]{1,78}$/.test(value));
const validComment = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

export function reviewEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/reviews')) return null;
    return url.href;
  } catch { return null; }
}

export function configuredReviewsApi(): string | null { return reviewEndpoint(process.env.NEXT_PUBLIC_REVIEWS_API_URL ?? 'https://nibbin-buyer-reviews.vercel.app/api/reviews'); }

export function reviewSubject(agent: Pick<Agent, 'is_reference_agent' | 'chain_id' | 'category' | 'token_id'>): string | null {
  if (agent.is_reference_agent) return agent.chain_id === 97 && agent.category === 'health_factor' ? REFERENCE_REVIEW_SUBJECT : null;
  return agent.token_id !== null && /^[0-9]+$/.test(agent.token_id) ? `erc8004:${agent.chain_id}:${BigInt(agent.token_id)}` : null;
}

export function validateReviewInput(value: ReviewInput): ReviewInput {
  if (value.subject !== REFERENCE_REVIEW_SUBJECT) throw new Error('Reviews can currently be submitted only for the reference testnet seller.');
  if (!decimal(value.jobId) || !address(value.buyer)) throw new Error('Invalid job or buyer wallet.');
  if (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) throw new Error('Choose a rating from 1 to 5.');
  if (!validComment(value.comment)) throw new Error('Use up to 1,000 characters of plain text without control characters.');
  return value;
}

export function buildReviewMessage(input: ReviewInput, challenge: Pick<ReviewChallenge, 'nonce' | 'issuedAt' | 'expiresAt'>, apiUrl: string): string {
  validateReviewInput(input);
  const endpoint = reviewEndpoint(apiUrl);
  if (!endpoint) throw new Error('Reviews are unavailable: API configuration is missing or invalid.');
  if (!/^[a-f0-9]{64}$/.test(challenge.nonce) || !Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) || challenge.issuedAt <= 0 || challenge.expiresAt - challenge.issuedAt !== 600) throw new Error('Invalid review challenge.');
  return ['Nibbin buyer review v1', `Audience: ${new URL(endpoint).origin}`, `Subject: ${input.subject}`, 'Chain: 97', `Commerce: ${REVIEW_COMMERCE}`, `Job: ${input.jobId}`, `Buyer: ${input.buyer.toLowerCase()}`, `Rating: ${input.rating}/5`, `Comment: ${JSON.stringify(input.comment)}`, `Nonce: ${challenge.nonce}`, `Issued at: ${challenge.issuedAt}`, `Expires at: ${challenge.expiresAt}`, 'Public review. No transaction or spending approval.'].join('\n');
}

export function validateChallenge(value: unknown, input: ReviewInput, apiUrl: string, now = Math.floor(Date.now() / 1000)): ReviewChallenge {
  const raw = record(value);
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.id)) throw new Error('Invalid review challenge ID.');
  const challenge = raw as unknown as ReviewChallenge;
  const expected = buildReviewMessage(input, challenge, apiUrl);
  if (challenge.message !== expected) throw new Error('Review message does not match your review and the configured service. Nothing was signed.');
  if (challenge.expiresAt <= now) throw new Error('Review challenge expired. Preview a fresh review before signing.');
  if (challenge.issuedAt > now + 30) throw new Error('Review challenge is dated in the future.');
  return challenge;
}

export async function assertReviewWallet(provider: Eip1193Provider, buyer: string): Promise<void> {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = await provider.request({ method: 'eth_chainId' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== buyer.toLowerCase()) throw new Error('The buyer wallet changed. Reconnect the job’s buyer wallet before continuing.');
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || Number.parseInt(chain.slice(2), 16) !== 97) throw new Error('Switch your wallet to BNB testnet before reviewing this job.');
}

export async function signReview(provider: Eip1193Provider, input: ReviewInput, challenge: ReviewChallenge, apiUrl: string, now = Math.floor(Date.now() / 1000)): Promise<SignedReview> {
  validateChallenge(challenge, input, apiUrl, now);
  await assertReviewWallet(provider, input.buyer);
  const encoded = `0x${Array.from(new TextEncoder().encode(challenge.message), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const signature = await provider.request({ method: 'personal_sign', params: [encoded, input.buyer] });
  if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('The wallet did not return a review signature. Nothing was published.');
  await assertReviewWallet(provider, input.buyer);
  return { challengeId: challenge.id, signature };
}

/** Fixed configured audience, bounded response and no credentials or redirect following. */
export async function requestReviews(apiUrl: string, payload?: object, params?: Record<string, string>): Promise<unknown> {
  const endpoint = reviewEndpoint(apiUrl);
  if (!endpoint) throw new ReviewApiError('Reviews unavailable.');
  const url = new URL(endpoint);
  Object.entries(params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { method: payload ? 'POST' : 'GET', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (!response.body) throw new ReviewApiError('Review service returned no response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 131072) { await reader.cancel(); throw new ReviewApiError('Review response exceeded the supported size.'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!response.ok) throw new ReviewApiError(typeof data?.error === 'string' ? data.error.slice(0, 240) : 'Reviews unavailable. Try again later.', response.status);
    return data;
  } catch (error) {
    if (error instanceof ReviewApiError) throw error;
    throw new ReviewApiError('The review service did not confirm the result. Retry to check publication.');
  } finally { clearTimeout(timeout); }
}

function networkReviews(value: unknown): NetworkReviews {
  const row = record(value);
  if (!Number.isSafeInteger(row.count) || Number(row.count) < 0 || !Number.isSafeInteger(row.uniqueBuyers) || Number(row.uniqueBuyers) < 0 || Number(row.uniqueBuyers) > Number(row.count)) throw new Error('Invalid review summary.');
  if (row.count === 0 ? row.average !== null || row.uniqueBuyers !== 0 : typeof row.average !== 'number' || !Number.isFinite(row.average) || row.average < 1 || row.average > 5 || Number(row.uniqueBuyers) < 1) throw new Error('Invalid review summary.');
  return row as unknown as NetworkReviews;
}

export function parseSummaries(value: unknown): SubjectReviews[] {
  const data = record(value);
  if (!Array.isArray(data.summaries) || data.summaries.length > 24) throw new Error('Invalid review summaries.');
  const seen = new Set<string>();
  return data.summaries.map((value) => {
    const row = record(value);
    if (!subjectValid(row.subject) || seen.has(row.subject) || typeof row.enabled !== 'boolean') throw new Error('Invalid review subject.');
    seen.add(row.subject);
    return { subject: row.subject, enabled: row.enabled, mainnet: networkReviews(row.mainnet), testnet: networkReviews(row.testnet) };
  });
}

export function reviewSummary(summary: SubjectReviews, chainId: 56 | 97) {
  return { label: chainId === 97 ? 'Testnet reviews' : 'Buyer reviews', ...(chainId === 97 ? summary.testnet : summary.mainnet) };
}

function publicReview(value: unknown): PublicReview {
  const row = record(value);
  if (!decimal(row.id) || !subjectValid(row.subject) || !decimal(row.jobId) || !address(row.buyer) || ![56, 97].includes(Number(row.chainId)) || typeof row.chainId !== 'number' || !Number.isInteger(row.rating) || Number(row.rating) < 1 || Number(row.rating) > 5 || !validComment(row.comment) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('Invalid public review.');
  return row as unknown as PublicReview;
}

export function parseReviewPage(value: unknown, subject: string): { reviews: PublicReview[]; nextCursor: string | null } {
  const data = record(value);
  if (!Array.isArray(data.reviews) || data.reviews.length > 20 || data.nextCursor !== null && !decimal(data.nextCursor)) throw new Error('Invalid review page.');
  const rows = data.reviews.map(publicReview);
  if (rows.some((row) => row.subject !== subject)) throw new Error('Reviews do not match this agent.');
  return { reviews: rows, nextCursor: data.nextCursor as string | null };
}

export function confirmPublishedReview(value: unknown, input: ReviewInput): { review: PublicReview; replayed: boolean } {
  const data = record(value); const review = publicReview(data.review);
  if (typeof data.replayed !== 'boolean' || review.subject !== input.subject || review.chainId !== 97 || review.jobId !== input.jobId || review.buyer.toLowerCase() !== input.buyer.toLowerCase() || review.rating !== input.rating || review.comment !== input.comment) throw new ReviewApiError('Published response does not match your signed review. Retry publication to check its status.');
  return { review, replayed: data.replayed };
}

export async function publishReview(provider: Eip1193Provider, input: ReviewInput, signed: SignedReview, apiUrl: string) {
  validateReviewInput(input);
  await assertReviewWallet(provider, input.buyer);
  return confirmPublishedReview(await requestReviews(apiUrl, { action: 'publish', ...signed }), input);
}
