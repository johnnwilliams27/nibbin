import type { Metadata } from "next";
import type { ReactNode } from "react";
import { plexMono, plexSans } from "./fonts";
import { tokenCss } from "@/lib/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Trust Index",
  description: "Confidence-weighted trust scores for ERC-8004 agents, with the uncertainty in band.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokenCss() }} />
      </head>
      <body>
        <div className="topbar">
          <div className="topbar-inner">
            <a className="wordmark plain" href="/">
              Agent Trust Index
            </a>
            <ul className="nav-links">
              <li>
                <a href="/compendium">Compendium</a>
              </li>
              <li>
                <a href="/methodology">Methodology</a>
              </li>
              <li>
                <a href="/stats">Stats</a>
              </li>
              <li>
                <a href="/dumps">Dumps</a>
              </li>
            </ul>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
