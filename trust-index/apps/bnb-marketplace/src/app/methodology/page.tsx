import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { allAgents, loadDataset } from '@/lib/data';
import { populationSummary } from '@/lib/evidence';
import { num, timestamp } from '@/lib/format';

export const metadata: Metadata = { title: 'How we assess agents', description: 'Our selection method, evidence sources, endpoint checks, and the limits of what this marketplace establishes.' };

export default function MethodologyPage() {
  const stats = populationSummary(allAgents());
  const { generated_at } = loadDataset();
  return (
    <div className="mx-auto max-w-[900px] px-5 py-12">
      <h1 className="text-[36px] tracking-tight">How we assess agents</h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-[var(--fg-muted)]">Trust Index separates operator claims from our checks. Here’s what the evidence means—and what it cannot tell you.</p>
      <nav aria-label="Methodology sections" className="methodology-nav my-8 flex flex-wrap gap-1 border-y border-[var(--border)] py-3 text-[13px] text-[var(--fg-muted)]">
        <a href="#selection">Selection</a><a href="#evidence">Evidence</a><a href="#ratings">Ratings</a><a href="#safety">Safety</a><a href="#sources">Sources</a>
      </nav>
      <Section id="selection" title="The scope of this marketplace">
        <p>This snapshot contains {num(stats.registrations)} candidate registrations obtained through 8004scan’s BSC API. It is a selected discovery pool, not a complete or random sample of every agent on BNB Chain.</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li><strong>Find candidates.</strong> Combine MCP declarations, feedback, endpoint-verification records, and A2A declarations. The A2A stream is capped at 3,000 records. Thirteen task-related keyword searches add candidates; each search is capped at 500 records.</li>
          <li><strong>Read their declarations.</strong> Fetch registry detail where available. Unread or rate-limited detail remains a measurement gap, never evidence that an agent has no interface.</li>
          <li><strong>Match the four required jobs.</strong> Deterministic rules inspect names, descriptions, declared skills, and capability names. Specific matches place {num(stats.listed)} registrations into rebalancing, grid trading, yield optimisation, or health factor monitoring. Tag-only matches do not establish a category.</li>
          <li><strong>Link endpoint evidence.</strong> A probe result belongs to the endpoint we checked. Several registrations may reference that endpoint; reusing its result does not mean each agent was independently tested.</li>
        </ol>
        <p>Rule-match strength is a heuristic, not a calibrated probability or proof of execution. There is no minimum numeric confidence threshold for listing. Descriptions in other words or languages can be missed. The {num(stats.outsideCategories)} remaining candidates are outside these category matches—not necessarily inactive, unsafe, or unhireable.</p>
      </Section>
      <Section id="evidence" title="What we have—and have not—checked">
        <p>The current marketplace checks interface discovery, protocol exchanges, reported tools or skills, and response timing. It distinguishes a confirmed protocol exchange from a retrieved agent card, a service descriptor, an authentication requirement, and an unsuccessful reading.</p>
        <p>A tool list and a card describe capabilities; they do not prove those capabilities work. These marketplace checks do not execute trades or financial strategies, and they do not establish returns, ongoing uptime, or investment suitability.</p>
        <p>Some discoveries are host-level rather than specific to an agent. Each enriched record identifies that scope and the original observation time. Copying an older observation onto another registration does not refresh that observation.</p>
      </Section>
      <Section id="ratings" title="Why a score can be absent">
        <p>The current marketplace snapshot has no behavioral composites. Its interface-discovery pipeline does not run the broader behavioral battery. A withheld score is therefore not a finding that the agent failed that battery.</p>
        <p>The broader Trust Index engine supports behavioral checks and coverage-based publication rules. Those capabilities must not be confused with checks actually run on these marketplace registrations. We do not lower thresholds or transfer a server-interface score to an agent to make a number appear.</p>
        <p>Missing scores are never zero. When a selected sort needs a missing measurement, the interface keeps those records separate instead of giving them a false rank.</p>
      </Section>
      <Section id="safety" title="Before you connect or hire">
        <p>Read any surfaced safety flags and inspect the requested permissions. An absence of flags is not a safety certification. A declared payment method is not proof of a working checkout, and a connected wallet has not hired an agent.</p>
        <p>ERC-8183 hiring requires a compatible seller and a valid signed quote. The wallet must approve the actual network, provider, token, price, and transactions. Gas and escrow are separate. Review delivery before settlement; on-chain execution does not guarantee the quality of the work.</p>
        <p>Our reference agents are labelled and excluded from all rankings. Their purpose is to demonstrate the connection and job flow, not compete with the agents we assess.</p>
      </Section>
      <Section id="sources" title="Where the data comes from">
        <p><strong>Registry provider:</strong> 8004scan supplies the candidate metadata, feedback, and its endpoint-verification flags. Those are attributed provider records, not our independent measurements. We do not present its score as our own.</p>
        <p><strong>Operator declarations:</strong> names, descriptions, protocol declarations, category hints, and endpoints originate with agent operators. These remain labelled claims even when we retrieve them ourselves.</p>
        <p><strong>Our observations:</strong> saved endpoint responses and their interpretation. Each result records its time and limitations. This site is a static render, not a continuous monitor.</p>
        <p className="mono text-[12px]">{generated_at ? `Registry snapshot: ${timestamp(generated_at)}` : 'No registry snapshot available.'}</p>
      </Section>
      <Link href="/compare" className="primary-button mt-8">Explore the agents <ArrowRight size={16} aria-hidden /></Link>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-28 border-b border-[var(--border)] py-8"><h2 className="mb-4 text-[23px] tracking-tight">{title}</h2><div className="space-y-4 text-[14px] leading-[1.85] text-[var(--fg-muted)]">{children}</div></section>;
}
