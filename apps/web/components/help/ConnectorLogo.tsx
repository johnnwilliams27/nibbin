'use client';
import { useState } from 'react';
import { monogramFor } from '../../lib/connections/catalog-view';
import styles from './help.module.css';

export function clearbitUrl(domain: string): string {
  return `https://logo.clearbit.com/${domain}`;
}

export function ConnectorLogo({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return <span className={styles.logoFallback} aria-hidden="true">{monogramFor(name)}</span>;
  }
  return (
    <img
      className={styles.logo}
      src={clearbitUrl(domain)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={28}
      height={28}
      onError={() => setFailed(true)}
    />
  );
}
