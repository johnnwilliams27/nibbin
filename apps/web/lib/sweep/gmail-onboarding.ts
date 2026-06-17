import 'server-only';

import { GmailClient, SupabaseTokenVault } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';
import { anthropicGenerate } from '../llm/client';
import type { UnderstandingProfile } from '@nibbin/keeper';
import { runPass1, runPass2, mergeSweepDerived, type SentBatch, type ThreadBatch } from './derive';
import type { SweepDerived, SweepStatus } from './types';

export const SWEEP_WINDOW_DAYS = 90;
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

export function isSensitiveThread(meta: MessageMetaLike): boolean {
  const headers = meta.payload?.headers ?? [];
  const get = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name)?.value?.toLowerCase() ?? '';
  // Normalize From/Subject to single-space-delimited tokens, padded with spaces,
  // so we get whole-word matching via plain includes() — no dynamic RegExp (SAST
  // detect-non-literal-regexp) and no ReDoS surface. Keywords are normalized the
  // same way, so multi-word / hyphenated terms (e.g. "two-factor") still match.
  const norm = (s: string): string => ` ${s.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const haystack = norm(`${get('from')} ${get('subject')}`);
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

  // ── Pass 1: Sent messages ────────────────────────────────────────────────
  const sentBatches: SentBatch[] = [];
  let sentFetched = 0;
  const oldestDate: string = cutoff.toISOString().slice(0, 10);
  let pageToken: string | undefined;

  outer: do {
    if (Date.now() > deadline) { status = 'partial'; break; }
    const page = await client.listMessages(buildSentQuery(cutoff), pageToken, 50);
    const ids = page.messages?.map((m) => m.id) ?? [];
    const batchBodies: string[] = [];
    for (const id of ids) {
      if (Date.now() > deadline) { status = 'partial'; break outer; }
      if (sentFetched >= MAX_SENT_MESSAGES) { status = 'partial'; break outer; }
      const body = await client.getMessageBody(id); // swallows failures
      if (body) {
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

  if (Date.now() <= deadline) {
    const threadsResp = await client.listThreads(buildInboxQuery(cutoff), MAX_INBOX_THREADS);
    const threadIds = threadsResp.threads?.map((t) => t.id) ?? [];
    const batchItems: Array<{ subject: string; firstLine: string }> = [];

    for (const id of threadIds) {
      if (Date.now() > deadline) { status = 'partial'; break; }
      if (threadsFetched >= MAX_INBOX_THREADS) { status = 'partial'; break; }
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
  const p1 = generate && sentBatches.length > 0
    ? await runPass1(sentBatches, generate, accountId)
    : { voiceSamples: [], inferredFacts: [], extraChannels: [], extraTools: [] };

  const p2 = generate && threadBatches.length > 0
    ? await runPass2(threadBatches, generate, accountId)
    : { faqCandidates: [] };

  const totalRead = sentFetched + threadsFetched;
  const derived = mergeSweepDerived([p1, p2], {
    oldestMessageDate: oldestDate,
    messagesRead: totalRead,
    recurringContactCount: 0, // contact dedup is not implemented in v1
  });

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

  // ── Insert gmail_sweep_log ───────────────────────────────────────────────
  await svc.from('gmail_sweep_log').insert({
    account_id: accountId,
    connection_id: connectionId,
    status,
    messages_read: totalRead,
    oldest_message_date: derived.oldestMessageDate || null,
    error_summary: null,
  });

  return { status, messagesRead: totalRead, derived };
}
