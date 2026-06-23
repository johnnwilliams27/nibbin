import 'server-only';
/**
 * Nango SDK singleton for server-side use (P4 Nango connector lane).
 * Never import @nangohq/node directly elsewhere in apps/web — use getNango().
 *
 * TODO Task 6: factory functions (makeGmailClient / makeGoogleCalendarClient)
 * will wrap getNango() with proper connection-row injection.
 */
import { Nango } from '@nangohq/node';

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    const secretKey = process.env.NANGO_SECRET_KEY;
    if (!secretKey) throw new Error('NANGO_SECRET_KEY is not set');
    _nango = new Nango({ secretKey, host: process.env.NANGO_HOST });
  }
  return _nango;
}
