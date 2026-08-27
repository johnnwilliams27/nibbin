import Link from "next/link";
import { IntervalFigure } from "@/components/IntervalFigure";
import { getDataSource } from "@/lib/get-data-source";
import { formatConfidence, formatNEff } from "@/lib/format";

export default async function HomePage() {
  const dataSource = getDataSource();
  const worked = await dataSource.getAgent("base", "9006"); // strong-diverse
  const thin = await dataSource.getAgent("base", "9003"); // thin-same-day-cohort

  return (
    <main className="shell">
      <h1>A trust number you can check</h1>
      <p>
        Seventeen-plus services publish a single trust number for ERC-8004 agents. Each one comes
        from a private formula, fed by feedback that is measurably fabricated at scale, and each
        one ships as a bare point estimate. A minimum-score gate set to 80 cannot tell an 80 backed
        by 400 independent paying counterparties from an 80 backed by two wallets created the same
        afternoon. Both render as 80.
      </p>
      <p>
        This index scores the same agents differently: every score shrinks toward a cohort prior in
        proportion to how much weighted evidence backs it, every reviewer&apos;s weight is continuous
        rather than a sybil flag, and every score ships with a 95% interval and an effective sample
        size (<code>n_eff</code>) instead of a bare number. An agent with two low-quality reviews and
        an agent with four hundred high-quality ones can both land near the same point estimate; the
        interval is where they stop looking the same.
      </p>

      {worked && worked.score.score !== null && (
        <div className="section">
          <span className="field-label">Worked example</span>
          <p>
            Agent <code>base/{worked.agent_id}</code>, coverage tier{" "}
            <strong>{worked.score.coverage_tier}</strong>. The band is the 95% interval; the tick is
            the point estimate.
          </p>
          <IntervalFigure
            low={worked.score.score_low ?? 0}
            high={worked.score.score_high ?? 0}
            point={worked.score.score}
            nEff={worked.score.n_eff}
            label={`interval for agent ${worked.agent_id}`}
          />
          <p className="num" style={{ fontSize: "0.85rem", color: "var(--color-slate)" }}>
            confidence {formatConfidence(worked.score.confidence)}
          </p>
          <Link href={`/agent/base/${worked.agent_id}`}>See the full record and derivation</Link>
        </div>
      )}

      {thin && thin.score.score !== null && worked && worked.score.score !== null && (
        <div className="section">
          <span className="field-label">Same register, thinner evidence</span>
          <p>
            Agent <code>base/{thin.agent_id}</code> carries a similar point estimate on a much
            smaller effective sample. Two same-day reviewer wallets narrow the raw average, but the
            estimator shrinks the score toward the prior and widens the interval instead of reporting
            the raw figure as fact.
          </p>
          <IntervalFigure
            low={thin.score.score_low ?? 0}
            high={thin.score.score_high ?? 0}
            point={thin.score.score}
            nEff={thin.score.n_eff}
            label={`interval for agent ${thin.agent_id}`}
          />
          <p>
            n_eff {formatNEff(thin.score.n_eff)} against n_eff {formatNEff(worked.score.n_eff)} above:
            same page, same axis, a different amount of evidence behind each band.
          </p>
        </div>
      )}

      <div className="section">
        <p>
          <Link href="/methodology">Read the methodology</Link>: every formula and constant, rendered
          from the values this deployment actually runs, each one marked tuned or provisional.
        </p>
      </div>
    </main>
  );
}
