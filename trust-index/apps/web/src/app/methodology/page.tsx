import { DEFAULT_CONSTANTS } from "@trust-index/types";
import { flattenConstants, methodChoices } from "@/lib/flatten-constants";
import { getDataSource } from "@/lib/get-data-source";
import { formatConfidence, formatNEff, formatScore } from "@/lib/format";

export default async function MethodologyPage() {
  const constants = DEFAULT_CONSTANTS;
  const rows = flattenConstants(constants);
  const choices = methodChoices(constants);

  const worked = await getDataSource().getAgent("base", "9006"); // strong-diverse

  return (
    <main className="shell wide">
      <span className="field-label">Methodology</span>
      <h1>How a score is computed</h1>
      <p>
        Methodology version <span className="num">{constants.methodology_version}</span>. Every
        constant below is marked provisional or tuned; all of them are provisional in this release
        (SPEC 12: no calibration data exists yet). Provisional means chosen by reading the spec and a
        sensitivity range, not fit to outcomes.
      </p>

      <div className="section">
        <span className="field-label">Core formula</span>
        <pre className="num" style={{ whiteSpace: "pre-wrap", background: "transparent", padding: 0 }}>
          {"posterior_score = (Σ wᵢ·vᵢ + k·prior) / (Σ wᵢ + k)"}
        </pre>
        <p>
          <code>v_i</code> is a reviewer&apos;s normalized feedback value in [0,1]. <code>w_i</code> is
          that reviewer&apos;s weight in (0,1], from the components table below. <code>prior</code> is
          the relevant context&apos;s cohort prior, computed from high-weight evidence only so a
          sybil-inflated pool cannot poison the value low-evidence agents shrink toward.{" "}
          <code>k</code> is the shrinkage constant. The interval is the 95% width of the same weighted
          Beta posterior; confidence is <code>1 - min(1, width / width_at_zero_evidence)</code>,
          derived from that posterior and never blended with a second formula.
        </p>
      </div>

      <div className="section">
        <span className="field-label">Constants</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Every constant in MethodologyConstants, rendered from DEFAULT_CONSTANTS</caption>
            <thead>
              <tr>
                <th scope="col">Constant</th>
                <th scope="col">Value</th>
                <th scope="col">Status</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path}>
                  <td className="num">{r.path}</td>
                  <td className="num">{r.value}</td>
                  <td>{r.provisional ? "provisional" : `tuned (${r.tuningRun})`}</td>
                  <td>{r.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="data-table-wrap" style={{ marginTop: "1rem" }}>
          <table className="data-table">
            <caption>Fixed methodology choices</caption>
            <thead>
              <tr>
                <th scope="col">Choice</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {choices.map((c) => (
                <tr key={c.name}>
                  <td className="num">{c.name}</td>
                  <td className="num">{c.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <span className="field-label">Reviewer weight components</span>
        <p>
          Each signal below yields a multiplier in (0,1] (commerce corroboration can push above 1,
          capped at 1.0 overall); weight is their product, floored at{" "}
          <span className="num">{constants.weight.weight_floor.value}</span>. Every signal is chosen
          for being expensive to fake (SPEC 11.9): address age, ownership continuity, distinct
          counterparty count, repeat interaction, and commerce corroboration all cost real time or
          real money to manufacture. Cheap signals, like raw review counts or metadata completeness,
          are excluded or capped.
        </p>
      </div>

      {worked && worked.score.score !== null && (
        <div className="section">
          <span className="field-label">Worked example</span>
          <p>
            Agent <code>base/{worked.agent_id}</code>: n_eff{" "}
            <span className="num">{formatNEff(worked.score.n_eff)}</span>, posterior score{" "}
            <span className="num">{formatScore(worked.score.score)}</span>, interval{" "}
            <span className="num">
              [{formatScore(worked.score.score_low ?? 0)}, {formatScore(worked.score.score_high ?? 0)}]
            </span>
            , confidence <span className="num">{formatConfidence(worked.score.confidence)}</span>. See
            the <a href={`/agent/base/${worked.agent_id}/recompute`}>full derivation</a> for every
            reviewer weight that fed this number.
          </p>
        </div>
      )}

      <div className="section">
        <span className="field-label">Calibration</span>
        <p>
          Not yet available. Calibration (SPEC 12) backtests scores against Olas and Virtuals ACP job
          outcomes and publishes a reliability diagram and Brier score. This page will render those
          results in place of this paragraph once a calibration run exists;{" "}
          <code>constants_provisional</code> stays <code>true</code> in every API response until then.
        </p>
      </div>
    </main>
  );
}
