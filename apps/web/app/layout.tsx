import type { Metadata } from 'next';
import { creatureCss } from '@nibbin/creatures';
import { archivo, bricolage, plexMono } from './fonts';
import './globals.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'Nibbin — AI agents for creative freelancers',
    template: '%s · Nibbin',
  },
  description:
    'Little creatures that grow up working for you. Hatch a grove of agents that earn your trust in Agent School and take real busywork off your plate — for people who work for themselves.',
  applicationName: 'Nibbin',
  keywords: ['AI agents', 'freelancers', 'photographers', 'creative business', 'automation', 'AI employees'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE,
    siteName: 'Nibbin',
    title: 'Nibbin — AI agents for creative freelancers',
    description: 'Little creatures that grow up working for you.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Nibbin' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nibbin — AI agents for creative freelancers',
    description: 'Little creatures that grow up working for you.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${bricolage.variable} ${plexMono.variable}`}>
      <head>
        {/* Mark JS-capable before paint so reveal-on-scroll only hides content
            when the observer can reveal it (no-JS/crawlers see everything). */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <style dangerouslySetInnerHTML={{ __html: creatureCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
