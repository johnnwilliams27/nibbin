'use client';

import { useState } from 'react';
import { COMMERCE_ABI, CONTRACTS } from '@/lib/commerce-contracts';
import { chainClient } from '@/lib/commerce';
import { fetchDelivery } from '@/lib/commerce-delivery';
import { ReferenceResult } from './ReferenceResult';

const manifestUrl = 'https://nibbin-reference-testnet.vercel.app/result/v1/97/1169';

export function ExampleDelivery() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<Awaited<ReturnType<typeof fetchDelivery>> | null>(null);
  const [status, setStatus] = useState('');
  async function inspect() {
    if (busy) return;
    setBusy(true); setError(null); setVerified(null);
    try {
      const job = await chainClient(97).readContract({ address: CONTRACTS[97].commerceProxy, abi: COMMERCE_ABI, functionName: 'getJob', args: [1169n] });
      if (job.id !== 1169n || ![2, 3].includes(job.status)) throw new Error('The example job currently has no submitted or completed delivery to verify.');
      const delivery = await fetchDelivery(manifestUrl, { id: job.id, chainId: 97, deliverable: job.deliverable });
      setStatus(job.status === 3 ? 'Completed' : 'Submitted'); setVerified(delivery);
    } catch (caught) { setError(caught instanceof Error ? caught.message.slice(0, 350) : 'Could not verify the example. Try again when the chain and seller are reachable.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 min-w-0 max-w-full" aria-label="Verify a real example delivery">
    <p className="text-[13px] text-[var(--fg-muted)]">Verify the result of existing testnet job #1169 against its on-chain digest. Read-only; no wallet or transaction.</p>
    <button type="button" disabled={busy} onClick={inspect} className="mt-3 inline-flex min-h-11 min-w-0 max-w-full items-center justify-center whitespace-normal break-words rounded-[var(--radius-btn)] border border-[var(--border)] px-4 py-2 text-center text-[13px] font-medium disabled:opacity-40">{busy ? 'Verifying…' : 'Verify example delivery'}</button>
    <div role="status" aria-live="polite">{verified ? <div className="mt-4 min-w-0"><p className="text-[13px] font-medium">Job #1169 · {status} · Digest verified</p><p className="mt-2 text-[12px] text-[var(--fg-muted)]">Verified when you clicked. A matching digest proves content integrity, not correctness.</p><ReferenceResult content={verified.content} /><details className="mt-3 text-[12px]"><summary className="cursor-pointer">Verification details</summary><code className="mt-2 block break-all text-[11px]">{verified.hash}</code><a className="mt-3 inline-block underline underline-offset-2" href={manifestUrl} target="_blank" rel="noreferrer noopener">Source manifest</a></details></div> : null}</div>
    {error ? <p role="alert" className="mt-3 text-[12px]" style={{ color: 'var(--critical)' }}>{error}</p> : null}
  </section>;
}
