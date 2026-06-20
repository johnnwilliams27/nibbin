/**
 * Shared Sentry beforeSend/beforeSendTransaction scrubber (RISKS §3).
 *
 * Strips OAuth / auth tokens from outbound Sentry events so that a leaky URL
 * or exception message never ships a live credential to the Sentry ingest:
 *  - Sensitive query-string params (code, state, token, access_token,
 *    refresh_token) are redacted from request URLs.
 *  - Authorization headers are dropped.
 *  - Token-shaped strings (Bearer …, long hex/base64 sequences) are redacted
 *    from exception messages and values.
 *
 * Import in every Sentry config:
 *   import { sentryBeforeSend } from '@nibbin/shared/sentry-scrub';
 *   Sentry.init({ beforeSend: sentryBeforeSend, beforeSendTransaction: sentryBeforeSend });
 */

const SENSITIVE_PARAMS = new Set(['code', 'state', 'token', 'access_token', 'refresh_token']);

/** Matches Bearer tokens, JWT-shaped strings, and long hex/base64 blobs. */
const TOKEN_RE =
  /Bearer\s+[A-Za-z0-9\-._~+/=]{8,}|eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+(?:\.[A-Za-z0-9\-_=]+)?|[0-9a-fA-F]{32,}|[A-Za-z0-9+/]{40,}={0,2}/g;

function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAMS.has(key)) u.searchParams.set(key, '[Filtered]');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function scrubString(s: string): string {
  return s.replace(TOKEN_RE, '[Filtered]');
}

/** Minimal Sentry event shape — intentionally loose to avoid a hard dependency. */
interface SentryEventLike {
  request?: {
    url?: string;
    headers?: Record<string, string | undefined>;
    query_string?: string | Record<string, string | undefined>;
  };
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: {
        frames?: Array<{ abs_path?: string; filename?: string }>;
      };
    }>;
  };
}

export function sentryBeforeSend<T extends SentryEventLike>(event: T): T {
  // 1. Scrub request URL.
  if (event.request?.url) {
    event.request.url = scrubUrl(event.request.url);
  }

  // 2. Drop Authorization and Cookie headers entirely.
  if (event.request?.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (/^(authorization|cookie|set-cookie)$/i.test(key)) {
        delete event.request.headers[key];
      }
    }
  }

  // 3. Scrub query_string (may be a raw string or a parsed object).
  if (event.request?.query_string) {
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubUrl(`https://x.invalid/?${event.request.query_string}`).replace(
        'https://x.invalid/?',
        '',
      );
    } else {
      for (const key of Object.keys(event.request.query_string)) {
        if (SENSITIVE_PARAMS.has(key)) {
          (event.request.query_string as Record<string, string>)[key] = '[Filtered]';
        }
      }
    }
  }

  // 4. Redact token-shaped strings from exception messages.
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value) exc.value = scrubString(exc.value);
    }
  }

  return event;
}
