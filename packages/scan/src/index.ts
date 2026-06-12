/**
 * @nibbin/scan — the connector scan (SPEC §4.4): per-connector scan modules
 * over the 90-day read-only lookback, the scan engine, the scan_empty Keeper
 * interview fallback (§6.12), and the synthetic fixture corpus for seeded
 * accounts and tests.
 *
 * Modules are pure functions, no side effects, no model calls. All connector
 * content arrives quarantined and is only ever parsed into typed shapes and
 * reduced to counts/dates/ids — never interpolated into prompts.
 */
export * from './engine';
export * from './findings';
export * from './fixtures';
export * from './interview';
export * from './unwrap';
export * from './modules/email';
export * from './modules/calendar';
export * from './modules/payments';
export * from './modules/crm';
export * from './modules/dm';
