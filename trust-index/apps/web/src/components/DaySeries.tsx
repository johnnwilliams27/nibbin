/**
 * A subject's window of days, drawn so the four states cannot be confused.
 *
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE: only a scored day is plotted on
 * the value axis. Withheld days, days the collector ran without this subject,
 * and days it did not run at all are drawn in a separate status strip BELOW the
 * axis, where they have no height and therefore no readable value. There is no
 * position in the plot area that a non-scored day could occupy, so none of them
 * can be mistaken for a low score.
 *
 * And no line is drawn across them. The segment between two points appears only
 * when both days scored and they are adjacent. A polyline through a fortnight
 * the collector was down is the most misleading thing this chart could produce:
 * it turns our outage into the subject's steady performance.
 *
 * Consistent with docs/design-plan.md, meaning is carried by geometry rather
 * than colour: filled square, hollow square, empty cell. The strip reads
 * identically in greyscale and to a colourblind reader, and the counts are
 * printed underneath in words for anyone the figure does not reach.
 */
import type { RatingDay } from "@/lib/ratings-source";

const CELL = 11;
const PLOT_H = 46;
const STRIP_Y = PLOT_H + 8;
const STRIP_H = 9;
const HEIGHT = STRIP_Y + STRIP_H + 2;

/** 0-100 to a y inside the plot area, top of the box being 100. */
function toY(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return PLOT_H - (v / 100) * PLOT_H;
}

const STATE_WORDS: Record<RatingDay["state"], string> = {
  scored: "scored and published",
  withheld: "assessed and withheld",
  not_assessed: "the run happened without this subject",
  not_run: "no collection run at all",
};

export function DaySeries({ days }: { days: RatingDay[] }) {
  const width = Math.max(1, days.length) * CELL;
  const cx = (i: number): number => i * CELL + CELL / 2;

  const counts = days.reduce<Record<string, number>>((acc, d) => {
    acc[d.state] = (acc[d.state] ?? 0) + 1;
    return acc;
  }, {});

  // Segments only between adjacent scored days. Built explicitly rather than as
  // one polyline over the scored points, because a polyline would happily join
  // day 3 to day 20 and draw a straight line through everything between.
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 1; i < days.length; i += 1) {
    const prev = days[i - 1]!;
    const cur = days[i]!;
    if (prev.state !== "scored" || cur.state !== "scored") continue;
    segments.push({
      x1: cx(i - 1),
      y1: toY(Number(prev.composite)),
      x2: cx(i),
      y2: toY(Number(cur.composite)),
    });
  }

  const first = days[0]?.utc_day ?? "";
  const last = days[days.length - 1]?.utc_day ?? "";

  return (
    <figure className="day-series">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT * 2}
        role="img"
        preserveAspectRatio="xMinYMid meet"
        aria-label={`Daily ratings from ${first} to ${last}. ${Object.entries(counts)
          .map(([state, n]) => `${n} ${n === 1 ? "day" : "days"} ${STATE_WORDS[state as RatingDay["state"]]}`)
          .join("; ")}.`}
      >
        {/* Plot area rules at 0, 50 and 100, so a point has a scale to sit against. */}
        {[0, 50, 100].map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={width}
            y1={toY(tick)}
            y2={toY(tick)}
            stroke="var(--color-hairline)"
            strokeWidth={1}
          />
        ))}

        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke="var(--color-band)"
            strokeWidth={1.5}
          />
        ))}

        {days.map((d, i) =>
          d.state === "scored" ? (
            <circle
              key={d.utc_day}
              cx={cx(i)}
              cy={toY(Number(d.composite))}
              r={2.4}
              fill="var(--color-marker)"
            />
          ) : null,
        )}

        {/* The separator. Everything below it is a status, not a value. */}
        <line
          x1={0}
          x2={width}
          y1={STRIP_Y - 4}
          y2={STRIP_Y - 4}
          stroke="var(--color-hairline)"
          strokeWidth={1}
        />

        {days.map((d, i) => {
          const x = i * CELL + 2;
          const w = CELL - 4;
          if (d.state === "scored") {
            // A tick, not a box: the day's substance is up in the plot.
            return (
              <line
                key={d.utc_day}
                x1={cx(i)}
                x2={cx(i)}
                y1={STRIP_Y + STRIP_H - 3}
                y2={STRIP_Y + STRIP_H}
                stroke="var(--color-marker)"
                strokeWidth={1}
              />
            );
          }
          if (d.state === "withheld") {
            return (
              <rect key={d.utc_day} x={x} y={STRIP_Y} width={w} height={STRIP_H} fill="var(--color-band)" />
            );
          }
          if (d.state === "not_assessed") {
            return (
              <rect
                key={d.utc_day}
                x={x + 0.5}
                y={STRIP_Y + 0.5}
                width={w - 1}
                height={STRIP_H - 1}
                fill="none"
                stroke="var(--color-band)"
                strokeWidth={1}
              />
            );
          }
          return (
            <rect
              key={d.utc_day}
              x={x + 0.5}
              y={STRIP_Y + 0.5}
              width={w - 1}
              height={STRIP_H - 1}
              fill="none"
              stroke="var(--color-hairline)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          );
        })}
      </svg>

      <div className="day-series-axis num">
        <span>{first}</span>
        <span>{last}</span>
      </div>

      <figcaption className="day-series-legend">
        <span>
          <span className="glyph glyph-point" aria-hidden="true" /> scored ({counts["scored"] ?? 0})
        </span>
        <span>
          <span className="glyph glyph-filled" aria-hidden="true" /> withheld ({counts["withheld"] ?? 0})
        </span>
        <span>
          <span className="glyph glyph-hollow" aria-hidden="true" /> not assessed ({counts["not_assessed"] ?? 0})
        </span>
        <span>
          <span className="glyph glyph-dashed" aria-hidden="true" /> not run ({counts["not_run"] ?? 0})
        </span>
      </figcaption>
      <p className="note">
        Only scored days are plotted against the axis. Withheld days, days this subject was not in
        the run, and days no run happened sit in the strip below it and carry no value. Lines join
        adjacent scored days only; a gap in the line is a gap in the evidence, not a flat stretch.
      </p>
    </figure>
  );
}
