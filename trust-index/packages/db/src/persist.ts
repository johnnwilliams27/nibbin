/**
 * One scored subject, landed: its identity, its evidence, its gaps, and the
 * day's snapshot.
 *
 * Until now nothing wrote to any of these tables. The collector produced JSON
 * files on disk and the scoring ran in-process, so `observations`,
 * `assessment_gaps` and the rest existed as a schema nobody had exercised. This
 * is the bridge, and it is deliberately one function: a snapshot whose
 * observations were not stored cannot be reproduced, and observations stored
 * without the snapshot that used them are just a pile of readings. Writing them
 * apart would let a run half-fail into a state where the two disagree.
 */
import { eq } from "drizzle-orm";
import type { Subject, SubjectScoreResult } from "@trust-index/types";
import type { Db } from "./client.js";
import {
  assessment_gaps,
  collection_runs,
  observations,
  observers,
  subject_observers,
  subjects,
} from "./schema.js";
import { writeDailySnapshot } from "./ratings.js";

export type PersistArgs = {
  subject: Subject;
  result: SubjectScoreResult;
  /** The UTC day this run belongs to. Not derived from the clock here — the job owns that. */
  utc_day: string;
  run_id: string;
};

/**
 * Text that Postgres will actually accept.
 *
 * A `text` column cannot hold a NUL byte — Postgres rejects the whole statement,
 * not the character — and several of these fields are built from a SUBJECT'S OWN
 * BYTES. A server answering with a gzip body we then try to JSON.parse produces
 * `Unexpected token '\x1f', "\x1f\x8b\x08\x00\x00..."`, and that error text goes
 * into a gap's `detail`.
 *
 * Measured: exactly that dropped `shop.tier1/tier1-shop` from a 15,043-subject
 * run. The whole subject vanished — identity, evidence and snapshot — because
 * one diagnostic string had a control byte in it. That is a subject deleted from
 * the compendium by the shape of its own error message, which is the same class
 * of bug as reading "I could not obtain it" as "it is not there".
 *
 * NUL is removed; the other C0 controls are escaped rather than dropped so the
 * detail still reads as the bytes that came back. Nothing here is scored — these
 * are diagnostic strings — so this cannot change a rating, only whether it lands.
 */
function pgText(v: string): string;
function pgText(v: string | null | undefined): string | null;
function pgText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  // eslint-disable-next-line no-control-regex
  return v.replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, (c) =>
    `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

/**
 * The same cleaning, applied to every string anywhere in a value.
 *
 * The gap tables are not the only place a subject's bytes land: the same detail
 * string is embedded in `frame_json` and `result_json`, and jsonb rejects a NUL
 * exactly as `text` does. Cleaning the two objects once, here, is what makes the
 * whole write safe — sanitising the columns one at a time fixed the gap insert
 * and then failed on the snapshot two statements later.
 */
function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return pgText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeDeep(v);
    return out as unknown as T;
  }
  return value;
}

/**
 * Everything a run learned about one subject, in a single transaction.
 *
 * The transaction boundary is the point. A row in `rating_results` whose
 * `inputs_hash` covers observations that failed to land is a rating nobody can
 * check, and it would look exactly like a good one.
 */
export async function persistScoredSubject(db: Db, a: PersistArgs): Promise<void> {
  // Cleaned ONCE, at the boundary, before anything is written. See sanitizeDeep:
  // the same subject-supplied string reaches a text column, a jsonb frame and the
  // result payload, and every one of them rejects a NUL.
  const s = sanitizeDeep(a.subject);
  const result = sanitizeDeep(a.result);
  const key = { kind: s.kind, source_registry: s.source.registry, subject_id: s.subject_id };
  const now = new Date();
  const asOf = new Date(s.as_of_ts);

  await db.transaction(async (tx) => {
    // Identity. Current-state, so upsert: a subject that changed its URL or
    // moved profile is the same subject.
    const subjectRow = {
      ...key,
      source_ref: s.source.ref,
      source_url: s.source.url,
      profile_id: s.profile_id,
      rubric_version: s.rubric_version,
      first_seen_ts: new Date(s.first_seen_ts),
      last_active_ts: s.last_active_ts === null ? null : new Date(s.last_active_ts),
      reachable: s.reachable,
      tags: s.tags,
      independence_group: s.independence_group,
      priors_json: s.priors,
      constants_json: s.constants,
      as_of_ts: asOf,
      updated_at: now,
    };
    await tx
      .insert(subjects)
      .values(subjectRow)
      .onConflictDoUpdate({
        target: [subjects.kind, subjects.source_registry, subjects.subject_id],
        set: subjectRow,
      });

    for (const o of Object.values(s.observers)) {
      const row = {
        observer_id: o.observer_id,
        observer_kind: o.observer_kind,
        first_seen_ts: new Date(o.first_seen_ts),
        total_observations: o.total_observations,
        distinct_subjects: o.distinct_subjects,
        max_observations_single_day: o.max_observations_single_day,
        independence_group: o.independence_group,
        concentration: o.concentration,
        updated_at: now,
      };
      await tx
        .insert(observers)
        .values(row)
        .onConflictDoUpdate({ target: observers.observer_id, set: row });

      // has_interaction_with_subject is a fact about the PAIR, not the
      // observer, and it up-weights the observation — so it lives here or the
      // rebuild is wrong. first_observed_ts must not move on re-runs.
      await tx
        .insert(subject_observers)
        .values({
          ...key,
          observer_id: o.observer_id,
          has_interaction_with_subject: o.has_interaction_with_subject,
          first_observed_ts: asOf,
          last_observed_ts: asOf,
        })
        .onConflictDoUpdate({
          target: [
            subject_observers.kind,
            subject_observers.source_registry,
            subject_observers.subject_id,
            subject_observers.observer_id,
          ],
          set: {
            has_interaction_with_subject: o.has_interaction_with_subject,
            last_observed_ts: asOf,
          },
        });
    }

    // Evidence. The primary key is the engine's own dedupe key, so re-running a
    // day is idempotent and tomorrow's run of the same check lands a new row —
    // which is what lets the confidence model see N distinct days.
    if (s.observations.length > 0) {
      await tx
        .insert(observations)
        .values(
          s.observations.map((o) => ({
            ...key,
            observer_id: o.observer_id,
            dimension: o.dimension,
            observation_key: o.observation_key,
            ts: new Date(o.ts),
            provenance: o.provenance,
            value: o.value,
            evidence_ref: o.evidence_ref,
            run_id: a.run_id,
          })),
        )
        .onConflictDoNothing();
    }

    if (s.gaps.length > 0) {
      await tx
        .insert(assessment_gaps)
        .values(
          s.gaps.map((g) => ({
            ...key,
            as_of_ts: asOf,
            dimension: g.dimension,
            check: g.check,
            cause: g.cause,
            capability: g.capability,
            detail: g.detail,
            run_id: a.run_id,
          })),
        )
        .onConflictDoNothing();
    }
  });

  // The snapshot, in its own transaction because it manages its own
  // delete-then-insert of the dimension rows.
  await writeDailySnapshot(db, {
    ...key,
    utc_day: a.utc_day,
    result,
    // The Subject MINUS its observations: they are already in `observations`
    // and the day selects exactly the ones that entered this score. What is
    // kept is everything that is current-state elsewhere and would otherwise
    // reproduce as today's values.
    frame: {
      subject_version: s.subject_version,
      kind: s.kind,
      subject_id: s.subject_id,
      source: s.source,
      profile_id: s.profile_id,
      rubric_version: s.rubric_version,
      as_of_ts: s.as_of_ts,
      first_seen_ts: s.first_seen_ts,
      last_active_ts: s.last_active_ts,
      reachable: s.reachable,
      tags: s.tags,
      independence_group: s.independence_group,
      priors: s.priors,
      constants: s.constants,
      observers: s.observers,
      gaps: s.gaps,
    },
    observation_count: s.observations.length,
    rubric_version: s.rubric_version,
    run_id: a.run_id,
  });
}

/**
 * The run ledger.
 *
 * `run_id` is the collector plus the UTC day, so a day cannot be started twice
 * under two identities and then counted twice. Re-running a day reopens the
 * same row: status back to `running`, counters back to zero, `finished_at` and
 * `error` cleared. A retry that inherited the failed run's counters would
 * double-count everything it re-wrote.
 */
export function dailyRunId(collector: string, utcDay: string): string {
  return `${collector}:${utcDay}`;
}

export async function startRun(
  db: Db,
  r: { collector: string; utc_day: string; detail?: unknown },
): Promise<string> {
  const run_id = dailyRunId(r.collector, r.utc_day);
  const started_at = new Date();
  const fresh = {
    status: "running",
    started_at,
    finished_at: null,
    error: null,
    subjects_seen: 0,
    observations_written: 0,
    gaps_written: 0,
    results_published: 0,
    results_withheld: 0,
    subjects_failed: 0,
    detail_json: r.detail ?? null,
  };
  await db
    .insert(collection_runs)
    .values({ run_id, collector: r.collector, utc_day: r.utc_day, ...fresh })
    .onConflictDoUpdate({ target: collection_runs.run_id, set: fresh });
  return run_id;
}

export type RunCounters = {
  subjects_seen: number;
  observations_written: number;
  gaps_written: number;
  results_published: number;
  results_withheld: number;
  subjects_failed: number;
};

/**
 * Close a run.
 *
 * A run that hit an unrecoverable error is `failed` and keeps whatever it had
 * written — the rows are real observations and deleting them would discard
 * evidence because the process died afterwards. What a failed run must NOT do
 * is prune: see the job.
 */
export async function finishRun(
  db: Db,
  run_id: string,
  outcome: { status: "succeeded" | "failed"; error?: string | null; counters: RunCounters; detail?: unknown },
): Promise<void> {
  await db
    .update(collection_runs)
    .set({
      status: outcome.status,
      finished_at: new Date(),
      error: outcome.error ?? null,
      ...outcome.counters,
      ...(outcome.detail === undefined ? {} : { detail_json: outcome.detail }),
    })
    .where(eq(collection_runs.run_id, run_id));
}
