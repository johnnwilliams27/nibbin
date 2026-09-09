import Link from "next/link";
import { notFound } from "next/navigation";
import { getDataSource } from "@/lib/get-data-source";
import { formatConfidence, formatNEff, formatScore, formatSignalValue, formatWeight, shortAddress } from "@/lib/format";

export default async function RecomputePage({
  params,
}: {
  params: Promise<{ chain: string; id: string }>;
}) {
  const { chain, id } = await params;
  const recompute = await getDataSource().getRecompute(chain, id);
  if (!recompute) notFound();

  const s = recompute.score;

  return (
    <main className="shell wide">
      <span className="field-label">Derivation</span>
      <h1>
        Recompute: {chain}/{recompute.agent_id}
      </h1>
      <p>
        Every input and intermediate that produced the current score for this agent, at{" "}
        <span className="num">as_of_block {recompute.as_of_block}</span>.
      </p>

      {recompute.score_source === "synthetic" && (
        <div className="suppressed-block">
          <p>
            <strong>Synthetic fallback.</strong> @trust-index/scoring was unavailable when this page
            was rendered, so this derivation was produced by this app&apos;s own fallback estimator
            (SPEC 11.0/11.1 formulas, plain-number arithmetic), not the canonical fixed-point engine.
            Treat the numbers below as illustrative, not authoritative. See{" "}
            <Link href="/methodology">methodology</Link>.
          </p>
        </div>
      )}

      <div className="section">
        <span className="field-label">Priors used</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Cohort priors (SPEC 11.0)</caption>
            <thead>
              <tr>
                <th scope="col">Context</th>
                <th scope="col">Prior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>global</td>
                <td className="num">{recompute.priors.global}</td>
              </tr>
              {Object.entries(recompute.priors.by_context).map(([tag, v]) => (
                <tr key={tag}>
                  <td>{tag}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Basis: {recompute.priors.basis}. n_basis:{" "}
          <span className="num">{recompute.priors.n_basis}</span>.
        </p>
      </div>

      <div className="section">
        <span className="field-label">Posterior output</span>
        <dl className="kv-list">
          <dt>score</dt>
          <dd className="num">{s.score !== null ? formatScore(s.score) : "null"}</dd>
          <dt>score_low</dt>
          <dd className="num">{s.score_low !== null ? formatScore(s.score_low) : "null"}</dd>
          <dt>score_high</dt>
          <dd className="num">{s.score_high !== null ? formatScore(s.score_high) : "null"}</dd>
          <dt>confidence</dt>
          <dd className="num">{formatConfidence(s.confidence)}</dd>
          <dt>n_eff</dt>
          <dd className="num">{formatNEff(s.n_eff)}</dd>
          <dt>coverage_tier</dt>
          <dd>{s.coverage_tier}</dd>
          <dt>lifecycle_state</dt>
          <dd>{s.lifecycle_state}</dd>
          <dt>suppression_reason</dt>
          <dd>{s.suppression_reason ?? "none"}</dd>
          <dt>ownership_epoch</dt>
          <dd className="num">{s.ownership_epoch}</dd>
          <dt>effective_history_days</dt>
          <dd className="num">{s.effective_history_days}</dd>
          <dt>methodology_version</dt>
          <dd className="num">{s.methodology_version}</dd>
          <dt>inputs_hash</dt>
          <dd className="num">{s.inputs_hash}</dd>
        </dl>
      </div>

      <div className="section">
        <span className="field-label">Reviewer weights (every input)</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Full reviewer weight table used in this computation</caption>
            <thead>
              <tr>
                <th scope="col">Reviewer</th>
                <th scope="col">Weight</th>
                <th scope="col">Age</th>
                <th scope="col">Cohort</th>
                <th scope="col">Funder</th>
                <th scope="col">Velocity</th>
                <th scope="col">Repeat</th>
                <th scope="col">Commerce</th>
                <th scope="col">Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {s.reviewer_weights.length === 0 ? (
                <tr>
                  <td colSpan={9}>No reviewers contributed weighted evidence.</td>
                </tr>
              ) : (
                s.reviewer_weights.map((r) => (
                  <tr key={r.address}>
                    <td className="num">{shortAddress(r.address)}</td>
                    <td className="num">{formatWeight(r.weight)}</td>
                    <td className="num">{formatWeight(r.components.age)}</td>
                    <td className="num">{formatWeight(r.components.cohort)}</td>
                    <td className="num">{formatWeight(r.components.funder)}</td>
                    <td className="num">{formatWeight(r.components.velocity)}</td>
                    <td className="num">{formatWeight(r.components.repeat)}</td>
                    <td className="num">{formatWeight(r.components.commerce)}</td>
                    <td className="num">{formatWeight(r.components.portfolio)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <span className="field-label">Signals</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Every signal recorded for this computation</caption>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.signals).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td className="num">{formatSignalValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p>
        <Link href={`/agent/${chain}/${id}`}>Back to the agent record</Link>
      </p>
    </main>
  );
}
