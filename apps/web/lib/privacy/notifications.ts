/** Pure helpers for the notification-preferences UI (T&C spec §7.4). */

/** 0..23 → "12 AM" / "9 PM" etc. */
export function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

export const HOUR_OPTIONS: { value: string; label: string }[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: formatHour(h),
}));

/** Clamp any input to a valid hour (0..23); non-numeric → 0. */
function toHour(v: FormDataEntryValue | null): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, n));
}

export interface NotificationPrefs {
  emailEnabled: boolean;
  quietStart: number;
  quietEnd: number;
}

export function parseNotificationPrefs(form: FormData): NotificationPrefs {
  return {
    emailEnabled: form.get('email_enabled') === 'on',
    quietStart: toHour(form.get('quiet_start')),
    quietEnd: toHour(form.get('quiet_end')),
  };
}
