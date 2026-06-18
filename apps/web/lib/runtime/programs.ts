import 'server-only';

/**
 * Deterministic specialist programs — one per shop template (§4.6). v0 is
 * model-free by design: drafts are composed from structured provider data
 * with templated language, so LLM COGS stays $0 and no real `generate` ships
 * before the durable frontier-budget store (issue #24). When a model joins,
 * it slots in as a 'specialist_draft' (T1) route behind the same runner —
 * the enforcement around it does not change.
 *
 * Programs are generators the runner drives: they yield read steps, receive
 * quarantined results, and end with one proposed action (a draft). They never
 * touch a connector directly and never see an unquarantined byte.
 */
import {
  digestInboxCleanup,
  digestMorning,
  interpretSpec,
  nudgeOverdueEmail,
  nudgeOverdueInvoice,
  nudgeUnconfirmedEvent,
  replyNewInquiry,
  type AgentSpec,
  type ProgramFn,
} from '@nibbin/runtime';

/** Provider → connection id for the adopting account. */
export type ConnectionMap = Partial<Record<string, string>>;

/* ── Programs ─────────────────────────────────────────────────────────────── */

/**
 * Route a run to its program. A composed spec (`steps[]` present, future
 * Composer output / the Slice-1 proof agent) runs through the declarative
 * interpreter; everything else routes to its hand-written template program,
 * byte-for-byte unchanged. The interpreter yields ProgramSteps the same runner
 * gates — no execution path lives outside the runner either way.
 */
export function buildProgram(spec: AgentSpec, connections: ConnectionMap, nowMs: number): ProgramFn {
  if (spec.steps && spec.steps.length > 0) return interpretSpec(spec, connections, nowMs);
  switch (spec.templateKey) {
    case 'echo':
      return echoProgram(connections, nowMs);
    case 'sweep':
      return sweepProgram(connections, nowMs);
    case 'scribe':
      return scribeProgram(connections, nowMs);
    case 'brief':
      return briefProgram(connections, nowMs);
    case 'tally':
      return tallyProgram(connections, nowMs);
    case 'hopper':
      return hopperProgram(connections, nowMs);
    default:
      throw new Error(`no program for spec (templateKey=${spec.templateKey})`);
  }
}

/**
 * Echo delegates to the SHARED `nudge.overdue-email` primitive implementation
 * (packages/runtime) — the template and the composable primitive are now the
 * SAME code, so a synthesized detect-and-nudge agent behaves byte-for-byte
 * like Echo (parity test in packages/runtime).
 *
 * The "no active gmail connection — pausing politely" guard lives INSIDE the
 * primitive's generator body (nudge-overdue-email.ts), NOT here at factory
 * build time: an eager throw would fire before executeRun creates the run row,
 * propagate out of triggerNibbinRun, and abort the dispatch fan-out loop (the
 * cursor would never advance → re-fires forever; no `failed` run recorded).
 * Delegating to the primitive keeps the throw inside the generator, where
 * executeRun's try/catch records a clean `failed` run.
 */
function echoProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeOverdueEmail({ staleDays: 3 }, connections, nowMs);
}

/**
 * Sweep delegates to the SHARED `digest.inbox-cleanup` PRESENTATION primitive
 * implementation (packages/runtime) — the template and the composable primitive
 * are the SAME code, so a synthesized inbox-cleanup digest behaves byte-for-byte
 * like Sweep (differential parity test). The "no gmail connection" pause lives
 * INSIDE the primitive's generator (Slice-2a P1), not here at build time. It is
 * presentation-only: the yielded draft reads (email.read) + presents — nothing
 * is sent or deleted.
 */
function sweepProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return digestInboxCleanup({ topSenders: 5 }, connections, nowMs);
}

/**
 * Scribe delegates to the SHARED `reply.new-inquiry` primitive implementation
 * (packages/runtime) — the template and the composable primitive are the SAME
 * code, so a synthesized inquiry-reply agent behaves byte-for-byte like Scribe
 * (parity test in packages/runtime). The "no gmail connection" pause lives
 * INSIDE the primitive's generator (Slice-2a P1), not here at build time.
 */
function scribeProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return replyNewInquiry({}, connections, nowMs);
}

/**
 * Brief delegates to the SHARED 3-CONNECTOR `digest.morning` PRESENTATION
 * primitive implementation — byte-for-byte identical to the primitive (the
 * differential parity test drives both). It reads the calendar (gcal), Stripe
 * invoices (stripe), and fresh mail (gmail), then presents one 3-part morning
 * digest. The "no calendar/stripe/gmail connection" pause lives INSIDE the
 * primitive's generator and checks ALL THREE connectors up front (Slice-2a P1).
 * Presentation-only — nothing is sent.
 */
function briefProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return digestMorning({}, connections, nowMs);
}

/**
 * Tally delegates to the SHARED `nudge.overdue-invoice` primitive
 * implementation — byte-for-byte identical to the primitive at its default
 * `minDaysLate=0` (parity test in packages/runtime). The "no stripe connection"
 * pause lives INSIDE the primitive's generator (Slice-2a P1).
 */
function tallyProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeOverdueInvoice({ minDaysLate: 0 }, connections, nowMs);
}

/**
 * Hopper delegates to the SHARED CROSS-RESOURCE `nudge.unconfirmed-event`
 * primitive implementation — byte-for-byte identical at its default
 * `withinDays=7` (parity test in packages/runtime). It reads the calendar and
 * drafts the confirmation email; the "no calendar/gmail connection" pause lives
 * INSIDE the primitive's generator and checks BOTH connectors (Slice-2a P1).
 */
function hopperProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeUnconfirmedEvent({ withinDays: 7 }, connections, nowMs);
}
