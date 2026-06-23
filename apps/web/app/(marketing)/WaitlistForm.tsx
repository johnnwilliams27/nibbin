'use client';

import { useActionState, useEffect, useState } from 'react';
import { joinWaitlist, type JoinResult } from './actions';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'] as const;
type Utm = Record<(typeof UTM_KEYS)[number], string>;
const EMPTY_UTM: Utm = { utm_source: '', utm_medium: '', utm_campaign: '', ref: '' };
const STORAGE_KEY = 'nibbin_utm';

/**
 * First-touch attribution: prefer a UTM set already stashed this session;
 * otherwise read it off the current URL (the /r/<code> redirect lands here with
 * ?utm_source=...&ref=...) and stash it so it survives in-page navigation before
 * the visitor submits. Server-side renders empty (no window) — the effect fills it.
 */
function readUtm(): Utm {
  if (typeof window === 'undefined') return EMPTY_UTM;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return { ...EMPTY_UTM, ...(JSON.parse(stored) as Partial<Utm>) };
  } catch {
    /* sessionStorage unavailable (private mode) — fall through to the URL */
  }
  const params = new URLSearchParams(window.location.search);
  const next: Utm = { ...EMPTY_UTM };
  let found = false;
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) {
      next[k] = v;
      found = true;
    }
  }
  if (found) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* best-effort persistence */
    }
  }
  return next;
}

export function WaitlistForm() {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(joinWaitlist, null);
  const [utm, setUtm] = useState<Utm>(EMPTY_UTM);

  useEffect(() => {
    setUtm(readUtm());
  }, []);

  return (
    <form className="join-form" action={action} noValidate>
      {UTM_KEYS.map((k) => (
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
