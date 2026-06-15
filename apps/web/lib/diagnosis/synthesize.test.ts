import { describe, it, expect } from 'vitest';
import { validateSynthesisPacket } from './synthesize';

const base = {
  version: 1, studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
  workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'],
                minutesObserved: 120, sessions: 10 }],
};

describe('validateSynthesisPacket studyId', () => {
  it('passes studyId through, clamped', () => {
    const p = validateSynthesisPacket({ ...base, studyId: 'study_abc' });
    expect(p?.studyId).toBe('study_abc');
  });
  it('tolerates a missing studyId (web caller)', () => {
    const p = validateSynthesisPacket(base);
    expect(p).not.toBeNull();
    expect(p?.studyId ?? '').toBe('');
  });
});
