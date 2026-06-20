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
          const path = new URL(event.url).pathname;
          if (path === '/app' || path.startsWith('/app/')) return null;
        } catch {
          // If the URL can't be parsed, fail safe by dropping the event.
          return null;
        }
        return event;
      }}
    />
  );
}
