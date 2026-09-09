import type { Metadata } from 'next';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_BY_SLUG } from '@/lib/categories';
import { findAgent, pageableAgents, routeTokenId } from '@/lib/data';
import { chainName, compositeOutOf100, isTestnet, latency, shortAddress, timestamp } from '@/lib/format';
import { CoverageAxis, GateBanner, ReferenceBadge, ScoreBlock, scoreState, unassessedReason } from '@/components/Assessment';
import { Figure, ProvenanceChip, ProvenanceSplit } from '@/components/Provenance';
import { HirePanel } from '@/components/HirePanel';
import { CapabilityList } from '@/components/CapabilityList';
import { evidenceSummary } from '@/lib/evidence';
import { BackToAgents } from '@/components/BackToAgents';

/**
 * `output: export` refuses to build a dynamic route that produces no paths, and
 * an empty index is a legitimate state here (the pipeline may not have finished).
 * So when there are no agents we emit one placeholder path that renders an honest
 * "not in this snapshot" page. It is a real, truthful page — not a stub agent.
 */
const PLACEHOLDER = { chain: 'none', tokenId: 'none' };

export function generateStaticParams() {
  const params = pageableAgents().map((a) => ({ chain: String(a.chain_id), tokenId: routeTokenId(a) }));
  return params.length > 0 ? params : [PLACEHOLDER];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chain: string; tokenId: string }>;
}): Promise<Metadata> {
  const { chain, tokenId } = await params;
  const agent = findAgent(chain, tokenId);
  if (!agent) return { title: 'Agent not in this snapshot' };
  return { title: agent.name, description: agent.description.slice(0, 160) };
}

export default async function AgentPage({ params }: { params: Promise<{ chain: string; tokenId: string }> }) {
  const { chain, tokenId } = await params;
  const agent = findAgent(chain, tokenId);
  if (!agent) return <NotInSnapshot />;

  const meta = CATEGORY_BY_SLUG.get(agent.category);
  const a = agent.assessment;
  const state = scoreState(agent);
  const gates = a?.gates_fired ?? [];
  const evidence = evidenceSummary(agent);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-9">
      <BackToAgents />
      <nav aria-label="Breadcrumb" className="text-[14px] text-[var(--fg-muted)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          Home
        </Link>
        <span className="mx-2">/</span>
        {meta ? (
          <>
            <Link href={`/category/${meta.path}`} className="hover:text-[var(--fg)]">
              {meta.name}
            </Link>
            <span className="mx-2">/</span>
          </>
        ) : null}
        <span className="mono text-[var(--fg-muted)]">
          {agent.token_id ? `#${agent.token_id}` : 'unregistered'}
        </span>
      </nav>

      <header className="mt-4 grid items-start gap-4 border-b border-[var(--border)] pb-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-stretch lg:gap-6">
        <div className="card min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {meta ? (
              <Link
                href={`/category/${meta.path}`}
                className="mono text-[10px] uppercase tracking-[0.09em]"
                style={{ color: meta.accent }}
              >
                {meta.name}
              </Link>
            ) : null}
            {agent.is_reference_agent ? <ReferenceBadge /> : null}
          </div>
          <h1 className="mt-2 text-[28px]">{agent.name}</h1>
          <p className="mono mt-1.5 break-all text-[11px] text-[var(--fg-faint)]">{agent.agent_id}</p>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
            {agent.description || 'No description was registered for this agent.'}
          </p>
          <div className="mt-2">
            <ProvenanceChip source="self_reported" />
            <span className="ml-2 text-[12px] text-[var(--fg-faint)]">
              Name and description are the operator&apos;s own words.
            </span>
          </div>
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <p className="text-[14px] font-medium" style={{ color: evidence.tone }}>{evidence.label}</p>
            <p className="mt-1 text-[13px] text-[var(--fg-muted)]">{evidence.detail}</p>
            {a?.shared_registration_count && a.shared_registration_count > 1 ? <p className="mt-2 text-[12px] text-[var(--fg-muted)]">{a.shared_registration_count.toLocaleString('en-US')} registrations share this endpoint. This is shared interface evidence, not independent tests of each registration.</p> : null}
          </div>
        </div>

        <section aria-labelledby="rating-coverage-heading" className="card min-w-0 p-5 sm:p-6">
          <h2 id="rating-coverage-heading" className="text-[14px] font-medium">Rating and evidence coverage</h2>
          <div className="mt-4"><ScoreBlock agent={agent} size="md" />
          {a ? (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <CoverageAxis coverage={a.coverage} />
            </div>
          ) : null}
          <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--fg-faint)]">
            {state === 'rated'
              ? 'Score and coverage are two different axes. A high score on thin coverage means we liked what we saw, and we did not see much.'
              : state === 'withheld'
                ? 'We assessed this agent and chose not to publish a number. That is a deliberate outcome, not a missing field.'
                : 'No number is shown because no measurement exists. We do not substitute a zero.'}
          </p></div>
        </section>
      </header>

      <div className="mt-5"><HirePanel agent={agent} /></div>

      {gates.length > 0 ? (
        <section className="mt-6">
          <GateBanner gates={gates} agent={agent} />
        </section>
      ) : null}

      {/* The heart of the page: our measurements and their claims, never merged. */}
      <section className="mt-8">
        <h2 className="text-[18px]">Evidence</h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--fg-muted)]">
          Our endpoint observations sit alongside registry and operator declarations. Neither a registration nor a successful connection establishes investment performance.
        </p>
        <div className="mt-4">
          <ProvenanceSplit
            ours={
              a ? (
                <>
                  <Figure
                    label="Composite score"
                    value={
                      a.composite === null ? (
                        <span style={{ color: 'var(--withheld)' }}>Not rated</span>
                      ) : (
                        `${compositeOutOf100(a.composite)} / 100`
                      )
                    }
                    note={a.composite === null ? (a.withheld_reason ?? 'Insufficient evidence to publish a number.') : undefined}
                    tone={a.composite === null ? 'var(--withheld)' : 'var(--measured)'}
                  />
                  <Figure
                    label="Coverage"
                    value={a.coverage}
                    note="How much evidence these endpoint checks provide. Independent of any score."
                    tone="var(--coverage)"
                  />
                  <Figure
                    label="Endpoint answered our request"
                    value={a.reachable === null ? 'Unknown' : a.reachable ? 'Yes' : 'No'}
                    note={
                      a.reachable === null
                        ? 'We failed to get a reading. That is our gap, not a finding that the agent is down.'
                        : undefined
                    }
                    tone={
                      a.reachable === null
                        ? 'var(--withheld)'
                        : a.reachable
                          ? 'var(--measured)'
                          : 'var(--critical)'
                    }
                  />
                  <Figure label="Protocol exchange confirmed" value={evidence.confirmed ? (a.protocol_spoken?.toUpperCase() ?? 'Confirmed') : 'Not established'} note={a.evidence_scope === 'host' ? 'Discovery was at the host level; it may not describe this individual agent.' : undefined} />
                  <Figure
                    label="Capability names reported"
                    value={a.tool_count}
                    note={a.tool_count === 0 ? 'No capability names were recorded by this check.' : 'From a tool list, agent card, or descriptor. These capabilities have not been executed by this check.'}
                  />
                  <Figure
                    label="Response time"
                    value={latency(a.latency_ms)}
                    tone={a.latency_ms !== null ? 'var(--measured)' : undefined}
                  />
                  <Figure
                    label="Safety battery"
                    value={gates.length === 0 ? 'Not established' : `${gates.length} gates fired`}
                    tone={gates.length > 0 ? 'var(--critical)' : undefined}
                    note={gates.length > 0 ? gates.join(', ') : 'This endpoint record does not establish that behavioral safety checks ran. An empty gate list is not a clearance.'}
                  />
                  <Figure label="Endpoint checked at" value={timestamp(a.checked_at)} />
                </>
              ) : (
                <div className="py-2">
                  <p className="font-medium" style={{ color: 'var(--neutral-fg)' }}>
                    Not assessed
                  </p>
                  <p className="mt-1.5 text-[13px] text-[var(--fg-muted)]">{unassessedReason(agent)}</p>
                  <p className="mt-3 text-[13px] text-[var(--fg-muted)]">
                    There is nothing in this column because we have not measured anything. We would rather show you an
                    empty column than fill it.
                  </p>
                </div>
              )
            }
            theirs={
              <>
                <Figure
                  label="8004scan total score"
                  value={agent.scan_total_score === null ? 'None published' : String(agent.scan_total_score)}
                  note="Their scoring model, their weighting. We do not reproduce or endorse it."
                  tone={agent.scan_total_score === null ? undefined : 'var(--thirdparty)'}
                />
                <Figure
                  label="Feedback records"
                  value={agent.scan_feedbacks}
                  note={
                    agent.scan_feedbacks === 0
                      ? 'No feedback is recorded in this source snapshot.'
                      : 'Volume of third-party feedback. Volume is not quality, and we do not weight it.'
                  }
                  tone="var(--thirdparty)"
                />
                <Figure
                  label="Endpoint verified"
                  value={agent.scan_endpoint_verified ? 'Yes' : 'No'}
                  note={
                    agent.scan_endpoint_verified
                      ? 'Verified according to the registry data provider, not independently by us.'
                      : 'No provider verification is recorded in this snapshot.'
                  }
                  tone="var(--thirdparty)"
                />
                <Figure
                  label="Declared protocols"
                  value={agent.protocols.length > 0 ? agent.protocols.join(', ') : 'None declared'}
                  note="What the operator says it speaks. Compare against the protocol we actually established."
                  source="self_reported"
                />
                <Figure
                  label="Declared endpoint"
                  value={
                    agent.endpoint ? (
                      <span className="break-all text-[12px]">{agent.endpoint}</span>
                    ) : (
                      agent.detail_status === 'read' ? 'No endpoint in the detail we read' : 'Registry detail not confirmed'
                    )
                  }
                  source="self_reported"
                />
                <Figure
                  label="x402 payments"
                  value={agent.x402_supported ? 'Declared' : 'Not declared'}
                  note={
                    agent.x402_supported
                      ? 'The operator declares payment support. We have not verified a payment or price.'
                      : undefined
                  }
                  source="self_reported"
                  tone={agent.x402_supported ? 'var(--withheld)' : undefined}
                />
                <Figure label="Owner" value={<span className="text-[12px]">{shortAddress(agent.owner_address)}</span>} source="onchain" />
                <Figure
                  label="Token id"
                  value={agent.token_id ?? 'None'}
                  note={
                    agent.token_id
                      ? undefined
                      : 'Not registered in the ERC-8004 identity registry. Registration costs gas that is not sponsored, so a working agent can legitimately lack one — it just means there is no on-chain identity to check it against.'
                  }
                  source="onchain"
                  tone={agent.token_id ? undefined : 'var(--withheld)'}
                />
                <Figure
                  label="Chain"
                  value={`${agent.chain_id} · ${chainName(agent.chain_id)}`}
                  note={isTestnet(agent.chain_id) ? 'Testnet. Nothing here moves real funds.' : undefined}
                  source="onchain"
                  tone={isTestnet(agent.chain_id) ? 'var(--withheld)' : undefined}
                />
              </>
            }
          />
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <CapabilityList agent={agent} />
        <div className="space-y-4">
          <ClassificationCard agent={agent} />
        </div>
      </div>
    </div>
  );
}

function ClassificationCard({ agent }: { agent: Parameters<typeof CapabilityList>[0]['agent'] }) {
  const meta = CATEGORY_BY_SLUG.get(agent.category);
  const confidence = Math.round((agent.category_confidence ?? 0) * 100);
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px]">Why it is filed here</h2>
        <ProvenanceChip source="self_reported" />
      </div>
      <p className="mt-3 text-[13px]">
        <span className="mono" style={{ color: meta?.accent }}>
          {meta?.name ?? 'Other'}
        </span>
        <span className="mono ml-2 text-[12px] text-[var(--fg-faint)]">rule-match strength {confidence}/100</span>
      </p>
      <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
        {agent.category_evidence || 'No classification evidence was recorded for this agent.'}
      </p>
      <p className="mt-2 text-[12px] text-[var(--fg-muted)]">A deterministic match against declared text, not a measured probability or proof that the agent performs this task.</p>
      {confidence < 60 ? (
        <p className="mt-3 rounded-[var(--radius-btn)] p-2.5 text-[12px]" style={{ background: 'var(--withheld-bg)', color: 'var(--withheld)' }}>
          Low classification confidence. Check the capability list below before treating this as a{' '}
          {meta?.name.toLowerCase() ?? 'categorised'} agent.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Rendered when the requested agent is not in the snapshot — including the
 * placeholder path emitted when the index is empty. It states the situation
 * plainly instead of pretending an agent exists.
 */
function NotInSnapshot() {
  return (
    <div className="mx-auto max-w-[860px] px-5 py-16">
      <p className="eyebrow">Not indexed</p>
      <h1 className="mt-2 text-[26px]">This agent is not in the current snapshot</h1>
      <p className="mt-2 text-[15px] text-[var(--fg-muted)]">
        Either it has never been indexed, or it was registered after this snapshot was taken. We do not generate a page
        for an agent we have no record of, and we do not fill one in with placeholder values.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-[13px]">
        <Link
          href="/"
          className="rounded-[var(--radius-btn)] border px-3 py-2"
          style={{ borderColor: 'var(--measured)', color: 'var(--measured)' }}
        >
          Back to the index
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.path}
            href={`/category/${c.path}`}
            className="rounded-[var(--radius-btn)] border border-[var(--border)] px-3 py-2"
          >
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
