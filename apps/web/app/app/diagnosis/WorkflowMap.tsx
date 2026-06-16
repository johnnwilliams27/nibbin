import type { DiagnosisWorkflow } from '../../../lib/diagnosis/types';
import styles from './diagnosis.module.css';

/**
 * The "Your Map" visual: a node graph of every workflow, sized by hours and
 * colored by automatability — the Group-A reveal centerpiece (Maya demo).
 *
 * Server component on purpose: pure SVG, no client JS. Hover affordances are
 * CSS-only (`:hover` halo + `<title>` for the full label), so this can render
 * server-side inside the diagnosis reveal.
 *
 * Layout is deterministic and derived from the workflow list (variable length,
 * no hardcoded coordinates): sort by hours desc, drop the largest at the
 * center, and ring the rest around it. We deliberately draw NO connection lines
 * between unrelated workflows — only a faint spoke from each ring node to the
 * hub, which reads as "all part of one week" without implying false data
 * relationships.
 */

const VIEW_W = 560;
const VIEW_H = 360;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;

// Radius scaling: clamp so a tiny workflow still reads and a huge one doesn't
// blow past the canvas. Linear map from [minHrs, maxHrs] → [R_MIN, R_MAX].
const R_MIN = 20;
const R_MAX = 46;

const COLOR = {
  moss: '#5B7C2E',
  honey: '#D9A21B',
  neutral: '#8A917B',
  coral: '#E2603A',
  line: '#D6DAC8',
} as const;

/** ≥60 → highly automatable (moss), ≥30 → partly (honey), else neutral. */
function autoColor(automatable: number): string {
  if (automatable >= 60) return COLOR.moss;
  if (automatable >= 30) return COLOR.honey;
  return COLOR.neutral;
}

interface PlacedNode {
  key: string;
  label: string;
  short: string;
  hrs: number;
  automatable: number;
  color: string;
  isFriction: boolean;
  x: number;
  y: number;
  r: number;
}

function shortLabel(label: string): string {
  // Take the first segment before a separator, lowercase — matches the demo's
  // terse node captions. CSS truncates further; the full label lives in <title>.
  const head = label.split(/\s[—&·/]\s|:\s/)[0].trim();
  return head.length > 16 ? `${head.slice(0, 15)}…` : head;
}

function placeNodes(workflows: DiagnosisWorkflow[]): PlacedNode[] {
  if (workflows.length === 0) return [];

  const sorted = [...workflows].sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);

  const hoursList = sorted.map((w) => w.hoursPerWeek);
  const maxHrs = Math.max(...hoursList);
  const minHrs = Math.min(...hoursList);
  const span = maxHrs - minHrs;
  const radiusFor = (hrs: number) =>
    span <= 0 ? (R_MIN + R_MAX) / 2 : R_MIN + ((hrs - minHrs) / span) * (R_MAX - R_MIN);

  // The single highest-hours workflow that also has friction is the hotspot.
  const frictionKey = sorted.find((w) => w.friction)?.key ?? null;

  // Ring radius: enough room for the hub + ring nodes without clipping.
  const ringR = Math.min(VIEW_W, VIEW_H) / 2 - R_MAX - 14;

  return sorted.map((w, i) => {
    const automatable = w.automatable ?? 0;
    const r = radiusFor(w.hoursPerWeek);
    const isFriction = w.key === frictionKey;

    let x: number;
    let y: number;
    if (i === 0) {
      // Largest workflow anchors the center.
      x = CX;
      y = CY;
    } else {
      // Remaining nodes evenly spaced on a ring. Offset the start angle so the
      // ring doesn't sit perfectly axis-aligned (reads more organic).
      const ringCount = sorted.length - 1;
      const angle = (-Math.PI / 2) + (2 * Math.PI * (i - 1)) / ringCount + 0.35;
      x = CX + ringR * Math.cos(angle);
      y = CY + ringR * Math.sin(angle);
    }

    return {
      key: w.key,
      label: w.label,
      short: shortLabel(w.label),
      hrs: w.hoursPerWeek,
      automatable,
      color: isFriction ? COLOR.coral : autoColor(automatable),
      isFriction,
      x,
      y,
      r,
    };
  });
}

export function WorkflowMap({ workflows }: { workflows: DiagnosisWorkflow[] }) {
  const nodes = placeNodes(workflows);
  if (nodes.length === 0) return null;

  const hub = nodes[0];

  return (
    <div className={styles.mapCanvas}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Map of ${nodes.length} ${nodes.length === 1 ? 'workflow' : 'workflows'} sized by weekly hours`}
      >
        {/* Faint hub spokes — "all one week", not a data relationship. */}
        {nodes.length > 1 && (
          <g fill="none" stroke={COLOR.line} strokeWidth="1.4">
            {nodes.slice(1).map((n) => (
              <line key={`spoke-${n.key}`} x1={hub.x} y1={hub.y} x2={n.x} y2={n.y} />
            ))}
          </g>
        )}

        <g fontFamily="var(--mono)">
          {nodes.map((n) => (
            <g key={n.key} className={styles.wfNode}>
              <title>
                {n.label} — ~{n.hrs}h/week
                {n.automatable > 0 ? `, ~${n.automatable}% automatable` : ''}
                {n.isFriction ? ' · biggest friction' : ''}
              </title>
              <circle className={styles.wfHalo} cx={n.x} cy={n.y} r={n.r + 10} />
              <circle
                className={styles.wfCore}
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill="#FFFFFF"
                stroke={n.color}
                strokeWidth={n.isFriction ? 2.6 : 2}
              />
              <text
                x={n.x}
                y={n.y + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill={n.color}
              >
                {n.hrs}
              </text>
              <text
                x={n.x}
                y={n.y + n.r + 15}
                textAnchor="middle"
                fontSize="9.5"
                fill="#5A6248"
              >
                {n.short}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className={styles.mapLegend}>
        <span className={styles.mapKey}>
          <i style={{ background: COLOR.moss }} />
          highly automatable
        </span>
        <span className={styles.mapKey}>
          <i style={{ background: COLOR.honey }} />
          partly automatable
        </span>
        <span className={styles.mapKey}>
          <i style={{ background: COLOR.coral }} />
          biggest friction
        </span>
        <span className={styles.mapKey}>○ size = hours/week</span>
      </div>
    </div>
  );
}
