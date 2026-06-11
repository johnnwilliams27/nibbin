/**
 * Layer 3a — the regex battery. Always runs, sidecar up or down. Rules live in
 * rules/redaction-rules.json (shared verbatim with the Rust daemon); this
 * module only compiles and applies them in order.
 */
import rulesJson from '../rules/redaction-rules.json';
import type { ValueClass } from './types.js';

interface BatteryRule {
  id: string;
  placeholder: string;
  regex: RegExp;
}

interface ValueClassRule {
  klass: ValueClass;
  regex: RegExp;
}

const battery: BatteryRule[] = rulesJson.battery.map((r) => ({
  id: r.id,
  placeholder: r.placeholder,
  regex: new RegExp(r.pattern, 'g'),
}));

const valueClasses: ValueClassRule[] = rulesJson.valueClasses.map((r) => ({
  klass: r.class as ValueClass,
  regex: new RegExp(r.pattern),
}));

export const RULES_VERSION: number = rulesJson.version;

export interface BatteryResult {
  text: string;
  rulesHit: string[];
}

/** Apply every battery rule in declared order, recording which rules fired. */
export function applyBattery(text: string): BatteryResult {
  let out = text;
  const rulesHit: string[] = [];
  for (const rule of battery) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(out)) {
      rule.regex.lastIndex = 0;
      out = out.replace(rule.regex, rule.placeholder);
      rulesHit.push(rule.id);
    }
  }
  return { text: out, rulesHit };
}

/**
 * Classify a field value, then let the caller discard it. The class — not the
 * value — is the only thing the schema can persist.
 */
export function classifyValue(value: string | null | undefined): ValueClass {
  if (value == null || value.trim() === '') return 'none';
  for (const { klass, regex } of valueClasses) {
    if (regex.test(value.trim())) return klass;
  }
  return 'freeform';
}

/** True if any battery rule still matches — used as a paranoid re-scan on export. */
export function batteryStillMatches(text: string): string | null {
  for (const rule of battery) {
    // The generic NUM sweep matches benign counts/durations that legitimately
    // appear in aggregate fields; the paranoid re-scan is about PII shapes.
    if (rule.id === 'NUM') continue;
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) return rule.id;
  }
  return null;
}
