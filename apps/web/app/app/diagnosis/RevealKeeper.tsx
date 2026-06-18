'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildCreature } from '@nibbin/creatures';
import styles from './diagnosis.module.css';

/**
 * The Grovekeeper presenting the diagnosis (CE-P5 — the Keeper narrates these
 * moments, it is never the subject). Engine-only sprite, mount-gated for the
 * gradient-id hydration gotcha. Static pose — the ceremony's motion is the
 * staged reveal around it, not the sprite.
 */
export function RevealKeeper() {
  const keeperSvg = useMemo(() => buildCreature({ species: 'Keeper', size: 88 }), []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.revealKeeper}>
      <div className={styles.revealKeeperSprite} aria-hidden="true">
        {mounted && (
          <span
            // keeperSvg is built by the in-repo @nibbin/creatures engine from a
            // fixed species — never user/runtime HTML (same trust basis as
            // grove/KeeperSprite.tsx).
            // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
            dangerouslySetInnerHTML={{ __html: keeperSvg }}
          />
        )}
      </div>
      {/* CE11: this line will move to keeper/src/copy.ts when that (gated) work lands. */}
      <p className={styles.revealKeeperLine}>
        Fourteen days, grown into one map. Here&rsquo;s where your week actually goes.
      </p>
    </div>
  );
}
