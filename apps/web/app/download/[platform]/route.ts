/**
 * Desktop installer redirector. The source repo is private, so installers are
 * published to the PUBLIC repo `nibbin-desktop`; this route finds the latest
 * release asset for the requested platform and 302-redirects to it. Version-
 * proof (no hardcoded asset filenames) and falls back to the releases page when
 * nothing is published yet or the GitHub API hiccups.
 *
 *   /download/mac      → newest .dmg
 *   /download/windows  → newest .msi
 */
import { NextResponse } from 'next/server';

const RELEASES_REPO = 'johnnwilliams27/nibbin-desktop';
// Windows prefers the modern NSIS installer (.exe), falling back to the .msi.
const EXTS: Record<string, string[]> = { mac: ['.dmg'], windows: ['.exe', '.msi'] };
const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`;

// Cache the GitHub lookup so we don't hit the unauthenticated rate limit under load.
export const revalidate = 600;

interface Release {
  assets?: Array<{ name: string; browser_download_url: string }>;
}

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const exts = EXTS[platform];
  if (!exts) return NextResponse.redirect(RELEASES_PAGE, 302);

  try {
    // /releases (not /releases/latest) so prereleases are included.
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nibbin-web' },
      next: { revalidate: 600 },
    });
    if (res.ok) {
      const releases = (await res.json()) as Release[];
      for (const rel of releases) {
        for (const ext of exts) {
          const asset = rel.assets?.find((a) => a.name.toLowerCase().endsWith(ext));
          if (asset) return NextResponse.redirect(asset.browser_download_url, 302);
        }
      }
    }
  } catch {
    /* fall through to the releases page */
  }
  return NextResponse.redirect(RELEASES_PAGE, 302);
}
