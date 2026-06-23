/**
 * Unit tests for synthesis-prompt.ts (P5 Task 4).
 *
 * Pure string / pure function — no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import {
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisInput,
  type SynthesisPassage,
} from '../src/synthesis-prompt';

describe('SYNTHESIS_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof SYNTHESIS_SYSTEM_PROMPT).toBe('string');
    expect(SYNTHESIS_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('instructs the model to answer from passages only (hallucination guard)', () => {
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/passages only/i);
  });

  it('instructs the model to cite every claim with [N] anchors', () => {
    // The prompt must contain the citation instruction so the model appends [N].
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/\[N\]/);
  });

  it('instructs the model to output JSON with summary, answer, citations, hasGap, gapNote', () => {
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"summary"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"answer"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"citations"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"hasGap"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"gapNote"/);
  });

  it('specifies the citation schema with passageIndex, label, kind, sourceId, excerpt', () => {
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"passageIndex"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"label"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"kind"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"sourceId"/);
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/"excerpt"/);
  });

  it('instructs the model to set hasGap=true when passages do not fully answer', () => {
    expect(SYNTHESIS_SYSTEM_PROMPT).toMatch(/hasGap.*true/i);
  });
});

describe('buildSynthesisInput', () => {
  const passages: SynthesisPassage[] = [
    {
      index: 0,
      kind: 'memory',
      label: 'Memory: pricing',
      text: 'I charge $120/hr for portrait sessions.',
    },
    {
      index: 1,
      kind: 'source',
      label: 'Acme Contract',
      sourceId: 'src-uuid-1',
      text: 'Acme Corp has a net-30 payment term and a $5000/mo retainer.',
    },
  ];

  it('includes the passage index (citation anchor) for each passage', () => {
    const result = buildSynthesisInput('What is my rate?', passages);
    expect(result).toContain('[0]');
    expect(result).toContain('[1]');
  });

  it('includes the passage kind for each passage', () => {
    const result = buildSynthesisInput('What is my rate?', passages);
    expect(result).toContain('(memory)');
    expect(result).toContain('(source)');
  });

  it('includes the passage label for each passage', () => {
    const result = buildSynthesisInput('What is my rate?', passages);
    expect(result).toContain('Memory: pricing');
    expect(result).toContain('Acme Contract');
  });

  it('includes the passage text for each passage', () => {
    const result = buildSynthesisInput('What is my rate?', passages);
    expect(result).toContain('I charge $120/hr for portrait sessions.');
    expect(result).toContain('Acme Corp has a net-30 payment term');
  });

  it('includes the question at the end', () => {
    const question = 'What is my rate?';
    const result = buildSynthesisInput(question, passages);
    // Question must appear after the passages block.
    const passageEnd = result.lastIndexOf(passages[passages.length - 1]!.text);
    const questionPos = result.lastIndexOf(`Question: ${question}`);
    expect(questionPos).toBeGreaterThan(passageEnd);
  });

  it('produces correct output for 0 passages (edge case)', () => {
    const result = buildSynthesisInput('What is my rate?', []);
    expect(result).toContain('Passages:');
    expect(result).toContain('(none)');
    expect(result).toContain('Question: What is my rate?');
  });

  it('begins with "Passages:"', () => {
    const result = buildSynthesisInput('hello?', passages);
    expect(result.startsWith('Passages:')).toBe(true);
  });

  it('passages carry the sourceId when kind is source (caller can map back to source_id)', () => {
    // This test verifies the SynthesisPassage type contract: sourceId is present
    // for source-kind passages. The buildSynthesisInput function receives it; the
    // engine uses the index-to-passage map, not the text content, to recover sourceId.
    const sourcePassage = passages.find((p) => p.kind === 'source');
    expect(sourcePassage?.sourceId).toBe('src-uuid-1');
  });

  it('each passage block format is "[N] (kind) label\\ntext"', () => {
    const single: SynthesisPassage[] = [
      { index: 2, kind: 'source', label: 'Invoice 1042', sourceId: 'src-2', text: '$2500 due April 1.' },
    ];
    const result = buildSynthesisInput('When is it due?', single);
    expect(result).toContain('[2] (source) Invoice 1042\n$2500 due April 1.');
  });
});
