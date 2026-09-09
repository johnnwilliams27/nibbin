'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { configuredReviewsApi, parseReviewPage, parseSummaries, requestReviews, reviewSubject, reviewSummary, type PublicReview, type SubjectReviews } from '@/lib/reviews';
import { timestamp } from '@/lib/format';

type SummaryState = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; summary: SubjectReviews };
type SubjectProps = { agent?: Agent; subject?: string };
const ReviewsContext = createContext<Record<string, SummaryState> | null>(null);

async function loadSummaries(subjects: string[]): Promise<Record<string, SummaryState>> {
  const api = configuredReviewsApi();
  if (!api) return Object.fromEntries(subjects.map((subject) => [subject, { status: 'unavailable' }]));
  const entries = await Promise.all(Array.from({ length: Math.ceil(subjects.length / 24) }, (_, index) => subjects.slice(index * 24, index * 24 + 24)).map(async (batch) => {
    try {
      const summaries = parseSummaries(await requestReviews(api, undefined, { subjects: batch.join(',') }));
      return batch.map((subject): [string, SummaryState] => {
        const summary = summaries.find((entry) => entry.subject === subject);
        return [subject, summary ? { status: 'ready', summary } : { status: 'unavailable' }];
      });
    } catch { return batch.map((subject): [string, SummaryState] => [subject, { status: 'unavailable' }]); }
  }));
  return Object.fromEntries(entries.flat());
}

/** One request per bounded batch of visible subjects, never one request per card. */
export function BuyerReviewsProvider({ agents, children }: { agents: Agent[]; children: ReactNode }) {
  const key = [...new Set(agents.map(reviewSubject).filter((subject): subject is string => !!subject))].sort().join(',');
  const [state, setState] = useState<{ key: string; summaries: Record<string, SummaryState> }>({ key: '', summaries: {} });
  useEffect(() => {
    let alive = true;
    const subjects = key ? key.split(',') : [];
    const refresh = () => { void loadSummaries(subjects).then((summaries) => { if (alive) setState({ key, summaries }); }); };
    refresh();
    window.addEventListener('buyer-review-published', refresh);
    return () => { alive = false; window.removeEventListener('buyer-review-published', refresh); };
  }, [key]);
  const current = state.key === key ? state.summaries : {};
  return <ReviewsContext.Provider value={current}>{children}</ReviewsContext.Provider>;
}

function useReviewSummary({ agent, subject: explicitSubject }: SubjectProps): SummaryState {
  const subject = explicitSubject ?? (agent ? reviewSubject(agent) : null);
  const context = useContext(ReviewsContext);
  const [standalone, setStandalone] = useState<{ subject: string; state: SummaryState } | null>(null);
  useEffect(() => {
    if (!subject || context !== null) return;
    let alive = true;
    const refresh = () => { void loadSummaries([subject]).then((result) => { if (alive) setStandalone({ subject, state: result[subject] }); }); };
    refresh();
    window.addEventListener('buyer-review-published', refresh);
    return () => { alive = false; window.removeEventListener('buyer-review-published', refresh); };
  }, [subject, context]);
  if (!subject || !configuredReviewsApi()) return { status: 'unavailable' };
  return context !== null ? context[subject] ?? { status: 'loading' } : standalone?.subject === subject ? standalone.state : { status: 'loading' };
}

export function BuyerReviewSummary(props: SubjectProps) {
  const state = useReviewSummary(props);
  if (state.status === 'loading') return <p className="text-[13px] text-[var(--fg-muted)]" role="status">Loading buyer reviews…</p>;
  if (state.status === 'unavailable') return <p className="text-[13px] text-[var(--fg-muted)]">Reviews unavailable</p>;
  const mainnet = reviewSummary(state.summary, 56); const testnet = reviewSummary(state.summary, 97);
  if (!mainnet.count && !testnet.count) return <p className="text-[13px] text-[var(--fg-muted)]">No buyer reviews yet</p>;
  return <div className="space-y-1 text-[13px]">{[mainnet, testnet].filter((entry) => entry.count > 0).map((entry) => <p key={entry.label} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
    <Star size={14} strokeWidth={1.5} aria-hidden className="text-[var(--withheld)]" /><span>{entry.average!.toFixed(1)}/5</span><span className="text-[var(--fg-muted)]">· {entry.count} {entry.count === 1 ? entry.label.toLowerCase().slice(0, -1) : entry.label.toLowerCase()} · {entry.uniqueBuyers} buyer wallet{entry.uniqueBuyers === 1 ? '' : 's'}</span>
  </p>)}</div>;
}

export function BuyerReviews({ agent, subject: explicitSubject }: SubjectProps) {
  const subject = explicitSubject ?? (agent ? reviewSubject(agent) : null);
  const [state, setState] = useState<{ subject: string | null; rows: PublicReview[]; next: string | null; loading: boolean; failed: boolean }>({ subject, rows: [], next: null, loading: true, failed: false });
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let alive = true; const api = configuredReviewsApi();
    setState({ subject, rows: [], next: null, loading: true, failed: false });
    if (!api || !subject) { setState({ subject, rows: [], next: null, loading: false, failed: true }); return; }
    void requestReviews(api, undefined, { subject }).then((raw) => {
      const page = parseReviewPage(raw, subject);
      if (alive) setState({ subject, rows: page.reviews, next: page.nextCursor, loading: false, failed: false });
    }).catch(() => { if (alive) setState({ subject, rows: [], next: null, loading: false, failed: true }); });
    return () => { alive = false; };
  }, [subject, refreshKey]);
  useEffect(() => { const refresh = () => setRefreshKey((key) => key + 1); window.addEventListener('buyer-review-published', refresh); return () => window.removeEventListener('buyer-review-published', refresh); }, []);

  async function loadMore() {
    const api = configuredReviewsApi(); if (!api || !subject || !state.next || state.loading) return;
    const cursor = state.next;
    setState((current) => ({ ...current, loading: true, failed: false }));
    try {
      const page = parseReviewPage(await requestReviews(api, undefined, { subject, cursor }), subject);
      if (page.nextCursor === cursor) throw new Error('Review pagination did not advance.');
      setState((current) => current.subject !== subject ? current : { ...current, rows: [...current.rows, ...page.reviews.filter((review) => !current.rows.some((row) => row.id === review.id))], next: page.nextCursor, loading: false, failed: false });
    } catch { setState((current) => current.subject !== subject ? current : { ...current, loading: false, failed: true }); }
  }

  const visible = state.subject === subject ? state.rows : [];
  const onlyTestnet = visible.length > 0 && visible.every((review) => review.chainId === 97);
  const mixedNetworks = visible.some((review) => review.chainId === 56) && visible.some((review) => review.chainId === 97);
  return <section className="min-w-0" aria-label="Buyer reviews">
    <h4 className="text-[14px] font-semibold">{onlyTestnet ? 'Testnet buyer reviews' : 'Buyer reviews'}</h4>
    {state.loading && !visible.length ? <p role="status" className="mt-2 text-[13px] text-[var(--fg-muted)]">Loading reviews…</p> : null}
    {state.failed ? <p role="status" className="mt-2 text-[13px] text-[var(--fg-muted)]">Reviews unavailable. {configuredReviewsApi() ? <button type="button" onClick={() => visible.length ? void loadMore() : setRefreshKey((key) => key + 1)} className="min-h-11 underline underline-offset-4">Try again</button> : null}</p> : null}
    {!state.loading && !state.failed && !visible.length ? <p className="mt-2 text-[13px] text-[var(--fg-muted)]">No buyer reviews yet.</p> : null}
    {[56, 97].map((chainId) => {
      const rows = visible.filter((review) => review.chainId === chainId);
      return rows.length ? <div key={chainId} className="mt-3">{mixedNetworks ? <p className="text-[13px] font-medium">{chainId === 97 ? 'Testnet' : 'Mainnet'}</p> : null}<ul className="space-y-4">{rows.map((review) => <li key={review.id} className="min-w-0 border-t border-[var(--border)] pt-3 text-[13px]">
        <p className="flex items-center gap-1.5 font-medium"><Star size={14} strokeWidth={1.5} aria-hidden className="text-[var(--withheld)]" />{review.rating}/5</p>
        {review.comment ? <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{review.comment}</p> : null}
        <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-[var(--fg-muted)]"><span title={review.buyer} aria-label={`Buyer wallet ${review.buyer}`}>{review.buyer.slice(0, 6)}…{review.buyer.slice(-4)}</span><span>· Job #{review.jobId}</span><span>· <time dateTime={review.createdAt}>{timestamp(review.createdAt)}</time></span></p>
      </li>)}</ul></div> : null;
    })}
    {state.next && !state.failed ? <button type="button" onClick={() => void loadMore()} disabled={state.loading} className="mt-3 min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] px-3 text-[13px] disabled:opacity-50">{state.loading ? 'Loading…' : 'More reviews'}</button> : null}
  </section>;
}

export function DemoReviewExamples() {
  return <details className="mt-5 border-t border-[var(--border)] pt-4 text-[13px]"><summary className="min-h-11 cursor-pointer font-medium">Demo examples</summary><p className="mt-2 text-[var(--fg-muted)]">Fictional examples of the review format. These are not reviews of any listed agent and never count toward ratings.</p><ul className="mt-3 space-y-3">{[
    { rating: 5, comment: 'The explanation made the calculation easy to follow.' },
    { rating: 3, comment: 'The output helped, but I wanted more detail about the assumptions.' },
    { rating: 2, comment: 'The response was too brief for my task.' },
  ].map((example) => <li key={example.rating} className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3"><p className="font-medium">Demo review — fictional example</p><p className="mt-1">{example.rating}/5 · {example.comment}</p></li>)}</ul></details>;
}
