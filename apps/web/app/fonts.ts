import { Archivo, Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';

// Self-hosted at build time (no runtime request to Google) — the privacy-
// forward posture (SPEC §6.12) shouldn't leak visitor IPs to a font CDN.
// Each exposes a CSS variable that apps/web maps onto the design tokens.

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '900'],
  variable: '--font-archivo',
  display: 'swap',
});

export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});
