import type { Metadata } from 'next';
import Link from 'next/link';
import { CENSUS, CENSUS_SOURCE } from '@/lib/census';
import { knownGates, loadDataset } from '@/lib/data';
import { COVERAGE_COPY, gateCopy, num, timestamp } from '@/lib/format';
import { ProvenanceChip } from '@/components/Provenance';

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How Trust Index measures agents: what a composite score is, what coverage means, when a score is withheld, what a safety gate is, and why our own reference agents are never ranked.',
};

export default function MethodologyPage() {
  const { generated_at } = loadDataset();
  const gates = knownGates();

  return (
    <div className="mx-auto max-w-[860px] px-5 py-9">
      <h1 className="text-[28px]">Methodology</h1>
      <p className="mt-2 text-[15px] text-[var(--fg-muted)]">
        Everything on this site is either something we measured or something someone else reported. This page says which
        is which, how the measurements are produced, and where they stop.
      </p>
      <p className="mono mt-3 text-[11px] text-[var(--fg-faint)]">
        {generated_at ? `snapshot ${timestamp(generated_at)}` : 'no snapshot available at build time'}
      </p>

      <Section title="What we actually do">
        <p>
          We open a session with the agent at its declared endpoint, establish a protocol, ask it to enumerate its tools
          or skills, time its responses, and run a fixed probe set that includes adversarial prompts. Everything in the
          left-hand column of an agent page comes from that session. Nothing in it comes from a review, a rating, a
          social signal or an operator&apos;s own description.
        </p>
        <p>
          A run is reproducible from its seed and rubric version, not from the bytes we published. If our number and
          your number disagree, the run parameters are where to look.
        </p>
      </Section>

      <Section title="Score and coverage are two different things">
        <p>
          The <strong>composite</strong> is how well an agent did on what we asked. <strong>Coverage</strong> is how
          much we asked. They are drawn as separate axes everywhere on this site and are never combined into a single
          figure, because combining them destroys the only information that matters: a high score on thin coverage and
          a high score on strong coverage are entirely different claims.
        </p>
        <ul className="mt-3 space-y-2">
          {(['thin', 'moderate', 'strong'] as const).map((c) => (
            <li key={c} className="card p-3">
              <span className="mono text-[12px]" style={{ color: 'var(--coverage)' }}>
                {COVERAGE_COPY[c].label}
              </span>
              <span className="ml-2 text-[13px] text-[var(--fg-muted)]">{COVERAGE_COPY[c].meaning}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="When we withhold a score">
        <p>
          If an assessment did not produce enough evidence to support a number, we publish{' '}
          <strong style={{ color: 'var(--withheld)' }}>Not rated</strong> and the reason, and we do not publish a
          number. Withholding is a result, not a failure: it means the run completed and the honest output was
          uncertainty.
        </p>
        <p>
          A withheld score is <em>not</em> a low score. It is never counted as zero, never included in a median, and
          never sorted as if it were the bottom of the range. Agents we could not rate are listed separately from the
          ranking, with the reason attached.
        </p>
        <p>
          An agent we have not called at all reads <strong style={{ color: 'var(--neutral-fg)' }}>Not assessed</strong>,
          also with a reason — usually that it declares no callable endpoint, or that it has not reached the front of
          the probe queue.
        </p>
      </Section>

      <Section title="Safety gates">
        <p>
          Gates are hard caps, not deductions. A gate does not shave points off a composite — it is a separate,
          categorical finding that we surface above the score, because it is usually the single most decision-relevant
          thing on the page. An agent that fails injection resistance while holding a spend cap is a fund-loss risk
          regardless of how well it performs on everything else.
        </p>
        {gates.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {gates.map((g) => {
              const copy = gateCopy(g);
              return (
                <li key={g} className="card p-3">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--critical)' }}>
                    {copy.title}
                  </p>
                  <p className="mt-0.5 text-[13px] text-[var(--fg-muted)]">{copy.why}</p>
                  <p className="mono mt-1 text-[10px] uppercase tracking-[0.09em] text-[var(--fg-faint)]">{g}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-[var(--fg-faint)]">
            No gate has fired anywhere in the current snapshot, so there is nothing to enumerate here. This list is
            generated from the data, not written by hand.
          </p>
        )}
      </Section>

      <Section title="What is ours and what is 8004scan's">
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <ProvenanceChip source="measured" />
            <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
              Composite, coverage, reachability, protocol established, enumerated capabilities, latency, gates fired,
              assessment timestamp, and category classification.
            </p>
          </div>
          <div className="card p-4">
            <ProvenanceChip source="third_party" />
            <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
              Total score, feedback count and endpoint verification. Passed through unchanged, weighted at zero in our
              composite, and never relabelled as ours.
            </p>
          </div>
        </div>
        <p className="mt-3">
          We report 8004scan&apos;s figures because they are the ecosystem&apos;s own signal and a buyer should see
          them. We do not reproduce their model, endorse it, or let it move our number.
        </p>
      </Section>

      <Section title="Our reference agents are never ranked">
        <p>
          We deployed a small number of agents ourselves to prove the assessment pipeline works end to end against real
          on-chain identities. They are labelled{' '}
          <span style={{ color: 'var(--reference)' }}>our reference agent</span> everywhere they appear, and they are
          excluded from every ranking, sort, leaderboard, median and headline count on this site.
        </p>
        <p>
          This is not politeness. An assessor that ranks its own deployments alongside the agents it rates has no
          standing to rate anything. The same reasoning is why Trust Index does not broker, host, operate or take
          payment for any agent listed here.
        </p>
      </Section>

      <Section title="Population figures">
        <p>
          The numbers on the landing page describe the whole BSC agent population, not this index: {num(CENSUS.registeredAgents)}{' '}
          registered agents, {num(CENSUS.mcpExposed)} exposing an MCP interface, {num(CENSUS.withAnyFeedback)} with any
          feedback at all, and {num(CENSUS.endpointVerified)} with an ecosystem-verified endpoint, growing by{' '}
          {num(CENSUS.mintedPerDay)} registrations a day.
        </p>
        <p className="text-[13px] text-[var(--fg-faint)]">Source: {CENSUS_SOURCE}</p>
      </Section>

      <Section title="Limits">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>An assessment is a point-in-time observation. An agent can change the moment after we call it.</li>
          <li>We measure interfaces and behaviour under probing. We do not audit the code behind an endpoint.</li>
          <li>A clean assessment is not a safety guarantee and nothing here is financial advice.</li>
          <li>Category classification is automated and carries a confidence figure. Low confidence is shown as such.</li>
          <li>
            This site is a static render of one snapshot. The timestamp is in the header and the footer, and the raw
            dataset is{' '}
            <a className="underline underline-offset-2" href="/data/agents.json">
              downloadable
            </a>{' '}
            so any figure here can be checked.
          </li>
        </ul>
      </Section>

      <p className="mt-10 border-t border-[var(--border)] pt-5 text-[13px] text-[var(--fg-muted)]">
        <Link href="/compare" className="underline underline-offset-2" style={{ color: 'var(--measured)' }}>
          Back to the comparison table
        </Link>
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 border-t border-[var(--border)] pt-6">
      <h2 className="text-[18px]">{title}</h2>
      <div className="mt-2 space-y-3 text-[14px] leading-relaxed text-[var(--fg-muted)]">{children}</div>
    </section>
  );
}
