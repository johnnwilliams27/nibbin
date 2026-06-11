/**
 * CSV import rail [G] (SPEC §4.3). RFC 4180 parsing, defensive limits, and
 * quarantined cell values — a CSV from a user's other tool is still external
 * content (formula-injection strings, prompt-injection strings, etc.).
 */
import { quarantine, type QuarantinedContent } from '../quarantine';

export interface CsvParseResult {
  header: string[];
  rows: string[][];
  /** the whole document as quarantined external data */
  quarantined: QuarantinedContent;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_CELL_CHARS = 32_768;

export function parseCsv(input: string, source = 'csv-import:upload'): CsvParseResult {
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new Error('csv exceeds size limit');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL_CHARS) throw new Error('csv cell exceeds size limit');
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    if (rows.length > MAX_ROWS) throw new Error('csv exceeds row limit');
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      if (cell.endsWith('\r')) cell = cell.slice(0, -1);
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new Error('csv ends inside a quoted cell');
  if (cell !== '' || row.length > 0) pushRow();

  const header = rows.shift() ?? [];
  return { header, rows, quarantined: quarantine(input, source) };
}
