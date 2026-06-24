/**
 * Curated timezone + locale lists for the profile UI. The full IANA set
 * (`Intl.supportedValuesOf('timeZone')`, ~400 entries) is overwhelming and
 * labels zones by their representative city only (e.g. `America/Chicago`),
 * which hides that it covers Chicago, Dallas, etc. These short, plainly-labelled
 * lists cover the common cases; a stored value outside the list is preserved by
 * the UI rather than dropped.
 */

export interface Option {
  value: string;
  label: string;
}

/** Common timezones, labelled by the cities people actually search for. */
export const COMMON_TIMEZONES: Option[] = [
  { value: 'Pacific/Honolulu', label: 'Honolulu (Hawaii)' },
  { value: 'America/Anchorage', label: 'Anchorage (Alaska)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles · Seattle (Pacific)' },
  { value: 'America/Phoenix', label: 'Phoenix (Arizona, no DST)' },
  { value: 'America/Denver', label: 'Denver · Salt Lake City (Mountain)' },
  { value: 'America/Chicago', label: 'Chicago · Dallas · Houston (Central)' },
  { value: 'America/New_York', label: 'New York · Atlanta · Miami (Eastern)' },
  { value: 'America/Toronto', label: 'Toronto (Eastern)' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'Europe/London', label: 'London · Dublin' },
  { value: 'Europe/Paris', label: 'Paris · Berlin · Madrid · Rome' },
  { value: 'Europe/Athens', label: 'Athens · Helsinki · Bucharest' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'Mumbai · Delhi · Bengaluru' },
  { value: 'Asia/Singapore', label: 'Singapore · Kuala Lumpur' },
  { value: 'Asia/Shanghai', label: 'Beijing · Shanghai · Hong Kong' },
  { value: 'Asia/Tokyo', label: 'Tokyo · Seoul' },
  { value: 'Australia/Perth', label: 'Perth' },
  { value: 'Australia/Sydney', label: 'Sydney · Melbourne · Brisbane' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
];

/** Common locales (BCP-47), labelled in English. */
export const COMMON_LOCALES: Option[] = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'es-US', label: 'Spanish (United States)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
];

/**
 * Options to render in a select, guaranteeing the user's current value is
 * present even if it's outside the curated list (so saving never drops it).
 */
export function withCurrent(options: Option[], current: string | null): Option[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: current }];
}
