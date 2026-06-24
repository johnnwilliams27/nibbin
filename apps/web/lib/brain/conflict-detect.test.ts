/**
 * Unit tests for conflict-detect.ts — deterministic field-conflict detection.
 *
 * All tests are pure (no I/O, no model calls, no DB).
 * Run: npx vitest run apps/web/lib/brain/conflict-detect.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  detectFieldConflicts,
  type FieldInput,
} from './conflict-detect';

// Default authority weights matching the plan's seeded defaults.
const DEFAULT_AUTHORITY = {
  document: 70,
  manual: 65,
  connector_artifact: 50,
  observation: 40,
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeField(
  fieldKey: string,
  currentValue: string,
  contributions: Array<{ sourceId: string; sourceKind: 'document' | 'connector_artifact' | 'observation' | 'manual'; value: string }>,
): FieldInput {
  return { fieldKey, currentValue, contributions };
}

// ── Basic conflict detection ──────────────────────────────────────────────────

describe('detectFieldConflicts — basic conflict', () => {
  it('two sources with materially different values → exactly one conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.fieldKey).toBe('pricing');
    expect(c.competingSourceIds).toContain('src-1');
    expect(c.competingSourceIds).toContain('src-2');
    expect(c.competingSourceIds).toHaveLength(2);
  });

  it('suggested source is the one with the highest authority weight', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'low-auth', sourceKind: 'observation', value: '50% deposit' },
        { sourceId: 'high-auth', sourceKind: 'document', value: '30% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    // document(70) > observation(40) → high-auth wins
    expect(conflicts[0].suggestedSourceId).toBe('high-auth');
  });

  it('suggested source uses manual when manual is highest authority', () => {
    const fields: FieldInput[] = [
      makeField('policies', '', [
        { sourceId: 'manual-src', sourceKind: 'manual', value: 'No refunds' },
        { sourceId: 'connector-src', sourceKind: 'connector_artifact', value: 'Full refunds within 30 days' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    // manual(65) > connector_artifact(50)
    expect(conflicts[0].suggestedSourceId).toBe('manual-src');
  });

  it('exposes the distinct ORIGINAL competing values (for the LLM judge)', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '  50% Deposit  ' },
        { sourceId: 'src-2', sourceKind: 'observation', value: '30% deposit' },
        // duplicate of src-2 by normalized identity → must NOT appear twice
        { sourceId: 'src-3', sourceKind: 'manual', value: '30%   DEPOSIT' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    // Original (trimmed) text, de-duped by normalized identity, first-appearance order.
    expect(conflicts[0].distinctValues).toEqual(['50% Deposit', '30% deposit']);
  });
});

// ── No-conflict cases ─────────────────────────────────────────────────────────

describe('detectFieldConflicts — no conflict', () => {
  it('identical values → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '50% deposit' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('whitespace-only differences → no conflict (normalization)', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '  50%  deposit  ' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '50% deposit' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('case-only differences → no conflict (normalization)', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: 'NO REFUNDS' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: 'no refunds' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('mixed case and whitespace → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('hard_rules', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: 'Payment  Due  IMMEDIATELY' },
        { sourceId: 'src-2', sourceKind: 'manual', value: 'payment due immediately' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('one value is a substring of the other → no conflict (near-dup suppression)', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: 'deposit required' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '50% deposit required' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('longer value is a substring of shorter value → same rule, no conflict', () => {
    // "deposit" is substring of "deposit required" so also no conflict
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit required' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: 'deposit required' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('single source → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('empty contributions → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', 'some current value', []),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('contributions with empty/whitespace-only values are ignored', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '   ' },
      ]),
    ];
    // src-2 normalizes to empty → ignored → only 1 effective source → no conflict
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });
});

// ── Stakes ───────────────────────────────────────────────────────────────────

describe('detectFieldConflicts — stakes', () => {
  const conflictingContributions = [
    { sourceId: 'src-1', sourceKind: 'document' as const, value: 'option A' },
    { sourceId: 'src-2', sourceKind: 'connector_artifact' as const, value: 'option B' },
  ];

  it('"pricing" fieldKey → stakes="high"', () => {
    const fields: FieldInput[] = [makeField('pricing', '', conflictingContributions)];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].stakes).toBe('high');
  });

  it('"policies" fieldKey → stakes="high"', () => {
    const fields: FieldInput[] = [makeField('policies', '', conflictingContributions)];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].stakes).toBe('high');
  });

  it('"hard_rules" fieldKey → stakes="high"', () => {
    const fields: FieldInput[] = [makeField('hard_rules', '', conflictingContributions)];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].stakes).toBe('high');
  });

  it('other fieldKey → stakes="normal"', () => {
    const fields: FieldInput[] = [makeField('location', '', conflictingContributions)];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].stakes).toBe('normal');
  });

  it('"business_name" fieldKey → stakes="normal"', () => {
    const fields: FieldInput[] = [makeField('business_name', '', conflictingContributions)];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].stakes).toBe('normal');
  });
});

// ── Three sources ─────────────────────────────────────────────────────────────

describe('detectFieldConflicts — three sources', () => {
  it('three sources with two distinct values → one conflict with all three source ids', () => {
    // src-1 and src-3 agree; src-2 disagrees → all three participate because
    // there are ≥2 distinct normalized values from ≥2 distinct sources.
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
        { sourceId: 'src-3', sourceKind: 'observation', value: '50% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.competingSourceIds).toContain('src-1');
    expect(c.competingSourceIds).toContain('src-2');
    expect(c.competingSourceIds).toContain('src-3');
    expect(c.competingSourceIds).toHaveLength(3);
  });

  it('three sources with all distinct values → one conflict with all three source ids', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
        { sourceId: 'src-3', sourceKind: 'observation', value: '20% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].competingSourceIds).toHaveLength(3);
  });

  it('three sources all identical → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '50% deposit' },
        { sourceId: 'src-3', sourceKind: 'observation', value: '50% deposit' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('suggested is the highest-authority kind among all competing sources', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'obs-src', sourceKind: 'observation', value: '50% deposit' },
        { sourceId: 'doc-src', sourceKind: 'document', value: '30% deposit' },
        { sourceId: 'con-src', sourceKind: 'connector_artifact', value: '20% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    // document(70) is highest
    expect(conflicts[0].suggestedSourceId).toBe('doc-src');
  });
});

// ── Tie-break ─────────────────────────────────────────────────────────────────

describe('detectFieldConflicts — tie-break is deterministic', () => {
  it('two sources with same authority kind → first in input order wins', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-first', sourceKind: 'document', value: 'option A' },
        { sourceId: 'src-second', sourceKind: 'document', value: 'option B' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    // Both are 'document'(70) — first in input order wins
    expect(conflicts[0].suggestedSourceId).toBe('src-first');
  });

  it('tie-break is stable across repeated calls (deterministic)', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-a', sourceKind: 'connector_artifact', value: 'alpha' },
        { sourceId: 'src-b', sourceKind: 'connector_artifact', value: 'beta' },
      ]),
    ];
    const r1 = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    const r2 = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(r1[0].suggestedSourceId).toBe(r2[0].suggestedSourceId);
    expect(r1[0].suggestedSourceId).toBe('src-a');
  });
});

// ── currentValue as pseudo-contribution ──────────────────────────────────────

describe('detectFieldConflicts — currentValue pseudo-contribution', () => {
  it('currentValue alone with no sources → no conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '50% deposit', []),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('currentValue that differs from one source → no conflict (need ≥2 source disagreement)', () => {
    // Only one source, even if currentValue is different — sources must disagree among themselves
    const fields: FieldInput[] = [
      makeField('pricing', '50% deposit', [
        { sourceId: 'src-1', sourceKind: 'document', value: '30% deposit' },
      ]),
    ];
    expect(detectFieldConflicts(fields, DEFAULT_AUTHORITY)).toHaveLength(0);
  });

  it('currentValue materially differs AND two sources also disagree → conflict includes all', () => {
    // Two sources disagree with each other (primary condition met).
    // currentValue also materially differs from at least one.
    // Per spec: currentValue is included as a pseudo-contribution only if
    // ≥2 distinct SOURCES already disagree AND currentValue differs materially.
    const fields: FieldInput[] = [
      makeField('pricing', 'different value entirely', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
    ];
    // The two sources disagree — conflict is detected regardless of currentValue
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
  });
});

// ── Multiple fields ───────────────────────────────────────────────────────────

describe('detectFieldConflicts — multiple fields', () => {
  it('two conflicting fields → two conflicts returned', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
      makeField('policies', '', [
        { sourceId: 'src-3', sourceKind: 'manual', value: 'No refunds' },
        { sourceId: 'src-4', sourceKind: 'observation', value: 'Full refunds within 30 days' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(2);
    const keys = conflicts.map((c) => c.fieldKey);
    expect(keys).toContain('pricing');
    expect(keys).toContain('policies');
  });

  it('one conflicting field and one non-conflicting → only one conflict', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
      makeField('location', '', [
        { sourceId: 'src-3', sourceKind: 'document', value: 'New York' },
        { sourceId: 'src-4', sourceKind: 'connector_artifact', value: 'New York' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fieldKey).toBe('pricing');
  });
});

// ── Detail string ─────────────────────────────────────────────────────────────

describe('detectFieldConflicts — detail string', () => {
  it('detail string contains the fieldKey and competing values', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].detail).toContain('pricing');
    expect(conflicts[0].detail).toContain('50% deposit');
    expect(conflicts[0].detail).toContain('30% deposit');
  });

  it('detail string is at most ~300 chars', () => {
    const longValue = 'X'.repeat(200);
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: longValue + ' A' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: longValue + ' B' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].detail.length).toBeLessThanOrEqual(300);
  });

  it('detail string uses a human-readable format with "vs"', () => {
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'src-2', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].detail).toContain('vs');
  });

  it('detail string is non-empty for any conflict', () => {
    const fields: FieldInput[] = [
      makeField('hard_rules', '', [
        { sourceId: 'src-1', sourceKind: 'document', value: 'payment upfront' },
        { sourceId: 'src-2', sourceKind: 'manual', value: 'payment on delivery' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, DEFAULT_AUTHORITY);
    expect(conflicts[0].detail.length).toBeGreaterThan(0);
  });
});

// ── Custom authority weights ──────────────────────────────────────────────────

describe('detectFieldConflicts — custom authority weights', () => {
  it('custom weights override the suggested source selection', () => {
    const customAuthority = {
      document: 10,
      manual: 10,
      connector_artifact: 90,  // highest
      observation: 10,
    };
    const fields: FieldInput[] = [
      makeField('pricing', '', [
        { sourceId: 'doc-src', sourceKind: 'document', value: '50% deposit' },
        { sourceId: 'con-src', sourceKind: 'connector_artifact', value: '30% deposit' },
      ]),
    ];
    const conflicts = detectFieldConflicts(fields, customAuthority);
    // connector_artifact(90) > document(10) with custom weights
    expect(conflicts[0].suggestedSourceId).toBe('con-src');
  });
});
