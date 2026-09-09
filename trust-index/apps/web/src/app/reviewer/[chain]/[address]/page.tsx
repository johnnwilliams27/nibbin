import Link from "next/link";
import { notFound } from "next/navigation";
import { getDataSource } from "@/lib/get-data-source";
import { formatDate, formatSignalValue, formatWeight, shortAddress } from "@/lib/format";

export default async function ReviewerPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;
  const dataSource = getDataSource();
  const reviewer = await dataSource.getReviewer(chain, address);
  if (!reviewer) notFound();

  const touched = (await dataSource.getReviewerAgents(chain, address)) ?? [];
  const rows = await Promise.all(
    touched.map(async (a) => {
      const agent = await dataSource.getAgent(chain, a.agent_id);
      const entry = agent?.score.reviewer_weights.find(
        (r) => r.address.toLowerCase() === address.toLowerCase(),
      );
      return { agent: a, entry };
    }),
  );

  return (
    <main className="shell wide">
      <span className="field-label">Reviewer profile</span>
      <h1 className="num" style={{ fontFamily: "var(--font-mono)" }}>
        {shortAddress(reviewer.address)}
      </h1>

      <div className="section">
        <dl className="kv-list">
          <dt>First seen</dt>
          <dd className="num">{reviewer.first_seen_ts ? formatDate(reviewer.first_seen_ts) : "not recorded"}</dd>
          <dt>Total reviews</dt>
          <dd className="num">{reviewer.total_reviews}</dd>
          <dt>Distinct agents reviewed</dt>
          <dd className="num">{reviewer.distinct_agents_reviewed}</dd>
          <dt>Max reviews, single day</dt>
          <dd className="num">{reviewer.max_reviews_single_day}</dd>
          <dt>Mean score given</dt>
          <dd className="num">{reviewer.mean_score_given !== null ? reviewer.mean_score_given.toFixed(2) : "not computable"}</dd>
          <dt>Score variance</dt>
          <dd className="num">{reviewer.score_variance !== null ? reviewer.score_variance.toFixed(4) : "not computable"}</dd>
        </dl>
      </div>

      <div className="section">
        <span className="field-label">Conditions</span>
        <p>Observable conditions, not a verdict on this reviewer (SPEC 5.5).</p>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Recorded conditions</caption>
            <thead>
              <tr>
                <th scope="col">Condition</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(reviewer.conditions).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td className="num">{formatSignalValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <span className="field-label">Agents touched</span>
        {rows.length === 0 ? (
          <p>No agents recorded for this reviewer on {chain}.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <caption>Weight contributed per agent</caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Lifecycle</th>
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
                {rows.map(({ agent, entry }) => (
                  <tr key={agent.agent_id}>
                    <td>
                      <Link href={`/agent/${chain}/${agent.agent_id}`} className="plain">
                        {chain}/{agent.agent_id}
                      </Link>
                    </td>
                    <td>{agent.lifecycle_state}</td>
                    <td className="num">{entry ? formatWeight(entry.weight) : "not counted"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.age) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.cohort) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.funder) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.velocity) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.repeat) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.commerce) : "-"}</td>
                    <td className="num">{entry ? formatWeight(entry.components.portfolio) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
