/**
 * Which RatingsSource this process serves from.
 *
 * DATABASE_URL decides, and nothing else. Set it and the compendium reads the
 * live store; leave it unset and the app serves the committed sample with zero
 * infrastructure, which is the protocol the rest of this app already follows.
 *
 * There is deliberately no `RATINGS_SOURCE=postgres` opt-in flag beside the
 * URL. A second switch means a deployment that has a database and reads
 * fixtures anyway, silently, and nothing in the response would say so — the
 * exact failure the `DATA_SOURCE` flag on the chain path is one misconfiguration
 * away from. One input, one behaviour.
 *
 * `sourceKind()` is exported so the API can report which of the two answered.
 * A reader looking at a rating is entitled to know whether it came from the
 * store or from a fixture, and asking them to infer it from the numbers is how
 * a demo gets quoted as data.
 */
import type { RatingsSource } from "./ratings-source.js";
import { FixtureRatingsSource } from "./fixture-ratings-source.js";
import { PostgresRatingsSource } from "./postgres-ratings-source.js";

let instance: RatingsSource | null = null;
let kind: "postgres" | "fixture" | null = null;

function databaseUrl(): string {
  return process.env["DATABASE_URL"] ?? "";
}

export function getRatingsSource(): RatingsSource {
  if (instance) return instance;
  const url = databaseUrl();
  if (url !== "") {
    kind = "postgres";
    instance = new PostgresRatingsSource(url);
  } else {
    kind = "fixture";
    instance = new FixtureRatingsSource();
  }
  return instance;
}

/** "postgres" or "fixture", as served. Reported in API meta. */
export function ratingsSourceKind(): "postgres" | "fixture" {
  if (kind === null) getRatingsSource();
  return kind ?? "fixture";
}

/** Drop the memoized source. Tests only; the server holds one for its lifetime. */
export function resetRatingsSource(): void {
  instance = null;
  kind = null;
}
