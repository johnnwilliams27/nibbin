import type { Metadata } from 'next';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_BY_SLUG } from '@/lib/categories';
import { allAgents, findAgent, routeTokenId } from '@/lib/data';
import { chainName, compositeOutOf100, isTestnet, latency, shortAddress, timestamp } from '@/lib/format';
import { CoverageAxis, GateBanner, ReferenceBadge, ScoreBlock, scoreState, unassessedReason } from '@/components/Assessment';
import { Figure, ProvenanceChip, ProvenanceSplit } from '@/components/Provenance';
import { HirePanel } from '@/components/HirePanel';
import { CapabilityList } from '@/components/CapabilityList';

/**
 * `output: export` refuses to build a dynamic route that produces no paths, and
 * an empty index is a legitimate state here (the pipeline may not have finished).
 * So when there are no agents we emit one placeholder path that renders an honest
 * "not in this snapshot" page. It is a real, truthful page — not a stub agent.
 */
const PLACEHOLDER = { chain: 'none', tokenId: 'none' };

export function generateStaticParams() {
  const params = allAgents().map((a) => ({ chain: String(a.chain_id), tokenId: routeTokenId(a) }));
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

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-9">
      <nav className="text-[12px] text-[var(--fg-faint)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          Index
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

      <header className="mt-4 flex flex-wrap items-start justify-between gap-6 border-b border-[var(--border)] pb-6">
        <div className="min-w-[280px] max-w-2xl flex-1">
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
          <p className="mono mt-1.5 text-[11px] text-[var(--fg-faint)]">{agent.agent_id}</p>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-muted)]">
            {agent.description || 'No description was registered for this agent.'}
          </p>
          <div className="mt-2">
            <ProvenanceChip source="self_reported" />
            <span className="ml-2 text-[12px] text-[var(--fg-faint)]">
              Name and description are the operator&apos;s own words.
            </span>
          </div>
        </div>

        <div className="card w-full max-w-sm p-5">
          <ScoreBlock agent={agent} size="lg" />
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
          </p>
        </div>
      </header>

      {gates.length > 0 ? (
        <section className="mt-6">
          <GateBanner gates={gates} agent={agent} />
        </section>
      ) : null}

      {/* The heart of the page: our measurements and their claims, never merged. */}
      <section className="mt-8">
        <h2 className="text-[18px]">Evidence</h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--fg-muted)]">
          Two columns, two sources. Nothing on the left came from a review, and nothing on the right went into our
          score.
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
                    note="How much of the agent we exercised. Independent of the score."
                    tone="var(--coverage)"
                  />
                  <Figure
                    label="Reachable when we called"
                    value={a.reachable ? 'Yes' : 'No'}
                    tone={a.reachable ? 'var(--measured)' : 'var(--critical)'}
                  />
                  <Figure label="Protocol it actually spoke" value={a.protocol_spoken ?? 'None established'} />
                  <Figure
                    label="Capabilities we enumerated"
                    value={a.tool_count}
                    note={a.tool_count === 0 ? 'It answered, but exposed nothing we could call.' : undefined}
                  />
                  <Figure
                    label="Response time"
                    value={latency(a.latency_ms)}
                    tone={a.latency_ms !== null ? 'var(--measured)' : undefined}
                  />
                  <Figure
                    label="Safety gates fired"
                    value={gates.length === 0 ? 'None' : String(gates.length)}
                    tone={gates.length > 0 ? 'var(--critical)' : 'var(--measured)'}
                    note={gates.length > 0 ? gates.join(', ') : 'No hard cap tripped during this assessment.'}
                  />
                  <Figure label="Assessed at" value={timestamp(a.checked_at)} />
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
                      ? 'No feedback exists. Across BSC that is the norm, not a red flag on its own.'
                      : 'Volume of third-party feedback. Volume is not quality, and we do not weight it.'
                  }
                  tone="var(--thirdparty)"
                />
                <Figure
                  label="Endpoint verified"
                  value={agent.scan_endpoint_verified ? 'Yes' : 'No'}
                  note={
                    agent.scan_endpoint_verified
                      ? 'One of very few BSC agents 8004scan has verified.'
                      : 'Not verified by 8004scan. Only 5 BSC agents are.'
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
                      'None declared'
                    )
                  }
                  source="self_reported"
                />
                <Figure
                  label="x402 payments"
                  value={agent.x402_supported ? 'Supported' : 'Not declared'}
                  note={
                    agent.x402_supported
                      ? 'It can take machine payments. Read the safety section before pointing a wallet at it.'
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
          <HirePanel agent={agent} />
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
        <ProvenanceChip source="measured" />
      </div>
      <p className="mt-3 text-[13px]">
        <span className="mono" style={{ color: meta?.accent }}>
          {meta?.name ?? 'Other'}
        </span>
        <span className="mono ml-2 text-[12px] text-[var(--fg-faint)]">confidence {confidence}%</span>
      </p>
      <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
        {agent.category_evidence || 'No classification evidence was recorded for this agent.'}
      </p>
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
