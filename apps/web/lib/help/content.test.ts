import { describe, it, expect } from 'vitest';
import { HELP_CONTENT, filterHelp } from './content';

describe('HELP_CONTENT', () => {
  it('has unique section ids and non-empty articles', () => {
    const ids = HELP_CONTENT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_CONTENT) {
      expect(s.articles.length).toBeGreaterThan(0);
      for (const a of s.articles) {
        expect(a.q.length).toBeGreaterThan(0);
        expect(a.body.length).toBeGreaterThan(0);
      }
    }
  });
  it('covers the required sections', () => {
    const ids = new Set(HELP_CONTENT.map((s) => s.id));
    for (const req of ['getting-started', 'field-study', 'privacy', 'agents', 'connections', 'memory', 'channels', 'faq']) {
      expect(ids.has(req), `missing section ${req}`).toBe(true);
    }
  });
  it('never publishes the dropped "<100ms" claim', () => {
    const all = JSON.stringify(HELP_CONTENT);
    expect(all.includes('100ms')).toBe(false);
  });
  it('contains the required secure-fields phrase', () => {
    expect(JSON.stringify(HELP_CONTENT)).toContain("by construction, never by reading the picture");
  });
});

describe('filterHelp', () => {
  it('returns all sections for an empty query', () => {
    expect(filterHelp('', HELP_CONTENT).length).toBe(HELP_CONTENT.length);
  });
  it('matches across question, body and keywords', () => {
    const res = filterHelp('telegram', HELP_CONTENT);
    expect(res.some((s) => s.articles.some((a) => /telegram/i.test(a.q + a.body + (a.keywords || []).join(' '))))).toBe(true);
  });
});
