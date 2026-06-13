'use server';

import { redirect } from 'next/navigation';
import { normalizeEmail, passwordResetEmail, renderTransactional, resendProvider } from '@nibbin/email';
import { serviceClient } from '../../lib/supabase/service';
import { siteOrigin } from '../../lib/site-url';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Forgot-password: mint a recovery link with the service role and send it via
 * Resend — never Supabase's throttled built-in email. Always returns the same
 * neutral "sent" state, so we never reveal whether an account exists.
 */
export async function requestReset(formData: FormData) {
  const raw = formData.get('email');
  const email = typeof raw === 'string' ? normalizeEmail(raw) : '';
  if (!EMAIL_RE.test(email) || email.length > 254) redirect('/forgot-password?sent=1');

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Nibbin <keeper@nibbin.com>';
  const postalAddress = process.env.EMAIL_POSTAL_ADDRESS;

  try {
    if (apiKey) {
      const svc = serviceClient();
      const { data, error } = await svc.auth.admin.generateLink({ type: 'recovery', email });
      const hashedToken = data?.properties?.hashed_token;
      if (!error && hashedToken) {
        const link = `${siteOrigin()}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
        const msg = renderTransactional(passwordResetEmail(link), { from, to: email, postalAddress });
        await resendProvider(apiKey).send(msg);
      }
    }
  } catch {
    // Never leak whether the address exists or the send failed — stay neutral.
  }

  redirect('/forgot-password?sent=1');
}
