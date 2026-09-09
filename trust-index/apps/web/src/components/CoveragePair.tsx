/**
 * The two numbers, side by side, with the sentence that keeps them apart.
 *
 * One component so there is exactly one place in the UI where coverage and
 * completeness are rendered, and it renders both or neither. A page cannot
 * accidentally show one of them: there is no prop for that.
 *
 * The reading below the numbers is generated from the pair itself rather than
 * written once as static copy, because which of the two sentences applies is
 * the whole question a reader has. Coverage 0.60 at completeness 1.00 is a
 * subject that came up short. Coverage 1.00 at completeness 0.13 is a subject
 * we never gave the chance — and on the live population that second case is
 * 259 of 600 subjects, not a corner case.
 */
import type { AssessmentCoverage } from "@/lib/ratings-source";

/** A decimal string like "0.1300" as a percentage, without going through a float. */
function pct(decimal: string): string {
  const n = Number(decimal);
  return Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : decimal;
}

export function CoveragePair({ coverage }: { coverage: AssessmentCoverage }) {
  const cov = Number(coverage.dimension_coverage);
  const compl = Number(coverage.assessment_completeness);
  const shortfallIsOurs = Number.isFinite(compl) && compl < 1;
  const shortfallIsTheirs = Number.isFinite(cov) && cov < 1;

  return (
    <div className="coverage-pair">
      <dl className="kv-list">
        <dt>Dimension coverage</dt>
        <dd className="num">
          {coverage.dimension_coverage} <span className="muted">({pct(coverage.dimension_coverage)})</span>
        </dd>
        <dt>Assessment completeness</dt>
        <dd className="num">
          {coverage.assessment_completeness}{" "}
          <span className="muted">({pct(coverage.assessment_completeness)})</span>
        </dd>
      </dl>
      <p className="note">
        Coverage is the share of what we could assess that produced a score. Completeness is the
        share of the profile we were able to attempt at all. They are not the same measurement and
        must not be combined.
      </p>
      {shortfallIsOurs ? (
        <p className="note">
          Completeness is below 1.00, so {pct(String(1 - compl))} of this profile was never
          attempted. That shortfall is ours, not this subject&rsquo;s; the blocked checks are listed
          under harness gaps.
        </p>
      ) : (
        <p className="note">
          Completeness is 1.00: nothing was blocked on our side, so this subject was fully
          assessable.
        </p>
      )}
      {shortfallIsTheirs ? (
        <p className="note">
          Coverage is below 1.00: of the part we could assess, some produced no publishable score.
        </p>
      ) : null}
    </div>
  );
}
