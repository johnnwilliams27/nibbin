'use client';

import { useEffect, useRef, useState } from 'react';
import { formatUnits, isAddress } from 'viem';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { ExternalLink } from 'lucide-react';
import { connectWallet, parseChainId, switchBnbChain, walletAccount, walletConnectionError, walletError } from '@/lib/wallet';
import type { Eip1193Provider, WalletState } from '@/lib/wallet';
import { ACTION_LABEL, chainClient, commerceCall, createdJobId, explorerTransaction } from '@/lib/commerce';
import type { CommerceAction, CommerceContext } from '@/lib/commerce';
import { COMMERCE_ABI, CONTRACTS, POLICY_ABI } from '@/lib/commerce-contracts';
import { normalizeQuote } from '@/lib/commerce-quote';
import type { VerifiedQuote } from '@/lib/commerce-quote';
import { fundingNotification, fundingReceiptKey, nextJobAction, pollJobUntil, readCommerceJob, sellerRequest, sendCommerceTransaction } from '@/lib/commerce-network';
import type { CommerceJob } from '@/lib/commerce-network';
import { publicEndpoint } from '@/lib/activation';
import { fetchDelivery } from '@/lib/commerce-delivery';
import { settlementWait } from '@/lib/reference-result';
import { ReferenceResult } from './ReferenceResult';
import { BuyerReviewForm } from './BuyerReviewForm';
import { readResumeJob } from '@/lib/hire-resume';
import { HireProgress } from './HireProgress';
import { SmoothDisclosure } from './SmoothDisclosure';

const button = 'inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 whitespace-normal break-words text-center [&>svg]:shrink-0 rounded-[var(--radius-btn)] border border-[var(--border)] px-4 py-2 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40';
const input = 'mt-1 block min-w-0 w-full max-w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px]';
const statuses = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
type Pending = { hash: Hex; action: CommerceAction };

/** Each wallet send is reachable only from a user click. Receipt polling is read-only. */
export function HireFlow({ providerAddress = '', sellerEndpoint = '', chainId, defaultTask = 'collateral=12500 debt=6200 threshold=0.825', reference = false, disabled = false }: {
  providerAddress?: string; sellerEndpoint?: string; chainId: 56 | 97; defaultTask?: string; reference?: boolean; disabled?: boolean;
}) {
  const [provider, setProvider] = useState(providerAddress);
  const [endpoint, setEndpoint] = useState(sellerEndpoint);
  const [task, setTask] = useState(defaultTask);
  const [numbers, setNumbers] = useState({ collateral: '12500', debt: '6200', threshold: '0.825' });
  const [importedQuote, setImportedQuote] = useState('');
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [quote, setQuote] = useState<VerifiedQuote | null>(null);
  const [job, setJob] = useState<CommerceJob | null>(null);
  const [action, setAction] = useState<CommerceAction | null>('create');
  const [pending, setPending] = useState<Pending | null>(null);
  const [transactions, setTransactions] = useState<Pending[]>([]);
  const [fundingHash, setFundingHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [jobInput, setJobInput] = useState('');
  const [resumeOpen, setResumeOpen] = useState(false);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const scrollToReviewJob = useRef<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [deliveryResult, setDeliveryResult] = useState<string | null>(null);
  const [verifiedDelivery, setVerifiedDelivery] = useState<Awaited<ReturnType<typeof fetchDelivery>> | null>(null);
  const [windowSeconds, setWindowSeconds] = useState<bigint | null>(null);
  const [clock, setClock] = useState(Math.floor(Date.now() / 1000));
  const d = CONTRACTS[chainId];
  const connected = wallet !== null && wallet.chainId === chainId;
  const completedJob = job?.status === 3;
  const quoteExpired = quote !== null && clock >= quote.expiresAt;
  const noEdit = busy || job !== null || pending !== null;
  const deliveryVerified = !!job && verifiedDelivery?.jobId === job.id.toString() && verifiedDelivery.hash.toLowerCase() === job.deliverable.toLowerCase();
  const settlementRemaining = job?.status === 2 ? settlementWait(job.submittedAt, windowSeconds, BigInt(clock)) : null;

  function changeNumber(field: keyof typeof numbers, value: string) {
    const next = { ...numbers, [field]: value };
    setNumbers(next);
    setTask(`collateral=${next.collateral} debt=${next.debt} threshold=${next.threshold}`);
    setQuote(null);
  }

  useEffect(() => { const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!reference || chainId !== 97) return;
    const id = readResumeJob(window.location.search);
    if (id) { setJobInput(id); setResumeOpen(true); }
  }, [reference, chainId]);
  useEffect(() => {
    if (busy || !job || job.status !== 3 || scrollToReviewJob.current !== job.id.toString() || !reviewPanel.current) return;
    scrollToReviewJob.current = null;
    reviewPanel.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [busy, job?.id, job?.status]);
  useEffect(() => {
    if (!wallet) return;
    const browserWallet = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
    if (!browserWallet?.on) return;
    const accounts = (value: unknown) => {
      const account = walletAccount(value);
      setWallet((current) => current && account ? { ...current, account } : null);
      setReviewed(false);
      setMessage('Buyer wallet changed. Review the account and terms again before any transaction.');
    };
    const chain = (value: unknown) => {
      const nextChain = parseChainId(value);
      setWallet((current) => current && nextChain ? { ...current, chainId: nextChain } : null);
      setReviewed(false);
    };
    const disconnect = () => accounts([]);
    browserWallet.on('accountsChanged', accounts);
    browserWallet.on('chainChanged', chain);
    browserWallet.on('disconnect', disconnect);
    return () => { browserWallet.removeListener?.('accountsChanged', accounts); browserWallet.removeListener?.('chainChanged', chain); browserWallet.removeListener?.('disconnect', disconnect); };
  }, [wallet?.account, wallet?.chainId]);
  useEffect(() => {
    if (!job || job.status < 1 || job.status > 2) return;
    return pollJobUntil(async () => {
      if (document.visibilityState === 'hidden') return null;
      const fresh = await readCommerceJob(chainId, job.id);
      await nextJobAction(chainId, fresh);
      return fresh;
    }, (fresh) => { if (fresh) setJob(fresh); }, () => BigInt(Math.floor(Date.now() / 1000)) <= job.expiredAt);
  }, [chainId, job?.id, job?.status, job?.expiredAt]);

  function injected(): Eip1193Provider {
    const result = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
    if (!result?.request) throw new Error('No browser wallet found. Open this page in your wallet browser or enable an extension.');
    return result;
  }
  async function run(operation: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try { await operation(); }
    catch (caught) {
      const hasCode = typeof caught === 'object' && caught !== null && 'code' in caught;
      setError(hasCode ? ('code' in caught && caught.code === 4001 ? 'You cancelled the wallet request. No subsequent step was sent. Check any earlier transaction receipts before continuing.' : walletError(caught)) : caught instanceof Error ? caught.message.slice(0, 350) : 'The operation did not finish. Check your wallet and job state before retrying.');
    } finally { setBusy(false); }
  }
  async function connect() {
    let browserWallet: Eip1193Provider;
    try { browserWallet = injected(); }
    catch (error) { throw walletConnectionError(error, 'finding browser wallet'); }
    const state = await connectWallet(browserWallet);
    setWallet(state);
    setMessage('Wallet connected. No spending permission or transaction requested.');
  }
  async function getQuote(raw?: unknown) {
    if (!isAddress(provider)) throw new Error('Enter the seller’s wallet address. The quote must be signed by that wallet.');
    const response = raw ?? await sellerRequest(endpoint, { skill: 'negotiate', task_description: task, terms: { deliverables: reference ? 'Health factor, risk band, headroom and formula' : 'Complete the requested task and provide a retrievable deliverable', quality_standards: reference ? 'Deterministic arithmetic; show the formula' : 'Return the result and explain how it meets the task' } });
    const block = await chainClient(chainId).getBlock();
    const verified = await normalizeQuote(response, provider, chainId, Number(block.timestamp));
    const token = await chainClient(chainId).readContract({ address: d.commerceProxy, abi: COMMERCE_ABI, functionName: 'paymentToken' });
    if (token.toLowerCase() !== d.paymentToken.toLowerCase()) throw new Error('Commerce payment token differs from the supported deployment. No transaction prepared.');
    const disputeWindow = await chainClient(chainId).readContract({ address: d.policy, abi: POLICY_ABI, functionName: 'disputeWindow' });
    setWindowSeconds(disputeWindow);
    setQuote(verified); setReviewed(false); setAction('create');
    setMessage('Seller signature verified against the selected wallet, chain, contract and terms. Review before creating a job.');
  }

  async function refresh(currentId = job?.id, expectedQuote = quote) {
    if (!currentId || !wallet) throw new Error('Connect the buyer wallet and enter a job ID.');
    const fresh = await readCommerceJob(chainId, currentId);
    if (fresh.id !== currentId || fresh.client.toLowerCase() !== wallet.account.toLowerCase()) throw new Error('This job belongs to a different buyer wallet.');
    if (fresh.provider.toLowerCase() !== provider.toLowerCase() || fresh.evaluator.toLowerCase() !== d.routerProxy.toLowerCase() || fresh.hook.toLowerCase() !== d.routerProxy.toLowerCase()) throw new Error('This job does not match the selected seller and supported router.');
    if (expectedQuote && fresh.description !== expectedQuote.description) throw new Error('Job description does not match the quote you reviewed.');
    if (expectedQuote && fresh.budget !== 0n && fresh.budget !== expectedQuote.price) throw new Error('On-chain budget differs from the signed quote.');
    const next = await nextJobAction(chainId, fresh);
    setJob(fresh); setJobInput(currentId.toString());
    setAction(next);
    return fresh;
  }

  async function receiptConfirmed(receipt: TransactionReceipt, transaction: Pending) {
    if (receipt.status !== 'success') { setPending(null); throw new Error('Transaction reverted on-chain. No next step was sent. Review the receipt before retrying.'); }
    const id = transaction.action === 'create' ? createdJobId(receipt, chainId) : job?.id;
    if (!id) throw new Error('Confirmed transaction did not yield a verified job ID. Do not create another job; inspect the receipt and resume by ID.');
    await refresh(id);
    setPending(null);
    setMessage(`${ACTION_LABEL[transaction.action]} confirmed. ${transaction.action === 'fund' ? 'Now notify the seller to begin delivery.' : 'Review the next step below.'}`);
  }

  async function execute(next: CommerceAction) {
    if (!connected || !wallet || !quote || !reviewed || pending) throw new Error('Connect the correct buyer wallet, verify the quote and review the terms first.');
    if (windowSeconds === null) throw new Error('Read the policy window before preparing a job.');
    const block = await chainClient(chainId).getBlock();
    if (['create', 'register', 'budget', 'approve', 'fund'].includes(next) && Number(block.timestamp) >= quote.expiresAt) throw new Error('The signed quote expired. Do not fund this job; obtain a new quote and start a new job.');
    if (next !== 'create') {
      const fresh = await refresh();
      if (!fresh) throw new Error('No confirmed job');
      if (['register', 'budget', 'approve', 'fund'].includes(next) && await nextJobAction(chainId, fresh) !== next) throw new Error('Job state changed. Review the updated next step.');
      if ((next === 'settle' || next === 'dispute') && fresh.status !== 2) throw new Error('The job has no submitted delivery to review.');
      if (next === 'settle' && (!verifiedDelivery || verifiedDelivery.jobId !== fresh.id.toString() || verifiedDelivery.hash.toLowerCase() !== fresh.deliverable.toLowerCase())) throw new Error('Download and verify the deliverable against its on-chain digest before settlement.');
      if (next === 'settle') {
        const currentWindow = await chainClient(chainId).readContract({ address: d.policy, abi: POLICY_ABI, functionName: 'disputeWindow' });
        setWindowSeconds(currentWindow);
        const remaining = settlementWait(fresh.submittedAt, currentWindow, block.timestamp);
        if (remaining === null || remaining > 0n) throw new Error('The on-chain dispute window has not finished. Wait for the countdown before settlement.');
      }
      if (next === 'refund' && (fresh.status !== 1 && fresh.status !== 2 || block.timestamp <= fresh.expiredAt)) throw new Error('This job is not eligible for an expired-job refund.');
    }
    const context: CommerceContext = { chainId, provider: quote.provider, description: quote.description, price: quote.price, expiredAt: job?.expiredAt ?? block.timestamp + windowSeconds + 1200n, jobId: job?.id ?? null };
    const hash = await sendCommerceTransaction(injected(), wallet.account as Address, next, context);
    const transaction = { hash, action: next };
    setPending(transaction); setTransactions((previous) => [...previous, transaction]);
    if (next === 'fund' && job) rememberFunding(job.id, hash);
    setMessage('Transaction submitted. Waiting for an on-chain receipt; do not send it again.');
    const receipt = await chainClient(chainId).waitForTransactionReceipt({ hash, timeout: 90000 });
    await receiptConfirmed(receipt, transaction);
  }

  async function notifySeller() {
    const fresh = await refresh();
    if (!fresh || fresh.status !== 1) throw new Error('Only a confirmed funded job can be sent to the seller.');
    const notification = fundingNotification(fresh.id, fundingHash.trim());
    rememberFunding(fresh.id, notification.funding_tx_hash);
    const response = await sellerRequest(endpoint, notification);
    const data = response as Record<string, unknown>;
    const suppliedUrl = typeof data.deliverableUrl === 'string' ? data.deliverableUrl : null;
    setResultUrl(publicEndpoint(suppliedUrl));
    setVerifiedDelivery(null);
    setDeliveryResult(JSON.stringify(response, null, 2));
    await refresh();
    setMessage('Seller response received. Job status below is read from the chain, not inferred from this response.');
  }

  function rememberFunding(id: bigint, hash: string) {
    setFundingHash(hash);
    if (!wallet) return;
    try { sessionStorage.setItem(fundingReceiptKey(chainId, wallet.account, provider, id), hash); }
    catch { /* Storage may be disabled. The visible hash remains available to copy. */ }
  }

  async function resume() {
    const resumeId = readResumeJob(new URLSearchParams({ job: jobInput }).toString());
    if (!connected || !isAddress(provider) || !resumeId) throw new Error('Connect the buyer wallet and enter a valid seller and job ID.');
    const fresh = await readCommerceJob(chainId, BigInt(resumeId));
    const content = JSON.parse(fresh.description);
    const block = await chainClient(chainId).getBlock();
    // Expired quotes may be inspected for already-funded jobs; funding still checks current time.
    const at = fresh.status === 0 ? Number(block.timestamp) : Math.min(Number(block.timestamp), Number(content.quote_expires_at) - 1);
    const verified = await normalizeQuote(content, provider, chainId, at);
    await refresh(BigInt(resumeId), verified);
    let savedHash = '';
    try { savedHash = sessionStorage.getItem(fundingReceiptKey(chainId, wallet!.account, provider, fresh.id)) ?? ''; } catch { /* Manual receipt entry remains available. */ }
    setFundingHash(/^0x[0-9a-f]{64}$/i.test(savedHash) ? savedHash : '');
    if (reference && publicEndpoint(endpoint)) setResultUrl(`${new URL(endpoint).origin}/result/v1/${chainId}/${jobInput}`);
    setQuote(verified); setReviewed(false);
    if (fresh.status < 3) setWindowSeconds(await chainClient(chainId).readContract({ address: d.policy, abi: POLICY_ABI, functionName: 'disputeWindow' }));
    if (reference && chainId === 97 && fresh.status === 3) scrollToReviewJob.current = fresh.id.toString();
    setResumeOpen(false);
    setMessage(fresh.status === 3 ? 'Completed job loaded from chain. You can leave a review below.' : 'Existing job loaded from chain. Review its signed terms before any further wallet action.');
  }

  const nextPreview = quote && action ? commerceCall(action, { chainId, provider: quote.provider, description: quote.description, price: quote.price, expiredAt: job?.expiredAt ?? BigInt(clock) + (windowSeconds ?? 0n) + 1200n, jobId: job?.id ?? null }) : null;
  return (
    <section className="mt-5 min-w-0 max-w-full border-t border-[var(--border)] pt-4" aria-label="On-chain hire">
      {reference ? <HireProgress connected={connected} quoted={!!quote} status={job?.status ?? null} /> : null}
      {!job ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[17px] font-semibold">{resumeOpen ? 'Resume your hire' : 'Set up your hire'}</h2><button type="button" className={button} disabled={busy || disabled || !!pending} aria-expanded={resumeOpen} aria-controls="resume-hire" onClick={() => setResumeOpen(!resumeOpen)}>{resumeOpen ? 'New hire' : 'Resume a hire'}</button></div> : null}
      <div hidden={completedJob}>
      {!reference ? <h3 className="text-[17px] font-semibold">Hire this seller</h3> : null}
      {!reference ? <p className="mt-2 text-[13px] text-[var(--fg-muted)]">A registry listing does not establish ERC-8183 seller compatibility. Verify a signed quote before funding.</p> : null}
      <p className="mt-2 text-[12px]" style={{ color: 'var(--withheld)' }}>{chainId === 56 ? 'BNB mainnet · Real tokens and gas; confirm each wallet transaction.' : 'BNB testnet · Test tokens only. Your wallet pays tBNB gas.'}</p>
      {reference ? <p className="mt-1 text-[13px]">Task fee: 0 U · Wallet gas is separate.</p> : null}
      {disabled ? <p className="mt-3 text-[13px]" style={{ color: 'var(--critical)' }}>Read and acknowledge the safety findings above before using this flow.</p> : null}
      <p className="mt-3 text-[12px] font-medium">Your task, inputs and signed terms become permanently public on-chain. Do not enter confidential information.</p>
      <fieldset hidden={resumeOpen && !job} disabled={noEdit || disabled} className="mt-4 min-w-0 space-y-3 disabled:opacity-60">
        {reference ? <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>label]:min-w-0"><label className="block text-[12px]">Collateral value<input className={input} type="number" min="0" step="any" inputMode="decimal" value={numbers.collateral} onChange={(event) => changeNumber('collateral', event.target.value)} /></label><label className="block text-[12px]">Debt value<input className={input} type="number" min="0.000001" step="any" inputMode="decimal" value={numbers.debt} onChange={(event) => changeNumber('debt', event.target.value)} /></label><label className="block text-[12px]">Liquidation threshold<input className={input} type="number" min="0" max="1" step="0.001" inputMode="decimal" value={numbers.threshold} onChange={(event) => changeNumber('threshold', event.target.value)} /><span className="mt-1 block text-[11px] text-[var(--fg-muted)]">Decimal · 0.825 means 82.5%</span></label></div>
          <p className="text-[12px] text-[var(--fg-muted)]">Use the same unit for collateral and debt. Illustrative inputs only.</p>
        </> : <>
          <label className="block text-[12px]">Seller wallet · must sign the quote<input className={input} value={provider} onChange={(event) => { setProvider(event.target.value.trim()); setQuote(null); }} placeholder="0x…" autoComplete="off" /></label>
          <label className="block text-[12px]">Seller A2A endpoint · HTTPS + CORS required<input className={input} value={endpoint} onChange={(event) => { setEndpoint(event.target.value.trim()); setQuote(null); }} placeholder="https://seller.example/api/agent" autoComplete="off" /></label>
          <label className="block text-[12px]">Task<textarea className={input} value={task} maxLength={1500} onChange={(event) => { setTask(event.target.value); setQuote(null); }} rows={2} /></label>
        </>}
      </fieldset>
      {reference ? <SmoothDisclosure label="Seller and contract details" className="mt-2 text-[12px]"><dl className="mt-2 space-y-2"><div><dt>Seller</dt><dd className="break-all">{provider}</dd></div><div><dt>A2A endpoint</dt><dd className="break-all">{endpoint}</dd></div><div><dt>Commerce contract</dt><dd className="break-all">{d.commerceProxy}</dd></div><div><dt>Generated task</dt><dd className="break-all">{task}</dd></div></dl></SmoothDisclosure> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!completedJob || !connected ? <button className={`${button} ${!connected ? 'primary-button' : ''}`} type="button" disabled={busy || disabled} onClick={() => run(connect)}>{wallet ? 'Reconnect wallet' : 'Connect wallet'}</button> : null}
        {wallet && !connected ? <button className={button} type="button" disabled={busy || disabled} onClick={() => run(async () => { await switchBnbChain(injected(), chainId); await connect(); })}>Switch to BNB {chainId === 97 ? 'testnet' : 'mainnet'}</button> : null}
        {wallet ? <button className={button} type="button" disabled={busy} onClick={() => { setWallet(null); setMessage('Disconnected locally. Revoke site access in wallet settings if needed.'); }}>Disconnect</button> : null}
        {!resumeOpen && !job ? <button className={`${button} ${connected && !quote ? 'primary-button' : ''}`} type="button" disabled={noEdit || disabled || !connected || !endpoint || !provider || !task} onClick={() => run(() => getQuote())}>{quote ? 'Request fresh quote' : 'Get signed quote'}</button> : null}
      </div>
      {wallet ? <p className="mt-2 break-all text-[11px] text-[var(--fg-muted)]">Buyer {wallet.account} · Chain {wallet.chainId}</p> : null}
      {!job ? <div id="resume-hire" hidden={!resumeOpen} className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <p className="mt-1 text-[13px] text-[var(--fg-muted)]">Load an existing job to inspect its result or review a completed hire. Connect the same buyer wallet above; no new quote or transaction is needed.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3 pb-2"><label className="min-w-0 flex-1 basis-[180px] text-[13px]">Existing job ID<input className={input} value={jobInput} maxLength={78} inputMode="numeric" autoComplete="off" disabled={busy || disabled || !!pending} onChange={(event) => setJobInput(event.target.value)} placeholder="Enter your job ID" /></label><button type="button" className={`${button} ${connected ? 'primary-button' : ''}`} disabled={busy || disabled || !connected || !!pending || !readResumeJob(new URLSearchParams({ job: jobInput }).toString())} onClick={() => run(resume)}>Load job from chain</button></div>
      </div> : null}
      {!job && !resumeOpen ? <details className="mt-3 text-[12px]"><summary className="min-h-11 cursor-pointer py-2">Advanced: import a signed quote</summary>
        <label className="mt-3 block">SDK quote JSON<textarea className={input} rows={3} value={importedQuote} maxLength={16000} disabled={noEdit} onChange={(event) => setImportedQuote(event.target.value)} /></label>
        <button type="button" className={`${button} mt-2`} disabled={noEdit || disabled || !importedQuote} onClick={() => run(() => getQuote(JSON.parse(importedQuote)))}>Verify imported quote</button>
      </details> : null}
      {quote && !completedJob ? <div className="results-enter mt-4 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium">Seller signature verified</p>
        <dl className="mt-3 space-y-2 text-[12px]"><div><dt className="text-[var(--fg-muted)]">Signed task</dt><dd className="mt-1 whitespace-pre-wrap break-words">{quote.task}</dd></div><div><dt className="text-[var(--fg-muted)]">Exact escrow budget</dt><dd>{formatUnits(quote.price, 18)} U {quote.price === 0n ? '· No token approval or paid escrow' : '· Plus wallet gas'}</dd></div><div><dt className="text-[var(--fg-muted)]">Quote expiry</dt><dd>{quoteExpired ? 'Expired for new funding' : `${Math.max(0, quote.expiresAt - clock)} seconds remaining`}</dd></div><div><dt className="text-[var(--fg-muted)]">Commerce contract</dt><dd className="break-all">{d.commerceProxy}</dd></div></dl>
        <details className="mt-3 text-[12px]"><summary className="cursor-pointer">Full signed terms</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[10px]">{quote.description}</pre></details>
        <label className="mt-3 flex min-h-11 items-start gap-2 text-[12px]"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the seller, task, budget, network and contract. I understand my full task and inputs become permanently public on-chain. Gas is paid by my wallet. A signed quote is not a Nibbin quality guarantee.</span></label>
      </div> : null}
      {job ? <div key={`${job.id}:${job.status}`} className="results-enter mt-4 text-[13px]"><p className="font-medium">Job #{job.id.toString()} · {statuses[job.status] ?? 'Unknown status'}</p><p className="mt-1 text-[12px] text-[var(--fg-muted)]">On-chain budget: {formatUnits(job.budget, 18)} U. {job.status === 1 ? 'Escrow is funded; notify the seller to start.' : job.status === 2 ? 'Delivery submitted. Inspect it before settlement. The policy’s dispute window is enforced on-chain.' : ''}</p><button type="button" className={`${button} mt-2`} disabled={busy || disabled || !wallet} onClick={() => run(async () => { await refresh(); })}>Refresh job status</button></div> : null}
      {nextPreview && action ? <div className="mt-4 rounded-[var(--radius-btn)] border border-[var(--border)] p-3"><p className="text-[13px] font-medium">Next: {ACTION_LABEL[action]}</p><p className="mt-2 break-all text-[10px]">To: {nextPreview.to}</p><p className="mt-1 text-[12px] text-[var(--fg-muted)]">Native BNB transfer: 0. {action === 'approve' ? `Token allowance: exactly ${quote ? formatUnits(quote.price, 18) : '0'} U to the commerce contract.` : 'The wallet shows network gas before you confirm.'}</p><details className="mt-2 text-[11px]"><summary className="cursor-pointer">Transaction calldata</summary><code className="mt-2 block break-all">{nextPreview.data}</code></details><button type="button" className={`${button} mt-3 w-full ${reviewed ? 'primary-button' : ''}`} disabled={busy || disabled || !connected || !reviewed || !!pending || quoteExpired} onClick={() => run(() => execute(action))}>{busy ? 'Waiting…' : `${ACTION_LABEL[action]} in wallet`}</button></div> : null}
      {pending ? <div className="mt-3"><p className="text-[12px]">Transaction sent. Check its receipt before another wallet action.</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => run(async () => { const receipt = await chainClient(chainId).waitForTransactionReceipt({ hash: pending.hash, timeout: 60000 }); await receiptConfirmed(receipt, pending); })}>Check submitted transaction</button></div> : null}
      {job?.status === 1 ? <div className="mt-3"><label className="block text-[12px]">Funding transaction hash<input className={input} value={fundingHash} onChange={(event) => setFundingHash(event.target.value.trim())} placeholder="0x… funding receipt from your wallet" disabled={busy || disabled} /></label><p className="mt-1 text-[11px] text-[var(--fg-muted)]">The seller verifies this receipt to locate funding without scanning chain history. Only this public hash is saved in this tab’s session; no task or wallet credentials are saved.</p><button type="button" className={`${button} mt-3`} disabled={busy || disabled || !endpoint || !connected || !/^0x[0-9a-f]{64}$/i.test(fundingHash)} onClick={() => run(notifySeller)}>Notify seller to begin delivery</button></div> : null}
      {deliveryResult ? <details className="mt-3 min-w-0 text-[12px]"><summary className="cursor-pointer">Seller response · not yet verified</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{deliveryResult}</pre></details> : null}
      {publicEndpoint(resultUrl) && !completedJob ? <a href={publicEndpoint(resultUrl)!} target="_blank" rel="noreferrer noopener" className={`${button} mt-3`}>Open deliverable <ExternalLink size={14} strokeWidth={1.5} aria-hidden /></a> : null}
      {job && [2, 3].includes(job.status) ? <div className="mt-4 rounded-[var(--radius-btn)] border border-[var(--border)] p-4">
        <h3 className="text-[15px] font-semibold">Deliverable</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy || disabled || !resultUrl} onClick={() => run(async () => { const fresh = await refresh(); if (!fresh || !resultUrl) throw new Error('Load the job first'); setVerifiedDelivery(null); setVerifiedDelivery(await fetchDelivery(resultUrl, { id: fresh.id, chainId, deliverable: fresh.deliverable })); })}>Download and verify deliverable</button>
          {completedJob && publicEndpoint(resultUrl) ? <a href={publicEndpoint(resultUrl)!} target="_blank" rel="noreferrer noopener" className={button}>Open deliverable <ExternalLink size={14} strokeWidth={1.5} aria-hidden /></a> : null}
        </div>
        <p className="mt-2 text-[12px] font-medium" style={{ color: deliveryVerified ? 'var(--measured)' : 'var(--withheld)' }}>{deliveryVerified ? 'Verified: matches the on-chain digest.' : 'Not verified in this session.'}</p>
        {deliveryVerified ? <div className="results-enter"><p className="mt-1 text-[12px] text-[var(--fg-muted)]">{completedJob ? 'Verification confirms content integrity, not correctness.' : 'This proves content integrity, not correctness. Review the actual result before settling.'}</p>{reference && verifiedDelivery ? <ReferenceResult content={verifiedDelivery.content} /> : <details className="mt-2 text-[12px]"><summary className="cursor-pointer">Raw delivery content</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{verifiedDelivery?.content}</pre></details>}</div> : null}
        <details open={!completedJob} className="mt-2 text-[12px]"><summary className="w-fit min-h-11 cursor-pointer py-3 text-[var(--fg-muted)]">Delivery details</summary>
          <p className="font-medium">On-chain deliverable digest</p><code className="mt-2 block break-all text-[10px]">{job.deliverable}</code><label className="mt-3 block">Deliverable manifest URL<input className={input} value={resultUrl ?? ''} onChange={(event) => { setResultUrl(event.target.value); setVerifiedDelivery(null); }} placeholder="https://seller.example/result/…" /></label>
        </details>
      </div> : null}
      {job?.status === 2 ? <div className="mt-3"><p className="mb-2 text-[12px] text-[var(--fg-muted)]">{settlementRemaining === null ? 'Settlement timing is not available. Refresh the job and policy before continuing.' : settlementRemaining > 0n ? `Dispute window: ${settlementRemaining.toString()} seconds remaining before settlement. Based on the on-chain submission time and policy duration; the chain rechecks timing.` : 'Dispute window elapsed. Verify and inspect the delivery before settlement.'}</p><div className="flex flex-wrap gap-2"><button type="button" className={`${button} ${reviewed && deliveryVerified && settlementRemaining === 0n ? 'primary-button' : ''}`} disabled={busy || disabled || !connected || !reviewed || !!pending || !deliveryVerified || settlementRemaining !== 0n} onClick={() => run(() => execute('settle'))}>{settlementRemaining !== null && settlementRemaining > 0n ? `Settlement available in ${settlementRemaining.toString()}s` : 'Review settlement in wallet'}</button><button type="button" className={`${button} hire-action-danger`} disabled={busy || disabled || !connected || !reviewed || !!pending} onClick={() => run(() => execute('dispute'))}>Dispute in wallet</button></div></div> : null}
      {job && [1, 2].includes(job.status) && BigInt(clock) > job.expiredAt ? <button type="button" className={`${button} mt-3`} disabled={busy || disabled || !reviewed || !!pending} onClick={() => run(() => execute('refund'))}>Claim refund in wallet</button> : null}
      {reference && chainId === 97 && job?.status === 3 ? <div ref={reviewPanel} className="scroll-mt-6"><BuyerReviewForm key={`${job.id}:${job.client}`} jobId={job.id.toString()} buyer={job.client} completed chainId={chainId} walletProvider={injected} disabled={busy || disabled || !connected} /></div> : null}
      {completedJob && quote ? <details className="mt-4 border-t border-[var(--border)] pt-2 text-[12px]"><summary className="w-fit min-h-11 cursor-pointer py-3 text-[var(--fg-muted)]">Hire record</summary><dl className="space-y-3"><div><dt className="text-[var(--fg-muted)]">Signed task</dt><dd className="whitespace-pre-wrap break-words">{quote.task}</dd></div><div><dt className="text-[var(--fg-muted)]">Exact budget</dt><dd>{formatUnits(quote.price, 18)} U</dd></div><div><dt className="text-[var(--fg-muted)]">Seller</dt><dd className="break-all">{provider}</dd></div><div><dt className="text-[var(--fg-muted)]">Commerce contract</dt><dd className="break-all">{d.commerceProxy}</dd></div></dl><p className="mt-3 font-medium">Full signed terms</p><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[10px]">{quote.description}</pre></details> : null}
      {transactions.length ? <ul className="mt-4 space-y-2 text-[12px]">{transactions.map((tx) => <li key={tx.hash}><a className="underline underline-offset-2" href={explorerTransaction(chainId, tx.hash)} target="_blank" rel="noreferrer noopener">{ACTION_LABEL[tx.action]} · View transaction <ExternalLink size={11} strokeWidth={1.5} className="inline" aria-hidden /></a></li>)}</ul> : null}
      {transactions.some((tx) => tx.action === 'approve') ? <p className="mt-3 text-[12px] text-[var(--fg-muted)]">If you stop after approving tokens and before funding, the allowance may remain. Review or revoke it in your wallet’s token-approval settings.</p> : null}
      <p role="status" aria-live="polite" className="mt-3 text-[12px] text-[var(--fg-muted)]">{busy ? 'Working on your requested step. Do not close the page while a wallet transaction is pending.' : message}</p>
      {error ? <p role="alert" className="mt-2 break-words text-[12px]" style={{ color: 'var(--critical)' }}>{error}</p> : null}
    </section>
  );
}
