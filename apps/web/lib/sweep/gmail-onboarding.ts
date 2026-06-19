import 'server-only';

import { GmailClient, SupabaseTokenVault } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';
import { anthropicGenerate } from '../llm/client';
import type { UnderstandingProfile } from '@nibbin/keeper';
import { runPass1, runPass2, mergeSweepDerived, isSensitiveSample, type SentBatch, type ThreadBatch } from './derive';
import type { SweepDerived, SweepStatus } from './types';

// ≈12-month onboarding seed; caps (MAX_SENT_MESSAGES/MAX_INBOX_THREADS) + newest-first ordering bind first.
export const SWEEP_WINDOW_DAYS = 365;
export const MAX_SENT_MESSAGES = 200;
export const MAX_INBOX_THREADS = 300;
export const BATCH_SIZE_PASS1 = 20;
export const BATCH_SIZE_PASS2 = 15;
const BUDGET_MS = 45_000;

export function buildSentQuery(cutoff: Date): string {
  const d = cutoff.toISOString().slice(0, 10).replace(/-/g, '/');
  return `from:me after:${d} -in:spam -in:trash`;
}

export function buildInboxQuery(cutoff: Date): string {
  const d = cutoff.toISOString().slice(0, 10).replace(/-/g, '/');
  return `in:inbox -category:promotions -category:updates -category:social after:${d} -in:spam -in:trash`;
}

type MessageMetaLike = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

export function isNewsletter(meta: MessageMetaLike): boolean {
  return (
    meta.payload?.headers?.some((h) => h.name.toLowerCase() === 'list-unsubscribe') ?? false
  );
}

/**
 * Conservative sensitive-category pre-filter (P3.9). Skips obviously sensitive
 * threads (banking, health, legal, password/2FA) by sender/subject keyword
 * BEFORE any body fetch reaches the LLM. Kept low-false-positive: whole-word
 * matches only, on the short From/Subject metadata we already hold.
 */
const SENSITIVE_KEYWORDS = [
  // banking / finance
  'bank', 'banking', 'account number', 'routing number', 'wire transfer',
  'statement', 'overdraft', 'credit card', 'debit card', 'irs', 'tax',
  // health / medical
  'medical', 'health', 'diagnosis', 'prescription', 'patient', 'lab results',
  'insurance claim', 'pharmacy',
  // legal
  'legal', 'attorney', 'lawsuit', 'subpoena', 'settlement', 'litigation',
  // password / auth / 2FA
  'password', 'verification code', 'security code', 'one-time', 'one time code',
  '2fa', 'two-factor', 'two factor', 'reset your password', 'login code',
];

/**
 * @param addressHeaders which address header(s) carry the counterparty. Inbox
 *   mail is identified by `From` (the default); sent mail (#114) is always from
 *   the user, so the bank/doctor/lawyer is in `To` — callers pass `['to']` so the
 *   same sensitive signal gates the sent-mail Pass-1 body fetch, not just inbox.
 */
export function isSensitiveThread(
  meta: MessageMetaLike,
  addressHeaders: readonly string[] = ['from'],
): boolean {
  const headers = meta.payload?.headers ?? [];
  const get = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name)?.value?.toLowerCase() ?? '';
  // Normalize address/Subject to single-space-delimited tokens, padded with
  // spaces, so we get whole-word matching via plain includes() — no dynamic
  // RegExp (SAST detect-non-literal-regexp) and no ReDoS surface. Keywords are
  // normalized the same way, so multi-word / hyphenated terms (e.g.
  // "two-factor") still match.
  const norm = (s: string): string => ` ${s.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const addresses = addressHeaders.map((h) => get(h)).join(' ');
  const haystack = norm(`${addresses} ${get('subject')}`);
  return SENSITIVE_KEYWORDS.some((kw) => haystack.includes(norm(kw)));
}

/** Merge new sections into existing grove_memory.sections — only fill empty slots. */
export function writeSweepDerivedToMemory(
  existing: Record<string, string>,
  derived: SweepDerived,
): Record<string, string> {
  const out = { ...existing };
  if (!out.voice?.trim() && derived.voiceSamples.length > 0) {
    out.voice = derived.voiceSamples.join('\n\n');
  }
  if (!out.faq?.trim() && derived.faqCandidates.length > 0) {
    out.faq = derived.faqCandidates.map((c) => `- ${c}`).join('\n');
  }
  if (!out.facts?.trim() && derived.inferredFacts.length > 0) {
    out.facts = derived.inferredFacts.join('\n');
  } else if (out.facts?.trim() && derived.inferredFacts.length > 0) {
    // Append inferred facts to existing stub (additive, not replacement)
    const stub = out.facts.trim();
    const newFacts = derived.inferredFacts.filter((f) => !stub.includes(f));
    if (newFacts.length > 0) out.facts = `${stub}\n${newFacts.join('\n')}`;
  }
  return out;
}

/** Union extraChannels/extraTools into profile, deduplicated, capped at 12. */
export function mergeProfileChannelsAndTools(
  existing: string[],
  extra: string[],
): string[] {
  return [...new Set([...existing, ...extra.map((c) => c.toLowerCase())])].slice(0, 12);
}

export interface SweepResult {
  status: SweepStatus;
  messagesRead: number;
  derived: SweepDerived;
}

export async function gmailOnboardingSweep(
  accountId: string,
  connectionId: string,
  /**
   * The claim row id from `claim_gmail_sweep`. When provided, the sweep marks
   * `derived_written_at` on the row immediately after writing grove_memory /
   * grove_state — before returning. This lets `claim_gmail_sweep`'s stale-reclaim
   * detect that a previously-crashed invocation already produced derived notes and
   * auto-finalize the row to `complete` rather than re-running the full sweep
   * (L1 idempotency hardening).
   */
  claimId?: string,
): Promise<SweepResult> {
  const deadline = Date.now() + BUDGET_MS;
  const svc = serviceClient();
  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });

  // Load the connection row
  const { data: connRow, error: connErr } = await svc
    .from('connections')
    .select('*')
    .eq('id', connectionId)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .maybeSingle();
  if (connErr || !connRow) throw new Error(`sweep: connection ${connectionId} not found/active`);

  const { connectionFromRow } = await import('../runtime/engine');
  const connection = connectionFromRow(connRow as Record<string, unknown>);
  const client = new GmailClient(connection, vault);

  const generate = anthropicGenerate();
  const cutoff = new Date(Date.now() - SWEEP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let status: SweepStatus = 'complete';

  // ── Mid-sweep consent re-check (TOCTOU) ──────────────────────────────────
  // The read loops + derive run for up to ~45 s. The write-time check below is
  // the last line of defense, but on its own a sweep that the user revokes early
  // keeps reading + transmitting the whole mailbox to the LLM before the write
  // is blocked. Re-read consent (and status='active') at each page/batch boundary
  // so a revocation STOPS the read promptly — minimizing what is read/sent after
  // the user said stop. Fail-closed: any error or missing/null consent → revoked.
  let consentRevoked = false;
  const consentActive = async (): Promise<boolean> => {
    try {
      const { data, error } = await svc
        .from('connections')
        .select('sweep_consent_at')
        .eq('id', connectionId)
        .eq('account_id', accountId)
        .eq('status', 'active')
        .maybeSingle();
      return !error && !!data && data.sweep_consent_at != null;
    } catch {
      return false;
    }
  };

  // ── Pass 1: Sent messages ────────────────────────────────────────────────
  const sentBatches: SentBatch[] = [];
  let sentFetched = 0;
  const oldestDate: string = cutoff.toISOString().slice(0, 10);
  let pageToken: string | undefined;

  outer: do {
    if (Date.now() > deadline) { status = 'partial'; break; }
    // TOCTOU: re-check consent once per page (≤50 messages) so a mid-sweep
    // revocation stops the read here rather than after the full derive phase.
    if (!(await consentActive())) { consentRevoked = true; status = 'partial'; break; }
    const page = await client.listMessages(buildSentQuery(cutoff), pageToken, 50);
    const ids = page.messages?.map((m) => m.id) ?? [];
    const batchBodies: string[] = [];
    for (const id of ids) {
      if (Date.now() > deadline) { status = 'partial'; break outer; }
      if (sentFetched >= MAX_SENT_MESSAGES) { status = 'partial'; break outer; }
      // #114: gate the sent-mail body fetch on the same sensitive signal the
      // inbox Pass-2 uses — fetch headers first and skip before any body reaches
      // the LLM. Sent mail is always From the user, so the bank/doctor/lawyer is a
      // recipient; screen To AND Cc (the reply-all case where the institution is
      // Cc'd). A metadata fetch failure skips the message (fail-closed), matching
      // getMessageBody's swallow-and-skip.
      let meta: MessageMetaLike;
      try { meta = await client.getMessageMetadata(id); } catch { continue; }
      // RT-3: Bcc now fetched by getMessageMetadata; screen it alongside To/Cc so
      // a bank/doctor/lawyer Bcc'd on a sent message is caught before the body fetch.
      if (isSensitiveThread(meta, ['to', 'cc', 'bcc'])) continue;
      const body = await client.getMessageBody(id); // swallows failures
      if (body) {
        // Body content-scan: a sent message with benign To/Cc/Bcc/Subject can
        // still paste a card/account/routing number, SSN, IBAN, or labelled
        // secret in the body. Don't transmit such bodies to the LLM at all —
        // scan with the same high-precision secret detector the output guard
        // uses (low false-positive: actual secret patterns, not topic words),
        // and skip the message on a hit.
        if (isSensitiveSample(body)) continue;
        batchBodies.push(body);
        sentFetched++;
      }
      if (batchBodies.length === BATCH_SIZE_PASS1) {
        sentBatches.push({ messages: [...batchBodies] });
        batchBodies.length = 0;
      }
    }
    if (batchBodies.length > 0) sentBatches.push({ messages: batchBodies });
    pageToken = page.nextPageToken;
  } while (pageToken && sentFetched < MAX_SENT_MESSAGES);

  // ── Pass 2: Inbox threads ────────────────────────────────────────────────
  const threadBatches: ThreadBatch[] = [];
  let threadsFetched = 0;

  if (!consentRevoked && Date.now() <= deadline) {
    const threadsResp = await client.listThreads(buildInboxQuery(cutoff), MAX_INBOX_THREADS);
    const threadIds = threadsResp.threads?.map((t) => t.id) ?? [];
    const batchItems: Array<{ subject: string; firstLine: string }> = [];
    let processed = 0;

    for (const id of threadIds) {
      if (Date.now() > deadline) { status = 'partial'; break; }
      if (threadsFetched >= MAX_INBOX_THREADS) { status = 'partial'; break; }
      // TOCTOU: re-check consent every BATCH_SIZE_PASS2 threads so a mid-sweep
      // revocation stops the read promptly (bounds reads-after-revoke to one batch).
      if (processed > 0 && processed % BATCH_SIZE_PASS2 === 0 && !(await consentActive())) {
        consentRevoked = true; status = 'partial'; break;
      }
      processed++;
      try {
        const meta = await client.getMessageMetadata(id);
        if (isNewsletter(meta)) continue;
        if (isSensitiveThread(meta)) continue; // P3.9: never send sensitive bodies to the LLM
        const subject =
          meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
        // P3.8: use the server-side snippet (returned by format=metadata) instead of
        // fetching the full message body just to keep a short preview line.
        const snippet = (meta.snippet ?? '').split('\n').find((l) => l.trim()) ?? '';
        batchItems.push({ subject, firstLine: snippet.slice(0, 200) });
        threadsFetched++;
      } catch { continue; }
      if (batchItems.length === BATCH_SIZE_PASS2) {
        threadBatches.push({ threads: [...batchItems] });
        batchItems.length = 0;
      }
    }
    if (batchItems.length > 0) threadBatches.push({ threads: batchItems });
  }

  // ── Derive ───────────────────────────────────────────────────────────────
  // If consent was revoked mid-sweep, do NOT run derive — never transmit the
  // collected bodies/snippets to the LLM after the user said stop. The write-time
  // check below is the final guard (it returns without writing on missing consent).
  const p1 = !consentRevoked && generate && sentBatches.length > 0
    ? await runPass1(sentBatches, generate, accountId)
    : { voiceSamples: [], inferredFacts: [], extraChannels: [], extraTools: [] };

  const p2 = !consentRevoked && generate && threadBatches.length > 0
    ? await runPass2(threadBatches, generate, accountId)
    : { faqCandidates: [] };

  const totalRead = sentFetched + threadsFetched;
  const derived = mergeSweepDerived([p1, p2], {
    oldestMessageDate: oldestDate,
    messagesRead: totalRead,
    recurringContactCount: 0, // contact dedup is not implemented in v1
  });

  // ── TOCTOU consent re-check (RT-3/LS-2) ────────────────────────────────
  // The derive phase takes up to ~45 s. Re-read sweep_consent_at from the DB
  // immediately before writing any derived notes; abort (fail-closed, no write)
  // if the user withdrew consent while the sweep was in flight.
  // If a loop-level re-check already saw the revocation, short-circuit here
  // (derive was skipped, so `derived` is empty and nothing would be written).
  if (consentRevoked) {
    return { status, messagesRead: totalRead, derived };
  }
  const { data: freshConsent } = await svc
    .from('connections')
    .select('sweep_consent_at')
    .eq('id', connectionId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!freshConsent || freshConsent.sweep_consent_at == null) {
    // Consent was revoked mid-sweep. Return with whatever we read — the caller
    // will still finalize the row (marking it complete/partial so the claim is
    // closed), but nothing is written to grove_memory or grove_state.
    return { status, messagesRead: totalRead, derived };
  }

  // ── Write to grove_memory (service role) ────────────────────────────────
  if (derived.voiceSamples.length > 0 || derived.faqCandidates.length > 0 || derived.inferredFacts.length > 0) {
    const { data: memRow } = await svc
      .from('grove_memory')
      .select('sections')
      .eq('account_id', accountId)
      .maybeSingle<{ sections: Record<string, string> | null }>();
    const existing = memRow?.sections ?? {};
    const updated = writeSweepDerivedToMemory(existing, derived);
    await svc.from('grove_memory').upsert({ account_id: accountId, sections: updated }, { onConflict: 'account_id' });
  }

  // ── Merge into UnderstandingProfile (service role) ───────────────────────
  if (derived.extraChannels.length > 0 || derived.extraTools.length > 0) {
    const { data: stateRow } = await svc
      .from('grove_state')
      .select('answers')
      .eq('account_id', accountId)
      .maybeSingle<{ answers: Record<string, unknown> | null }>();
    const answers = stateRow?.answers ?? {};
    const profile = (answers._profile ?? {}) as Partial<UnderstandingProfile>;
    const updatedProfile: Partial<UnderstandingProfile> = {
      ...profile,
      channels: mergeProfileChannelsAndTools(profile.channels ?? [], derived.extraChannels),
      tools: mergeProfileChannelsAndTools(profile.tools ?? [], derived.extraTools),
    };
    await svc
      .from('grove_state')
      .upsert(
        { account_id: accountId, answers: { ...answers, _profile: updatedProfile } },
        { onConflict: 'account_id' },
      );
  }

  // ── Provenance marker (L1 idempotency) ─────────────────────────────────
  // Mark derived_written_at AFTER the grove writes succeed. If a hard process-kill
  // occurs between here and the route's finalize UPDATE, claim_gmail_sweep's
  // stale-reclaim will detect the marker and auto-finalize the row to 'complete'
  // instead of re-running the full sweep (re-spending model budget). Best-effort:
  // a failure here does NOT abort — the row just lacks the marker and the reclaim
  // would re-run (the pre-existing behaviour); this is not worse than before.
  if (claimId) {
    await svc
      .from('gmail_sweep_log')
      .update({ derived_written_at: new Date().toISOString() })
      .eq('id', claimId);
  }

  // #112: the gmail_sweep_log row is no longer written here. The route claims a
  // 'running' row up front (claim_gmail_sweep) and UPDATEs it to this final
  // status by id — so the claim and the result are the same row, and the
  // claim-before-work serialization holds. This function just returns the result.
  return { status, messagesRead: totalRead, derived };
}
