'use client';

import { useId, useRef, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Eip1193Provider } from '@/lib/wallet';
import { assertReviewWallet, configuredReviewsApi, publishReview, REFERENCE_REVIEW_SUBJECT, requestReviews, signReview, validateChallenge, validateReviewInput, type PublicReview, type ReviewChallenge, type ReviewInput, type SignedReview } from '@/lib/reviews';

const button = 'min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] px-4 py-2 text-[14px] disabled:cursor-not-allowed disabled:opacity-50';

export function BuyerReviewForm({ jobId, buyer, completed, chainId, walletProvider, disabled = false }: { jobId: string; buyer: string; completed: boolean; chainId: number; walletProvider: () => Eip1193Provider; disabled?: boolean }) {
  const id = useId(); const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [challenge, setChallenge] = useState<ReviewChallenge | null>(null);
  const [signed, setSigned] = useState<SignedReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<PublicReview | null>(null);
  const api = configuredReviewsApi();
  if (!completed || chainId !== 97) return null;
  const input: ReviewInput = { subject: REFERENCE_REVIEW_SUBJECT, jobId, buyer, rating, comment };

  async function run(operation: () => Promise<void>) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (caught) {
      const rejected = !!caught && typeof caught === 'object' && 'code' in caught && caught.code === 4001;
      setError(rejected ? 'You cancelled the review signature. Nothing was published. Your draft is still here.' : caught instanceof Error ? caught.message : 'The review was not confirmed. Check your wallet and retry.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function preview() {
    if (!api) throw new Error('Reviews unavailable. The public review service is not configured.');
    validateReviewInput(input);
    await assertReviewWallet(walletProvider(), buyer);
    const response = await requestReviews(api, { action: 'challenge', ...input });
    setChallenge(validateChallenge(response, input, api));
  }

  async function publish() {
    if (!api || !challenge) return;
    const provider = walletProvider();
    const payload = signed ?? await signReview(provider, input, challenge, api);
    setSigned(payload);
    const result = await publishReview(provider, input, payload, api);
    setPublished(result.review);
    window.dispatchEvent(new Event('buyer-review-published'));
  }

  return <section className="mt-6 rounded-[var(--radius-card)] border border-[var(--measured)] bg-[var(--panel-2)] p-5 sm:p-6" aria-label="Review completed job">
    <div className="flex items-center gap-3"><CircleCheck size={24} strokeWidth={1.5} className="shrink-0 text-[var(--measured)]" aria-hidden /><h3 className="text-[20px] font-semibold">Job #{jobId} completed</h3></div>
    {published ? <p role="status" className="mt-2 text-[14px]">Your testnet review is published. {published.rating}/5 · Job #{published.jobId}</p> : <>
      {!open ? <p className="mt-2 text-[14px] text-[var(--fg-muted)]">Share your experience with this testnet hire.</p> : null}
      {!api ? <p className="mt-3 text-[13px] text-[var(--fg-muted)]">Reviews unavailable. Public review submission is not configured yet.</p> : !open ? <button type="button" className={`${button} primary-button mt-3`} disabled={disabled} onClick={() => setOpen(true)}>Leave a review</button> : <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void run(challenge ? publish : preview); }}>
        <fieldset hidden={!!challenge} disabled={busy || !!challenge || !!signed || disabled}><legend className="text-[14px] font-medium">Your rating</legend><div className="mt-2 flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map((value) => <label key={value} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-btn)] border border-[var(--border)] px-2 text-[14px]" style={rating === value ? { background: 'var(--measured-bg)', color: 'var(--measured)' } : undefined}><input type="radio" name={`${id}-rating`} value={value} checked={rating === value} onChange={() => { setRating(value); setChallenge(null); }} aria-label={`${value} out of 5 stars`} required />{value}</label>)}</div>
          <label htmlFor={`${id}-comment`} className="mt-4 block text-[14px] font-medium">Comment (optional)</label><textarea id={`${id}-comment`} value={comment} maxLength={1000} rows={3} onChange={(event) => { setComment(event.target.value); setChallenge(null); }} aria-describedby={`${id}-comment-help`} className="mt-2 block w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[14px]" /><p id={`${id}-comment-help`} className="mt-1 text-[12px] text-[var(--fg-muted)]">{comment.length}/1,000 characters · Plain text</p>
        </fieldset>
        {challenge ? <div aria-label="Your review preview" className="rounded-[var(--radius-input)] bg-[var(--panel)] p-4"><p className="text-[17px] font-semibold">{rating}/5 <span className="text-[13px] font-normal text-[var(--fg-muted)]">· Testnet hire</span></p>{comment ? <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed">{comment}</p> : null}</div> : null}
        <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">Your wallet address, job ID, rating and comment will be public and cannot be edited after publishing. Signature only—no gas or token approval.</p>
        {challenge ? <details className="text-[12px]"><summary className="w-fit min-h-11 cursor-pointer py-3 text-[var(--fg-muted)]">Technical details</summary><p className="mt-1 text-[12px] font-medium">Exact message your wallet will sign</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] p-3 text-[12px]">{challenge.message}</pre></details> : null}
        {signed && error ? <p className="text-[13px] text-[var(--fg-muted)]">Retry publication with the same signature; no new signature is needed.</p> : null}
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || disabled || !rating} className={`${button} primary-button`}>{busy ? 'Waiting for confirmation…' : signed ? 'Retry publication' : challenge ? 'Sign and publish review' : 'Preview review'}</button>
          {!signed && !challenge ? <button type="button" disabled={busy} className={button} onClick={() => { setOpen(false); setChallenge(null); setError(''); }}>Cancel</button> : null}
          {signed && error ? <button type="button" disabled={busy} className={button} onClick={() => { setSigned(null); setChallenge(null); setError(''); }}>Discard signed draft</button> : null}
          {challenge && !signed ? <button type="button" disabled={busy} className="min-h-11 px-3 text-[13px] text-[var(--fg-muted)] underline underline-offset-4 disabled:opacity-50" onClick={() => { setChallenge(null); setError(''); }}>Edit review</button> : null}
        </div>
        {signed && error ? <p className="text-[12px] text-[var(--fg-muted)]">Retry first if publication is uncertain. Discarding this draft does not remove a review that already reached the service.</p> : null}
        {busy ? <p role="status" className="text-[13px] text-[var(--fg-muted)]">Confirm only the review message in your wallet. Your completed job stays unchanged.</p> : null}
      </form>}
    </>}
    {error ? <p role="alert" className="mt-3 break-words text-[13px] text-[var(--critical)]">{error}</p> : null}
  </section>;
}
