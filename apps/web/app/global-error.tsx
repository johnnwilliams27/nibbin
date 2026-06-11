'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
// global-error replaces the crashed root layout, so it must pull in the global
// styles (and render its own <html>) itself.
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ maxWidth: '28rem', padding: '32px 24px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '23px' }}>Something went wrong</h1>
            <p className="sub" style={{ margin: '0 auto 24px' }}>
              The page hit an error it could not recover from. Your grove and
              your data are safe, and the error has been logged. Try again — if
              it keeps happening, give it a minute.
            </p>
            <button
              onClick={reset}
              style={{
                padding: '10px 24px',
                borderRadius: 'var(--r-button)',
                border: 'none',
                background: 'var(--moss-deep)',
                color: 'var(--canopy)',
                fontFamily: 'var(--sans)',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
