import type { Metadata } from 'next';
import { creatureCss } from '@nibbin/creatures';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nibbin — AI agents that nibble your busywork away',
  description:
    'Hatch a grove of creature agents that earn your trust in Agent School and take real busywork off your plate.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Archivo:wght@400;500;600;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{ __html: creatureCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
