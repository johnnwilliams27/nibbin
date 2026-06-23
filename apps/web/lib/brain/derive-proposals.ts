import 'server-only';

/**
 * Cloud proposal derivation (P3 Task 3).
 *
 * Maps a validated ObservationSummary to 0–3 structured memory proposals via a
 * small, constrained model call. Returns [] on thin data / no API key / any
 * parse failure — [] is always success (§11: never surfaces errors to the user).
 *
 * Privacy invariants (C1/C7):
 * - The model is given ONLY the structural ObservationSummary (app names,
 *   timing, workflow shapes). No raw AX/window/URL/keystroke content ever
 *   reaches this function — it was stripped on-device before the summary
 *   was built.
 * - Each proposal `value` is battery-scanned by the caller (Task 4) before
 *   being written — an additional derived-not-raw guard at the write boundary.
 * - `hard_rules` is blocked at the filter step below; proposals never target
 *   the hard-rules field.
 */

import { DEFAULT_MODELS } from '@nibbin/router';
import type { Generate } from '@nibbin/router';
import { MEMORY_SECTIONS } from '../grove/memory';
import type { ObservationSummary } from './observation-schema';

export interface CaptureProposal {
  field_key: string;
  value: string;
  rationale: string;
}

/** Allowed target fields — MEMORY_SECTIONS keys only; hard_rules is never a target. */
const ALLOWED = new Set(MEMORY_SECTIONS.map((s) => s.key));

/** Thin-data floor: mirrors buildObservationSummary's floor from Task 1. */
const MIN_EVENTS = 10;
const MIN_ACTIVE_MS = 5 * 60 * 1000; // 5 minutes

/** Max proposals the model may emit — enforced in validation. */
const MAX_PROPOSALS = 3;

const SYSTEM_TEXT = [
  'You convert a STRUCTURAL summary of observed work patterns into 1-3 brief additions to the',
  "user's business memory. You may reference only PATTERNS (recurring apps, timing, workflow",
  'shapes) — never a specific moment, file, message, or person. Output ONLY JSON:',
  '[{"field_key":"...","value":"...","rationale":"..."}].',
  'field_key must be one of: facts, pricing, policies, faq, voice.',
  'Never propose to hard_rules. Never include raw content. If the summary is too thin for a',
  'confident proposal, output []. Keep each value under 240 characters.',
].join(' ');

/**
 * Validate that a parsed value looks like CaptureProposal[].
 * Strict: >3 entries → fail (enforces the max-3 constraint at the schema level).
 */
function parseModelOut(parsed: unknown): CaptureProposal[] | null {
  if (!Array.isArray(parsed)) return null;
  // Enforce the hard cap: more than MAX_PROPOSALS items → parse failure.
  if (parsed.length > MAX_PROPOSALS) return null;

  const result: CaptureProposal[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;
    const field_key = o.field_key;
    const value = o.value;
    const rationale = o.rationale;
    if (typeof field_key !== 'string' || field_key.length === 0) return null;
    if (typeof value !== 'string' || value.length === 0 || value.length > 6000) return null;
    if (typeof rationale !== 'string' || rationale.length > 2000) return null;
    result.push({ field_key, value, rationale });
  }
  return result;
}

/**
 * Derive 0–3 capture proposals from an ObservationSummary.
 *
 * @param summary - The validated, already-redaction-scanned boundary payload.
 * @param generate - The DI'd model client; null when ANTHROPIC_API_KEY is absent.
 * @returns Filtered, validated proposal list (may be empty).
 */
export async function deriveProposalsFromObservation(
  summary: ObservationSummary,
  generate: Generate | null,
): Promise<CaptureProposal[]> {
  // Guard 1 — no model → [].
  if (!generate) return [];

  // Guard 2 — thin data: mirrors the on-device floor so the model never gets
  // a summary too sparse to reason about (saves tokens; cost-auditor invariant).
  if (summary.total_events_reviewed < MIN_EVENTS || summary.active_ms < MIN_ACTIVE_MS) return [];

  let raw: { text: string };
  try {
    raw = await generate({
      // T0-class call: the cheapest model tier for a small structured extraction.
      // Hardcoded to DEFAULT_MODELS.t0 to avoid a Postgres router round-trip for
      // a pipeline-background call. The router would return the same model anyway
      // (style_extraction is T0); this avoids the budget-store DB dependency in
      // this fire-and-forget background path.
      model: DEFAULT_MODELS.t0,
      system: [{ text: SYSTEM_TEXT, cache: true }],
      messages: [{ role: 'user', content: JSON.stringify(summary) }],
      maxTokens: 600,
      temperature: 0.3,
    });
  } catch {
    // Network / API error → [] (never surfaces to the user).
    return [];
  }

  // Parse and validate the model's JSON output.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text.trim());
  } catch {
    return [];
  }

  const proposals = parseModelOut(parsed);
  if (proposals === null) return [];

  // Filter to allowed field_keys only — hard_rules and unknown keys are silently dropped.
  return proposals.filter((p) => ALLOWED.has(p.field_key));
}
