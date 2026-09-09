const SCALE = 100000000n;
const DECIMAL = /^(0|[1-9]\d{0,12})(?:\.(\d{1,8}))?$/;

function units(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error('Use positive decimal strings with at most eight decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function fixed(numerator, denominator, places) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const scaled = (magnitude * 10n ** BigInt(places) + denominator / 2n) / denominator;
  const digits = scaled.toString().padStart(places + 1, '0');
  return `${negative && scaled !== 0n ? '-' : ''}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export function calculate(task) {
  if (typeof task !== 'string' || task.length > 1000) throw new Error('Task must contain collateral, debt and threshold.');
  let input;
  if (task.trim().startsWith('{')) {
    input = JSON.parse(task);
    if (!input || input.kind !== 'health_factor_v1' || Object.keys(input).some((key) => !['kind', 'collateral', 'debt', 'threshold'].includes(key))) throw new Error('Unsupported task.');
  } else {
    const match = /^collateral=(\d+(?:\.\d+)?)\s+debt=(\d+(?:\.\d+)?)\s+threshold=(\d+(?:\.\d+)?)$/.exec(task.trim());
    if (!match) throw new Error('Use collateral=12500 debt=6200 threshold=0.825.');
    input = { collateral: match[1], debt: match[2], threshold: match[3] };
  }
  const collateral = units(input.collateral);
  const debt = units(input.debt);
  const threshold = units(input.threshold);
  if (debt <= 0n || collateral <= 0n || threshold <= 0n || threshold > SCALE) throw new Error('Collateral and debt must be positive; threshold must be greater than zero and at most one.');
  const limit = collateral * threshold;
  return {
    health_factor: fixed(limit, debt * SCALE, 4),
    risk: limit > debt * SCALE ? 'ABOVE_LIQUIDATION_THRESHOLD' : 'AT_OR_BELOW_LIQUIDATION_THRESHOLD',
    max_debt_before_liquidation: fixed(limit, SCALE * SCALE, 2),
    headroom: fixed(limit - debt * SCALE, SCALE * SCALE, 2),
    inputs: { collateral: input.collateral, debt: input.debt, threshold: input.threshold },
    formula: '(collateral * threshold) / debt',
    method: 'deterministic arithmetic from user-supplied inputs; no live position data',
    limitations: 'Reference demonstration, not investment advice, live monitoring, liquidation protection or an independent Nibbin rating.',
  };
}
