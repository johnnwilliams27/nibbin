/** Fixture manifest types. Fixtures are the cross-track interface (SPEC §18.0). */

export type FixtureCase = {
  /** Snapshot file under fixtures/snapshots/, e.g. "thin-same-day-cohort.json". */
  snapshot: string;
  /** Golden ScoreResult under fixtures/golden/ once Track B commits it; null until then. */
  golden: string | null;
  /** What the case exercises; which SPEC section it pins. */
  covers: string;
  /** Assertions every consumer can rely on regardless of exact numbers. */
  invariants: string[];
};

export type FixtureManifest = {
  manifest_version: "1";
  cases: Record<string, FixtureCase>;
};
