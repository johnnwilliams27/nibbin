/**
 * One subject's record.
 *
 * The page is laid out around a single decision: what the reader sees FIRST
 * when a rating was withheld. It is not a greyed-out number and not an empty
 * chart. It is the reason, in the engine's own words, followed by the checks
 * our harness could not run and the capability each of them needed — because on
 * this population that is almost always the actual answer, and a page that led
 * with silence would let a reader conclude the subject failed.
 *
 * A scored subject gets the interval figure. A withheld one never does, in any
 * form: there is no band to draw and drawing a faint one anyway would put a
 * position on a scale where no estimate exists.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoveragePair } from "@/components/CoveragePair";
import { DaySeries } from "@/components/DaySeries";
import { IntervalFigure } from "@/components/IntervalFigure";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { SUPPRESSION_NOTES } from "@/lib/ratings-envelope";
import { parseSubjectRoute } from "@/lib/subject-route";

export const dynamic = "force-dynamic";

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ kind: string; registry: string; subject_id: string[] }>;
}) {
  const parsed = parseSubjectRoute(await params);
  if (!parsed.ok) notFound();

  const source = getRatingsSource();
  const subject = await source.getSubject(parsed.ref);
  if (subject === null) notFound();
  const series = await source.getSubjectSeries(parsed.ref, { collector: "mcp" });

  const reason = subject.rating.state === "withheld" ? subject.rating.suppression_reason : null;

  return (
    <main className="shell wide">
      <span className="field-label">{subject.ref.kind.replace(/_/g, " ")} record</span>
      <h1>{subject.ref.subject_id}</h1>
      <p className="note">
        {subject.ref.source_registry}
        {subject.source?.url ? (
          <>
            {" · "}
            <a href={subject.source.url} rel="nofollow noreferrer">
              {subject.source.url}
            </a>
          </>
        ) : null}
      </p>

      <div className="section">
        <span className="field-label">Rating for {subject.utc_day}</span>
        {subject.rating.state === "scored" ? (
          <>
            {subject.rating.composite_low !== null && subject.rating.composite_high !== null ? (
              <IntervalFigure
                low={Number(subject.rating.composite_low)}
                point={Number(subject.rating.composite)}
                high={Number(subject.rating.composite_high)}
                label={`composite for ${subject.ref.subject_id}`}
              />
            ) : (
              <p className="num" style={{ fontSize: "1.6rem" }}>
                {subject.rating.composite}
              </p>
            )}
            <p className="note">
              Composite {subject.rating.composite} on a 0–100 scale, confidence{" "}
              {subject.rating.composite_confidence}, coverage tier {subject.coverage_tier} (derived
              by {subject.coverage_tier_basis}).
            </p>
          </>
        ) : (
          // No numeral in this region, in any form. Cf. docs/design-plan.md:
          // "Suppressed agents never get this element in any form."
          <div className="suppressed-block">
            <span className="field-label">Withheld</span>
            <p>
              <strong>{reason ?? "No reason was recorded."}</strong>
            </p>
            {reason !== null && SUPPRESSION_NOTES[reason] !== undefined ? (
              <p>{SUPPRESSION_NOTES[reason]}</p>
            ) : null}
            <p className="note">
              This is not a score of zero and not missing data. The rating was computed and
              deliberately not published.
            </p>
          </div>
        )}
      </div>

      <div className="section">
        <span className="field-label">Coverage</span>
        <CoveragePair coverage={subject.coverage} />
      </div>

      {subject.harness_gaps.length > 0 ? (
        <div className="section">
          <span className="field-label">Checks our harness could not run</span>
          <p>
            {subject.harness_gaps.length} check{subject.harness_gaps.length === 1 ? "" : "s"} did not
            run because we lacked a capability. These are our defects. They are never converted into
            evidence and this subject is not marked down for them.
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Check</th>
                  <th scope="col">Capability needed</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {subject.harness_gaps.map((g) => (
                  <tr key={`${g.dimension}|${g.check}`}>
                    <th scope="row">{g.dimension}</th>
                    <td>{g.check}</td>
                    <td>{g.capability ?? "—"}</td>
                    <td>{g.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {subject.gates_fired.length > 0 ? (
        <div className="section">
          <span className="field-label">Gates fired</span>
          <p>
            A gate is a hard ceiling triggered by a single finding, applied instead of letting an
            average dilute it. Gates are reported whether or not a composite was published.
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Gate</th>
                  <th scope="col">Dimension</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Caps composite at</th>
                  <th scope="col">Finding</th>
                </tr>
              </thead>
              <tbody>
                {subject.gates_fired.map((g) => (
                  <tr key={g.gate_id}>
                    <th scope="row">{g.gate_id}</th>
                    <td>{g.dimension}</td>
                    <td>{g.trigger}</td>
                    <td className="num">{g.caps_composite_at}</td>
                    <td>{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="section">
        <span className="field-label">Dimensions</span>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Score</th>
                <th scope="col">Interval</th>
                <th scope="col">n_eff</th>
                <th scope="col">Observers</th>
                <th scope="col">Obs</th>
                <th scope="col">Tier</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {subject.dimensions.map((d) => (
                <tr key={d.dimension}>
                  <th scope="row">{d.dimension}</th>
                  <td className="num">{d.state === "scored" ? d.score : "—"}</td>
                  <td className="num">
                    {d.state === "scored" && d.score_low !== null && d.score_high !== null
                      ? `${d.score_low} – ${d.score_high}`
                      : "—"}
                  </td>
                  <td className="num">{d.n_eff}</td>
                  <td className="num">{d.distinct_observers}</td>
                  <td className="num">{d.observation_count}</td>
                  <td>{d.coverage_tier}</td>
                  <td>
                    {d.state === "scored" ? (
                      d.gate_capped_by === null ? (
                        <span className="badge-quiet">published</span>
                      ) : (
                        <>capped by {d.gate_capped_by}</>
                      )
                    ) : (
                      <>withheld — {d.suppression_reason ?? "no reason recorded"}</>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          A dash is a withheld dimension, never a zero. The evidence counters beside it still apply:
          &ldquo;we looked and found nothing admissible&rdquo; and &ldquo;we could not look&rdquo;
          are different statements, and the harness gaps above say which this was.
        </p>
      </div>

      {series !== null ? (
        <div className="section">
          <span className="field-label">
            Last {series.days.length} days ({series.from_day} to {series.through_day})
          </span>
          <DaySeries days={series.days} />
        </div>
      ) : null}

      <div className="section">
        <span className="field-label">Provenance</span>
        <dl className="kv-list">
          <dt>Profile</dt>
          <dd className="num">{subject.profile_id}</dd>
          <dt>Methodology</dt>
          <dd className="num">{subject.rating_methodology_version}</dd>
          <dt>Computed at</dt>
          <dd className="num">{subject.computed_at}</dd>
          <dt>Lifecycle</dt>
          <dd>
            <span className="badge-quiet">{subject.lifecycle}</span>
          </dd>
          <dt>Observations this day</dt>
          <dd className="num">{subject.observation_count}</dd>
          <dt>Rubric</dt>
          <dd className="num">{subject.digests.rubric_version}</dd>
          <dt>Profile digest</dt>
          <dd className="num">{subject.digests.profile_digest}</dd>
          <dt>Inputs hash</dt>
          <dd className="num">{subject.digests.inputs_hash}</dd>
        </dl>
        <p className="note">
          Two days are comparable only if all three digests match. A rubric change moves every score
          it touches without moving the other two, which is why the collector version is stored per
          day beside them.
        </p>
      </div>

      <p>
        <Link href={`/compendium?kind=${encodeURIComponent(subject.ref.kind)}`}>
          ← back to the compendium
        </Link>
      </p>
    </main>
  );
}
