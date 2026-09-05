/**
 * Does re-reading the same fact still manufacture confidence?
 *
 * The review replayed ONE byte-identical transcript as N consecutive daily runs
 * — same tool list, same registry publish date, zero new information — and
 * watched n_eff on `maintenance` climb to 263 and the composite to 96.21 with
 * 0.88 confidence. This re-runs that experiment against the resampling policy.
 *
 * Expected after the fix: dimensions marked `latest_only` stay flat no matter
 * how many times the same transcript is replayed, while `availability` and
 * `functional_correctness` — which genuinely vary between probes — still
 * accumulate, because there the repeats are real samples.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptsToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";

const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const base = readdirSync(D).map((f) => JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript).find((t) => t.tools?.ok === true)!;

for (const days of [1, 30, 365]) {
  const copies: ProbeTranscript[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.parse(base.probed_at) - i * 86400_000).toISOString().slice(0, 19) + "Z";
    copies.push({ ...base, probed_at: d, attempts: base.attempts.map((a) => ({ ...a, ts: d })) });
  }
  const asOfTs = `${new Date(Date.parse(base.probed_at) + 86400_000).toISOString().slice(0, 19)}Z`;
  const s = transcriptsToSubject(copies, { probe, asOfTs, gaps: [...transcriptGaps(base), ...batteryGaps([])] });
  const { result } = scoreSubject(s);
  const dims = Object.fromEntries(result.dimensions.map((d) => [d.dimension, d.n_eff]));
  console.log(
    `days=${String(days).padStart(3)}  composite=${String(result.composite).padStart(6)} conf=${String(result.composite_confidence).padStart(6)}  ` +
      `maintenance n_eff=${String(dims.maintenance ?? "-").padStart(6)}  documentation n_eff=${String(dims.documentation ?? "-").padStart(6)}  availability n_eff=${String(dims.availability ?? "-").padStart(6)}`,
  );
}
