/**
 * The compendium: every rated subject of a kind, most recent snapshot each.
 *
 * TWO THINGS THIS PAGE REFUSES TO DO.
 *
 * It does not print a number for a withheld rating. The score cell of a
 * withheld row carries an em dash and the row carries the reason in words. The
 * type makes this hard to get wrong — `rating.state === "scored"` is the only
 * branch with a `composite` to reach for — but the page states it anyway,
 * because a dash in a numeric column is the moment a reader decides whether
 * this source is careful.
 *
 * And it does not default to hiding them. 439 of 600 subjects in the live store
 * are withheld, every one because our own harness could not assess enough of
 * the profile. A compendium opening on the 161 that published would be
 * presenting a quarter of the population as the whole of it, and the header
 * says the split before the table starts.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { subjectPath } from "@/lib/subject-route";
import type { SubjectListOrder, SubjectListState } from "@/lib/ratings-source";

export const dynamic = "force-dynamic";

const STATES: SubjectListState[] = ["all", "scored", "withheld"];

function asState(v: string | undefined): SubjectListState {
  return v === "scored" || v === "withheld" ? v : "all";
}

function asOrder(v: string | undefined): SubjectListOrder {
  return v === "composite_asc" || v === "subject_asc" || v === "day_desc" ? v : "composite_desc";
}

function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

export default async function CompendiumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const source = getRatingsSource();
  const kinds = await source.listKinds();
  const kind = one("kind") ?? kinds[0]?.kind;
  if (kind === undefined) {
    return (
      <main className="shell">
        <span className="field-label">Compendium</span>
        <h1>Nothing is rated yet</h1>
        <p>
          The store holds no rating snapshots. If a collection run was expected, the run ledger at{" "}
          <code>/api/v1/ratings/health</code> says what happened.
        </p>
      </main>
    );
  }

  const state = asState(one("state"));
  const order = asOrder(one("order"));
  const cursor = one("cursor") ?? null;

  const page = await source.listSubjects({ kind, state, order, cursor, limit: 50 });
  if (page.total_unfiltered === 0) notFound();

  const scored = await source.listSubjects({ kind, state: "scored", limit: 1 });

  return (
    <main className="shell wide">
      <span className="field-label">Compendium</span>
      <h1>{kind.replace(/_/g, " ")}</h1>

      <p>
        {page.total_unfiltered} subjects rated. {scored.total} published a composite;{" "}
        {page.total_unfiltered - scored.total} are withheld. A withheld rating is not a score of
        zero and not missing data: it was computed and deliberately not published. The reason is on
        every row.
      </p>

      <div className="section">
        <span className="field-label">Show</span>
        <ul className="nav-links">
          {STATES.map((s) => (
            <li key={s}>
              <Link
                href={`/compendium${query({ kind, state: s === "all" ? null : s, order })}`}
                aria-current={state === s ? "page" : undefined}
              >
                {s === "all" ? "all" : s}
              </Link>
            </li>
          ))}
        </ul>
        <span className="field-label" style={{ marginTop: "0.75rem" }}>
          Order
        </span>
        <ul className="nav-links">
          {(["composite_desc", "composite_asc", "subject_asc", "day_desc"] as SubjectListOrder[]).map((o) => (
            <li key={o}>
              <Link
                href={`/compendium${query({ kind, state: state === "all" ? null : state, order: o })}`}
                aria-current={order === o ? "page" : undefined}
              >
                {o.replace(/_/g, " ")}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="field-label">
            {page.total} of {page.total_unfiltered} subjects
          </caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Composite</th>
              <th scope="col">Interval</th>
              <th scope="col">Coverage</th>
              <th scope="col">Completeness</th>
              <th scope="col">Tier</th>
              <th scope="col">Day</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((s) => (
              <tr key={`${s.ref.source_registry}|${s.ref.subject_id}`}>
                <th scope="row">
                  <Link href={subjectPath(s.ref)}>{s.ref.subject_id}</Link>
                </th>
                {/* The only branch that has a number is the only branch that prints one. */}
                <td className="num">{s.rating.state === "scored" ? s.rating.composite : "—"}</td>
                <td className="num">
                  {s.rating.state === "scored" && s.rating.composite_low !== null && s.rating.composite_high !== null
                    ? `${s.rating.composite_low} – ${s.rating.composite_high}`
                    : "—"}
                </td>
                <td className="num">{s.coverage.dimension_coverage}</td>
                <td className="num">{s.coverage.assessment_completeness}</td>
                <td>{s.coverage_tier}</td>
                <td className="num">{s.utc_day}</td>
                <td>
                  {s.rating.state === "scored" ? (
                    <span className="badge-quiet">published</span>
                  ) : (
                    <span title={s.rating.suppression_reason ?? undefined}>
                      withheld — {s.rating.suppression_reason ?? "no reason recorded"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page.next_cursor !== null ? (
        <p>
          <Link
            href={`/compendium${query({
              kind,
              state: state === "all" ? null : state,
              order,
              cursor: page.next_cursor,
            })}`}
          >
            Next {Math.min(50, page.total - page.items.length)} →
          </Link>
        </p>
      ) : null}

      <div className="section">
        <p className="note">
          Coverage and completeness are two measurements and are shown as two columns on purpose.
          Coverage is the share of what we could assess that produced a score; completeness is the
          share of the profile we were able to attempt at all. A row at coverage 1.00 and
          completeness 0.13 is a subject we barely tested, not a subject that did well.
        </p>
      </div>
    </main>
  );
}
