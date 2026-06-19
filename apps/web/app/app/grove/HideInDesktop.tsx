'use client';

import { type ReactNode, useEffect, useState } from 'react';

/**
 * Renders children only when NOT running inside the Tauri desktop webview.
 *
 * Detection: Tauri injects `__TAURI_INTERNALS__` (v2) or `__TAURI__` (v1)
 * on the window object. If either is present we are inside the desktop app
 * and the children are suppressed.
 *
 * Note: if the Tauri remote-webview build does not expose those globals a
 * `?desktop=1` URL-marker fallback may be needed — implement that separately.
 */
function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function HideInDesktop({ children }: { children: ReactNode }) {
  // Start hidden on the server / first paint to avoid a layout flash when
  // running inside the desktop app; reveal on the client after detection.
  const [desktop, setDesktop] = useState(true);

  useEffect(() => {
    setDesktop(isDesktop());
  }, []);

  if (desktop) return null;
  return <>{children}</>;
}
