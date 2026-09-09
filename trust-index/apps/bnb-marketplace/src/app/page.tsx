import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CENSUS } from '@/lib/census';
import { allCategoryStats, headlineStats, loadDataset } from '@/lib/data';
import { num, pct, timestamp } from '@/lib/format';
import { StatTile } from '@/components/StatTile';
import { DataStatusBanner } from '@/components/DataStatus';
import { ProvenanceChip } from '@/components/Provenance';

export default function HomePage() {
  const stats = headlineStats();
  const categories = allCategoryStats();
  const { generated_at } = loadDataset();
  // An empty index is a legitimate state. Rather than printing two rows of
  // zeroes that read as a broken page, we swap the measured-stats block for the
  // status panel and keep every section that is still true.
  const empty = stats.total === 0 && stats.referenceCount === 0;

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-10">
      {/* The problem, stated as measurements rather than as a pitch. */}
      <section className="max-w-3xl">
        <p className="eyebrow">ERC-8004 · chain 56 · BNB Smart Chain</p>
        <h1 className="mt-3 text-[30px] leading-[1.15] sm:text-[38px]">
          The registry is not the hard part. Telling what is real is.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--fg-muted)]">
          Anyone can mint an agent on BSC, and {num(CENSUS.mintedPerDay)} people do every day. Almost none of those
          registrations can be called, and almost none carry any evidence at all. Trust Index calls the agents itself,
          records what happened, and publishes that separately from what the ecosystem claims — including the cases
          where the honest answer is that we do not know.
        </p>
      </section>

      <Funnel />

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[18px]">This index</h2>
          <p className="mono text-[11px] text-[var(--fg-faint)]">
            {generated_at ? `snapshot ${timestamp(generated_at)}` : 'no snapshot at build time'}
          </p>
        </div>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--fg-muted)]">
          We index the registry in bulk and then list only what we can actually place in one of the four categories. The
          gap between those two numbers is itself a finding: most of what is registered on BSC does not describe a job
          anyone could hire it to do. Listing counts exclude our own reference agents.
        </p>

        {empty ? (
          <div className="mt-4">
            <DataStatusBanner />
          </div>
        ) : (
        <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Registry rows indexed"
            value={stats.indexed}
            note={`Every row we pulled in this snapshot. ${num(stats.unclassified)} of them (${pct(stats.unclassified, stats.indexed)}) carry no signal that places them in any category — indexed and counted, but not listed.`}
            source="onchain"
          />
          <StatTile
            label="Listed in a category"
            value={stats.total}
            note="Rows we could place in rebalancing, grid trading, yield or health factor. These are the only agents this marketplace lists."
            source="measured"
          />
          <StatTile
            label="Callable interface"
            value={stats.callable}
            note={
              `${pct(stats.callable, stats.total)} of listed agents declare an endpoint or MCP/A2A support. ` +
              `${num(stats.notCallable)} have a detail record with no such declaration` +
              (stats.endpointUnknown > 0
                ? `; for ${num(stats.endpointUnknown)}, registry detail is unconfirmed, so whether they declare an interface is unknown.`
                : '.')
            }
            source="self_reported"
          />
          <StatTile
            label="We assessed"
            value={stats.assessed}
            note={`We called these ourselves. ${stats.rated} produced enough evidence to rate; ${stats.withheld} did not, and we say so.`}
            source="measured"
            tone="var(--measured)"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Ecosystem verified"
            value={stats.ecosystemVerified}
            note="8004scan verified the endpoint. Their check, reported here as theirs."
            source="third_party"
            tone="var(--thirdparty)"
          />
          <StatTile
            label="Scores withheld"
            value={stats.withheld}
            note="Assessed, but the evidence was too thin to publish a number. Each one states its reason."
            source="measured"
            tone="var(--withheld)"
          />
          <StatTile
            label="Safety gates fired"
            value={stats.gatesFired}
            note="Hard caps tripped during assessment. A gate is a reason not to hand an agent money."
            source="measured"
            tone="var(--critical)"
          />
          <StatTile
            label="Our reference agents"
            value={stats.referenceCount}
            note="Deployed by us to prove the pipeline. Labelled everywhere and excluded from every count above."
            source="measured"
            tone="var(--reference)"
          />
        </div>
        </>
        )}
      </section>

      {/* Four categories, one layout, identical depth. */}
      <section className="mt-12">
        <h2 className="text-[18px]">Find an agent by what it does</h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--fg-muted)]">
          Four categories, assessed the same way and reported to the same depth. Each one handles a different part of a
          position, and each one carries a different kind of risk if it goes wrong.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {categories.map(({ meta, stats: s }) => (
            <Link
              key={meta.slug}
              href={`/category/${meta.path}`}
              data-target
              className="card lift flex flex-col overflow-hidden"
            >
              <span className="h-[3px] w-full" style={{ background: meta.accent }} />
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[0.09em]" style={{ color: meta.accent }}>
                    {meta.name}
                  </p>
                  <p className="mono mt-1.5 text-[24px] font-semibold leading-none">
                    {empty ? <span className="text-[var(--fg-faint)]">—</span> : num(s.total)}
                  </p>
                  <p className="eyebrow mt-1">{empty ? 'not yet indexed' : 'agents indexed'}</p>
                </div>

                <p className="text-[13px] leading-snug text-[var(--fg-muted)]">{meta.blurb}</p>

                {empty ? (
                  <p className="mt-auto border-t border-[var(--border)] pt-3 text-[12px] text-[var(--fg-faint)]">
                    No agents indexed in this snapshot. The category, its risk profile and the questions to ask are
                    unchanged.
                  </p>
                ) : (
                <dl className="mt-auto space-y-1 border-t border-[var(--border)] pt-3 text-[12px]">
                  <Row label="We assessed" value={`${s.assessed}`} tone="var(--measured)" />
                  <Row
                    label="We rated"
                    value={`${s.rated}`}
                    tone="var(--measured)"
                    hint={s.withheld > 0 ? `${s.withheld} withheld` : undefined}
                  />
                  <Row
                    label="Median score"
                    value={s.medianComposite === null ? 'n/a' : String(Math.round(s.medianComposite <= 1 ? s.medianComposite * 100 : s.medianComposite))}
                    tone="var(--measured)"
                  />
                  <Row label="Strong coverage" value={`${s.strongCoverage}`} tone="var(--coverage)" />
                  <Row label="Gates fired" value={`${s.gatesFired}`} tone={s.gatesFired > 0 ? 'var(--critical)' : undefined} />
                  <Row label="Ecosystem verified" value={`${s.ecosystemVerified}`} tone="var(--thirdparty)" />
                </dl>
                )}

                <p className="flex items-center gap-1.5 text-[13px]" style={{ color: meta.accent }}>
                  Browse {meta.name.toLowerCase()} <ArrowRight size={13} strokeWidth={1.5} aria-hidden />
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <Legend />

      <section className="mt-12 flex flex-wrap items-center gap-4 rounded-[var(--radius-shell)] border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="min-w-[260px] flex-1">
          <h2 className="text-[16px]">Compare agents side by side</h2>
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
            One table across all four categories. Sort by our assessment, by how much we looked, by capability count, by
            measured latency, or by 8004scan&apos;s feedback and verification — and see which agents cannot be ranked on
            each of those, and why.
          </p>
        </div>
        <Link
          href="/compare"
          data-target
          className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] border px-4 py-2.5 text-[13px] font-medium"
          style={{ borderColor: 'var(--measured)', color: 'var(--measured)' }}
        >
          Open the comparison table <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      </section>
    </div>
  );
}

function Row({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--fg-muted)]">{label}</dt>
      <dd className="mono" style={tone ? { color: tone } : undefined}>
        {value}
        {hint ? <span className="ml-1.5 text-[10px] text-[var(--fg-faint)]">{hint}</span> : null}
      </dd>
    </div>
  );
}

/**
 * The population funnel, drawn to true scale. The last two bars are invisible
 * because the real proportion is invisible — that is the finding, so we label it
 * rather than inflating the bar to make the chart look better.
 */
function Funnel() {
  const rows = [
    {
      label: 'Registered agents on BSC',
      value: CENSUS.registeredAgents,
      note: `Growing by ${num(CENSUS.mintedPerDay)} a day, mostly bulk registrations with no feedback and no endpoint.`,
      tone: 'var(--fg-faint)',
    },
    {
      label: 'Expose an MCP interface',
      value: CENSUS.mcpExposed,
      note: 'The only ones that can be called at all. Everything else is a name in a registry.',
      tone: 'var(--coverage)',
    },
    {
      label: 'Have any feedback at all',
      value: CENSUS.withAnyFeedback,
      note: 'One or more third-party feedback records. Star counts do not exist for the other 99.8%.',
      tone: 'var(--thirdparty)',
    },
    {
      label: 'Endpoint verified by the ecosystem',
      value: CENSUS.endpointVerified,
      note: 'Five. Out of three hundred and ten thousand.',
      tone: 'var(--critical)',
    },
  ];
  const max = rows[0].value;

  return (
    <section className="mt-9 rounded-[var(--radius-shell)] border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">The BSC agent population, to scale</p>
        <ProvenanceChip source="onchain" />
      </div>
      <div className="mt-4 space-y-3.5">
        {rows.map((r) => {
          const width = (r.value / max) * 100;
          return (
            <div key={r.label}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-[13px]">{r.label}</span>
                <span className="mono text-[15px] font-semibold" style={{ color: r.tone }}>
                  {num(r.value)}
                  <span className="ml-2 text-[11px] font-normal text-[var(--fg-faint)]">
                    {pct(r.value, max)} of registry
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-[2px] bg-[var(--panel-2)]">
                <div
                  className="h-2 rounded-[2px]"
                  style={{ width: `${width}%`, background: r.tone, minWidth: width > 0 ? 1 : 0 }}
                />
              </div>
              <p className="mt-1 text-[12px] text-[var(--fg-faint)]">{r.note}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--fg-faint)]">
        Bars are drawn to true proportion. The bottom two are hairlines because the real numbers are hairlines; we have
        not rescaled them to make the chart easier to look at.
      </p>
    </section>
  );
}

function Legend() {
  return (
    <section className="mt-12 rounded-[var(--radius-shell)] border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-[16px]">Where each number comes from</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-[var(--fg-muted)]">
        Provenance is marked on every figure on this site. We never merge our measurements with anyone else&apos;s
        reporting, and we never present a third party&apos;s score as ours.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            source: 'measured' as const,
            title: 'We measured it',
            body: 'Our probe opened a session with the agent, enumerated its tools, timed it and ran adversarial prompts. Reproducible from the run seed and rubric version.',
          },
          {
            source: 'third_party' as const,
            title: '8004scan reported it',
            body: 'Feedback counts, total score and endpoint verification come from 8004scan. We pass them through unchanged and never fold them into our composite.',
          },
          {
            source: 'onchain' as const,
            title: 'Read from the chain',
            body: 'Identity, owner, token id and registration data come from the ERC-8004 registry on BSC. Verifiable by anyone with an RPC endpoint.',
          },
          {
            source: 'self_reported' as const,
            title: 'The agent claims it',
            body: 'Names, descriptions, declared protocols and endpoints are what the operator wrote at registration. Nobody checked them, including us.',
          },
        ].map((item) => (
          <div key={item.source} className="card p-4">
            <ProvenanceChip source={item.source} />
            <p className="mt-2.5 text-[14px] font-medium">{item.title}</p>
            <p className="mt-1 text-[12px] leading-snug text-[var(--fg-muted)]">{item.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-[var(--fg-muted)]">
        <Link href="/methodology" className="underline underline-offset-2" style={{ color: 'var(--measured)' }}>
          Read the full methodology
        </Link>{' '}
        — including when we withhold a score and why a withheld score is not a low one.
      </p>
    </section>
  );
}
