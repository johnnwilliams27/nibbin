/**
 * @nibbin/runtime — the agent runtime (M4).
 *
 * Every SPEC §6.2 invariant lives here, at the runtime layer: weighted-credit
 * budget pre-checks, per-run ceilings, same-tool-same-args loop kill,
 * idempotency keys on side effects, debounce/dedupe + cooldowns, cycle-checked
 * trigger graphs (Grovekeeper = terminal hub), anomaly auto-pause, and Agent
 * School stage gating (draft vs execute) — never the prompt layer.
 *
 * The package is pure: persistence rides injected stores; apps/web wires the
 * Supabase RPCs (run_begin / run_finish / nibbin_promote / …) which re-enforce
 * the money- and trust-critical checks in SQL.
 */
export * from './types';
export * from './capabilities';
export * from './primitives/shared';
export * from './primitives/nudge-overdue-email';
export * from './primitives/nudge-overdue-invoice';
export * from './primitives/nudge-unconfirmed-event';
export * from './primitives/reply-new-inquiry';
export * from './primitives/digest-inbox-cleanup';
export * from './primitives/digest-morning';
export * from './interpreter';
export * from './utilities';
export * from './events';
export * from './validate';
export * from './school';
export * from './stores';
export * from './runner';
export * from './planner';
export * from './templates';
export * from './velocity';
