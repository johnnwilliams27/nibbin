/**
 * Synthesis packet builder (SPEC §5) — the ONLY artifact with an upload path
 * (C7), and uploaded only on explicit user action at REVIEW.
 *
 * Construction is whitelist-only: every field is picked explicitly from the
 * already-redacted event; `frame_ref` does not exist in the packet schema at
 * all (pixels never leave the device, C1). user_deleted events are excluded.
 * Before returning, the serialized packet is re-scanned with the battery —
 * a residual PII shape throws rather than exports.
 *
 * Gzipping is the caller's concern (node:zlib in the exporter, flate2 in the
 * daemon) so this module stays platform-neutral.
 */
import { batteryStillMatches } from './battery.js';
import type { ObserverEvent } from './types.js';

export class PacketLeakError extends Error {
  constructor(ruleId: string) {
    super(`synthesis packet failed the paranoid re-scan: battery rule ${ruleId} still matches`);
    this.name = 'PacketLeakError';
  }
}

interface PacketEvent {
  ts: string;
  session: string;
  kind: ObserverEvent['kind'];
  app: string;
  window_title: string;
  url: { host: string; path_template: string } | null;
  ax: { role_path: string; action: string; label: string; value_class: string } | null;
  input: { keys: number; clicks: number; duration_ms: number } | null;
}

export interface SequenceCandidate {
  steps: string[];
  count: number;
}

export interface SynthesisPacket {
  manifest: {
    version: 1;
    study_id: string;
    created_at: string;
    event_count: number;
    hash: string;
  };
  jsonl: string;
}

function pickEvent(e: ObserverEvent): PacketEvent {
  return {
    ts: e.ts,
    session: e.session,
    kind: e.kind,
    app: e.app.name,
    window_title: e.window.title_redacted,
    url: e.url ? { host: e.url.host, path_template: e.url.path_template } : null,
    ax: e.ax
      ? {
          role_path: e.ax.role_path,
          action: e.ax.action,
          label: e.ax.label_redacted,
          value_class: e.ax.value_class,
        }
      : null,
    input: e.input,
  };
}

/** Exact n-gram repetition over role_path+action streams (deterministic mining v0). */
export function sequenceCandidates(events: ObserverEvent[], minN = 3, maxN = 8, minCount = 3): SequenceCandidate[] {
  const steps = events
    .filter((e) => e.ax !== null)
    .map((e) => `${e.ax!.role_path}#${e.ax!.action}`);

  const found = new Map<string, number>();
  for (let n = minN; n <= Math.min(maxN, steps.length); n += 1) {
    for (let i = 0; i + n <= steps.length; i += 1) {
      const key = steps.slice(i, i + n).join('|');
      found.set(key, (found.get(key) ?? 0) + 1);
    }
  }

  return [...found.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 50)
    .map(([key, count]) => ({ steps: key.split('|'), count }));
}

function dailyAggregates(events: ObserverEvent[]): Record<string, Record<string, number>> {
  const byDay: Record<string, Record<string, number>> = {};
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    const dayBucket = (byDay[day] ??= {});
    dayBucket[e.app.name] = (dayBucket[e.app.name] ?? 0) + (e.input?.duration_ms ?? 0);
  }
  return byDay;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildSynthesisPacket(
  studyId: string,
  events: ObserverEvent[],
  createdAt: string,
): Promise<SynthesisPacket> {
  // Layer-4 outcome is binding: user-deleted blocks never export.
  const exportable = events.filter((e) => e.redaction.review_state !== 'user_deleted');

  const lines: string[] = [];
  for (const e of exportable) lines.push(JSON.stringify({ t: 'event', ...pickEvent(e) }));
  lines.push(JSON.stringify({ t: 'aggregates', daily_app_duration_ms: dailyAggregates(exportable) }));
  lines.push(JSON.stringify({ t: 'sequences', candidates: sequenceCandidates(exportable) }));

  const body = lines.join('\n');

  const residual = batteryStillMatches(body);
  if (residual !== null) throw new PacketLeakError(residual);

  const hash = await sha256Hex(body);
  const manifest = {
    version: 1 as const,
    study_id: studyId,
    created_at: createdAt,
    event_count: exportable.length,
    hash,
  };

  return { manifest, jsonl: `${JSON.stringify({ t: 'manifest', ...manifest })}\n${body}` };
}
