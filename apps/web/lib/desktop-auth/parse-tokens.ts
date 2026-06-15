/**
 * Parse the Supabase access/refresh tokens the desktop app hands off in the URL
 * fragment (never the query string — fragments aren't sent to the server / logged).
 * Returns null unless both tokens are present.
 */
export function parseTokens(hash: string): { access_token: string; refresh_token: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}
