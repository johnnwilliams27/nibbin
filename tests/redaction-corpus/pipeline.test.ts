/**
 * Redaction corpus — pipeline assertions (M6). CI-blocking and P0.
 *
 * These attach the skill's seven sentinel assertions to the REAL Observer
 * code: the @nibbin/redaction 4-layer pipeline and the daemon simulator in
 * apps/desktop/src/daemon-sim (the TS twin of the Rust observerd daemon;
 * the Rust crates run these same fixtures in cargo tests).
 *
 *   1. Zero sentinels in the persisted store after the full 4-layer pipeline.
 *   2. Zero sentinels in any synthesis packet.
 *   3. Secure-field fixtures (C4): no value, no label, no frame — at capture.
 *   4. Category-blocklist fixtures (C5): zero persisted events.
 *   5. Fail-closed: NER sidecar down ⇒ persistence blocked, pipeline halts.
 *   6. Deletion: after RAW_DELETING the verifier proves store emptiness;
 *      this test walks the paths independently.
 *   7. Day-14 stop: daemon-level enforcement fires with no UI in-process
 *      (static import-graph proof + behavioral restart-past-deadline proof;
 *      the OS-process-level twin lives in the Rust study crate's tests).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  buildSynthesisPacket,
  deleteBlock,
  DownNer,
  HeuristicNer,
  snapshotToRawEvents,
  toObservation,
  type AxSnapshot,
} from '@nibbin/redaction';
import { ObserverDaemon } from '../../apps/desktop/src/daemon-sim/daemon.js';
import { verifyRawDataDeleted } from '../../apps/desktop/src/daemon-sim/file-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

const registry = JSON.parse(readFileSync(join(fixturesDir, 'sentinels.json'), 'utf8')) as {
  sentinels: Record<string, { kind: string; value: string }>;
};
const sentinelValues = Object.values(registry.sentinels).map((s) => s.value);

/** Load a fixture and seed it: sentinel ids are replaced with their VALUES. */
function loadSeededFixture(name: string): { snapshot: AxSnapshot; expectations: Record<string, unknown> } {
  let text = readFileSync(join(fixturesDir, name), 'utf8');
  for (const [id, entry] of Object.entries(registry.sentinels)) {
    text = text.replaceAll(id, entry.value);
  }
  const fixture = JSON.parse(text) as {
    window: { app: string; title: string; category?: string };
    axTree: AxSnapshot['axTree'];
    expectations: Record<string, unknown>;
  };
  return {
    snapshot: {
      window: {
        app: fixture.window.app,
        bundleId: `corpus.${fixture.window.app.toLowerCase()}`,
        title: fixture.window.title,
        ...(fixture.window.category !== undefined ? { category: fixture.window.category } : {}),
      },
      axTree: fixture.axTree,
      frameRef: 'frame_corpus_blob',
    },
    expectations: fixture.expectations,
  };
}

function expectNoSentinels(text: string, where: string): void {
  for (const value of sentinelValues) {
    expect(text.includes(value), `${where} leaks sentinel "${value}"`).toBe(false);
  }
}

/** Fake clock the corpus controls; the daemon never reads the real time. */
function clockAt(iso: string): { now: () => string; set: (next: string) => void } {
  let current = iso;
  return { now: () => current, set: (next) => (current = next) };
}

const T0 = '2026-06-10T08:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(new Date(T0).getTime() + days * DAY).toISOString();

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), 'nibbin-corpus-'));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function startedDaemon(clock: () => string, ner = new HeuristicNer()): ObserverDaemon {
  const daemon = new ObserverDaemon({ storeRoot, ner, clock, studyId: 'study_corpus' });
  daemon.consent();
  daemon.start();
  return daemon;
}

describe('assertion 1+2 — zero sentinels in store and synthesis packet (full 4-layer run)', () => {
  it('persists events from sentinel-seeded fixtures with zero sentinel leakage', async () => {
    const clock = clockAt(T0);
    const daemon = startedDaemon(clock.now);

    const basic = loadSeededFixture('ax-tree-basic.json');
    const secure = loadSeededFixture('secure-field-c4.json');
    clock.set(at(1));
    const r1 = await daemon.captureSnapshot(basic.snapshot, 'ses_day1');
    clock.set(at(2));
    const r2 = await daemon.captureSnapshot(secure.snapshot, 'ses_day2');
    expect([...r1, ...r2].every((r) => r.action === 'persisted')).toBe(true);

    // layer 4: a user review pass runs too — delete one block, keep the rest
    const events = await daemon.store.listEvents();
    expect(events.length).toBeGreaterThanOrEqual(6);
    await deleteBlock(daemon.store, { eventIds: [events[0]!.id] });

    // assertion 1: raw store bytes contain no sentinel value
    const storeBytes = readFileSync(daemon.store.paths.eventsFile, 'utf8');
    expectNoSentinels(storeBytes, 'persisted store');

    // the redaction is structural, not accidental: known templates survive
    const persisted = await daemon.store.listEvents();
    const fromBasic = persisted.find((e) => e.session === 'ses_day1');
    expect(fromBasic!.window.title_redacted).toBe('Invoice from {PERSON}');

    // assertion 2: the synthesis packet — the ONLY exportable artifact —
    // carries no sentinels either, and survives a gzip round-trip intact.
    const packet = await buildSynthesisPacket('study_corpus', persisted, at(14));
    expectNoSentinels(packet.jsonl, 'synthesis packet');
    expect(packet.jsonl).not.toContain('frame_corpus_blob');
    const roundTrip = gunzipSync(gzipSync(Buffer.from(packet.jsonl, 'utf8'))).toString('utf8');
    expect(roundTrip).toBe(packet.jsonl);
  });
});

describe('assertion 3 — C4 secure fields: no value, no label, no frame, at capture', () => {
  it('the secure node never enters a raw event with content', async () => {
    const { snapshot, expectations } = loadSeededFixture('secure-field-c4.json');
    expect(expectations['secureFieldCaptured']).toBe(false);

    // at capture: the raw observation itself is content-free
    const raw = snapshotToRawEvents(snapshot, 'ses_c4');
    const secureRaw = raw.filter((e) => e.ax?.secureSuppressed === true);
    expect(secureRaw).toHaveLength(1);
    const serialized = JSON.stringify(secureRaw[0]);
    expectNoSentinels(serialized, 'raw secure observation');
    expect(serialized).not.toContain('Password');
    expect(secureRaw[0]!.frameRef).toBeNull();

    // toObservation is the single constructor — a secure AX node yields a
    // shape with no value or label property at the type AND runtime level
    const obs = toObservation({ role: 'textbox', secure: true, label: 'x', value: 'y' }, 'window/textbox');
    expect(Object.keys(obs).sort()).toEqual(['action', 'rolePath', 'secureSuppressed']);

    // and after the full pipeline the persisted event carries the constant
    const clock = clockAt(at(1));
    const daemon = startedDaemon(clock.now);
    await daemon.captureSnapshot(snapshot, 'ses_c4');
    const persisted = await daemon.store.listEvents();
    const secureEvent = persisted.find((e) => e.ax?.label_redacted === '{SECURE}');
    expect(secureEvent).toBeDefined();
    expect(secureEvent!.frame_ref).toBeNull();
    expect(secureEvent!.ax!.value_class).toBe('none');
  });
});

describe('assertion 4 — C5 category blocklist: zero persisted events', () => {
  it('a blocked-category window records nothing at all', async () => {
    const { snapshot, expectations } = loadSeededFixture('blocklist-c5.json');
    expect(expectations['persistedEvents']).toBe(0);

    const clock = clockAt(at(1));
    const daemon = startedDaemon(clock.now);
    const results = await daemon.captureSnapshot(snapshot, 'ses_c5');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.action === 'blocked_category')).toBe(true);

    expect(await daemon.store.listEvents()).toHaveLength(0);
    // not even a gap or residue file — the events file was never created
    expect(existsSync(daemon.store.paths.eventsFile)).toBe(false);
  });
});

describe('assertion 5 — fail-closed when the NER sidecar is down', () => {
  it('blocks persistence entirely and stays halted (regex layer still ran)', async () => {
    const clock = clockAt(at(1));
    // a daemon whose NER sidecar is dead from the start
    const dead = new ObserverDaemon({ storeRoot, ner: new DownNer(), clock: clock.now });
    dead.consent();
    dead.start();

    const { snapshot } = loadSeededFixture('ax-tree-basic.json');
    const first = await dead.captureSnapshot(snapshot, 'ses_down');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((r) => r.action === 'halted_ner_unavailable')).toBe(true);
    expect(dead.pipeline.halted).toBe(true);

    // halting is sticky: later captures persist nothing either
    const second = await dead.captureSnapshot(snapshot, 'ses_down');
    expect(second.every((r) => r.action === 'halted_ner_unavailable')).toBe(true);

    expect(await dead.store.listEvents()).toHaveLength(0);
    expect(existsSync(dead.store.paths.eventsFile)).toBe(false);
  });
});

describe('assertion 6 — verified deletion after RAW_DELETING', () => {
  it('the verifier proves emptiness and this test re-walks the paths itself', async () => {
    const clock = clockAt(at(1));
    const daemon = startedDaemon(clock.now);
    const { snapshot } = loadSeededFixture('ax-tree-basic.json');
    await daemon.captureSnapshot(snapshot, 'ses_del');
    daemon.store.putFrame('frame_corpus_blob', new Uint8Array([1, 2, 3]));
    expect((await daemon.store.listEvents()).length).toBeGreaterThan(0);

    clock.set(at(15.5)); // study started at day 1 ⇒ deadline is day 15
    expect(daemon.tick()).toBe(true); // day-14 stop → REVIEW
    daemon.finishReview();
    daemon.synthesisComplete();
    expect(daemon.snapshot.state).toBe('RAW_DELETING');
    daemon.deleteRawDataAndVerify();

    expect(daemon.snapshot.state).toBe('COMPLETE');
    const receipt = daemon.snapshot.deletionReceipt!;
    expect(receipt.verified).toBe(true);
    expect(receipt.residual_files).toEqual([]);

    // independent walk — raw fs, not the store's verifier
    const walk = (dir: string, out: string[] = []): string[] => {
      if (!existsSync(dir)) return out;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    const residual = walk(storeRoot).filter((p) => !p.endsWith('study.json'));
    expect(residual).toEqual([]);
    // and the surviving study snapshot itself carries no sentinels
    expectNoSentinels(readFileSync(daemon.store.paths.studyFile, 'utf8'), 'study snapshot');
  });

  it('the verifier itself refuses residue', () => {
    writeFileSync(join(storeRoot, 'events.jsonl'), '{"leftover":true}\n', 'utf8');
    const receipt = verifyRawDataDeleted(storeRoot, at(15));
    expect(receipt.verified).toBe(false);
    expect(receipt.residual_files).toHaveLength(1);
  });
});

describe('assertion 7 — day-14 stop is daemon-level, no UI in the process', () => {
  it('static proof: the daemon import graph reaches no UI module', () => {
    const desktopSrc = join(here, '..', '..', 'apps', 'desktop', 'src');
    const visit = (file: string, seen: Set<string>): void => {
      if (seen.has(file) || !existsSync(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      expect(text.includes('/ui/'), `${file} reaches UI code`).toBe(false);
      expect(text.includes('@tauri-apps'), `${file} reaches the Tauri webview API`).toBe(false);
      for (const m of text.matchAll(/from '(\.[^']+)\.js'/g)) {
        visit(join(dirname(file), `${m[1]!}.ts`), seen);
      }
    };
    visit(join(desktopSrc, 'daemon-sim', 'daemon.ts'), new Set());
  });

  it('behavioral proof: a daemon waking past the deadline stops the study before any capture', async () => {
    // Day 1: a study starts and captures normally; then the "machine sleeps"
    // and every process dies — including any UI.
    {
      const clock = clockAt(at(0));
      const daemon = startedDaemon(clock.now);
      clock.set(at(1));
      await daemon.captureSnapshot(loadSeededFixture('ax-tree-basic.json').snapshot, 'ses_before');
      expect(daemon.snapshot.state).toBe('ACTIVE');
    }

    // Day 15: a FRESH daemon instance (no UI ever constructed, no carryover
    // in-memory state) reloads the persisted study and must hard-stop on the
    // first heartbeat — and refuse capture from then on.
    const clock = clockAt(at(15));
    const reborn = new ObserverDaemon({ storeRoot, ner: new HeuristicNer(), clock: clock.now });
    expect(reborn.snapshot.state).toBe('ACTIVE'); // as persisted
    expect(reborn.tick()).toBe(true);
    expect(reborn.snapshot.state).toBe('REVIEW');
    expect(reborn.snapshot.stoppedBy).toBe('day14_daemon');
    expect(reborn.countdownMs).toBe(0);

    const before = (await reborn.store.listEvents()).length;
    const results = await reborn.captureSnapshot(loadSeededFixture('ax-tree-basic.json').snapshot, 'ses_after');
    expect(results).toEqual([]);
    expect((await reborn.store.listEvents()).length).toBe(before);

    // the stop decision is durable: yet another restart still sees REVIEW
    const again = new ObserverDaemon({ storeRoot, ner: new HeuristicNer(), clock: clock.now });
    expect(again.snapshot.state).toBe('REVIEW');
  });
});
