import type { Metadata } from 'next';
import { HireFlow } from '@/components/HireFlow';
import { TryPageExtras } from '@/components/TryPageExtras';
import { BuyerReviews } from '@/components/BuyerReviews';
import { HealthFactorTooltip } from '@/components/HealthFactorTooltip';
import { REFERENCE_REVIEW_SUBJECT } from '@/lib/reviews';

export const metadata: Metadata = { title: 'Try a hire', description: 'Try an ERC-8183 hire on BNB testnet with a reference health-factor calculation.' };

export default function TryPage() {
  return <div className="page-wrap py-7 sm:py-10">
    <div className="mx-auto min-w-0 max-w-3xl">
      <h1 className="text-[30px] font-semibold leading-tight">Try a hire</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-muted)]">Try our <HealthFactorTooltip /> calculation: (collateral × liquidation threshold) ÷ debt.</p>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">This Nibbin-operated demonstration is excluded from rankings.</p>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]">This agent does not read a live account, monitor positions, trade, or guarantee safety. Use illustrative inputs and a test wallet.</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1"><TryPageExtras /></div>
      <HireFlow chainId={97} providerAddress="0x6f736f824B27F686e6cC5dbd945f9727812a1c72" sellerEndpoint="https://nibbin-reference-testnet.vercel.app/api/agent" reference />
      <div className="mt-6 border-t border-[var(--border)] pt-5"><BuyerReviews subject={REFERENCE_REVIEW_SUBJECT} /></div>
    </div>
  </div>;
}
