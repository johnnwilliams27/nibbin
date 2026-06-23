/**
 * Unit tests for office-extract.ts — pptx text extraction.
 *
 * Uses fflate's zipSync to build minimal in-memory pptx fixtures so we do
 * NOT need a real .pptx file on disk.  fflate is NOT mocked here — we test
 * the real unzip path against a synthetic archive.
 *
 * Run: npx vitest run apps/web/lib/brain/office-extract.test.ts
 */
import { describe, it, expect } from 'vitest';
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
import { extractPptxText, extractXlsxText, extractSvgText } from './office-extract';

// ── Helper: build a minimal in-memory xlsx buffer ──────────────────────────

/**
 * Make a minimal .xlsx buffer (zip) with optional sharedStrings and sheets.
 *
 * @param sharedStrings  Array of string values for xl/sharedStrings.xml <si><t>…</t></si> items.
 *                       Pass [] or omit to produce an xlsx without a sharedStrings file.
 * @param sheets         Map of sheet name → XML string for xl/worksheets/sheet<N>.xml.
 *                       Keys are sorted alphabetically so sheet1 < sheet2.
 *
 * An empty call makXlsx() produces an archive with no shared strings and no sheets.
 */
function makeXlsx(
  sharedStrings: string[] = [],
  sheets: Record<string, string> = {},
): Buffer {
  const files: Record<string, Uint8Array> = {};

  if (sharedStrings.length > 0) {
    const sis = sharedStrings.map((s) => `<si><t>${s}</t></si>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sis}</sst>`;
    files['xl/sharedStrings.xml'] = strToU8(xml);
  }

  let sheetIndex = 1;
  for (const [, xml] of Object.entries(sheets).sort()) {
    files[`xl/worksheets/sheet${sheetIndex}.xml`] = strToU8(xml);
    sheetIndex++;
  }

  return Buffer.from(zipSync(files));
}

/** Build a minimal xl/worksheets/sheet.xml with given rows of cell descriptors. */
interface CellDef {
  /** 'A1', 'B2', etc. */
  ref: string;
  /** 's' = shared string, 'inlineStr' = inline string, undefined/other = numeric/literal */
  t?: 's' | 'inlineStr' | string;
  /** For t='s': shared-string index as string; for t='inlineStr': the text; for other: the literal value */
  value: string;
}

function sheetXml(cells: CellDef[]): string {
  const cellXmls = cells.map((c) => {
    const tAttr = c.t ? ` t="${c.t}"` : '';
    if (c.t === 'inlineStr') {
      return `<c r="${c.ref}"${tAttr}><is><t>${c.value}</t></is></c>`;
    }
    return `<c r="${c.ref}"${tAttr}><v>${c.value}</v></c>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>${cellXmls.join('')}</row></sheetData></worksheet>`;
}

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

// ── extractXlsxText tests ──────────────────────────────────────────────────

describe('extractXlsxText', () => {
  it('shared-string cells → text contains the shared string values', async () => {
    // Build an xlsx with sharedStrings ["Price", "100"] and a sheet referencing them.
    const buf = makeXlsx(
      ['Price', '100'],
      {
        sheet1: sheetXml([
          { ref: 'A1', t: 's', value: '0' }, // → "Price"
          { ref: 'B1', t: 's', value: '1' }, // → "100"
        ]),
      },
    );
    const result = await extractXlsxText(buf);
    expect(result).toContain('Price');
    expect(result).toContain('100');
  });

  it('inline string cells → text contains the inline values', async () => {
    const buf = makeXlsx(
      [],
      {
        sheet1: sheetXml([
          { ref: 'A1', t: 'inlineStr', value: 'Hello' },
          { ref: 'B1', t: 'inlineStr', value: 'World' },
        ]),
      },
    );
    const result = await extractXlsxText(buf);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('numeric/literal cell values → text contains the literal value', async () => {
    const buf = makeXlsx(
      [],
      {
        sheet1: sheetXml([
          { ref: 'A1', value: '42' },
          { ref: 'B1', value: '3.14' },
        ]),
      },
    );
    const result = await extractXlsxText(buf);
    expect(result).toContain('42');
    expect(result).toContain('3.14');
  });

  it('empty workbook (no sheets, no sharedStrings) → empty string', async () => {
    const buf = makeXlsx(); // no entries at all
    const result = await extractXlsxText(buf);
    expect(result).toBe('');
  });

  it('workbook with sheets but no cells → empty string', async () => {
    const emptySheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;
    const buf = makeXlsx([], { sheet1: emptySheetXml });
    const result = await extractXlsxText(buf);
    expect(result).toBe('');
  });

  it('output is capped at 50 000 chars', async () => {
    // Build a sheet with many shared-string cells totalling > 50k chars.
    const longValue = 'X'.repeat(1000);
    const sharedStrings = Array.from({ length: 60 }, () => longValue);
    const cells: CellDef[] = sharedStrings.map((_, i) => ({
      ref: `A${i + 1}`,
      t: 's' as const,
      value: String(i),
    }));
    const buf = makeXlsx(sharedStrings, { sheet1: sheetXml(cells) });
    const result = await extractXlsxText(buf);
    expect(result.length).toBeLessThanOrEqual(50_000);
  });

  it('multiple sheets → text from all sheets present', async () => {
    const buf = makeXlsx(
      ['Sheet1Value', 'Sheet2Value'],
      {
        // Both are named differently but sheet index is determined by sort order.
        sheet1: sheetXml([{ ref: 'A1', t: 's', value: '0' }]),
        sheet2: sheetXml([{ ref: 'A1', t: 's', value: '1' }]),
      },
    );
    const result = await extractXlsxText(buf);
    expect(result).toContain('Sheet1Value');
    expect(result).toContain('Sheet2Value');
  });

  it('mixed shared-string + inline + numeric in same sheet', async () => {
    const buf = makeXlsx(
      ['Name'],
      {
        sheet1: sheetXml([
          { ref: 'A1', t: 's', value: '0' },        // shared → "Name"
          { ref: 'B1', t: 'inlineStr', value: 'Alice' }, // inline
          { ref: 'C1', value: '99' },                // numeric
        ]),
      },
    );
    const result = await extractXlsxText(buf);
    expect(result).toContain('Name');
    expect(result).toContain('Alice');
    expect(result).toContain('99');
  });
});

// ── extractSvgText tests ───────────────────────────────────────────────────

describe('extractSvgText', () => {
  it('svg with <title> and <text> (with nested <tspan>) → contains both text values', () => {
    const svgXml = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <title>Acme</title>
  <text x="10" y="20">Logo<tspan>!</tspan></text>
</svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    expect(result).toContain('Acme');
    expect(result).toContain('Logo');
  });

  it('svg with <desc> element → desc text included', () => {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg">
  <desc>Company logo for Acme Corp</desc>
</svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    expect(result).toContain('Company logo for Acme Corp');
  });

  it('text-less svg (<svg><rect/></svg>) → empty string', () => {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    expect(result).toBe('');
  });

  it('svg with only whitespace inside text elements → empty string', () => {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg">
  <text>   </text>
  <title>  </title>
</svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    expect(result).toBe('');
  });

  it('output is capped at 50 000 chars', () => {
    const longText = 'X'.repeat(60_000);
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg"><text>${longText}</text></svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    expect(result.length).toBeLessThanOrEqual(50_000);
  });

  it('nested tags inside <text> are stripped (only text content retained)', () => {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg">
  <text>Hello<tspan dy="1em">World</tspan></text>
</svg>`;
    const buf = Buffer.from(svgXml, 'utf8');
    const result = extractSvgText(buf);
    // Should contain the text words but not tag markup
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).not.toContain('<tspan');
  });
});
