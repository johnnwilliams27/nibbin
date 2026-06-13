/**
 * Brand-voiced content for the one-off (transactional) emails. Subjects are
 * sentence case, no urgency, no guilt — the Grovekeeper writing, as always.
 * Rendered by renderTransactional (transactional.ts).
 */
import type { TransactionalEmail } from './transactional';

/** Admin-issued invite → account creation. The link lands on /auth/callback. */
export function inviteEmail(link: string): TransactionalEmail {
  return {
    subject: 'Your seat in the Founding Grove is ready',
    preheader: 'Create your account — the Grovekeeper is waiting.',
    eyebrow: 'Founding Grove · your seat is ready',
    title: 'A seat just opened in the grove.',
    body: "You're in. Create your account and the Grovekeeper will be waiting to hatch your first Nibbin — about ten minutes, start to finish.",
    cards: [
      {
        title: 'What happens next',
        body: 'Connect a tool or two, watch the scan, and adopt your first helper. The 14-day Field Study is optional and starts only when you say so.',
      },
    ],
    cta: { label: 'Create your account', url: link },
    footnote: 'This invite is tied to your email and the link expires in a few days. If you weren’t expecting it, you can ignore it.',
    creature: { species: 'Keeper', size: 88 },
  };
}

/** Waitlist double-opt-in confirmation (replaces the old hand-rolled inline email). */
export function waitlistConfirmEmail(link: string): TransactionalEmail {
  return {
    subject: 'Confirm your seat in the Founding Grove',
    preheader: "You're one click from the Founding Grove.",
    eyebrow: 'Founding Grove · confirm',
    title: "You're one click from the Founding Grove.",
    body: 'Confirm your seat and the Grovekeeper will hatch your grove early — and personally.',
    cta: { label: 'Confirm your seat', url: link },
    footnote: "If you didn't ask to join Nibbin's waitlist, ignore this — nothing happens without your click.",
    creature: { species: 'Keeper', size: 88 },
  };
}

/** First email after an account is created. Carries the app + desktop links. */
export function welcomeEmail(appUrl: string, downloadUrl?: string): TransactionalEmail {
  return {
    subject: 'Your grove is open',
    preheader: 'Hatch your first helper whenever you’re ready.',
    eyebrow: 'Welcome',
    title: 'Your grove is open.',
    body: 'The Grovekeeper is ready. Hatch your first helper in the web app now — and install the desktop app whenever you want the Field Study to map the work connectors can’t see.',
    cards: downloadUrl
      ? [{ title: 'Get the desktop app', body: 'macOS and Windows. The capture stays entirely on your machine.' }]
      : undefined,
    cta: { label: 'Open your grove', url: appUrl },
    creature: { species: 'Keeper', size: 88 },
  };
}

/** Branded passwordless sign-in link (for when we move auth mail off Supabase defaults). */
export function signInEmail(link: string): TransactionalEmail {
  return {
    subject: 'Your sign-in link',
    preheader: 'Tap to sign in — the link works once and expires soon.',
    eyebrow: 'Sign in',
    title: 'Your sign-in link',
    body: 'Tap below to sign in to your grove. The link works once and expires in 15 minutes. If you didn’t ask to sign in, you can safely ignore this.',
    cta: { label: 'Sign in to Nibbin', url: link },
    creature: { species: 'Keeper', size: 88 },
  };
}
