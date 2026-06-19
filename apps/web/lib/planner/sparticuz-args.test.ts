/**
 * Dep-drift egress guard for `@sparticuz/chromium` (FIX 3, red-team).
 *
 * The serverless launch path (lib/planner/browser.ts → loadBrowserRuntime) passes
 * `@sparticuz/chromium`'s `args` array through to `chromium.launch({ args })`
 * UNMODIFIED. The package is pinned (`~149.0.0`, patch-only) but a future bump
 * could add an arg that silently WEAKENS the #165 SSRF/egress model — e.g. a
 * proxy arg that reroutes Chromium's egress away from our `context.route('**')`
 * fetch-and-fulfill interceptor, a remote-debugging port/pipe that opens an
 * out-of-band channel, or a `--disable-features=...NetworkService...` token that
 * moves networking out of the interceptable path.
 *
 * This test asserts NONE of those tokens are present, so a future bump that
 * introduces one FAILS CI rather than silently weakening the model. The pinned
 * dep range is belt-and-suspenders; THIS assertion is the real guard.
 *
 * NOTE: `@sparticuz/chromium` is an installed RUNTIME dependency (it ships to
 * prod for the serverless launch), so importing it here needs no browser binary
 * and triggers no download — only the static `args` array is read.
 */
import { describe, expect, it } from 'vitest';

/** Arg PREFIXES that, if present, would let an arg reroute / expose Chromium's
 *  egress away from the pinned `context.route` interceptor. Matched as a prefix
 *  so a value-bearing form (`--proxy-server=...`) is caught too. */
const FORBIDDEN_ARG_PREFIXES = [
  '--proxy-server',
  '--proxy-pac-url',
  '--proxy-bypass-list',
  '--remote-debugging-port',
  '--remote-debugging-pipe',
];

describe('@sparticuz/chromium args — egress-pinning drift guard (FIX 3)', () => {
  it('exposes a string args array', async () => {
    const ns = (await import('@sparticuz/chromium')) as unknown as {
      default?: { args?: string[] };
      args?: string[];
    };
    const mod = ns.default ?? ns;
    expect(Array.isArray(mod.args)).toBe(true);
    expect(mod.args!.every((a) => typeof a === 'string')).toBe(true);
  });

  it('contains NO proxy / remote-debugging arg (no egress reroute or out-of-band channel)', async () => {
    const ns = (await import('@sparticuz/chromium')) as unknown as {
      default?: { args?: string[] };
      args?: string[];
    };
    const args = (ns.default ?? ns).args ?? [];
    for (const arg of args) {
      const lower = arg.toLowerCase();
      for (const forbidden of FORBIDDEN_ARG_PREFIXES) {
        expect(
          lower.startsWith(forbidden),
          `@sparticuz/chromium added a forbidden egress arg "${arg}" — this would weaken the SSRF/egress-pinning model. Re-audit before bumping.`,
        ).toBe(false);
      }
    }
  });

  it('does NOT disable Chromium NetworkService (which would move networking out of the interceptable path)', async () => {
    const ns = (await import('@sparticuz/chromium')) as unknown as {
      default?: { args?: string[] };
      args?: string[];
    };
    const args = (ns.default ?? ns).args ?? [];
    // A `--disable-features=` entry whose value list contains a NetworkService
    // token (e.g. `NetworkService`, `NetworkServiceInProcess`) would change how
    // Chromium does networking — re-audit egress interception before allowing it.
    for (const arg of args) {
      if (arg.toLowerCase().startsWith('--disable-features=')) {
        const value = arg.slice('--disable-features='.length);
        const tokens = value.split(',').map((t) => t.trim().toLowerCase());
        const hit = tokens.find((t) => t.includes('networkservice'));
        expect(
          hit,
          `@sparticuz/chromium's --disable-features now disables "${hit}" — a NetworkService change can move networking out of the context.route interceptor. Re-audit egress pinning before bumping.`,
        ).toBeUndefined();
      }
    }
  });
});
