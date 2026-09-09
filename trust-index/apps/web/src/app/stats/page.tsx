import { getDataSource } from "@/lib/get-data-source";

export default async function StatsPage() {
  const dataSource = getDataSource();
  const stats = await dataSource.getStats("base");
  if (!stats) {
    return (
      <main className="shell">
        <h1>Ecosystem stats</h1>
        <p>No indexed chain data yet.</p>
      </main>
    );
  }

  const tierRows = Object.entries(stats.coverage_tiers) as Array<[string, number]>;

  return (
    <main className="shell wide">
      <span className="field-label">Ecosystem stats</span>
      <h1>base</h1>
      <p>
        Indexed through block <span className="num">{stats.indexed_through_block}</span>. Placeholder
        agents are excluded from the counts below and reported on their own line: their prevalence is
        itself a finding (SPEC 11.7), not noise to hide.
      </p>

      <div className="section">
        <dl className="kv-list">
          <dt>Total agents</dt>
          <dd className="num">{stats.agents_total}</dd>
          <dt>Scoreable agents (non-placeholder)</dt>
          <dd className="num">{stats.agents_scoreable}</dd>
          <dt>Placeholder agents</dt>
          <dd className="num">{stats.agents_by_lifecycle.placeholder}</dd>
          <dt>Feedback entries recorded</dt>
          <dd className="num">{stats.feedback_total}</dd>
          <dt>Distinct reviewer wallets</dt>
          <dd className="num">{stats.reviewers_total}</dd>
        </dl>
      </div>

      <div className="section">
        <span className="field-label">Agents by lifecycle</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Lifecycle classification (SPEC 11.7)</caption>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(stats.agents_by_lifecycle) as Array<[string, number]>).map(([state, count]) => (
                <tr key={state}>
                  <td>{state}</td>
                  <td className="num">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <span className="field-label">Agents by coverage tier</span>
        <p>Placeholder agents carry no score and are not counted in this table.</p>
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Coverage tier distribution (SPEC 11.5)</caption>
            <thead>
              <tr>
                <th scope="col">Tier</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {tierRows.map(([tier, count]) => (
                <tr key={tier}>
                  <td>{tier}</td>
                  <td className="num">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
