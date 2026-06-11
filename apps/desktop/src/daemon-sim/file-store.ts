/**
 * Daemon-simulator store. Production storage is SQLCipher inside the Rust
 * daemon (apps/desktop/src-tauri/crates/store) — this file-backed TS store
 * exists so the CI-blocking redaction corpus can exercise the full pipeline
 * against REAL persistence paths (files on disk that the deletion verifier
 * walks independently). Node-only: never import from UI code.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObserverEvent, PersistSink, ReviewableStore, ReviewState } from '@nibbin/redaction';
import type { DeletionReceipt, StudySnapshot } from '../core/study-machine.js';

export interface StorePaths {
  root: string;
  eventsFile: string;
  framesDir: string;
  studyFile: string;
}

export class FileObserverStore implements PersistSink, ReviewableStore {
  readonly paths: StorePaths;

  constructor(root: string) {
    this.paths = {
      root,
      eventsFile: join(root, 'events.jsonl'),
      framesDir: join(root, 'frames'),
      studyFile: join(root, 'study.json'),
    };
    mkdirSync(this.paths.framesDir, { recursive: true });
  }

  append(event: ObserverEvent): Promise<void> {
    appendFileSync(this.paths.eventsFile, JSON.stringify(event) + '\n', 'utf8');
    return Promise.resolve();
  }

  putFrame(ref: string, bytes: Uint8Array): void {
    writeFileSync(join(this.paths.framesDir, ref), bytes);
  }

  listEvents(): Promise<ObserverEvent[]> {
    if (!existsSync(this.paths.eventsFile)) return Promise.resolve([]);
    const lines = readFileSync(this.paths.eventsFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
    return Promise.resolve(lines.map((l) => JSON.parse(l) as ObserverEvent));
  }

  async setReviewState(eventIds: string[], state: ReviewState): Promise<void> {
    const ids = new Set(eventIds);
    const events = await this.listEvents();
    const updated = events.map((e) =>
      ids.has(e.id) ? { ...e, redaction: { ...e.redaction, review_state: state } } : e,
    );
    writeFileSync(this.paths.eventsFile, updated.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }

  async purgeEvents(eventIds: string[]): Promise<void> {
    const ids = new Set(eventIds);
    const events = await this.listEvents();
    const kept = events.filter((e) => !ids.has(e.id));
    writeFileSync(
      this.paths.eventsFile,
      kept.length === 0 ? '' : kept.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
  }

  saveStudy(snapshot: StudySnapshot): void {
    writeFileSync(this.paths.studyFile, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  loadStudy(): StudySnapshot | null {
    if (!existsSync(this.paths.studyFile)) return null;
    return JSON.parse(readFileSync(this.paths.studyFile, 'utf8')) as StudySnapshot;
  }

  /**
   * RAW_DELETING: destroy all raw study data — events and frames. The study
   * snapshot file survives (it holds the deletion receipt and no raw data).
   */
  purgeAllRawData(): void {
    rmSync(this.paths.eventsFile, { force: true });
    rmSync(this.paths.framesDir, { recursive: true, force: true });
  }
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Deletion verifier (C3). Deliberately INDEPENDENT of FileObserverStore: it
 * re-walks the store root with raw fs calls and reports anything that is not
 * the study snapshot file. A verified receipt is the only way the state
 * machine will leave RAW_DELETING.
 */
export function verifyRawDataDeleted(root: string, nowIso: string): DeletionReceipt {
  const all = walkFiles(root);
  const residual = all.filter((p) => !p.endsWith('study.json'));
  return {
    verified_at: nowIso,
    checked_paths: [root],
    residual_files: residual,
    verified: residual.length === 0,
  };
}
