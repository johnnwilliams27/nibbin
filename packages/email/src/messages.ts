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
    body: "You're in. Create your account — you'll choose a password, then the Grovekeeper will be waiting to hatch your first Nibbin (about ten minutes, start to finish).",
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

/**
 * Completion receipt after an account is purged (§6.11). No CTA — the account
 * is gone; there is nowhere to send them. Sent to the address captured before
 * the purge scrubbed it.
 */
export function accountDeletedEmail(): TransactionalEmail {
  return {
    subject: 'Your Nibbin account has been deleted',
    preheader: 'Your grove and its personal data have been removed.',
    eyebrow: 'Account deleted',
    title: 'Your grove has been closed.',
    body: 'As you asked, your Nibbin account and the personal data in it have been permanently deleted. The few records we’re legally required to keep — like billing history — have been anonymized so they can no longer be tied to you. There’s nothing more you need to do.',
    footnote: 'If you didn’t ask for this, contact hello@nibbin.com right away.',
    creature: { species: 'Keeper', size: 88 },
  };
}

/** Password reset — sent via Resend so it isn't subject to Supabase's email throttle. */
export function passwordResetEmail(link: string): TransactionalEmail {
  return {
    subject: 'Reset your Nibbin password',
    preheader: 'Choose a new password — the link works once and expires soon.',
    eyebrow: 'Password reset',
    title: 'Let’s get you a new password.',
    body: 'Click below to choose a new password for your grove. The link works once and expires in an hour. If you didn’t ask to reset it, you can safely ignore this — nothing changes.',
    cta: { label: 'Set a new password', url: link },
    creature: { species: 'Keeper', size: 88 },
  };
}
