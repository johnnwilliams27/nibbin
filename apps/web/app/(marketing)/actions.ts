'use server';

import { normalizeEmail, renderTransactional, resendProvider, waitlistConfirmEmail } from '@nibbin/email';
import { serviceClient } from '../../lib/supabase/service';
import { waitlistToken } from '../../lib/waitlist/token';
import { normalizeUtm } from '../../lib/gtm/links';

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

  // GTM attribution (first-touch): sanitized UTM from the landing form's hidden
  // fields. Untrusted client input — normalizeUtm bounds + url-safe-filters each.
  const utm = {
    utm_source: normalizeUtm(formData.get('utm_source')),
    utm_medium: normalizeUtm(formData.get('utm_medium')),
    utm_campaign: normalizeUtm(formData.get('utm_campaign')),
    ref: normalizeUtm(formData.get('ref')),
  };

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
    if (existing?.status === 'confirmed') return confirmedAlready;

    // Resend cooldown: a re-submit within the window is a silent no-op, so the
    // form can't be used to spray confirmation emails at a chosen address. Someone
    // already on the list is told so, not silently re-queued.
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (existing?.last_email_sent_at && Date.now() - Date.parse(existing.last_email_sent_at) < COOLDOWN_MS) {
      return alreadyIn;
    }

    // Atomic first-touch join: inserts a pending row, or on conflict fills only the
    // NULL utm columns (COALESCE inside the RPC) so the FIRST tracked link to bring
    // an email wins — even under two concurrent first-submits. Returns true iff THIS
    // call inserted the row, the reliable signal for emitting the join event once.
    const { data: insertedNow, error: upErr } = await svc.rpc('waitlist_join', {
      p_email: email,
      p_utm_source: utm.utm_source,
      p_utm_medium: utm.utm_medium,
      p_utm_campaign: utm.utm_campaign,
      p_ref: utm.ref,
    });
    if (upErr) return oops;

    const apiKey = process.env.RESEND_API_KEY;
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com';
    const from = process.env.EMAIL_FROM ?? 'Nibbin <keeper@nibbin.com>';
    const postalAddress = process.env.EMAIL_POSTAL_ADDRESS;
    if (apiKey && secret) {
      const link = `${siteUrl.replace(/\/$/, '')}/waitlist/confirm?token=${encodeURIComponent(waitlistToken(email, secret))}`;
      const msg = renderTransactional(waitlistConfirmEmail(link), { from, to: email, postalAddress });
      await resendProvider(apiKey).send(msg);
      // stamp the send so the cooldown above can throttle re-submits
      await svc.from('waitlist').update({ last_email_sent_at: new Date().toISOString() }).eq('email', email);
    }

    // §6.12 cookieless product event (pre-auth, account-less). Best-effort. Emitted
    // only when THIS call inserted the row (insertedNow), so concurrent racers can't
    // each log a join — keeps the raw event honest alongside the row-counted funnel.
    if (insertedNow === true) {
      await svc.from('product_events').insert({
        name: 'waitlist_joined',
        props: { source: 'landing', ...utm },
      });
    }

    return insertedNow === true ? friendly : alreadyInResent;
  } catch (err) {
    // PII never reaches the log — message only, no recipient address.
    console.error('[waitlist] join failed', err instanceof Error ? err.message : String(err));
    return oops;
  }
}
