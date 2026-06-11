/**
 * Daemon simulator — the TS twin of the Rust `observerd` daemon, driven by
 * the CI-blocking redaction corpus. It owns the pipeline, the store, and the
 * study state machine, exactly like the production daemon, and has ZERO
 * imports from UI code (tests/redaction-corpus enforces that statically:
 * C2's day-14 stop must fire with no UI in the process at all).
 *
 * Every state transition is persisted before it is acted on, so enforcement
 * survives restarts: a daemon waking up past the deadline stops the study on
 * its first tick.
 */
import {
  RedactionPipeline,
  snapshotToRawEvents,
  type AxSnapshot,
  type NerClient,
  type ObserverEvent,
  type ProcessResult,
} from '@nibbin/redaction';
import {
  captureAllowed,
  deadlinePassed,
  newStudy,
  remainingMs,
  transition,
  type StudyCommand,
  type StudySnapshot,
} from '../core/study-machine.js';
import { FileObserverStore, verifyRawDataDeleted } from './file-store.js';

export type Clock = () => string;

export interface DaemonOptions {
  storeRoot: string;
  ner: NerClient;
  clock?: Clock;
  studyId?: string;
}

export class ObserverDaemon {
  readonly store: FileObserverStore;
  readonly pipeline: RedactionPipeline;
  private readonly clock: Clock;
  private study: StudySnapshot;
  private pausedAt: string | null = null;

  constructor(opts: DaemonOptions) {
    this.store = new FileObserverStore(opts.storeRoot);
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.pipeline = new RedactionPipeline({ ner: opts.ner, sink: this.store });
    this.study = this.store.loadStudy() ?? newStudy(opts.studyId ?? 'study_sim');
    this.store.saveStudy(this.study);
  }

  get snapshot(): StudySnapshot {
    return this.study;
  }

  get countdownMs(): number {
    return remainingMs(this.study, this.clock());
  }

  private apply(cmd: StudyCommand): void {
    this.study = transition(this.study, cmd);
    this.store.saveStudy(this.study);
  }

  /**
   * The daemon heartbeat. Day-14 enforcement lives HERE (C2) — the UI never
   * participates. Returns true if the hard stop fired on this tick.
   */
  tick(): boolean {
    const now = this.clock();
    if (deadlinePassed(this.study, now)) {
      this.apply({ type: 'stop_day14', at: now });
      return true;
    }
    return false;
  }

  consent(): void {
    this.apply({ type: 'consent', at: this.clock() });
  }

  start(): void {
    this.apply({ type: 'start', at: this.clock() });
  }

  /** C6: the global pause hotkey path — synchronous, no awaits, no IO before the flip. */
  pauseHotkey(): void {
    this.apply({ type: 'pause' });
    this.pausedAt = this.clock();
  }

  async resume(): Promise<void> {
    this.apply({ type: 'resume' });
    // Pauses are logged as visible gaps (C6) — a gap carries no content.
    const now = this.clock();
    const gap: ObserverEvent = {
      v: 1,
      id: `evt_gap_${now}`,
      ts: now,
      session: 'ses_gap',
      kind: 'capture_gap',
      app: { bundle_id: 'app.nibbin.observer', name: 'Observer' },
      window: { title_redacted: '', id: 'w_gap' },
      url: null,
      ax: null,
      input: this.pausedAt
        ? { keys: 0, clicks: 0, duration_ms: new Date(now).getTime() - new Date(this.pausedAt).getTime() }
        : null,
      frame_ref: null,
      redaction: { rules_hit: [], review_state: 'auto' },
    };
    await this.store.append(gap);
    this.pausedAt = null;
  }

  /**
   * Capture entry point. Enforcement order: deadline tick → study state gate
   * → the 4-layer pipeline. Nothing persists unless every gate passes.
   */
  async captureSnapshot(snapshot: AxSnapshot, session: string): Promise<ProcessResult[]> {
    this.tick();
    if (!captureAllowed(this.study)) return [];
    const results: ProcessResult[] = [];
    for (const raw of snapshotToRawEvents(snapshot, session, this.clock)) {
      results.push(await this.pipeline.process(raw));
    }
    return results;
  }

  stopEarly(): void {
    this.apply({ type: 'stop_early', at: this.clock() });
  }

  finishReview(): void {
    this.apply({ type: 'finish_review' });
  }

  synthesisComplete(): void {
    this.apply({ type: 'synthesis_complete' });
  }

  /** RAW_DELETING → verified receipt → COMPLETE (or DELETED when aborted). */
  deleteRawDataAndVerify(): void {
    if (this.study.state !== 'RAW_DELETING') {
      throw new Error(`raw deletion requires RAW_DELETING, was ${this.study.state}`);
    }
    this.store.purgeAllRawData();
    const receipt = verifyRawDataDeleted(this.store.paths.root, this.clock());
    if (!receipt.verified) {
      throw new Error(`deletion verification failed: residual ${receipt.residual_files.join(', ')}`);
    }
    this.apply({ type: 'deletion_verified', receipt });
  }

  /** "Delete everything" — reachable from any state, always honored. */
  deleteEverything(): void {
    this.apply({ type: 'delete_everything' });
    this.deleteRawDataAndVerify();
  }
}
