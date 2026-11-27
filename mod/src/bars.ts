/**
 * The bars of the operations in progress: what the server lists (`process_get_status` with `progress`, read
 * from the plugin's state file) turned into `BarRow`s, and the one function that changes the bars
 * state (`ModBars`, the atom `loadcraft.bars`). Pure: no `$`, no clock (the time comes in), no
 * exception; a function that has nothing to change hands back the same object, so that the caller
 * does not write.
 */

import { inline } from '../../mcp/src/render/primitives.js';
import type { BarEnd, BarRow, ModBars } from './state/types.js';

/** A bar that ended stays on screen, as finished, for this long. */
export const FINISHED_MS = 6000;
/** More bars than this are not read: a handful of long operations is all a session has. */
export const MAX_BARS = 8;
const MAX_STAGE = 160;
const MAX_FINISHED = 4;

type Dict = Readonly<Record<string, unknown>>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9999
    ? value
    : undefined;

function time(value: unknown): number | undefined {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
}

/**
 * The rows of a `process_get_status` answer with `progress`, or `undefined` when the answer is not one (a
 * failed read says nothing, an empty list says there is nothing in progress). A row of a shape the
 * mod does not know is left out; the texts are made fit for one line.
 */
export function parseBars(data: unknown): readonly BarRow[] | undefined {
  if (!isDict(data) || !Array.isArray(data['progress'])) return undefined;
  const rows: BarRow[] = [];
  for (const item of data['progress'] as readonly unknown[]) {
    if (!isDict(item)) continue;
    const call = text(item['call']);
    const tool = text(item['tool']);
    const stage = text(item['stage']);
    const startedAt = time(item['startedAt']);
    const updatedAt = time(item['updatedAt']);
    if (
      call === undefined ||
      tool === undefined ||
      stage === undefined ||
      startedAt === undefined ||
      updatedAt === undefined ||
      typeof item['open'] !== 'boolean'
    ) {
      continue;
    }
    const handle = text(item['handle']);
    const kind = text(item['kind']);
    const percent =
      typeof item['percent'] === 'number' && Number.isFinite(item['percent'])
        ? Math.min(100, Math.max(0, Math.round(item['percent'])))
        : undefined;
    const n = count(item['n']);
    const m = count(item['m']);
    rows.push({
      call: inline(call, 80),
      ...(handle === undefined ? {} : { handle: inline(handle, 160) }),
      ...(kind === undefined ? {} : { kind: inline(kind, 40) }),
      tool: inline(tool, 40),
      stage: inline(stage, MAX_STAGE),
      ...(percent === undefined ? {} : { percent }),
      ...(n === undefined || m === undefined || m < 1 || n > m ? {} : { n, m }),
      startedAt,
      updatedAt,
      open: item['open'],
    });
    if (rows.length >= MAX_BARS) break;
  }
  return rows;
}

const ENDS: ReadonlySet<string> = new Set<BarEnd>(['done', 'failed', 'cancelled']);

/** How an operation ended, by its handle. */
export type BarEnds = Readonly<Record<string, BarEnd>>;

/**
 * How the operations that ended lately ended (`ended` of a `process_get_status` answer with
 * `progress`), by handle; empty when the answer has no such list. An entry the mod does not know is
 * left out.
 */
export function parseEnded(data: unknown): BarEnds {
  const ends: Record<string, BarEnd> = {};
  if (!isDict(data) || !Array.isArray(data['ended'])) return ends;
  for (const item of data['ended'] as readonly unknown[]) {
    if (!isDict(item)) continue;
    const handle = text(item['handle']);
    const status = text(item['status']);
    if (handle === undefined || status === undefined || !ENDS.has(status)) continue;
    ends[inline(handle, 160)] = status as BarEnd;
  }
  return ends;
}

/** True when `row` is the bar `other` is, whatever key the server keeps it under. */
export function sameBar(row: BarRow, other: BarRow): boolean {
  return row.call === other.call || (row.handle !== undefined && row.handle === other.handle);
}

/**
 * The bars after a read at `now`: `read` is the rows the server listed, or `undefined` when the
 * read failed (the rows stay as they were). A bar that is no longer listed has ended: it stays as
 * finished for `FINISHED_MS`, with how its operation ended when `ends` (of the same read) names it.
 * A bar that is listed again (the operation went on) is not finished.
 */
export function withBars(
  bars: ModBars,
  read: readonly BarRow[] | undefined,
  now: number,
  ends: BarEnds = {},
): ModBars {
  const rows = read ?? bars.rows;
  const gone =
    read === undefined ? [] : bars.rows.filter((row) => !read.some((r) => sameBar(r, row)));
  const kept = bars.finished.filter(
    (entry) => entry.until > now && !rows.some((row) => sameBar(row, entry.row)),
  );
  const ended = gone.map((row) => {
    const end = row.handle === undefined ? undefined : ends[row.handle];
    return { row, until: now + FINISHED_MS, ...(end === undefined ? {} : { end }) };
  });
  const finished = [...kept, ...ended].slice(-MAX_FINISHED);
  const next: ModBars = { rows, finished };
  return JSON.stringify(next) === JSON.stringify(bars) ? bars : next;
}

/** True while anything is on screen or about to be: a timer has something to do. */
export function hasBars(bars: ModBars): boolean {
  return bars.rows.length > 0 || bars.finished.length > 0;
}
