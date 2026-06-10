import type { Metadata } from 'next';
import { creatureCss } from '@nibbin/creatures';
import { archivo, bricolage, plexMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nibbin — AI agents that nibble your busywork away',
  description:
    'Hatch a grove of creature agents that earn your trust in Agent School and take real busywork off your plate.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${bricolage.variable} ${plexMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: creatureCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
