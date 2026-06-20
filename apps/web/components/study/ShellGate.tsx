'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { isShell } from '../../lib/desktop/bridge';
import { EmptyState } from '../ui';

interface ShellGateProps {
  children: ReactNode;
}

export function ShellGate({ children }: ShellGateProps) {
  const [mounted, setMounted] = useState(false);
  const [shell, setShell] = useState(false);

  useEffect(() => {
    setShell(isShell());
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  if (!shell) {
    return (
      <EmptyState
        title="Field Study runs in the desktop app"
        body="Download the Nibbin desktop app to start a Field Study. Your grove and nibbins live here on the web; Field Study needs the desktop app to observe your work."
        action={
          <Link
            href="https://nibbin.com/download"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              background: 'var(--moss)',
              color: '#fff',
              borderRadius: 'var(--r-button)',
              fontWeight: 700,
              textDecoration: 'none',
              fontSize: '14.5px',
            }}
          >
            Get the desktop app
          </Link>
        }
      />
    );
  }

  return <>{children}</>;
}
