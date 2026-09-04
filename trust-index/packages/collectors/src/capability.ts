/**
 * Capabilities: what the harness needs in order to run a test, and whether it
 * actually has it right now.
 *
 * The principle this file exists to enforce, and it has no exceptions:
 *
 *   A GAP IN OUR HARNESS IS NEVER A FINDING ABOUT A SUBJECT.
 *
 * Testing other people's software means most tests need something on our side:
 * an account on a platform, a funded testnet wallet, a scoped token, a mailbox
 * we can read. Every one of those can be missing, expired, revoked, drained or
 * rate limited. When that happens the test does not run, and the temptation is
 * to record a missing result the same way we record a failed one.
 *
 * That would be the ninth instance of the error that has cost this project
 * more than any other: reading "I could not obtain the data" as "the data is
 * not there". The previous eight were internal and produced wrong numbers in a
 * research note. This one would point outward and publish our operational
 * failures as other people's ratings.
 *
 * So the flow is: declare what a test needs, check health BEFORE touching the
 * subject, and when something is missing emit an AssessmentGap with a harness
 * cause. The engine is built to refuse to score those.
 *
 * Health is checked up front rather than discovered by failure. A testnet
 * wallet running dry mid-run would otherwise produce a hundred subjects with
 * one real result and ninety-nine phantom ones, and the phantoms would look
 * exactly like real failures.
 */
import type { AssessmentGap } from "@trust-index/types";

/**
 * A thing the harness must possess for some tests to run. Deliberately
 * coarse: the unit is "the account or credential a human would have to go and
 * create", because that is the unit of work in fixing a gap.
 */
export type CapabilityId = string;

/** Capabilities the MCP battery knows about. Extended as sandboxes are added. */
export const CAPABILITIES = {
  /** No credential needed. Calling a public read-only tool. */
  none: "none",
  /**
   * An account or token for a specific MCP server that refuses anonymous
   * clients. The largest single capability gap by a wide margin: 48% of a
   * 200-server sample returned HTTP 401. Unlike the sandboxes below, this is
   * not one account that unlocks many subjects; it is potentially one per
   * operator, which is why it needs its own provisioning strategy rather than
   * a line in the same queue.
   */
  mcp_account: "mcp_account",
  /** A mailbox we own and can read, with a catch-all domain for unique addresses. */
  mailbox: "mailbox",
  /** Outbound SMS to a number we own. */
  sms: "sms",
  /** A throwaway git repository we can write to and inspect. */
  repo_sandbox: "repo_sandbox",
  /** A database we own, with before-and-after snapshotting. */
  database_sandbox: "database_sandbox",
  /** Object storage we own. */
  object_store_sandbox: "object_store_sandbox",
  /** Funded testnet wallets, at least two, for round-trip transfers. */
  testnet_wallet: "testnet_wallet",
  /** Mainnet wallets holding a small capped balance, for tools with no testnet. */
  mainnet_wallet: "mainnet_wallet",
  /** A chat workspace we control. */
  chat_sandbox: "chat_sandbox",
  /** An isolated executor for code-execution tools. */
  exec_sandbox: "exec_sandbox",
  /** Reference data sources for public-ground-truth checks. */
  reference_data: "reference_data",
  /**
   * A model to judge meaning with. Wiring one is a capability like any other,
   * so lacking it makes every judged check a harness gap rather than a
   * failure, and a run without it is honestly reported as incomplete instead
   * of quietly scoring subjects on structure alone.
   */
  judge_model: "judge_model",
} as const;

export type CapabilityHealth =
  | { available: true }
  /** We never provisioned it. Fix by creating the account. */
  | { available: false; reason: "not_provisioned"; detail: string }
  /** We have it and it is not usable. Fix urgently: it blocks every subject that needs it. */
  | { available: false; reason: "expired" | "exhausted" | "rate_limited" | "revoked" | "unreachable"; detail: string };

/**
 * A capability's current state. `check` is async because establishing health
 * usually means asking something: a balance, a token introspection, a quota.
 */
export type CapabilityProbe = {
  id: CapabilityId;
  /** One line for the defect report: what a human has to do to provide this. */
  provisioning_note: string;
  check: () => Promise<CapabilityHealth>;
};

export type CapabilityReport = {
  id: CapabilityId;
  health: CapabilityHealth;
  provisioning_note: string;
};

/**
 * Check every capability once, before a run touches any subject.
 *
 * Deliberately not lazy and not cached across runs. A capability that was fine
 * an hour ago can be revoked, and the cost of one balance check per run is
 * nothing against the cost of a run that silently produced phantom failures.
 */
export async function preflight(probes: readonly CapabilityProbe[]): Promise<Map<CapabilityId, CapabilityReport>> {
  const out = new Map<CapabilityId, CapabilityReport>();
  for (const p of probes) {
    let health: CapabilityHealth;
    try {
      health = await p.check();
    } catch (err) {
      // A probe that throws is an unhealthy capability, not a crashed run.
      health = {
        available: false,
        reason: "unreachable",
        detail: err instanceof Error ? err.message.slice(0, 160) : "capability check threw",
      };
    }
    out.set(p.id, { id: p.id, health, provisioning_note: p.provisioning_note });
  }
  return out;
}

/** What one check needs in order to run. */
export type TestRequirement = {
  dimension: string;
  /** Matches the observation_key the check would have produced. */
  check: string;
  requires: readonly CapabilityId[];
};

/**
 * Split a battery into the checks we can run and the gaps we cannot, given
 * what preflight found. A capability absent from the report is treated as not
 * provisioned rather than as available: silence is not consent here either.
 */
export function planBattery(
  requirements: readonly TestRequirement[],
  capabilities: ReadonlyMap<CapabilityId, CapabilityReport>,
): { runnable: TestRequirement[]; gaps: AssessmentGap[] } {
  const runnable: TestRequirement[] = [];
  const gaps: AssessmentGap[] = [];
  for (const req of requirements) {
    let blocker: { capability: CapabilityId; report: CapabilityReport | undefined } | null = null;
    for (const id of req.requires) {
      if (id === CAPABILITIES.none) continue;
      const report = capabilities.get(id);
      if (report === undefined || !report.health.available) {
        blocker = { capability: id, report };
        break;
      }
    }
    if (blocker === null) {
      runnable.push(req);
      continue;
    }
    const report = blocker.report;
    if (report === undefined) {
      gaps.push({
        dimension: req.dimension,
        check: req.check,
        cause: "harness_capability_missing",
        capability: blocker.capability,
        detail: `capability ${blocker.capability} was never provisioned`,
      });
      continue;
    }
    const health = report.health as Extract<CapabilityHealth, { available: false }>;
    gaps.push({
      dimension: req.dimension,
      check: req.check,
      // "not_provisioned" is a missing capability; everything else is one we
      // have that has stopped working, which is usually the more urgent of the
      // two because it degrades silently.
      cause: health.reason === "not_provisioned" ? "harness_capability_missing" : "harness_capability_unhealthy",
      capability: blocker.capability,
      detail: `${blocker.capability}: ${health.reason}, ${health.detail}`,
    });
  }
  return { runnable, gaps };
}

/** One line of the harness defect report. */
export type HarnessDefect = {
  capability: CapabilityId;
  reason: string;
  detail: string;
  provisioning_note: string;
  /** How many subjects this blocked in the run. The severity ranking. */
  subjects_blocked: number;
  /** How many individual checks it blocked. */
  checks_blocked: number;
  /** Dimensions left unassessed because of it, sorted. */
  dimensions_affected: string[];
  severity: "critical" | "high" | "medium" | "low";
};

/**
 * Roll a run's gaps into a work queue, ranked by how much of the compendium
 * each defect is costing us.
 *
 * Severity is by blast radius, not by how the failure feels. A revoked token
 * blocking eight thousand subjects outranks a missing niche account blocking
 * three, however alarming "revoked" sounds on its own. The point of the report
 * is to say what to fix first.
 */
export function harnessDefects(
  gapsBySubject: ReadonlyMap<string, readonly AssessmentGap[]>,
  capabilities: ReadonlyMap<CapabilityId, CapabilityReport>,
  totalSubjects: number,
): HarnessDefect[] {
  type Acc = { subjects: Set<string>; checks: number; dimensions: Set<string>; reason: string; detail: string };
  const byCapability = new Map<CapabilityId, Acc>();

  for (const [subjectId, gaps] of gapsBySubject) {
    for (const g of gaps) {
      if (g.cause !== "harness_capability_missing" && g.cause !== "harness_capability_unhealthy") continue;
      const id = g.capability ?? "(unattributed)";
      const acc = byCapability.get(id) ?? {
        subjects: new Set<string>(),
        checks: 0,
        dimensions: new Set<string>(),
        reason: g.cause === "harness_capability_missing" ? "not_provisioned" : "unhealthy",
        detail: g.detail,
      };
      acc.subjects.add(subjectId);
      acc.checks += 1;
      acc.dimensions.add(g.dimension);
      byCapability.set(id, acc);
    }
  }

  const out: HarnessDefect[] = [];
  for (const [capability, acc] of byCapability) {
    const share = totalSubjects === 0 ? 0 : acc.subjects.size / totalSubjects;
    const severity: HarnessDefect["severity"] =
      share >= 0.5 ? "critical" : share >= 0.2 ? "high" : share >= 0.05 ? "medium" : "low";
    out.push({
      capability,
      reason: acc.reason,
      detail: acc.detail,
      provisioning_note: capabilities.get(capability)?.provisioning_note ?? "unknown capability",
      subjects_blocked: acc.subjects.size,
      checks_blocked: acc.checks,
      dimensions_affected: [...acc.dimensions].sort(),
      severity,
    });
  }
  // Worst first, so the report reads as a work queue.
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.subjects_blocked - a.subjects_blocked);
  return out;
}

/**
 * Subjects to re-test once a capability is repaired.
 *
 * The other half of the principle. Recording a gap honestly is not enough: an
 * un-retested subject stays permanently under-assessed, and its rating stays
 * quietly wrong in our favour rather than theirs. Fixing a credential has to
 * put every subject it blocked back in the queue.
 */
export function subjectsBlockedBy(
  gapsBySubject: ReadonlyMap<string, readonly AssessmentGap[]>,
  capability: CapabilityId,
): string[] {
  const out: string[] = [];
  for (const [subjectId, gaps] of gapsBySubject) {
    const blocked = gaps.some(
      (g) =>
        g.capability === capability &&
        (g.cause === "harness_capability_missing" || g.cause === "harness_capability_unhealthy"),
    );
    if (blocked) out.push(subjectId);
  }
  return out.sort();
}
