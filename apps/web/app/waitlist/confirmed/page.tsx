import type { Metadata } from 'next';
import Link from 'next/link';
import { Grovekeeper } from '../../../components/grovekeeper/Grovekeeper';
import '../../(marketing)/landing.css';

export const metadata: Metadata = {
  title: 'Welcome to the Founding Grove — Nibbin',
  robots: { index: false },
};

export default async function Confirmed({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const confirmed = ok === '1';
  return (
    <main className="landing">
      <section style={{ textAlign: 'center', minHeight: '72vh', display: 'grid', placeItems: 'center' }}>
        <div className="wrap" style={{ maxWidth: 560 }}>
          <Grovekeeper size={150} />
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 800, margin: '14px 0 10px' }}>
            {confirmed ? 'Your seat is saved.' : 'That link has expired or already been used.'}
          </h1>
          <p style={{ color: 'var(--ink-soft)', fontSize: 16, maxWidth: '46ch', margin: '0 auto 24px' }}>
            {confirmed
              ? 'You’re in the Founding Grove. The Grovekeeper will be in touch when your grove is ready to hatch — early, and personally.'
              : 'No harm done. If you still want a seat, join again from the home page and we’ll send a fresh confirmation.'}
          </p>
          <Link className="btn btn-ghost" href="/">
            Back to nibbin.com
          </Link>
        </div>
      </section>
    </main>
  );
}
