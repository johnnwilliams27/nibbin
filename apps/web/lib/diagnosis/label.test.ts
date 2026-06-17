import { describe, it, expect } from 'vitest';
import { applyLabeling, sanitizeProse, type ParsedLabeling } from './label';
import type { DiagnosisMap, DiagnosisWorkflow } from './types';

function wf(over: Partial<DiagnosisWorkflow> & Pick<DiagnosisWorkflow, 'key' | 'category'>): DiagnosisWorkflow {
  return {
    label: 'Email',
    hoursPerWeek: 4,
    frequency: 'weekly',
    friction: null,
    recommendedNibbin: 'scribe',
    ...over,
  };
}

function mapOf(...workflows: DiagnosisWorkflow[]): DiagnosisMap {
  return { workflows, totalHoursPerWeek: 0, topRecommendations: [], timeSavedPerWeek: 0, appAllocation: [] };
}

describe('applyLabeling — finer-key refinement', () => {
  it('refines key AND recomputes recommendedNibbin for a valid finer key in-category', () => {
    const map = mapOf(wf({ key: 'email.general', category: 'email', recommendedNibbin: 'scribe' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Client inquiries', description: 'Answering inbound questions.', key: 'email.inquiries' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.inquiries');
    // KEY_TEMPLATE['email.inquiries'] === 'scribe'
    expect(out.workflows[0].recommendedNibbin).toBe('scribe');
    expect(out.workflows[0].label).toBe('Client inquiries');
    expect(out.workflows[0].description).toBe('Answering inbound questions.');
  });

  it('refines to a finer key that changes the recommendation (email.overdue → echo)', () => {
    const map = mapOf(wf({ key: 'email.general', category: 'email', recommendedNibbin: 'scribe' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Chasing late replies', description: 'Following up.', key: 'email.overdue' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.overdue');
    expect(out.workflows[0].recommendedNibbin).toBe('echo');
  });

  it('ignores a cross-category key (payments key on an email workflow)', () => {
    const map = mapOf(wf({ key: 'email.general', category: 'email', recommendedNibbin: 'scribe' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Email', description: 'x', key: 'payments.invoices' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.general');
    expect(out.workflows[0].recommendedNibbin).toBe('scribe');
  });

  it('ignores an unknown / non-allowed key (still in-category but not in the allow-list)', () => {
    const map = mapOf(wf({ key: 'email.general', category: 'email', recommendedNibbin: 'scribe' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Email', description: 'x', key: 'email.whatever' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.general');
    expect(out.workflows[0].recommendedNibbin).toBe('scribe');
  });

  it('keeps the original key + rec when key is omitted, but still applies label/description', () => {
    const map = mapOf(wf({ key: 'email.general', category: 'email', recommendedNibbin: 'scribe', label: 'Email' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Answering clients', description: 'Inbox triage.' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.general');
    expect(out.workflows[0].recommendedNibbin).toBe('scribe');
    expect(out.workflows[0].label).toBe('Answering clients');
    expect(out.workflows[0].description).toBe('Inbox triage.');
  });
});

describe('sanitizeProse — strips injected HTML + URLs from stored LLM prose', () => {
  it('strips an HTML/script tag and an http link', () => {
    const dirty = 'Your account is at risk! <script>steal()</script> Verify at http://evil.example/login now.';
    const clean = sanitizeProse(dirty);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('</script>');
    expect(clean).not.toContain('http://evil.example');
    expect(clean).not.toMatch(/<[^>]*>/);
    // The benign prose around it survives.
    expect(clean).toContain('Your account is at risk');
    expect(clean).toContain('Verify at');
  });

  it('strips an anchor tag and a bare www. link', () => {
    const clean = sanitizeProse('Click <a href="http://evil.example">here</a> or visit www.evil.example/x for more.');
    expect(clean).not.toMatch(/<[^>]*>/);
    expect(clean).not.toContain('http://');
    expect(clean).not.toContain('www.evil.example');
    expect(clean).toContain('here');
  });

  it('leaves clean prose untouched', () => {
    const s = "Here's what I learned about how you work: most of your week goes to email.";
    expect(sanitizeProse(s)).toBe(s);
  });
});

describe('applyLabeling — join semantics', () => {
  it('joins by id (the original key), not by the refined key', () => {
    const map = mapOf(
      wf({ key: 'email.general', category: 'email', label: 'Email', recommendedNibbin: 'scribe' }),
      wf({ key: 'payments.general', category: 'payments', label: 'Payments', recommendedNibbin: 'tally', hoursPerWeek: 2 }),
    );
    const parsed: ParsedLabeling = {
      workflows: [
        { id: 'email.general', label: 'Inquiries', description: 'd', key: 'email.inquiries' },
        { id: 'payments.general', label: 'Invoicing', description: 'd2', key: 'payments.invoices' },
      ],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('email.inquiries');
    expect(out.workflows[0].label).toBe('Inquiries');
    expect(out.workflows[1].key).toBe('payments.invoices');
    expect(out.workflows[1].label).toBe('Invoicing');
    expect(out.workflows[1].recommendedNibbin).toBe('tally');
  });

  it('leaves unmatched workflows (no parsed id) untouched', () => {
    const map = mapOf(
      wf({ key: 'email.general', category: 'email', label: 'Email' }),
      wf({ key: 'calendar.general', category: 'calendar', label: 'Scheduling', recommendedNibbin: 'hopper' }),
    );
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'email.general', label: 'Inbox', description: 'd' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[1].label).toBe('Scheduling');
    expect(out.workflows[1].recommendedNibbin).toBe('hopper');
    expect(out.workflows[1].description).toBeUndefined();
  });

  it('a calendar.general → calendar.confirmations refinement keeps hopper', () => {
    const map = mapOf(wf({ key: 'calendar.general', category: 'calendar', label: 'Scheduling', recommendedNibbin: 'hopper' }));
    const parsed: ParsedLabeling = {
      workflows: [{ id: 'calendar.general', label: 'Confirming bookings', description: 'd', key: 'calendar.confirmations' }],
      letter: 'l',
    };
    const out = applyLabeling(map, parsed);
    expect(out.workflows[0].key).toBe('calendar.confirmations');
    expect(out.workflows[0].recommendedNibbin).toBe('hopper');
  });
});

describe('sanitizeProse — sweep output gate', () => {
  it('strips HTML injected via a voice sample', () => {
    expect(sanitizeProse('<img src=x onerror=alert(1)> genuine voice')).toBe('genuine voice');
  });
  it('strips bare www. links', () => {
    expect(sanitizeProse('contact me at www.evil.com for details')).toBe('contact me at for details');
  });
});
