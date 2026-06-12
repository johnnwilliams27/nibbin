/**
 * Deterministic parsing of quarantined connector responses.
 *
 * Scan modules are pure functions, no model calls (§4.4) — so "data, never
 * instructions" is held by construction here: the payload is only ever
 * JSON.parsed into typed shapes and reduced to counts/dates/ids. Nothing in
 * this package interpolates connector content into a prompt.
 *
 * The quarantine wrapper neutralizes marker-shaped sequences inside the
 * payload with zero-width spaces; provider JSON (object keys, ISO dates,
 * numbers) never contains those sequences, so parsing is lossless in
 * practice. If hostile content managed to corrupt its own JSON, the module
 * simply yields no findings for that read — fail-quiet, never fail-trusting.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import { QUARANTINE_PREFIX } from '@nibbin/connectors';

/** Extract the raw payload text between the tagged quarantine markers. */
export function unwrapQuarantined(content: QuarantinedContent): string {
  // exact string matching, not RegExp — content.tag must never reach a regex engine
  const openPrefix = `<<<${QUARANTINE_PREFIX}:${content.tag} source="`;
  const headerEnd = '">>>\n';
  const close = `\n<<<END-${QUARANTINE_PREFIX}:${content.tag}>>>`;
  const text = content.wrapped;
  // the source value is quote-free, so the first '"' after the prefix must start '">>>\n'
  const q = text.startsWith(openPrefix) ? text.indexOf('"', openPrefix.length) : -1;
  const headerLen = q === -1 ? -1 : text.startsWith(headerEnd, q) ? q + headerEnd.length : -1;
  if (headerLen === -1 || !text.trimEnd().endsWith(close.trim())) {
    throw new Error('content is not a quarantine wrap from this connection');
  }
  const body = text.slice(headerLen, text.lastIndexOf(close));
  // drop the two fixed preamble lines the wrapper inserts
  const lines = body.split('\n');
  return lines.slice(2).join('\n');
}

/** Parse a quarantined JSON response; null when the payload isn't valid JSON. */
export function parseQuarantinedJson<T>(content: QuarantinedContent): T | null {
  try {
    return JSON.parse(unwrapQuarantined(content)) as T;
  } catch {
    return null;
  }
}
