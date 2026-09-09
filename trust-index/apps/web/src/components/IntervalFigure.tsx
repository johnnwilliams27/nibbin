/**
 * The signature element (SPEC 14.1, 14.2, docs/design-plan.md): a
 * forest-plot-style band on a 0-100 axis, point estimate marked, n_eff
 * printed beside it. Pure server-rendered SVG + CSS; the draw-in animation
 * is CSS only (globals.css .interval-band) and is removed entirely under
 * prefers-reduced-motion, so this component needs no client JS.
 */
import { formatNEff, formatScore } from "@/lib/format";

const WIDTH = 320;
const HEIGHT = 56;
const PAD = 10;
const USABLE = WIDTH - PAD * 2;
const AXIS_Y = 28;

function toX(score: number): number {
  return PAD + (Math.max(0, Math.min(100, score)) / 100) * USABLE;
}

export function IntervalFigure({
  low,
  high,
  point,
  nEff,
  label,
}: {
  low: number;
  high: number;
  point: number;
  /**
   * Omitted where the figure has no effective sample size to report. The
   * composite carries an interval but no n_eff of its own — that is a
   * per-dimension quantity — and printing "n_eff 0.00" beside it would be a
   * number nobody measured, sitting in the caption a reader uses to judge how
   * much evidence is behind the band.
   */
  nEff?: number;
  label?: string;
}) {
  const lowX = toX(low);
  const highX = toX(high);
  const markerX = toX(point);
  const bandWidth = Math.max(1, highX - lowX);
  const originPx = markerX - lowX;

  return (
    <figure className="interval-figure" aria-label={label ?? "trust score interval"}>
      <div className="interval-track">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-hidden="true"
          preserveAspectRatio="xMinYMid meet"
        >
          <line
            x1={PAD}
            x2={WIDTH - PAD}
            y1={AXIS_Y}
            y2={AXIS_Y}
            stroke="var(--color-hairline)"
            strokeWidth={1}
          />
          {[0, 25, 50, 75, 100].map((tick) => (
            <line
              key={tick}
              x1={toX(tick)}
              x2={toX(tick)}
              y1={AXIS_Y - 4}
              y2={AXIS_Y + 4}
              stroke="var(--color-hairline)"
              strokeWidth={1}
            />
          ))}
          <rect
            className="interval-band"
            x={lowX}
            y={AXIS_Y - 5}
            width={bandWidth}
            height={10}
            rx={1}
            fill="var(--color-band)"
            style={{
              transformBox: "fill-box",
              transformOrigin: `${originPx}px center`,
            }}
          />
          <line
            x1={markerX}
            x2={markerX}
            y1={AXIS_Y - 9}
            y2={AXIS_Y + 9}
            stroke="var(--color-marker)"
            strokeWidth={2}
          />
        </svg>
      </div>
      <div className="interval-labels num">
        <span>{formatScore(low)}</span>
        <span>{formatScore(point)}</span>
        <span>{formatScore(high)}</span>
      </div>
      {nEff === undefined ? null : (
        <figcaption className="interval-neff num">n_eff {formatNEff(nEff)}</figcaption>
      )}
    </figure>
  );
}
