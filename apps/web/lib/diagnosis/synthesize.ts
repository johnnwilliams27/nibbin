/**
 * Diagnosis synthesis v0 — deterministic mining (SPEC §5: "Inference v0 is
 * deterministic mining + LLM labeling; ML iteration follows real packets").
 *
 * This PR ships the deterministic half: the uploaded packet (already segmented
 * + redacted on-device) is aggregated into a workflow map — hours/week,
 * frequency, friction, and a recommended shop Nibbin per workflow. The LLM
 * labeling pass (better labels + the Grovekeeper's letter, on Opus via the
 * `diagnosis_synthesis` route) layers on top in a follow-up.
 */
import type {
  DiagnosisMap,
  DiagnosisWorkflow,
  Frequency,
  PacketWorkflow,
  SynthesisPacket,
  WorkflowCategory,
} from './types';

const CATEGORIES: ReadonlySet<WorkflowCategory> = new Set([
  'email',
  'calendar',
  'payments',
  'crm',
  'docs',
  'social',
  'other',
]);

/** Category default → shop template key. */
const CATEGORY_TEMPLATE: Record<WorkflowCategory, string | null> = {
  email: 'scribe',
  calendar: 'hopper',
  payments: 'tally',
  crm: 'echo',
  docs: 'brief',
  social: 'scribe',
  other: null,
};

/**
 * Finer key-level mapping (mirrors §4.4 scan-module → template intent).
 * Exported so the Opus labeling pass (label.ts) can recompute a workflow's
 * `recommendedNibbin` when it refines a coarse key to a finer allowed one.
 */
export const KEY_TEMPLATE: Record<string, string> = {
  'email.inquiries': 'scribe',
  'email.overdue': 'echo',
  'email.newsletter': 'sweep',
  'calendar.confirmations': 'hopper',
  'payments.invoices': 'tally',
  'payments.overdue': 'tally',
};

const MAX_WORKFLOWS = 60;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampStr = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

const clampNum = (v: unknown, max: number) => Math.max(0, Math.min(max, Number(v) || 0));

function clampDayMap(v: unknown, maxDays: number): Record<string, number> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const src = v as Record<string, unknown>;
  // `Object.create(null)` so a "__proto__" key becomes a normal own property
  // instead of mutating the accumulator's prototype.
  const out = Object.create(null) as Record<string, number>;
  // Early-break over keys rather than materializing the full entries array
  // before slicing — a body of tiny keys must not allocate the whole map.
  let taken = 0;
  for (const k of Object.keys(src)) {
    if (taken >= maxDays) break;
    out[clampStr(k, 10)] = Math.round(clampNum(src[k], 1_000_000) * 10) / 10;
    taken += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

function clampSequences(v: unknown): { steps: string[]; count: number }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .slice(0, 10)
    .map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const steps = Array.isArray(s.steps) ? s.steps.slice(0, 12).map((x) => clampStr(x, 80)).filter(Boolean) : [];
      return { steps, count: clampNum(s.count, 1_000_000) };
    })
    .filter((s) => s.steps.length > 0);
  return out.length ? out : undefined;
}

/**
 * Validate + sanitize an uploaded packet (untrusted external input). Returns a
 * clean SynthesisPacket or null if it isn't shaped like one.
 */
export function validateSynthesisPacket(input: unknown): SynthesisPacket | null {
  if (typeof input !== 'object' || input === null) return null;
  const p = input as Record<string, unknown>;
  if (p.version !== 1) return null;
  const studyDays = Number(p.studyDays);
  if (!Number.isFinite(studyDays) || studyDays < 1 || studyDays > 14) return null;
  if (!Array.isArray(p.workflows)) return null;

  const workflows: PacketWorkflow[] = [];
  for (const raw of p.workflows.slice(0, MAX_WORKFLOWS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const w = raw as Record<string, unknown>;
    const category = (CATEGORIES.has(w.category as WorkflowCategory) ? w.category : 'other') as WorkflowCategory;
    const key = clampStr(w.key, 64).trim();
    const label = clampStr(w.label, 120).trim();
    if (!key || !label) continue;
    const minutesObserved = Math.max(0, Math.min(1_000_000, Number(w.minutesObserved) || 0));
    const sessions = Math.max(0, Math.min(100_000, Number(w.sessions) || 0));
    const apps = Array.isArray(w.apps) ? w.apps.slice(0, 12).map((a) => clampStr(a, 60)).filter(Boolean) : [];
    const friction = clampStr(w.friction, 280).trim();
    const sequences = clampSequences(w.sequences);
    const urlTemplates = Array.isArray(w.urlTemplates)
      ? w.urlTemplates.slice(0, 20).map((u) => clampStr(u, 120)).filter(Boolean)
      : undefined;
    const dailyMinutes = clampDayMap(w.dailyMinutes, 31);
    workflows.push({
      key,
      label,
      category,
      apps,
      minutesObserved,
      sessions,
      ...(friction ? { friction } : {}),
      ...(sequences ? { sequences } : {}),
      ...(urlTemplates && urlTemplates.length ? { urlTemplates } : {}),
      ...(dailyMinutes ? { dailyMinutes } : {}),
    });
  }

  const dailyAppMinutes = (() => {
    if (typeof p.dailyAppMinutes !== 'object' || p.dailyAppMinutes === null) return undefined;
    const src = p.dailyAppMinutes as Record<string, unknown>;
    const out = Object.create(null) as Record<string, Record<string, number>>;
    // Early-break over keys (bounded work) + null-proto accumulator (no
    // "__proto__"-key prototype mutation), mirroring clampDayMap.
    let taken = 0;
    for (const day of Object.keys(src)) {
      if (taken >= 31) break;
      taken += 1;
      const inner = clampDayMap(src[day], 20);
      if (inner) out[clampStr(day, 10)] = inner;
    }
    return Object.keys(out).length ? out : undefined;
  })();

  const kind = p.kind === 'quick_scan' ? 'quick_scan' : 'full_study';
  const label = clampStr(p.label, 120).trim();

  const candidate: SynthesisPacket = {
    version: 1,
    studyId: clampStr(p.studyId, 64) || undefined,
    studyDays,
    capturedFrom: clampStr(p.capturedFrom, 40),
    capturedTo: clampStr(p.capturedTo, 40),
    workflows,
    ...(dailyAppMinutes ? { dailyAppMinutes } : {}),
    kind,
    ...(label ? { label } : {}),
  };

  // A validated packet that serializes past the diagnoses.packet 256KB column
  // cap would 502 at write time; reject it here so the route 422s instead.
  if (JSON.stringify(candidate).length > 262144) return null;
  return candidate;
}

/**
 * v0 automatability heuristic. Repetition (the dominant repeated step-chain) is
 * the GATE — no repeated chain ⇒ 0. Within that, two enrichment-derived factors
 * sharpen the score: narrowness (concentrated in few url-templates ⇒ cleaner to
 * automate) and regularity (active across more of the study window ⇒ a routine).
 * Absent enrichment ⇒ both factors are 1 and the expression collapses to the
 * prior `round(100 × repetition)` (so old behavior + tests are preserved).
 */
function automatableScore(w: PacketWorkflow, days: number): number {
  const top = w.sequences?.[0];
  if (!top) return 0;
  const strength = (top.count || 0) * (top.steps?.length || 0);
  if (strength <= 0) return 0;
  const repetition = strength / (strength + 24); // 0..1 (the prior saturating curve)

  const templates = w.urlTemplates?.length ?? 0;
  const narrowness = templates > 0 ? 1 / (1 + Math.max(0, templates - 1) / 4) : 1;

  const activeDays = w.dailyMinutes ? Object.keys(w.dailyMinutes).length : 0;
  const regularity = activeDays > 0 ? Math.min(1, activeDays / Math.max(1, days)) : 1;

  const score = repetition * (0.6 + 0.25 * narrowness + 0.15 * regularity);
  return Math.max(0, Math.min(100, Math.round(100 * score)));
}

/**
 * A factual friction line mined from the dominant sequence + enrichment. The
 * Opus labeling pass warms it into prose later; here it stays deterministic.
 * Falls back to the on-device note when there's no repeated chain.
 */
function frictionLine(w: PacketWorkflow): string | null {
  const top = w.sequences?.[0];
  if (!top) return w.friction ?? null;
  const templates = w.urlTemplates?.length ?? 0;
  const activeDays = w.dailyMinutes ? Object.keys(w.dailyMinutes).length : 0;
  const bits = [`a ${top.steps.length}-step pattern repeated ${top.count}×`];
  if (templates > 0) bits.push(`across ${templates} ${templates === 1 ? 'view' : 'views'}`);
  if (activeDays > 0) bits.push(`on ${activeDays} ${activeDays === 1 ? 'day' : 'days'}`);
  return bits.join(', ');
}

function synthOne(w: PacketWorkflow, days: number): DiagnosisWorkflow {
  const hoursPerWeek = round1(((w.minutesObserved / days) * 7) / 60);
  const perWeek = (w.sessions / days) * 7;
  const frequency: Frequency = perWeek >= 5 ? 'daily' : perWeek >= 1 ? 'weekly' : 'occasional';
  const recommendedNibbin = KEY_TEMPLATE[w.key] ?? CATEGORY_TEMPLATE[w.category] ?? null;
  return {
    key: w.key,
    label: w.label,
    category: w.category,
    hoursPerWeek,
    frequency,
    friction: frictionLine(w),
    recommendedNibbin,
    automatable: automatableScore(w, days),
  };
}

/** Aggregate a packet into the diagnosis map (deterministic). */
export function synthesizeDiagnosis(packet: SynthesisPacket): DiagnosisMap {
  const days = Math.max(1, Math.min(14, packet.studyDays));
  const workflows = packet.workflows
    .map((w) => synthOne(w, days))
    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);

  const totalHoursPerWeek = round1(workflows.reduce((s, w) => s + w.hoursPerWeek, 0));

  // Headline Group-A number: hours an adopted grove could lift off the plate
  // each week = Σ per-workflow hours × that workflow's automatability fraction.
  const timeSavedPerWeek = round1(
    workflows.reduce((s, w) => s + w.hoursPerWeek * ((w.automatable ?? 0) / 100), 0),
  );

  // "Where your desktop time goes": sum each app's minutes across all days, to
  // hours/week, sort desc, top 8. Empty when the device didn't send the aggregate.
  const appTotals = new Map<string, number>();
  for (const day of Object.values(packet.dailyAppMinutes ?? {})) {
    for (const [app, min] of Object.entries(day)) {
      appTotals.set(app, (appTotals.get(app) ?? 0) + (Number(min) || 0));
    }
  }
  const appAllocation = [...appTotals.entries()]
    .map(([app, totalMin]) => ({ app, hoursPerWeek: round1(((totalMin / days) * 7) / 60) }))
    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
    .slice(0, 8);

  const topRecommendations: string[] = [];
  for (const w of workflows) {
    if (w.recommendedNibbin && !topRecommendations.includes(w.recommendedNibbin)) {
      topRecommendations.push(w.recommendedNibbin);
    }
    if (topRecommendations.length >= 3) break;
  }

  return { workflows, totalHoursPerWeek, topRecommendations, timeSavedPerWeek, appAllocation };
}
