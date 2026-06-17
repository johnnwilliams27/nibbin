import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  gmail: (
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h13A1.5 1.5 0 0 1 18 5.5v9A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5v-9Zm2 .2v8.6h12V5.7l-6 4.2-6-4.2Zm10.8-.2H5.2L10 8.6l4.8-3.1Z" fill="currentColor" />
  ),
};

export function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const glyph = ICONS[provider] ?? (
    <path d="M10 2l5 3v6l-5 3-5-3V5l5-3Z" fill="currentColor" opacity="0.5" />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {glyph}
    </svg>
  );
}
