import 'server-only';
import { serviceClient } from '../supabase/service';

/**
 * Opt a phone number out of SMS notifications (TCPA STOP compliance).
 *
 * Calls the `sms_opt_out` service-role RPC which:
 *   1. Revokes every live `notification_channels` row for this number.
 *   2. Writes an `audit_log` row per revoked binding (plus one if no binding
 *      existed, so the opt-out is always recorded).
 *
 * Must only be called AFTER Twilio signature verification — the externalId
 * comes from the unverified carrier but the signature gate ensures the
 * Twilio payload is authentic before we act on it.
 */
export async function optOutSms(externalId: string): Promise<void> {
  const svc = serviceClient();
  const { error } = await svc.rpc('sms_opt_out', { p_external_id: externalId });
  if (error) {
    // Log but do not re-throw: a DB error must not prevent the TwiML STOP
    // reply from reaching the sender. The carrier also maintains opt-out state
    // at the number level — this is belt-and-suspenders persistence.
    console.error('[sms-compliance] sms_opt_out rpc failed', error.message);
  }
}

/**
 * Re-subscribe a phone number to SMS notifications (TCPA START compliance).
 *
 * Calls the `sms_opt_in` service-role RPC which:
 *   1. Clears revoked_at and restores status to 'verified' for every revoked
 *      SMS binding for this number (START is the consent signal — no new
 *      nonce/verification needed; the number is already known).
 *   2. Writes an `audit_log` row per restored binding (plus one if no revoked
 *      binding existed, so the START attempt is always recorded).
 *
 * Must only be called AFTER Twilio signature verification.
 */
export async function optInSms(externalId: string): Promise<void> {
  const svc = serviceClient();
  const { error } = await svc.rpc('sms_opt_in', { p_external_id: externalId });
  if (error) {
    // Log but do not re-throw: a DB error must not prevent the TwiML START
    // reply from reaching the sender.
    console.error('[sms-compliance] sms_opt_in rpc failed', error.message);
  }
}
