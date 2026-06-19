'use client';
import { useState } from 'react';
import { monogramFor } from '../../lib/connections/catalog-view';
import styles from './help.module.css';

// Logos are served through Nibbin's same-origin proxy (/api/connector-logo),
// which fetches them server-side — the browser never contacts the third-party
// logo provider directly.
export function logoUrl(domain: string): string {
  return `/api/connector-logo?domain=${encodeURIComponent(domain)}`;
}

export function ConnectorLogo({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return <span className={styles.logoFallback} aria-hidden="true">{monogramFor(name)}</span>;
  }
  return (
    <img
      className={styles.logo}
      src={logoUrl(domain)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={28}
      height={28}
      onError={() => setFailed(true)}
    />
  );
}
