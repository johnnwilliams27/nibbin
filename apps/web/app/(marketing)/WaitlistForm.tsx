'use client';

import { useActionState } from 'react';
import { joinWaitlist, type JoinResult } from './actions';

export function WaitlistForm() {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(joinWaitlist, null);

  return (
    <form className="join-form" action={action} noValidate>
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
