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

  // One person, one seat: an address already on the list never creates a second
  // row (email is the primary key) and isn't counted twice — we just say so.
  const alreadyIn: JoinResult = { ok: true, message: 'You’re already on the list — check your inbox for your confirmation link.' };
  const alreadyInResent: JoinResult = { ok: true, message: 'You’re already on the list — we’ve re-sent your confirmation link.' };
  const confirmedAlready: JoinResult = { ok: true, message: 'You’re already on the list — see you in the grove.' };

  const oops: JoinResult = { ok: false, message: 'Something hiccuped on our end — try again in a moment?' };

  try {
    const svc = serviceClient();

    // CAN-SPAM: never mail an address that asked to be left alone. Fail closed
    // on a DB error — better to ask the user to retry than to risk mailing a
    // suppressed address or downgrading a confirmed row on a null-from-error.
    const { data: suppressed, error: supErr } = await svc
      .from('email_suppressions')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (supErr) return oops;
    if (suppressed) return friendly;

    const { data: existing, error: exErr } = await svc
      .from('waitlist')
      .select('status, last_email_sent_at')
      .eq('email', email)
      .maybeSingle<{ status: string; last_email_sent_at: string | null }>();
    if (exErr) return oops;
    const isNew = !existing;
    if (existing?.status === 'confirmed') return confirmedAlready;

    // Resend cooldown: a re-submit within the window is a silent no-op, so the
    // form can't be used to spray confirmation emails at a chosen address. Someone
    // already on the list is told so, not silently re-queued.
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (existing?.last_email_sent_at && Date.now() - Date.parse(existing.last_email_sent_at) < COOLDOWN_MS) {
      return alreadyIn;
    }

    // upsert never downgrades a confirmed row (DB trigger enforces it too).
    const { error: upErr } = await svc
      .from('waitlist')
      .upsert({ email, status: 'pending', source: 'landing' }, { onConflict: 'email' });
    if (upErr) return oops;

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
      // stamp the send so the cooldown above can throttle re-submits
      await svc.from('waitlist').update({ last_email_sent_at: new Date().toISOString() }).eq('email', email);
    }

    // §6.12 cookieless product event (pre-auth, account-less). Best-effort. Only a
    // genuinely new signup counts — a re-submit by someone already in is not a join.
    if (isNew) {
      await svc.from('product_events').insert({ name: 'waitlist_joined', props: { source: 'landing' } });
    }

    return isNew ? friendly : alreadyInResent;
  } catch (err) {
    // PII never reaches the log — message only, no recipient address.
    console.error('[waitlist] join failed', err instanceof Error ? err.message : String(err));
    return oops;
  }
}
