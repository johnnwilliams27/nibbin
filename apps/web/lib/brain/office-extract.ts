/**
 * Office file text extractors for the P2 brain document pipeline.
 *
 * Uses fflate (tiny zero-dependency unzip) so we ship no heavy parser.
 * Exports:
 *   extractPptxText(buffer): unzip → read ppt/slides/slide*.xml (numeric order)
 *                             → concatenate <a:t>…</a:t> runs → cap at RAW_TEXT_CAP.
 *   extractXlsxText(buffer): unzip → parse xl/sharedStrings.xml → read
 *                             xl/worksheets/sheet*.xml (numeric order) → resolve
 *                             shared-string, inline-string, and numeric cells →
 *                             join with tabs/newlines → cap at RAW_TEXT_CAP.
 *   extractSvgText(buffer):  utf-8 decode → extract text inside <text>, <title>,
 *                             <desc> elements (strip nested tags, collapse whitespace)
 *                             → join with spaces → cap at RAW_TEXT_CAP.
 *                             Returns '' if none found (caller marks unsupported).
 *
 * Design constraints:
 *   - Text only — never raw bytes into proposals (derived-not-raw preserved).
 *   - Fail-closed: throw on unzip failure → caller writes extraction_state='failed'.
 *   - Empty / no-slides / no-sheets → '' → caller marks extraction_state='unsupported'.
 *   - Length cap mirrors doc-extract.ts RAW_TEXT_CAP (50 000 chars).
 *
 * Zip-bomb protection:
 *   fflate's unzipSync filter callback is used to select ONLY the entries we
 *   actually read.  Per-entry and cumulative originalSize caps are checked on
 *   the *declared* uncompressed size BEFORE inflation so we never allocate
 *   multi-GB buffers from a crafted archive.  Violation → throw → fail-closed.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { UnzipFileInfo } from 'fflate';

/** Maximum raw text returned by any extractor (mirrors doc-extract.ts). */
const RAW_TEXT_CAP = 50_000;

// ── Zip-bomb guard constants ─────────────────────────────────────────────────

/**
 * Maximum declared uncompressed size for a single zip entry we select (bytes).
 * 10 MB is generous for a slide or sheet XML file; real files are typically <1 MB.
 */
const ZIP_ENTRY_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Maximum total declared uncompressed size across ALL selected entries (bytes).
 * Guards against many small-looking entries that collectively expand to GBs.
 * Set to 50 MB — comfortably above any realistic office file's XML content.
 */
const ZIP_TOTAL_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Maximum number of entries we will select from a single archive.
 * Guards against crafted files with thousands of "matching" entries.
 */
const ZIP_MAX_ENTRY_COUNT = 512;

/**
 * Build a zip-bomb-safe unzipSync filter for office files.
 *
 * The filter is called once per entry in the archive (before inflation).
 * It receives the entry metadata — crucially `originalSize` (declared
 * uncompressed size) and `name` — and returns true to select the entry.
 *
 * We:
 *   1. Accept only entries whose path matches `pathMatcher`.
 *   2. Reject entries whose declared `originalSize` exceeds ZIP_ENTRY_MAX_BYTES.
 *   3. Accumulate selected `originalSize`; reject (and throw) if the running
 *      total would exceed ZIP_TOTAL_MAX_BYTES.
 *   4. Reject if the selected entry count would exceed ZIP_MAX_ENTRY_COUNT.
 *
 * @param pathMatcher  Predicate deciding which paths to include.
 * @returns            An fflate filter function.
 */
function makeBombSafeFilter(
  pathMatcher: (name: string) => boolean,
): (file: UnzipFileInfo) => boolean {
  let cumulativeBytes = 0;
  let entryCount = 0;

  return (file: UnzipFileInfo): boolean => {
    if (!pathMatcher(file.name)) return false;

    // Per-entry size guard (declared size, checked before inflation)
    if (file.originalSize > ZIP_ENTRY_MAX_BYTES) {
      throw new Error(
        `zip entry '${file.name}' declares originalSize ${file.originalSize} bytes exceeding the ${ZIP_ENTRY_MAX_BYTES}-byte per-entry cap — aborting to prevent zip-bomb`,
      );
    }

    // Entry count guard
    if (entryCount >= ZIP_MAX_ENTRY_COUNT) {
      throw new Error(
        `archive contains more than ${ZIP_MAX_ENTRY_COUNT} matching entries — aborting to prevent zip-bomb`,
      );
    }

    // Cumulative size guard
    cumulativeBytes += file.originalSize;
    if (cumulativeBytes > ZIP_TOTAL_MAX_BYTES) {
      throw new Error(
        `archive selected entries total declared size exceeds ${ZIP_TOTAL_MAX_BYTES}-byte cumulative cap — aborting to prevent zip-bomb`,
      );
    }

    entryCount += 1;
    return true;
  };
}

/**
 * Extract all text from a .pptx buffer.
 *
 * Algorithm:
 *   1. Unzip the buffer (pptx = zip-of-XML).
 *   2. Collect every entry whose path matches `ppt/slides/slide<N>.xml` (N = integer).
 *   3. Sort entries by slide number (ascending).
 *   4. For each slide XML, extract the text inside every `<a:t>…</a:t>` element.
 *   5. Join all text runs from a slide with a space; join slides with a space.
 *   6. Cap total length at RAW_TEXT_CAP.
 *
 * Returns '' if there are no slides or no text found.
 * Throws on corrupt zip / unzip failure (fail-closed — caller handles).
 */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  // Zip-bomb-safe unzip: only inflate ppt/slides/slide*.xml entries.
  // makeBombSafeFilter throws on per-entry or cumulative size/count violations →
  // caught by the caller's outer try/catch → extraction_state='failed'.
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;
  const zip = unzipSync(new Uint8Array(buffer), {
    filter: makeBombSafeFilter((name) => slideRegex.test(name)),
  });

  // Collect slide entries: key = 'ppt/slides/slide<N>.xml', value = Uint8Array

  const slides: Array<{ n: number; data: Uint8Array }> = [];
  for (const [path, data] of Object.entries(zip)) {
    const match = slideRegex.exec(path);
    if (match) {
      slides.push({ n: parseInt(match[1], 10), data });
    }
  }

  if (slides.length === 0) return '';

  // Sort by slide number (ascending)
  slides.sort((a, b) => a.n - b.n);

  const parts: string[] = [];
  for (const { data } of slides) {
    const xml = strFromU8(data);
    const slideText = extractAtTextRuns(xml);
    if (slideText) parts.push(slideText);
  }

  if (parts.length === 0) return '';

  return parts.join(' ').slice(0, RAW_TEXT_CAP);
}

/**
 * Extract the text content of every `<a:t>…</a:t>` element in a slide XML
 * string, joined with spaces.
 *
 * Uses a simple regex rather than a full XML parser: pptx slide XML is
 * well-structured and the `<a:t>` tag never contains child elements.
 */
function extractAtTextRuns(xml: string): string {
  const runs: string[] = [];
  // Match <a:t>text content</a:t>  (the tag may carry attributes in theory,
  // but in practice DrawingML <a:t> never does — a simple pattern is fine)
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = m[1].trim();
    if (text) runs.push(text);
  }
  return runs.join(' ');
}

// ── xlsx extractor ───────────────────────────────────────────────────────────

/**
 * Parse the shared-strings table from `xl/sharedStrings.xml`.
 *
 * The shared-strings file is a flat sequence of `<si>` elements; each may
 * contain a single `<t>` child (simple string) or multiple `<r><t>` runs for
 * rich text.  We collect all `<t>` text nodes within each `<si>` and
 * concatenate them — this covers both simple strings and rich-text runs.
 *
 * Returns an ordered array where index N is the resolved string for shared-
 * string ID N (zero-based, matching the `<v>` integer in sheet cell refs).
 */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];

  // Split into <si>…</si> blocks first so we handle rich-text runs correctly.
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(xml)) !== null) {
    const siContent = siMatch[1];
    // Collect all <t>…</t> text nodes within this <si> (may be multiple for rich text runs).
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    const parts: string[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(siContent)) !== null) {
      parts.push(tMatch[1]);
    }
    strings.push(parts.join(''));
  }

  return strings;
}

/**
 * Extract all text from an `xl/worksheets/sheet*.xml` string.
 *
 * Cell types:
 *   - `t="s"` → shared-string reference: `<v>IDX</v>` resolves via sharedStrings[IDX]
 *   - `t="inlineStr"` → inline string: `<is><t>…</t></is>`
 *   - no `t` or other → numeric/formula/other: use literal `<v>…</v>` text
 *
 * Cells are tab-separated; rows are newline-separated (best-effort — the XML
 * does not guarantee a wrapping `<row>` per spreadsheet row so we join all
 * cells in encounter order with tabs and use a newline at the end of the sheet).
 */
function extractSheetText(xml: string, sharedStrings: string[]): string {
  const cellValues: string[] = [];

  // Match each <c …>…</c> block (cells never nest).
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let cellMatch: RegExpExecArray | null;

  while ((cellMatch = cellRe.exec(xml)) !== null) {
    const attrs = cellMatch[1];
    const body = cellMatch[2];

    // Detect cell type from t="…" attribute.
    const tAttrMatch = /\bt="([^"]*)"/.exec(attrs);
    const cellType = tAttrMatch ? tAttrMatch[1] : '';

    let value = '';

    if (cellType === 's') {
      // Shared-string reference: <v>IDX</v>
      const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(body);
      if (vMatch) {
        const idx = parseInt(vMatch[1], 10);
        value = (!isNaN(idx) && idx >= 0 && idx < sharedStrings.length)
          ? sharedStrings[idx]
          : '';
      }
    } else if (cellType === 'inlineStr') {
      // Inline string: <is><t>…</t></is> (may have multiple <t> runs for rich text)
      const tRe = /<t[^>]*>([^<]*)<\/t>/g;
      const parts: string[] = [];
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRe.exec(body)) !== null) {
        parts.push(tMatch[1]);
      }
      value = parts.join('');
    } else {
      // Numeric / formula / other: use the raw <v> value.
      const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(body);
      if (vMatch) value = vMatch[1];
    }

    if (value) cellValues.push(value);
  }

  return cellValues.join('\t');
}

/**
 * Extract all text from an .xlsx buffer.
 *
 * Algorithm:
 *   1. Unzip the buffer (xlsx = zip-of-XML).
 *   2. Parse `xl/sharedStrings.xml` into an ordered string array (may be absent).
 *   3. Collect every entry matching `xl/worksheets/sheet<N>.xml` (N = integer),
 *      sort by N ascending (numeric order), extract text from each.
 *   4. Join sheets with newlines, cells with tabs (see extractSheetText).
 *   5. Cap total length at RAW_TEXT_CAP.
 *
 * Returns '' if there are no sheets or no text found.
 * Throws on corrupt zip / unzip failure (fail-closed — caller handles).
 */
export async function extractXlsxText(buffer: Buffer): Promise<string> {
  // Zip-bomb-safe unzip: only inflate xl/sharedStrings.xml and
  // xl/worksheets/sheet*.xml entries — never media or embedded binaries.
  // makeBombSafeFilter throws on size/count violations → fail-closed.
  const sheetRegex = /^xl\/worksheets\/sheet(\d+)\.xml$/i;
  const xlsxPathMatcher = (name: string): boolean =>
    name === 'xl/sharedStrings.xml' || sheetRegex.test(name);

  const zip = unzipSync(new Uint8Array(buffer), {
    filter: makeBombSafeFilter(xlsxPathMatcher),
  });

  // Step 2: Parse shared strings (optional part — not all workbooks have one).
  let sharedStrings: string[] = [];
  const ssEntry = zip['xl/sharedStrings.xml'];
  if (ssEntry) {
    sharedStrings = parseSharedStrings(strFromU8(ssEntry));
  }

  // Step 3: Collect sheet entries (sheetRegex already defined above for the filter).
  const sheets: Array<{ n: number; data: Uint8Array }> = [];
  for (const [path, data] of Object.entries(zip)) {
    const match = sheetRegex.exec(path);
    if (match) {
      sheets.push({ n: parseInt(match[1], 10), data });
    }
  }

  if (sheets.length === 0) return '';

  // Sort sheets by numeric index.
  sheets.sort((a, b) => a.n - b.n);

  // Step 4: Extract text from each sheet.
  const sheetTexts: string[] = [];
  for (const { data } of sheets) {
    const xml = strFromU8(data);
    const text = extractSheetText(xml, sharedStrings);
    if (text) sheetTexts.push(text);
  }

  if (sheetTexts.length === 0) return '';

  // Step 5: Cap total length.
  return sheetTexts.join('\n').slice(0, RAW_TEXT_CAP);
}

// ── svg extractor ─────────────────────────────────────────────────────────────

/**
 * Extract text content from an SVG buffer.
 *
 * Algorithm:
 *   1. Decode the buffer as UTF-8 (SVG is plain XML text — no unzip needed).
 *   2. For each of the three text-bearing element types (<text>, <title>, <desc>):
 *      a. Extract the full element block (including nested child tags like <tspan>).
 *      b. Strip all nested tags (e.g. <tspan>, <a>) leaving only text nodes.
 *      c. Collapse internal whitespace to a single space; trim.
 *   3. Join all collected text values with spaces.
 *   4. Cap total length at RAW_TEXT_CAP.
 *
 * Returns '' if no text-bearing elements are found or all are whitespace-only.
 * This is a synchronous function — SVG is plain text, no unzip required.
 *
 * Note: <text> in SVG can contain nested elements (<tspan>, <a>, etc.).
 * We strip all tags with a simple regex because SVG text element content is
 * shallow and well-structured in practice.
 */
export function extractSvgText(buffer: Buffer): string {
  // Step 1: UTF-8 decode
  const xml = buffer.toString('utf8');

  const parts: string[] = [];

  // Step 2: Extract content from each text-bearing element type.
  // We capture everything between opening and closing tags (non-greedy),
  // then strip any nested XML tags to get the raw text nodes.
  const elementRe = /<(text|title|desc)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = elementRe.exec(xml)) !== null) {
    const rawContent = match[2];

    // Strip nested tags (e.g. <tspan dy="1em">, <a href="…">, </tspan>)
    const textOnly = rawContent.replace(/<[^>]*>/g, ' ');

    // Collapse whitespace and trim
    const collapsed = textOnly.replace(/\s+/g, ' ').trim();

    if (collapsed) {
      parts.push(collapsed);
    }
  }

  if (parts.length === 0) return '';

  // Step 3+4: Join and cap.
  return parts.join(' ').slice(0, RAW_TEXT_CAP);
}
