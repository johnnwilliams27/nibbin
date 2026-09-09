import type { Metadata } from 'next';
import { AgentExplorer } from '@/components/AgentExplorer';
import { DataStatusBanner } from '@/components/DataStatus';
import { headlineStats, rankableAgents, referenceAgents } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Compare agents',
  description:
    'Every indexed BNB Chain agent in one sortable table: our assessment and coverage next to 8004scan feedback and verification, with provenance marked on each column.',
};

export default function ComparePage() {
  const agents = rankableAgents();
  const reference = referenceAgents();
  const stats = headlineStats();

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-9">
      <h1 className="text-[28px]">Compare agents</h1>
      <p className="mt-2 max-w-3xl text-[15px] text-[var(--fg-muted)]">
        All {stats.total.toLocaleString('en-US')} indexed agents across the four categories, in one table. Switch to the
        compare view for a dense column layout where every column states whether the number is ours or 8004scan&apos;s.
      </p>
      <p className="mt-2 max-w-3xl text-[13px] text-[var(--fg-faint)]">
        Sorting never invents a value. When you sort by something an agent has no measurement for, it drops out of the
        ranking into a labelled section below it rather than being ordered as if it scored zero.
      </p>

      {agents.length === 0 && reference.length === 0 ? (
        <div className="mt-7">
          <DataStatusBanner />
        </div>
      ) : (
        <div className="mt-7">
          <AgentExplorer agents={agents} reference={reference} showCategoryFilter defaultView="table" />
        </div>
      )}
    </div>
  );
}
