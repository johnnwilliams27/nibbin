export type ReferenceCalculation = {
  health_factor: string; headroom: string; max_debt_before_liquidation: string;
  inputs: { collateral: string; debt: string; threshold: string }; formula: string;
};

/** Parse presentation fields, not a correctness rating or a live position reading. */
export function parseReferenceResult(content: string): ReferenceCalculation | null {
  if (content.length > 16000) return null;
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || !value.inputs || typeof value.inputs !== 'object') return null;
    const decimal = (entry: unknown, signed = false): entry is string => typeof entry === 'string' && entry.length <= 80 && (signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(entry);
    if (!decimal(value.health_factor) || !decimal(value.headroom, true) || !decimal(value.max_debt_before_liquidation)) return null;
    const { collateral, debt, threshold } = value.inputs;
    if (![collateral, debt, threshold].every((entry) => decimal(entry) && Number(entry) > 0) || Number(threshold) > 1) return null;
    if (value.formula !== '(collateral * threshold) / debt') return null;
    return { health_factor: value.health_factor, headroom: value.headroom, max_debt_before_liquidation: value.max_debt_before_liquidation, inputs: { collateral, debt, threshold }, formula: value.formula };
  } catch { return null; }
}

export function settlementWait(submittedAt: bigint, windowSeconds: bigint | null, nowSeconds: bigint): bigint | null {
  if (submittedAt <= 0n || windowSeconds === null || windowSeconds < 0n || nowSeconds < 0n) return null;
  const remaining = submittedAt + windowSeconds - nowSeconds;
  return remaining > 0n ? remaining : 0n;
}
