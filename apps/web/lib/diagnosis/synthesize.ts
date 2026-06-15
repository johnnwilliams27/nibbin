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

/** Finer key-level mapping (mirrors §4.4 scan-module → template intent). */
const KEY_TEMPLATE: Record<string, string> = {
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
    workflows.push({ key, label, category, apps, minutesObserved, sessions, ...(friction ? { friction } : {}) });
  }

  return {
    version: 1,
    studyId: clampStr(p.studyId, 64) || undefined,
    studyDays,
    capturedFrom: clampStr(p.capturedFrom, 40),
    capturedTo: clampStr(p.capturedTo, 40),
    workflows,
  };
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
    friction: w.friction ?? null,
    recommendedNibbin,
  };
}

/** Aggregate a packet into the diagnosis map (deterministic). */
export function synthesizeDiagnosis(packet: SynthesisPacket): DiagnosisMap {
  const days = Math.max(1, Math.min(14, packet.studyDays));
  const workflows = packet.workflows
    .map((w) => synthOne(w, days))
    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);

  const totalHoursPerWeek = round1(workflows.reduce((s, w) => s + w.hoursPerWeek, 0));

  const topRecommendations: string[] = [];
  for (const w of workflows) {
    if (w.recommendedNibbin && !topRecommendations.includes(w.recommendedNibbin)) {
      topRecommendations.push(w.recommendedNibbin);
    }
    if (topRecommendations.length >= 3) break;
  }

  return { workflows, totalHoursPerWeek, topRecommendations };
}
