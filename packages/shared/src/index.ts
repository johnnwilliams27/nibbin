/**
 * @nibbin/shared — schemas, types, and credit math shared across apps.
 *
 * M0: design tokens only (tokens.css). Account/credit/connector schemas land
 * at M1+ alongside the Supabase migrations that define them.
 */
export const VOCABULARY = {
  tagline: 'AI agents that nibble your busywork away.',
  stages: ['Egg', 'Student', 'Senior', 'Graduate'],
} as const;
