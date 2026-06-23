import 'server-only';
/**
 * Nango SDK singleton for server-side use (P4 Nango connector lane).
 * Never import @nangohq/node directly elsewhere in apps/web — use getNango().
 *
 * Uses the preferred `apiKey` constructor parameter (NANGO_SECRET_KEY env var).
 * The deprecated `secretKey` alias is intentionally NOT used — apiKey is the
 * stable API per @nangohq/node types.d.ts NangoProps discriminated union.
 */
import { Nango } from '@nangohq/node';

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    const apiKey = process.env.NANGO_SECRET_KEY;
    if (!apiKey) throw new Error('NANGO_SECRET_KEY is not set');
    _nango = new Nango({ apiKey, host: process.env.NANGO_HOST });
  }
  return _nango;
}
