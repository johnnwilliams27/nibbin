/**
 * Validate a staff credit-adjustment form into a signed delta + reason.
 * Pure — the DB function staff_adjust_credits is the atomic, audited writer;
 * this just turns UI input into its arguments and fails closed on bad input.
 */
export type AdjustmentDirection = 'grant' | 'clawback';

export interface AdjustmentInput {
  amount: string;
  direction: AdjustmentDirection;
  reason: string;
}

export interface Adjustment {
  delta: number;
  reason: string;
}

export function parseAdjustment(input: AdjustmentInput): Adjustment {
  if (input.direction !== 'grant' && input.direction !== 'clawback') {
    throw new Error('direction must be grant or clawback');
  }
  const reason = (input.reason ?? '').trim();
  if (reason === '') {
    throw new Error('a reason is required');
  }
  if (reason.length > 500) {
    throw new Error('reason is too long (max 500 characters)');
  }
  if (!/^\d+$/.test(input.amount)) {
    throw new Error('amount must be a whole number of credits');
  }
  const magnitude = Number(input.amount);
  if (!Number.isSafeInteger(magnitude) || magnitude <= 0) {
    throw new Error('amount must be a positive whole number within range');
  }
  return { delta: input.direction === 'grant' ? magnitude : -magnitude, reason };
}
