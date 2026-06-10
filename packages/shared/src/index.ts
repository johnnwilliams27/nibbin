/**
 * @nibbin/shared — schemas, types, and credit math shared across apps.
 *
 * M1: credit ledger math (credits.ts). Account/connector schemas land
 * alongside the Supabase migrations that define them.
 */
export * from './credits';

export const VOCABULARY = {
  tagline: 'AI agents that nibble your busywork away.',
  stages: ['Egg', 'Student', 'Senior', 'Graduate'],
} as const;
