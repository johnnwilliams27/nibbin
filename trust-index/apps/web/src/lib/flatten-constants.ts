/** Walks MethodologyConstants into flat rows for /methodology, so every constant renders from DEFAULT_CONSTANTS rather than being hand-copied. */
import type { MethodologyConstants, TunableConstant } from "@trust-index/types";

export type ConstantRow = {
  path: string;
  value: string;
  provisional: boolean;
  tuningRun: string | null;
  basis: string;
};

function isTunable(v: unknown): v is TunableConstant {
  return (
    typeof v === "object" &&
    v !== null &&
    "value" in v &&
    "provenance" in v &&
    typeof (v as TunableConstant).value === "string"
  );
}

export function flattenConstants(constants: MethodologyConstants): ConstantRow[] {
  const rows: ConstantRow[] = [];
  function walk(prefix: string, obj: unknown): void {
    if (isTunable(obj)) {
      rows.push({
        path: prefix,
        value: obj.value,
        provisional: obj.provenance.provisional,
        tuningRun: obj.provenance.tuning_run,
        basis: obj.provenance.basis,
      });
      return;
    }
    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      for (const [key, val] of Object.entries(obj)) {
        walk(prefix ? `${prefix}.${key}` : key, val);
      }
    }
  }
  walk("", constants);
  return rows;
}

/** Non-tunable methodology choices (fixed string enums, not swept constants). */
export function methodChoices(constants: MethodologyConstants): Array<{ name: string; value: string }> {
  return [
    { name: "interval_method", value: constants.interval_method },
    { name: "confidence_transform", value: constants.confidence_transform },
  ];
}
