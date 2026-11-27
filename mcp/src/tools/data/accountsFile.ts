// `data_create_dataset` with `file` and `slot`: the accounts a customer already has, read from a CSV
// file of the workspace and saved as the dataset of a slot. The passwords go from the file to
// LoadCraft without passing through the model: every cell of a secret column is registered in the
// call's secrets before anything else sees it, and the result carries only the row count. The file
// is read for the consent card (its size and sha256, never its content) and again for the write.

import { createHash } from 'node:crypto';

import {
  isSecretColumn,
  csvRows,
  isDatasetStrategy,
  replaceDatasetContent,
  uploadDataset,
  type Dataset,
  type DatasetStrategy,
  type SavedDataset,
} from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { RunTarget } from '../../resolve/handles.js';
import { fileTooLarge } from '../../workspace/fileRead.js';
import { relativeToWorkspace } from '../../workspace/paths.js';
import { openAllowed, readTextAllowed } from '../../workspace/uploads.js';
import { fileNameOf } from './slotDataset.js';
import { readSlots, type SlotsRead } from './readPlan.js';

export interface AccountsFileArgs {
  readonly projectId: string;
  readonly target: RunTarget;
  readonly slot: string;
  readonly path: string;
  /** Name of the dataset; default: the slot's label. */
  readonly name?: string;
}

/** The backend takes at most this many characters of content in one request. */
const CONTENT_LIMIT = { bytes: 2_000_000, label: '2 000 000 characters' };

const sameColumns = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((column) => b.includes(column));

/** The separator of the header line: a comma, else a semicolon or a tab when the header has one. */
export function separatorOf(text: string): string {
  const end = text.search(/[\r\n]/u);
  const header = end === -1 ? text : text.slice(0, end);
  if (header.includes(',')) return ',';
  if (header.includes(';')) return ';';
  return header.includes('\t') ? '\t' : ',';
}

const quoted = (cell: string): string =>
  /[",\r\n]|^\s|\s$/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

/** The file's rows narrowed to the slot's columns, in the slot's spelling and order. */
function projected(
  text: string,
  columns: readonly string[],
  shown: string,
): { content: string; rows: number; cells: Map<string, string[]> } {
  const [header = [], ...body] = csvRows(text, separatorOf(text));
  const index = columns.map((column) =>
    header.findIndex((name) => name.trim().toLowerCase() === column.toLowerCase()),
  );
  const missing = columns.filter((_, position) => index[position] === -1);
  if (missing.length > 0) {
    throw new ToolError('accounts_file_columns_missing', {
      params: { file: shown, missing: missing.join(', '), columns: columns.join(', ') },
    });
  }
  const rows = body
    .map((row, position) => ({ row, line: position + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== ''));
  if (rows.length === 0) throw new ToolError('accounts_file_empty', { params: { file: shown } });
  const widest = Math.max(...index);
  const short = rows.find(({ row }) => row.length <= widest);
  if (short !== undefined) {
    throw new ToolError('accounts_file_row_short', {
      params: { file: shown, line: short.line },
    });
  }
  const cells = new Map<string, string[]>();
  columns.forEach((column, position) => {
    cells.set(
      column,
      rows.map(({ row }) => row[index[position] ?? 0] ?? ''),
    );
  });
  const lines = [
    columns.map(quoted).join(','),
    ...rows.map(({ row }) => index.map((at) => quoted(row[at] ?? '')).join(',')),
  ];
  return { content: `${lines.join('\n')}\n`, rows: rows.length, cells };
}

/** A file of accounts read and checked for a slot: what the write sends, and what the card shows. */
export interface PreparedAccounts {
  /** The file as the workspace shows it: a path relative to the project directory. */
  readonly file: string;
  readonly slot: string;
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: number;
  readonly fileName: string;
  readonly strategy: DatasetStrategy;
  /** The dataset that gets the file as a new revision; undefined for a new dataset. */
  readonly existing: Dataset | undefined;
  /** Size in bytes and sha256 of the file as it was read. */
  readonly size: number;
  readonly sha256: string;
  readonly slots: SlotsRead;
  /** The rows in the slot's columns: sent by the write, never shown. */
  readonly content: string;
}

/** Reads the file, checks it against the slot and registers every secret cell of it. Sends nothing. */
export async function prepareAccountsFile(
  ctx: ToolContext,
  args: AccountsFileArgs,
): Promise<PreparedAccounts> {
  const root = ctx.config.workspaceRoot;
  const file = await openAllowed(root, args.path, 'accounts');
  const shown = relativeToWorkspace(root, file.path);

  const { projectId, target } = args;
  const slots = await readSlots(ctx, { projectId, target });
  const spec = slots.scenarios
    .flatMap((scenario) => scenario.slots)
    .find((candidate) => candidate.slot === args.slot);
  if (spec === undefined) {
    const available = [...new Set(slots.verdicts.map((item) => item.slot))];
    throw new ToolError('slot_unknown', {
      params: { slot: args.slot, available: available.join(', ') },
    });
  }

  const text = await readTextAllowed(file);
  const { content, rows, cells } = projected(text, spec.columns, shown);
  const kinds = new Map(spec.specs.map((item) => [item.name, item.type]));
  for (const [column, values] of cells) {
    if (!isSecretColumn(column, kinds.get(column))) continue;
    for (const value of values) if (value !== '') ctx.secrets.add(value);
  }
  if (content.length > CONTENT_LIMIT.bytes) throw fileTooLarge(shown, CONTENT_LIMIT);

  // The dataset an earlier call made is the one pinned to the slot, so it comes first; otherwise a
  // dataset of the name this slot's accounts get.
  const name = args.name?.trim() || spec.label || args.slot;
  const pinnedId = slots.verdicts.find((verdict) => verdict.slot === args.slot)?.datasetId;
  const pinned = slots.datasets.find((dataset) => dataset.id === pinnedId);
  const existing =
    pinned !== undefined && sameColumns(pinned.columns, spec.columns)
      ? pinned
      : slots.datasets.find((dataset) => dataset.name === name);
  return {
    file: shown,
    slot: args.slot,
    name: existing?.name ?? name,
    columns: spec.columns,
    rows,
    fileName: fileNameOf(args.slot),
    strategy: isDatasetStrategy(spec.strategy) ? spec.strategy : 'queue',
    existing,
    size: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text).digest('hex'),
    slots,
    content,
  };
}

/** Saves the prepared rows: a new dataset, or a new revision of the one that exists. */
export async function saveAccountsFile(
  ctx: ToolContext,
  projectId: string,
  prepared: PreparedAccounts,
): Promise<SavedDataset> {
  const { content, fileName, existing } = prepared;
  return existing === undefined
    ? uploadDataset(ctx, projectId, {
        name: prepared.name,
        columns: [...prepared.columns],
        fileName,
        content,
        rows: prepared.rows,
        strategy: prepared.strategy,
      })
    : replaceDatasetContent(ctx, projectId, existing.id, { content, fileName });
}
