import type { Metadata } from 'next';
import Link from 'next/link';
import { HireFlow } from '@/components/HireFlow';

export const metadata: Metadata = { title: 'Limited mainnet hire', description: 'An allowlisted reference hire on BNB mainnet. Real network gas applies.' };

export default function MainnetReferencePage() {
  return <div className="page-wrap py-7 sm:py-10"><div className="mx-auto min-w-0 max-w-3xl">
    <Link href="/try" className="text-[13px] text-[var(--fg-muted)] underline underline-offset-4">Use testnet instead</Link>
    <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3"><h1 className="text-[30px] font-semibold leading-tight">Try a mainnet hire</h1><span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[12px]">BNB mainnet</span></div>
    <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-muted)]">Reference health-factor calculation. This demonstration is restricted to the allowlisted buyer.</p>
    <p className="mt-4 break-words text-[13px]" style={{ color: 'var(--withheld)' }}>Real BNB gas applies to every wallet transaction. The task costs 0 U. Do not send tokens directly to the seller.</p>
    <details className="mt-3 text-[13px]"><summary className="cursor-pointer">Buyer eligibility and limits</summary><dl className="mt-3 space-y-3 text-[var(--fg-muted)]"><div><dt>Allowed buyer</dt><dd className="mt-1 break-all">0x51e048a166d22e2898790a4806652bcff6f03a36</dd></div><div><dt>Seller capacity</dt><dd>At most 3 submissions, each capped at 0.0001 BNB seller gas. Buyer-wallet gas is separate. Quotes require an available seller reserve and submission capacity.</dd></div></dl></details>
    <HireFlow key="56:reference" chainId={56} providerAddress="0xf1d2541ee88ad9DCcFC4D7526EEFB4b31Ee56645" sellerEndpoint="https://nibbin-reference-mainnet.vercel.app/api/agent" reference />
    <details className="mt-5 border-t border-[var(--border)] pt-4 text-[13px]"><summary className="cursor-pointer">About this demonstration</summary><p className="mt-3 leading-relaxed text-[var(--fg-muted)]">This Nibbin-operated reference agent is not independently rated. Use illustrative figures only. It does not read live positions, trade, move collateral, monitor continuously or establish that a position is safe.</p></details>
  </div></div>;
}
