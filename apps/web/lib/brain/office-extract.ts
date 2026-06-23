/**
 * Office file text extractors for the P2 brain document pipeline.
 *
 * Uses fflate (tiny zero-dependency unzip) so we ship no heavy parser.
 * Exports:
 *   extractPptxText(buffer): unzip → read ppt/slides/slide*.xml (numeric order)
 *                             → concatenate <a:t>…</a:t> runs → cap at RAW_TEXT_CAP.
 *
 * Design constraints:
 *   - Text only — never raw bytes into proposals (derived-not-raw preserved).
 *   - Fail-closed: throw on unzip failure → caller writes extraction_state='failed'.
 *   - Empty / no-slides → '' → caller marks extraction_state='unsupported'.
 *   - Length cap mirrors doc-extract.ts RAW_TEXT_CAP (50 000 chars).
 */
import { unzipSync, strFromU8 } from 'fflate';

/** Maximum raw text returned by any extractor (mirrors doc-extract.ts). */
const RAW_TEXT_CAP = 50_000;

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
  // unzipSync throws if the buffer is not a valid zip archive.
  const zip = unzipSync(new Uint8Array(buffer));

  // Collect slide entries: key = 'ppt/slides/slide<N>.xml', value = Uint8Array
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

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
