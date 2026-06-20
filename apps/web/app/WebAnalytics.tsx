'use client';

import { Analytics } from '@vercel/analytics/next';

/**
 * Cookieless web analytics for the PUBLIC nibbin.com site only (SPEC §435 —
 * Plausible-class, no consent banner, no Google).
 *
 * We deliberately do NOT track the authenticated app (`/app/*`): firing
 * third-party beacons on the in-product surface where users do sensitive work
 * conflicts with Nibbin's privacy-first stance. `beforeSend` drops those events
 * client-side so only marketing/landing/legal page views are recorded. Pageviews
 * use Next route patterns (no raw dynamic-segment values), and Vercel Web
 * Analytics is cookieless + sends no PII.
 */
export function WebAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          const u = new URL(event.url);
          // Don't track the authenticated in-product app.
          if (u.pathname === '/app' || u.pathname.startsWith('/app/')) return null;
          // Strip query + hash so secrets that ride in URLs on public routes
          // (e.g. /waitlist/confirm?token=…, /auth?code=…, password-reset links)
          // are NEVER recorded. Marketing analytics only needs the path.
          return { ...event, url: u.origin + u.pathname };
        } catch {
          // Unparseable URL → fail safe by dropping the event.
          return null;
        }
      }}
    />
  );
}
