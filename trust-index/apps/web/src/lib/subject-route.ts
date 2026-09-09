/**
 * Turning a URL back into a SubjectRef.
 *
 * A subject_id is not a slug. The live registry hands out ids like
 * "ai.alpic.alpix/Alpix" and "com.example/mcp/server", so the id itself contains
 * the path separator. A single `[id]` segment silently 404s every one of them,
 * and percent-encoding the slash does not help: the router decodes it before the
 * handler sees it, so "%2F" and "/" arrive identical.
 *
 * So the id is a catch-all and is rejoined here, and the registry sits in front
 * of it as its own segment — the registry is a fixed vocabulary and the id is
 * not, which makes that the only split with no ambiguity in it.
 *
 * The series lives under its own top-level prefix (/api/v1/series/...) rather
 * than as a trailing segment, because a trailing "series" segment would be
 * indistinguishable from a subject whose id ends in "series".
 */
import type { SubjectRef } from "./ratings-source.js";

export type ParsedSubjectRoute =
  | { ok: true; ref: SubjectRef }
  | { ok: false; message: string };

export function parseSubjectRoute(params: {
  kind: string;
  registry: string;
  subject_id: string[] | string | undefined;
}): ParsedSubjectRoute {
  const kind = params.kind.trim();
  const registry = params.registry.trim();
  const segments = Array.isArray(params.subject_id)
    ? params.subject_id
    : params.subject_id === undefined
      ? []
      : [params.subject_id];
  const subject_id = segments.join("/").trim();

  if (kind === "") return { ok: false, message: "kind is required" };
  if (registry === "") return { ok: false, message: "registry is required" };
  if (subject_id === "") return { ok: false, message: "subject_id is required" };
  return { ok: true, ref: { kind, source_registry: registry, subject_id } };
}

/** The path this app serves a subject at, with each segment encoded exactly once. */
export function subjectPath(ref: SubjectRef): string {
  const id = ref.subject_id.split("/").map(encodeURIComponent).join("/");
  return `/subject/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.source_registry)}/${id}`;
}

/** Query parsing shared by the listing routes. Unknown values fall back rather than 400. */
export function parseListParams(url: URL): {
  state: "all" | "scored" | "withheld";
  order: "composite_desc" | "composite_asc" | "subject_asc" | "day_desc";
  limit: number | null;
  cursor: string | null;
  profile_id: string | undefined;
  source_registry: string | undefined;
  through_day: string | undefined;
} {
  const state = url.searchParams.get("state");
  const order = url.searchParams.get("order");
  const limitRaw = url.searchParams.get("limit");
  const day = url.searchParams.get("through_day");
  const registry = url.searchParams.get("registry");
  const profile = url.searchParams.get("profile_id");

  return {
    state: state === "scored" || state === "withheld" ? state : "all",
    order:
      order === "composite_asc" || order === "subject_asc" || order === "day_desc"
        ? order
        : "composite_desc",
    limit: limitRaw === null ? null : Number(limitRaw),
    cursor: url.searchParams.get("cursor"),
    profile_id: profile ?? undefined,
    source_registry: registry ?? undefined,
    // Only an exact UTC day is accepted. A malformed one is dropped rather than
    // coerced, because coercing it would silently move the window a reader
    // asked for.
    through_day: day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined,
  };
}
