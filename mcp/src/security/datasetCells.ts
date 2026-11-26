// The cells of the credential columns of a dataset an answer carries. A dataset comes back with its
// whole content (CSV-like text or JSON rows) and the meaning of each column (`column_semantics`); a
// password is a cell of a `credential` column, and a view may show it apart from the content it came
// in, so each such cell is a secret of its own. The sample rows of its audit metadata are read the
// same way.

import { isSecretField } from './secretFields.js';

/** Rows of a CSV text; a quoted cell may hold the separator, quotes (doubled) and line breaks. */
export function csvRows(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(i + 1) === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The separator of a dataset of each text type; another one names its own. */
const SEPARATORS: Readonly<Record<string, string>> = { csv: ',', tsv: '\t', ssv: ';' };

/** How deep an answer is searched for datasets (a list of them sits one level down). */
const MAX_DEPTH = 6;

/** The columns whose cells are secrets: `credential` by meaning, or a name that says so. */
function secretColumns(semantics: Json): Set<string> {
  return new Set(
    Object.entries(semantics)
      .filter(([column, meaning]) => meaning === 'credential' || isSecretField(column))
      .map(([column]) => column),
  );
}

const cellText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined;

function cellsOfRows(rows: unknown, columns: ReadonlySet<string>, out: string[]): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const column of columns) {
      const text = cellText(row[column]);
      if (text !== undefined && text !== '') out.push(text);
    }
  }
}

function cellsOfContent(dataset: Json, columns: ReadonlySet<string>, out: string[]): void {
  const { content } = dataset;
  if (typeof content !== 'string' || content === '') return;
  if (dataset.feeder_type === 'json') {
    try {
      cellsOfRows(JSON.parse(content), columns, out);
    } catch {
      // content that is not JSON has no rows to read; the whole content is masked as it is
    }
    return;
  }
  const type = typeof dataset.feeder_type === 'string' ? dataset.feeder_type : '';
  const separator =
    typeof dataset.separator === 'string' && dataset.separator !== ''
      ? dataset.separator
      : (SEPARATORS[type] ?? ',');
  const [header, ...rows] = csvRows(content, separator);
  if (header === undefined) return;
  const wanted = header.flatMap((name, index) => (columns.has(name.trim()) ? [index] : []));
  for (const row of rows) {
    for (const index of wanted) {
      const text = (row[index] ?? '').trim();
      if (text !== '') out.push(text);
    }
  }
}

/**
 * Cells taken from each dataset of a list, the first ones, each once. A dataset read on its own
 * gives every cell: a view may show any of its rows. A list of datasets (every dataset of a project,
 * with its whole content) is read by every data tool and none of them shows its rows; a cell costs
 * the masker about 20 µs twice (the scope of the call and the logger), so the 50 000 cells of a 2 MB
 * file of accounts would add seconds to each such call. The reader of the list keeps the same bound.
 */
export const MAX_CELLS_PER_LISTED_DATASET = 1000;

function walk(value: unknown, depth: number, listed: boolean, out: string[]): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, true, out);
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.column_semantics)) {
    const columns = secretColumns(value.column_semantics);
    if (columns.size > 0) {
      // every cell: a dataset of many accounts is masked to its last row
      const cells: string[] = [];
      cellsOfContent(value, columns, cells);
      const audit = value.audit_metadata;
      if (isRecord(audit)) cellsOfRows(audit.sample_rows_preview, columns, cells);
      out.push(...(listed ? [...new Set(cells)].slice(0, MAX_CELLS_PER_LISTED_DATASET) : cells));
    }
  }
  for (const item of Object.values(value)) {
    if (typeof item === 'object' && item !== null) walk(item, depth + 1, listed, out);
  }
}

/** The cells of the credential columns of every dataset `answer` holds, each once. */
export function credentialCells(answer: unknown): string[] {
  const out: string[] = [];
  walk(answer, 0, false, out);
  return [...new Set(out)];
}
