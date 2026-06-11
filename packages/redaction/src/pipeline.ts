/**
 * The 4-layer pre-persistence pipeline (SPEC §5):
 *
 *   capture (layer 1, C4 structural suppression — see capture.ts)
 *     → layer 2: category blocklist (C5) — a hit records NOTHING
 *     → layer 3: regex battery (always) + NER sidecar — FAIL-CLOSED:
 *       if the sidecar is unavailable the pipeline halts; nothing persists.
 *       The battery still having run is not grounds to degrade.
 *     → persistence (SQLCipher in the daemon; injected sink here)
 *     → layer 4: end-of-day review (review.ts) — a right, not a chore.
 *
 * Nothing reaches the sink except a fully-redacted ObserverEvent. There is no
 * code path that persists a RawCaptureEvent.
 */
import { applyBattery, classifyValue } from './battery.js';
import { blockedCategoryFor, EMPTY_EXCLUSIONS, type UserExclusions } from './blocklist.js';
import { NerUnavailableError, type NerClient } from './ner.js';
import { hostOf, scrubUrl } from './url.js';
import type { ObserverEvent, ProcessResult, RawCaptureEvent } from './types.js';

export interface PersistSink {
  append(event: ObserverEvent): Promise<void>;
}

export interface PipelineOptions {
  ner: NerClient;
  sink: PersistSink;
  exclusions?: UserExclusions;
  /** Called when the pipeline halts so the daemon can suspend capture. */
  onHalt?: (reason: string) => void;
}

export class RedactionPipeline {
  private readonly ner: NerClient;
  private readonly sink: PersistSink;
  private exclusions: UserExclusions;
  private readonly onHalt: ((reason: string) => void) | undefined;
  private haltedReason: string | null = null;

  constructor(opts: PipelineOptions) {
    this.ner = opts.ner;
    this.sink = opts.sink;
    this.exclusions = opts.exclusions ?? EMPTY_EXCLUSIONS;
    this.onHalt = opts.onHalt;
  }

  get halted(): boolean {
    return this.haltedReason !== null;
  }

  /** Layer-4 exclusions feed back into layer 2 for the rest of the study. */
  addExclusions(more: Partial<UserExclusions>): void {
    this.exclusions = {
      hosts: [...this.exclusions.hosts, ...(more.hosts ?? [])],
      bundleIds: [...this.exclusions.bundleIds, ...(more.bundleIds ?? [])],
      appNames: [...this.exclusions.appNames, ...(more.appNames ?? [])],
    };
  }

  /** Re-arm after the sidecar supervisor reports healthy again. */
  resume(): void {
    this.haltedReason = null;
  }

  async process(raw: RawCaptureEvent): Promise<ProcessResult> {
    // Fail-closed: once halted, nothing persists until the supervisor resumes us.
    if (this.haltedReason !== null) {
      return { action: 'halted_ner_unavailable' };
    }

    // Layer 2 — category blocklist (C5), before any redaction work.
    const category = blockedCategoryFor(
      raw.window,
      { bundleId: raw.app.bundleId, name: raw.app.name },
      hostOf(raw.url),
      this.exclusions,
    );
    if (category !== null) {
      return { action: 'blocked_category', category };
    }

    // Layer 3 — battery first (sync, always), then NER (fail-closed).
    const titlePass = applyBattery(raw.window.title);
    const labelPass = raw.ax && !raw.ax.secureSuppressed ? applyBattery(raw.ax.label) : null;

    let titleRedacted: string;
    let labelRedacted: string | null;
    let nerRules: string[] = [];
    try {
      const titleNer = await this.ner.redact(titlePass.text);
      titleRedacted = titleNer.redacted;
      nerRules = titleNer.rulesHit;
      if (labelPass !== null) {
        const labelNer = await this.ner.redact(labelPass.text);
        labelRedacted = labelNer.redacted;
        nerRules = [...nerRules, ...labelNer.rulesHit];
      } else {
        labelRedacted = null;
      }
    } catch (err) {
      if (err instanceof NerUnavailableError) {
        this.haltedReason = 'ner_unavailable';
        this.onHalt?.('ner_unavailable');
        return { action: 'halted_ner_unavailable' };
      }
      throw err;
    }

    // Values are classified, then discarded — the schema has no value field.
    const valueClass = raw.ax
      ? raw.ax.secureSuppressed
        ? ('none' as const)
        : classifyValue(raw.ax.value)
      : ('none' as const);

    const rulesHit = [...new Set([...titlePass.rulesHit, ...(labelPass?.rulesHit ?? []), ...nerRules])];

    const event: ObserverEvent = {
      v: 1,
      id: raw.id,
      ts: raw.ts,
      session: raw.session,
      kind: raw.kind,
      app: { bundle_id: raw.app.bundleId, name: raw.app.name },
      window: { title_redacted: titleRedacted, id: raw.window.id },
      url: raw.url !== undefined ? scrubUrl(raw.url) : null,
      ax: raw.ax
        ? {
            role_path: raw.ax.rolePath,
            action: raw.ax.action,
            // C4: a suppressed field contributes a constant, never its label.
            label_redacted: raw.ax.secureSuppressed ? '{SECURE}' : (labelRedacted ?? ''),
            value_class: valueClass,
          }
        : null,
      input: raw.input
        ? { keys: raw.input.keys, clicks: raw.input.clicks, duration_ms: raw.input.durationMs }
        : null,
      frame_ref: raw.ax?.secureSuppressed ? null : (raw.frameRef ?? null),
      redaction: { rules_hit: rulesHit, review_state: 'auto' },
    };

    await this.sink.append(event);
    return { action: 'persisted', event };
  }
}
