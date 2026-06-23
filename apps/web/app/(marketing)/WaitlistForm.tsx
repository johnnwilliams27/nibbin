'use client';

import { useActionState, useEffect, useState } from 'react';
import { joinWaitlist, type JoinResult } from './actions';
import { UTM_FIELDS, pickFirstTouchUtm, type UtmFields } from '../../lib/gtm/links';

const EMPTY_UTM: UtmFields = { utm_source: '', utm_medium: '', utm_campaign: '', ref: '' };
const STORAGE_KEY = 'nibbin_utm';

export function WaitlistForm() {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(joinWaitlist, null);
  const [utm, setUtm] = useState<UtmFields>(EMPTY_UTM);

  // First-touch attribution: prefer a set already stashed this session; otherwise
  // read it off the current URL (the /r/<code> redirect lands here with UTM) and
  // persist it so it survives in-page navigation before the visitor submits.
  // Runs only on the client (effect), so SSR renders empty and hydration fills it.
  useEffect(() => {
    let stored: Partial<UtmFields> | null = null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as Partial<UtmFields>;
    } catch {
      /* malformed/unavailable storage — pickFirstTouchUtm falls back to the URL */
    }
    const { utm: resolved, fromUrl } = pickFirstTouchUtm(stored, window.location.search);
    setUtm(resolved);
    if (fromUrl) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
      } catch {
        /* best-effort persistence */
      }
    }
  }, []);

  return (
    <form className="join-form" action={action} noValidate>
      {UTM_FIELDS.map((k) => (
        <input key={k} type="hidden" name={k} value={utm[k]} readOnly />
      ))}
      <input
        type="email"
        name="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@studio.com"
        aria-label="Email address"
      />
      <button className="btn btn-solid" type="submit" disabled={pending}>
        {pending ? 'Joining…' : 'Claim a seat'}
      </button>
      {state && (
        <p className={`join-msg ${state.ok ? 'ok' : 'err'}`} role="status" aria-live="polite" style={{ flexBasis: '100%' }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
