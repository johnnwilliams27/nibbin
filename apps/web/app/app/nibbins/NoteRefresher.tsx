'use client';

import { useEffect, useRef } from 'react';

/**
 * Fire-and-forget background refresher for the roster's learned-notes. On mount
 * it calls the server action once per stale Nibbin id, sequentially, swallowing
 * every error — this regenerates stale/missing notes OFF the render path so the
 * page paints instantly with cached-or-fallback text and the fresh note appears
 * on the next load (the action revalidates /app/nibbins). Renders nothing.
 */
export function NoteRefresher({
  staleIds,
  action,
}: {
  staleIds: string[];
  action: (nibbinId: string) => Promise<void>;
}) {
  // Guard against double-firing under React Strict Mode's dev double-mount.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (staleIds.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const id of staleIds) {
        if (cancelled) return;
        try {
          await action(id);
        } catch {
          // best-effort — never surface to the user
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // staleIds is computed once per render from server data; we intentionally
    // run this only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
