const browsePaths = new Set(['/', '/compare', '/category/rebalancing', '/category/grid-trading', '/category/yield', '/category/health-factor']);
export const BROWSE_RETURN_KEY = 'nibbin-browse-return';

/** Never allow stored navigation state to turn a back link into an external URL. */
export function safeBrowseReturn(value: string | null): string {
  if (!value || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/#browse';
  try {
    const url = new URL(value, 'https://nibbin.invalid');
    if (url.origin !== 'https://nibbin.invalid' || !browsePaths.has(url.pathname.replace(/\/$/, '') || '/')) return '/#browse';
    return `${url.pathname}${url.search}#agent-results`;
  } catch { return '/#browse'; }
}
