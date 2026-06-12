'use server';

import { normalizeEmail, resendProvider } from '@nibbin/email';
import { serviceClient } from '../../lib/supabase/service';
import { waitlistToken } from '../../lib/waitlist/token';

export interface JoinResult {
  ok: boolean;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Waitlist join (double-opt-in). Validates, respects the suppression list,
 * upserts a pending row, and sends the confirm link. Honest, quiet failures:
 * a suppressed or already-confirmed address gets the same friendly response
 * as a fresh one (no existence oracle, no re-mailing the unsubscribed).
 */
export async function joinWaitlist(_prev: JoinResult | null, formData: FormData): Promise<JoinResult> {
  const raw = formData.get('email');
  const email = typeof raw === 'string' ? normalizeEmail(raw) : '';
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, message: 'That email doesn’t look right — mind checking it?' };
  }

  const friendly: JoinResult = {
    ok: true,
    message: 'Almost there — check your inbox for a one-click confirmation to claim your seat.',
  };

  try {
    const svc = serviceClient();

    // CAN-SPAM: never mail an address that asked to be left alone.
    const { data: suppressed } = await svc
      .from('email_suppressions')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (suppressed) return friendly;

    const { data: existing } = await svc
      .from('waitlist')
      .select('status')
      .eq('email', email)
      .maybeSingle<{ status: string }>();
    if (existing?.status === 'confirmed') {
      return { ok: true, message: 'You’re already on the list — see you in the grove.' };
    }

    await svc.from('waitlist').upsert({ email, status: 'pending', source: 'landing' }, { onConflict: 'email' });

    const apiKey = process.env.RESEND_API_KEY;
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com';
    const from = process.env.EMAIL_FROM ?? 'Nibbin <keeper@mail.nibbin.com>';
    if (apiKey && secret) {
      const link = `${siteUrl.replace(/\/$/, '')}/waitlist/confirm?token=${encodeURIComponent(waitlistToken(email, secret))}`;
      const text = `You're one click from the Founding Grove.\n\nConfirm your seat: ${link}\n\nIf you didn't ask to join Nibbin's waitlist, ignore this — nothing happens without your click.`;
      const html = `<div style="font-family:Archivo,Helvetica,Arial,sans-serif;color:#23291A;background:#FBF6E6;padding:32px">
  <p style="font-size:16px;margin:0 0 16px">You're one click from the Founding Grove.</p>
  <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#23291A;color:#F5F6F2;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:4px">Confirm your seat</a></p>
  <p style="font-size:12px;color:#5A6248;margin:0">If you didn't ask to join Nibbin's waitlist, ignore this — nothing happens without your click.</p>
</div>`;
      await resendProvider(apiKey).send({
        from,
        to: email,
        subject: 'Confirm your seat in the Founding Grove',
        html,
        text,
        headers: {},
      });
    }

    // §6.12 cookieless product event (pre-auth, account-less). Best-effort.
    await svc.from('product_events').insert({ name: 'waitlist_joined', props: { source: 'landing' } });

    return friendly;
  } catch {
    return { ok: false, message: 'Something hiccuped on our end — try again in a moment?' };
  }
}
