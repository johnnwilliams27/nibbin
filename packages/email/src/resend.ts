/**
 * Resend adapter (§6.8: transactional + Field Notes mail via Resend/Postmark
 * from mail.nibbin.com). Plain fetch — no SDK dependency.
 */
import type { EmailProvider, OutboundEmail } from './types';

const API_URL = 'https://api.resend.com/emails';

export function resendProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  return {
    async send(msg: OutboundEmail): Promise<{ id: string }> {
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers: msg.headers,
        }),
      });
      if (!res.ok) {
        // Never log the recipient or body — PII stays out of logs (RISKS).
        throw new Error(`resend send failed: ${res.status}`);
      }
      const data = (await res.json()) as { id?: string };
      return { id: data.id ?? '' };
    },
  };
}
