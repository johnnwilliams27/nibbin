import { batteryStillMatches } from '@nibbin/redaction';

export interface ObservationApp {
  name: string;
  durationMs: number;
  category?: string;
}

export interface WorkflowShape {
  pattern: string;
  frequency: number;
}

export interface ObservationSummary {
  study_id: string;
  study_period: { start: string; end: string };
  total_events_reviewed: number;
  active_ms: number;
  top_apps: ObservationApp[];
  busiest_hour: number | null;
  workflow_shapes: WorkflowShape[];
  gap_count: number;
}

/** Exact allowed top-level keys — strict means any extra key fails. */
const TOP_KEYS = new Set<string>([
  'study_id', 'study_period', 'total_events_reviewed', 'active_ms',
  'top_apps', 'busiest_hour', 'workflow_shapes', 'gap_count',
]);
const APP_KEYS = new Set<string>(['name', 'durationMs', 'category']);
const SHAPE_KEYS = new Set<string>(['pattern', 'frequency']);
const PERIOD_KEYS = new Set<string>(['start', 'end']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) return null;
  return v;
}

function parseApp(raw: unknown): ObservationApp | null {
  if (!isPlainObject(raw)) return null;
  if (!hasOnlyKeys(raw, APP_KEYS)) return null; // strict — reject unknown keys
  const name = clampStr(raw.name, 120);
  if (name === null) return null;
  if (typeof raw.durationMs !== 'number' || !Number.isInteger(raw.durationMs) || raw.durationMs < 0) return null;
  const app: ObservationApp = { name, durationMs: raw.durationMs };
  if ('category' in raw) {
    const cat = clampStr(raw.category, 60);
    if (cat === null) return null;
    app.category = cat;
  }
  return app;
}

function parseShape(raw: unknown): WorkflowShape | null {
  if (!isPlainObject(raw)) return null;
  if (!hasOnlyKeys(raw, SHAPE_KEYS)) return null; // strict
  const pattern = clampStr(raw.pattern, 200);
  if (pattern === null) return null;
  if (typeof raw.frequency !== 'number' || !Number.isInteger(raw.frequency) || raw.frequency < 1) return null;
  return { pattern, frequency: raw.frequency };
}

/**
 * Strict parse of the cross-boundary ObservationSummary payload.
 * Any unknown top-level or nested key → null (strict: rejects rather than strips).
 * This is the cloud's defense-in-depth against upstream privacy regressions.
 */
export function parseObservationSummary(body: unknown): ObservationSummary | null {
  if (!isPlainObject(body)) return null;
  if (!hasOnlyKeys(body, TOP_KEYS)) return null; // strict — extra field → reject

  const study_id = clampStr(body.study_id, 200);
  if (study_id === null) return null;

  const sp = body.study_period;
  if (!isPlainObject(sp)) return null;
  if (!hasOnlyKeys(sp, PERIOD_KEYS)) return null; // strict
  const start = clampStr(sp.start, 40);
  const end = clampStr(sp.end, 40);
  if (start === null || end === null) return null;

  const ter = body.total_events_reviewed;
  if (typeof ter !== 'number' || !Number.isInteger(ter) || ter < 0) return null;

  const active_ms = body.active_ms;
  if (typeof active_ms !== 'number' || !Number.isInteger(active_ms) || active_ms < 0) return null;

  if (!Array.isArray(body.top_apps) || body.top_apps.length > 20) return null;
  const top_apps: ObservationApp[] = [];
  for (const raw of body.top_apps) {
    const app = parseApp(raw);
    if (app === null) return null;
    top_apps.push(app);
  }

  const bh = body.busiest_hour;
  if (bh !== null && (typeof bh !== 'number' || !Number.isInteger(bh) || bh < 0 || bh > 23)) return null;
  const busiest_hour = bh as number | null;

  if (!Array.isArray(body.workflow_shapes) || body.workflow_shapes.length > 20) return null;
  const workflow_shapes: WorkflowShape[] = [];
  for (const raw of body.workflow_shapes) {
    const shape = parseShape(raw);
    if (shape === null) return null;
    workflow_shapes.push(shape);
  }

  const gc = body.gap_count;
  if (typeof gc !== 'number' || !Number.isInteger(gc) || gc < 0) return null;

  return {
    study_id,
    study_period: { start, end },
    total_events_reviewed: ter,
    active_ms,
    top_apps,
    busiest_hour,
    workflow_shapes,
    gap_count: gc,
  };
}

/** Boundary scan: the battery must find NO residual sensitive token in the payload. */
export function summaryIsClean(summary: unknown): boolean {
  return batteryStillMatches(JSON.stringify(summary)) === null;
}
