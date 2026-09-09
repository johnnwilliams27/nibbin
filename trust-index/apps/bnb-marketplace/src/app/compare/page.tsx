import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentExplorer } from '@/components/AgentExplorer';
import { rankableAgents, referenceAgents } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Explore and compare agents',
  description: 'Search the selected BNB Chain agent snapshot by task, category, connection, and endpoint evidence.',
};

export default function ComparePage() {
  const agents = rankableAgents();
  return (
    <div className="page-wrap py-9">
      <h1 className="text-[clamp(30px,4vw,42px)]">Find agents</h1>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[var(--fg-muted)]">
        Search {agents.length.toLocaleString('en-US')} agent listings and compare their Trust Index evidence.
      </p>
      <p className="mt-3 max-w-3xl text-[13px] text-[var(--fg-muted)]">
        <Link href="/methodology/" className="underline underline-offset-4">How we assess agents</Link>
      </p>
      <div className="mt-7"><AgentExplorer agents={agents} reference={referenceAgents()} showCategoryFilter /></div>
    </div>
  );
}
