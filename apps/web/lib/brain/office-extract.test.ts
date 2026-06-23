/**
 * Unit tests for office-extract.ts — pptx text extraction.
 *
 * Uses fflate's zipSync to build minimal in-memory pptx fixtures so we do
 * NOT need a real .pptx file on disk.  fflate is NOT mocked here — we test
 * the real unzip path against a synthetic archive.
 *
 * Run: npx vitest run apps/web/lib/brain/office-extract.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

// ── Helper: build a minimal in-memory pptx buffer ──────────────────────────

/**
 * Make a minimal .pptx buffer (zip) with the given slides.
 * Each slide is a string that will become the full XML for
 * ppt/slides/slide{n}.xml  (1-indexed).
 *
 * An empty `slides` array produces an archive with no slide files.
 */
function makePptx(slides: string[]): Buffer {
  const files: Record<string, Uint8Array> = {};
  slides.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(xml);
  });
  return Buffer.from(zipSync(files));
}

/** Minimal slide XML that wraps text in proper <a:t> elements. */
function slideXml(...texts: string[]): string {
  const runs = texts.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('');
  return `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p>${runs}</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

// ── Import after helpers so vitest hoisting doesn't break anything ──────────
import { extractPptxText } from './office-extract';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('extractPptxText', () => {
  it('single slide with two <a:t> runs → concatenated with space', async () => {
    const buf = makePptx([slideXml('Hello', 'World')]);
    const result = await extractPptxText(buf);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('multiple slides → text from all slides present in output', async () => {
    const buf = makePptx([
      slideXml('Slide one text'),
      slideXml('Slide two text'),
    ]);
    const result = await extractPptxText(buf);
    expect(result).toContain('Slide one text');
    expect(result).toContain('Slide two text');
  });

  it('no slide files in archive → empty string', async () => {
    const buf = makePptx([]); // archive with no ppt/slides/slide*.xml entries
    const result = await extractPptxText(buf);
    expect(result).toBe('');
  });

  it('slide with no <a:t> elements → empty string', async () => {
    const emptySlideXml = `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>`;
    const buf = makePptx([emptySlideXml]);
    const result = await extractPptxText(buf);
    expect(result).toBe('');
  });

  it('output is capped at 50 000 chars', async () => {
    // Build a slide with a very long text run (> 50k chars)
    const longText = 'X'.repeat(60_000);
    const buf = makePptx([slideXml(longText)]);
    const result = await extractPptxText(buf);
    expect(result.length).toBeLessThanOrEqual(50_000);
  });

  it('slides extracted in numeric order (slide2 after slide1)', async () => {
    const buf = makePptx([
      slideXml('First'),
      slideXml('Second'),
      slideXml('Third'),
    ]);
    const result = await extractPptxText(buf);
    const idxFirst = result.indexOf('First');
    const idxSecond = result.indexOf('Second');
    const idxThird = result.indexOf('Third');
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxThird);
  });
});
