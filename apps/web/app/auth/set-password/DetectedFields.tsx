'use client';

/**
 * Hidden fields that capture the browser's timezone + locale at sign-up, so the
 * new user doesn't have to fill them in by hand (they can still change them in
 * Settings → Profile). The device's resolved timezone is more accurate than an
 * IP lookup, and `navigator.language` gives the locale directly.
 */
import { useEffect, useRef } from 'react';

export function DetectedFields() {
  const tzRef = useRef<HTMLInputElement>(null);
  const localeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tzRef.current) tzRef.current.value = tz;
    } catch {
      /* leave blank — the user can set it in Settings */
    }
    if (navigator.language && localeRef.current) localeRef.current.value = navigator.language;
  }, []);

  return (
    <>
      <input ref={tzRef} type="hidden" name="tz" />
      <input ref={localeRef} type="hidden" name="locale" />
    </>
  );
}
