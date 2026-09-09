import { Fragment } from "react";
import { getDataSource } from "@/lib/get-data-source";

const SCHEMA_DOCS: Record<string, string> = {
  agents: "One row per registered agent (SPEC 9: agents table): identity, metadata status, lifecycle state.",
  feedback: "One row per feedback entry (SPEC 9: feedback table): raw and normalized value, tags, revocation state.",
  reviewer_wallets: "One row per reviewer address (SPEC 9: reviewer_wallets): first-seen, funder, review volume.",
  scores: "One row per scored agent per methodology version (SPEC 9: scores table): score, interval, signals_json.",
};

export default async function DumpsPage() {
  const dumps = await getDataSource().getDumps();

  return (
    <main className="shell wide">
      <span className="field-label">Bulk data dumps</span>
      <h1>CC0 dumps</h1>
      <p>
        Every dump is <code>jsonl.gz</code>, one file per table per chain, unlimited and
        unauthenticated (SPEC 13): rate limits protect the hosted API, dumps ensure nobody is gated
        from the data itself. The manifest carries schema version, row counts, and the SHA-256
        checksum that gets anchored on chain (SPEC 20.1).
      </p>

      <div className="section">
        <div className="data-table-wrap">
          <table className="data-table">
            <caption>Available tables</caption>
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Chain</th>
                <th scope="col">Rows</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Generated</th>
                <th scope="col">Download</th>
              </tr>
            </thead>
            <tbody>
              {dumps.dumps.map((d) => {
                const pending = d.sha256 === "pending";
                return (
                  <tr key={`${d.chain_slug}-${d.table}`}>
                    <td>{d.table}</td>
                    <td>{d.chain_slug}</td>
                    <td className="num">{d.row_count}</td>
                    <td className="num">{pending ? "pending" : d.sha256}</td>
                    <td className="num">{d.generated_at || "not yet generated"}</td>
                    <td>
                      {pending ? (
                        <span className="badge-quiet">placeholder: not yet generated</span>
                      ) : (
                        <a href={d.url}>download</a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <span className="field-label">Manifest</span>
        <p>
          <code className="num">{dumps.manifest_url}</code>, checksum{" "}
          <span className="num">{dumps.manifest_sha256 === "pending" ? "pending" : dumps.manifest_sha256}</span>.
          {dumps.manifest_sha256 === "pending" && " Placeholder: no dump run has produced a manifest yet."}
        </p>
      </div>

      <div className="section">
        <span className="field-label">Schema</span>
        <dl className="kv-list">
          {Object.entries(SCHEMA_DOCS).map(([table, doc]) => (
            <Fragment key={table}>
              <dt className="num">{table}</dt>
              <dd>{doc}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </main>
  );
}
