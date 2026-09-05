/**
 * End to end: a stored probe transcript in, a published rating out.
 *
 * The pieces have been tested individually. This asks the only question that
 * matters to a user of the compendium — does a server go in and a rating come
 * out — and it is deliberately run over a real population rather than a
 * fixture, because a fixture cannot show what fraction of the world is
 * publishable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import { batteryGaps } from "../src/mcp/subject.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";

const files = readdirSync(join(import.meta.dirname, "..", "transcripts"));

// Behavioural evidence, keyed by ENDPOINT. assessment.json is per tool; a
// subject is a server, so outcomes are grouped before being handed over. The
// join is on endpoint rather than name because the two files sanitise names
// differently — "ai.x/y" against "ai.x_y" — and joining on those silently
// matched nothing at all.
const battery = new Map<string, BatteryOutcome[]>();
try {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "assessment.json"), "utf8")) as (BatteryOutcome & { server?: string; endpoint?: string })[];
  for (const o of raw) {
    const k = o.endpoint ?? "(unknown)";
    battery.set(k, [...(battery.get(k) ?? []), o]);
  }
} catch { /* no battery run yet; every judged check becomes a gap */ }
console.log(`battery outcomes loaded for ${battery.size} servers`);
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
const probe = {
  first_seen_ts: process.env.PROBE_SINCE ?? "2024-09-01T00:00:00Z",
  total_observations: 4000,
  distinct_subjects: 600,
  max_observations_single_day: 400,
};

let published = 0, withheld = 0, failed = 0;
const reasons = new Map<string, number>();
const sample: string[] = [];

for (const f of files) {
  let t: ProbeTranscript;
  try { t = JSON.parse(readFileSync(join(import.meta.dirname, "..", "transcripts", f), "utf8")) as ProbeTranscript; } catch { continue; }
  try {
    const b = battery.get(t.endpoint) ?? [];
    const subject = transcriptToSubject(t, {
      probe,
      asOfTs,
      gaps: [...transcriptGaps(t), ...batteryGaps(b)],
      battery: b,
    });
    const { result, canonicalBytes } = scoreSubject(subject);
    if (result.composite !== null) {
      published += 1;
      if (sample.length < 8) {
        sample.push(
          `${(t.registry?.name ?? f).slice(0, 34).padEnd(34)} score=${result.composite} conf=${result.composite_confidence} ` +
            `obs=${subject.observations.length} gaps=${subject.gaps.length} bytes=${canonicalBytes.length}`,
        );
      }
    } else {
      withheld += 1;
      const r = result.composite_suppression_reason ?? "(none)"; reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
  } catch (e) {
    failed += 1;
    if (failed <= 3) console.log("CRASH:", e instanceof Error ? e.message.slice(0, 200) : e);
  }
}

console.log(`transcripts:  ${files.length}`);
console.log(`published:    ${published}`);
console.log(`withheld:     ${withheld}`);
console.log(`crashed:      ${failed}`);
console.log("");
console.log("why ratings are withheld:");
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${r}`);
console.log("");
console.log("sample of published ratings:");
for (const s of sample) console.log(`  ${s}`);
