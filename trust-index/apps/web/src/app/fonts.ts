/**
 * Self-hosted faces via next/font/local (SPEC 14.1: no runtime font CDN).
 * Roles and fallback stacks documented in docs/design-plan.md.
 */
import localFont from "next/font/local";

export const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  fallback: ["ui-monospace", "Cascadia Mono", "Roboto Mono", "monospace"],
  display: "swap",
});

export const plexSans = localFont({
  src: [{ path: "../fonts/ibm-plex-sans-var.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-sans",
  fallback: ["system-ui", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
  display: "swap",
});
