/**
 * Hatch wizard options + chore→template mapping. Kept in a plain module (not
 * the 'use server' actions file, which may only export async functions) so both
 * the server action and the page shell can import these constants.
 */

/** The four plain-language chores, in the wizard's order (§ MayaDemo CHORES). */
export const HATCH_CHORES = [
  { label: 'Answering the same emails over and over', small: 'replies, quotes, FAQs' },
  { label: "Chasing people who haven't paid or replied", small: 'invoices, follow-ups, nudges' },
  { label: 'Moving files and info between apps', small: 'export → rename → upload → notify' },
  { label: 'Keeping clients in the loop', small: 'confirmations, reminders, updates' },
] as const;

/** The app toggles shown on step 2 (advisory only — see actions.ts header). */
export const HATCH_APPS = [
  'Gmail',
  'Outlook',
  'Google Calendar',
  'QuickBooks',
  'HoneyBook',
  'Stripe',
  'Drive / Dropbox',
  'Notion',
] as const;

/**
 * Chore index → shop template. Chosen against templates.ts curricula:
 *   0 same emails over and over  → scribe (learns your repeat-inquiry replies)
 *   1 chasing unpaid / no reply  → echo   (overdue replies + stalled follow-ups)
 *   2 moving files between apps   → brief  (cross-app digest; the closest honest
 *                                           fit — no file-mover template exists)
 *   3 keeping clients in the loop → hopper (confirmations + reminders)
 */
export const CHORE_TEMPLATE = ['scribe', 'echo', 'brief', 'hopper'] as const;
