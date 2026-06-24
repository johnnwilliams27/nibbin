/**
 * Product event taxonomy — SPEC §6.12, instrumented from day one.
 *
 * Events land in public.product_events (our own Postgres; cookieless,
 * privacy-respecting — no third-party analytics). Emission goes through the
 * emit_product_event RPC (membership-checked for authenticated callers) or
 * the service role for runtime/system events.
 */

export const PRODUCT_EVENT_NAMES = [
  'account_created',
  'connector_linked',
  'scan_completed',
  /** Triggers the Keeper interview fallback (§6.12 cold start). */
  'scan_empty',
  'nibbin_adopted',
  /** The Day-One "aha" — TTFAD north star measures to this. */
  'first_draft_approved',
  'run_approved',
  'run_edited',
  'run_rejected',
  'stage_promoted',
  'stage_demoted',
  'study_started',
  'study_completed',
  'study_aborted',
  'diagnosis_viewed',
  'plan_upgraded',
  'topup_purchased',
  /** Fleet-learning: the Composer wanted a capability it can't provide. */
  'capability_unfulfilled',
  /** Fleet-learning: a run couldn't proceed due to a connector blocker. */
  'connector_blocked',
  /**
   * Task 5a: the re-nudge ledger WRITE failed after a send executed. A SUSTAINED
   * failure (writes down, reads up) would let the cadence/count cap silently
   * reset and resume per-tick spam, so this is alarmed (not just logged) for
   * observability. Props: { resourceKind } only — no PII, no resource id.
   */
  'nudge_record_failed',
] as const;

export type StaticProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/** Drip beats are dynamic per §4.5 — `drip_{beat}_sent` / `drip_{beat}_opened`. */
export type DripEventName = `drip_${string}_sent` | `drip_${string}_opened`;

export type ProductEventName = StaticProductEventName | DripEventName;

const DRIP_PATTERN = /^drip_[a-z0-9_]+_(sent|opened)$/;

export function isProductEventName(name: string): name is ProductEventName {
  return (PRODUCT_EVENT_NAMES as readonly string[]).includes(name) || DRIP_PATTERN.test(name);
}

export interface ProductEvent {
  name: ProductEventName;
  accountId?: string;
  userId?: string;
  /** Counts/ids/keys only — never raw connector content, never PII. */
  props?: Record<string, string | number | boolean | null>;
}

export interface EventSink {
  emit(event: ProductEvent): Promise<void>;
}

/** Test/dev sink that just remembers what was emitted. */
export class MemoryEventSink implements EventSink {
  readonly events: ProductEvent[] = [];

  async emit(event: ProductEvent): Promise<void> {
    if (!isProductEventName(event.name)) {
      throw new Error(`unknown product event: ${String(event.name)}`);
    }
    this.events.push(event);
  }
}
