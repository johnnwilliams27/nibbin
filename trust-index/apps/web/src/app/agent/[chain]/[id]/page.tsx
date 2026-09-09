import Link from "next/link";
import { notFound } from "next/navigation";
import { IntervalFigure } from "@/components/IntervalFigure";
import { getDataSource } from "@/lib/get-data-source";
import {
  formatConfidence,
  formatDate,
  formatNEff,
  formatScore,
  formatSignalValue,
  formatWeight,
  shortAddress,
} from "@/lib/format";
import type { AgentDetail } from "@/lib/data-source";

function evidenceSummary(agent: AgentDetail): string[] {
  const s = agent.score;
  const lines: string[] = [];
  lines.push(`Lifecycle: ${s.lifecycle_state}.`);
  lines.push(`Metadata status: ${agent.metadata_status}.`);
  lines.push(`Effective sample size (n_eff): ${formatNEff(s.n_eff)}.`);
  const unusable = s.signals["unusable_feedback_count"];
  if (typeof unusable === "number" && unusable > 0) {
    lines.push(`${unusable} feedback ${unusable === 1 ? "entry excludes" : "entries exclude"} with no inferable scale.`);
  }
  const distinctCounterparties = s.signals["distinct_counterparties"];
  if (typeof distinctCounterparties === "number") {
    lines.push(`Distinct counterparties contributing usable evidence: ${distinctCounterparties}.`);
  }
  if (agent.ownership_epoch > 0) {
    lines.push(`Current ownership epoch: ${agent.ownership_epoch}. Feedback from prior epochs is excluded (SPEC 11.6).`);
  }
  return lines;
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ chain: string; id: string }>;
}) {
  const { chain, id } = await params;
  const agent = await getDataSource().getAgent(chain, id);
  if (!agent) notFound();

  const s = agent.score;
  const suppressed = s.score === null;
  const contextEntries = Object.entries(s.scores_by_context);

  return (
    <main className="shell wide">
      <span className="field-label">Agent record</span>
      <h1>
        {chain}/{agent.agent_id}
      </h1>

      <div className="section">
        <dl className="kv-list">
          <dt>Owner</dt>
          <dd className="num">{shortAddress(agent.owner_address)}</dd>
          <dt>Agent wallet</dt>
          <dd className="num">{agent.agent_wallet ? shortAddress(agent.agent_wallet) : "none declared"}</dd>
          <dt>Registered</dt>
          <dd className="num">{formatDate(agent.registered_at)}</dd>
          <dt>Metadata status</dt>
          <dd>{agent.metadata_status}</dd>
          <dt>Lifecycle</dt>
          <dd>
            <span className="badge-quiet">{s.lifecycle_state}</span>
          </dd>
          <dt>Coverage tier</dt>
          <dd>
            <span className="badge-quiet">coverage: {s.coverage_tier}</span>
          </dd>
          <dt>Ownership epoch</dt>
          <dd className="num">{s.ownership_epoch}</dd>
        </dl>
      </div>

      {s.coverage_tier === "none" || s.coverage_tier === "thin" ? (
        <p style={{ color: "var(--color-slate)" }}>
          {s.coverage_tier === "none"
            ? "This agent has no score. There is not enough weighted evidence to estimate one."
            : "This score rests on a small amount of weighted evidence. The interval is wide because the evidence is thin, not because the estimate is unstable."}
        </p>
      ) : null}

      <div className="section" data-testid="score-region">
        <span className="field-label">Trust score</span>
        {suppressed ? (
          <div className="suppressed-block">
            <p>
              <strong>No score.</strong>{" "}
              {s.suppression_reason ?? "Not enough weighted evidence exists to estimate a score."}
            </p>
            <p>See the evidence summary below for what is and is not recorded.</p>
          </div>
        ) : (
          <>
            <IntervalFigure
              low={s.score_low ?? 0}
              high={s.score_high ?? 0}
              point={s.score as number}
              nEff={s.n_eff}
              label={`interval for agent ${agent.agent_id}`}
            />
            <p className="num" style={{ fontSize: "0.85rem", color: "var(--color-slate)" }}>
              confidence {formatConfidence(s.confidence)}
            </p>

            {contextEntries.length > 0 && (
              <div className="data-table-wrap">
                <table className="data-table">
                  <caption>Score by context</caption>
                  <thead>
                    <tr>
                      <th scope="col">Context</th>
                      <th scope="col">Score</th>
                      <th scope="col">Low</th>
                      <th scope="col">High</th>
                      <th scope="col">n_eff</th>
                      <th scope="col">Coverage</th>
                      <th scope="col">Feedback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contextEntries.map(([tag, ctx]) => (
                      <tr key={tag}>
                        <td>{tag}</td>
                        <td className="num">{ctx.score !== null ? formatScore(ctx.score) : "null"}</td>
                        <td className="num">{ctx.score_low !== null ? formatScore(ctx.score_low) : "null"}</td>
                        <td className="num">{ctx.score_high !== null ? formatScore(ctx.score_high) : "null"}</td>
                        <td className="num">{formatNEff(ctx.n_eff)}</td>
                        <td>{ctx.coverage_tier}</td>
                        <td className="num">{ctx.feedback_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {suppressed && (
        <div className="section">
          <span className="field-label">Evidence summary</span>
          <ul>
            {evidenceSummary(agent).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section">
        <span className="field-label">Ownership epoch history</span>
        {agent.transfers.length === 0 ? (
          <p>No ownership transfers recorded. Epoch 0 since registration.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <caption>Transfers</caption>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Block</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {agent.transfers.map((t) => (
                  <tr key={t.tx_hash}>
                    <td className="num">{shortAddress(t.from_address)}</td>
                    <td className="num">{shortAddress(t.to_address)}</td>
                    <td className="num">{t.block}</td>
                    <td className="num">{formatDate(t.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!suppressed && s.reviewer_weights.length > 0 && (
        <div className="section">
          <span className="field-label">Reviewer weight breakdown</span>
          <div className="data-table-wrap">
            <table className="data-table">
              <caption>Weights and component multipliers (SPEC 11.2)</caption>
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
                {s.reviewer_weights.map((r) => (
                  <tr key={r.address}>
                    <td className="num">
                      <Link href={`/reviewer/${chain}/${r.address}`} className="plain">
                        {shortAddress(r.address)}
                      </Link>
                    </td>
                    <td className="num">{formatWeight(r.weight)}</td>
                    <td className="num">{formatWeight(r.components.age)}</td>
                    <td className="num">{formatWeight(r.components.cohort)}</td>
                    <td className="num">{formatWeight(r.components.funder)}</td>
                    <td className="num">{formatWeight(r.components.velocity)}</td>
                    <td className="num">{formatWeight(r.components.repeat)}</td>
                    <td className="num">{formatWeight(r.components.commerce)}</td>
                    <td className="num">{formatWeight(r.components.portfolio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="section">
        <span className="field-label">Signals</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Observable conditions behind this score (SPEC 5.5: conditions, never intent)</caption>
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
        <Link href={`/agent/${chain}/${id}/recompute`}>Recompute this: see the full derivation</Link>
      </p>
    </main>
  );
}
