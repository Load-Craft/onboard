/**
 * A list of the panel with a filter, a preview and, when the list takes them, marks: one component for
 * every list of the panel (the proposed journeys first; the log and the cards next). Pure: a function
 * of the entries, the marks and the view of the list (the filter, the entry open in the preview, the
 * groups shown open), returning panel nodes whose presses name list actions. No `$`, no clock.
 *
 * What a person does on it, by keys the panel has (`mod/docs/mods-facts.md`, "A list with a filter"):
 * - `f` (or the button "Filter") puts the cursor in the filter field; typing keeps the entries every
 *   word of the filter is found in. The field does not take the keys by itself, so the digits of the
 *   tabs still switch tabs;
 * - the arrows move between the rows (the focus ring of the pane);
 * - Enter on the mark (`[ ]`) of a row marks or unmarks it, `x` marks the row under the cursor; Enter
 *   on its name opens the preview;
 * - in the preview, "Back to the list" (`b`) comes back with the filter and the marks kept, `x` marks
 *   or unmarks the entry shown. Esc returns the keys and cannot be caught, so it is not used;
 * - a group (the rungs of one ladder) is one row: its mark marks the rungs it shows, Enter on its name
 *   shows or hides them. A filter shows the group open, with the rungs it matches.
 *
 * The counter says how many entries are marked (of the limit, when the list has one) and how many the
 * filter shows: a mark hidden by the filter still counts. At most `WINDOW` rows are drawn; the rest is
 * named by a count, and the filter reaches it. Every text from the data passes `inline` here.
 */

import { inline } from '../../../mcp/src/render/primitives.js';
import { text, type TextProps, type TreeText } from './tree.js';

/** Rows drawn at most: fewer nodes and fewer stops of the focus ring; the filter reaches the rest. */
export const WINDOW = 50;
/** Length of a label, a note or a summary of a row; the preview is the place to read the rest. */
const LABEL = 200;
const NOTE = 80;
const SUMMARY = 160;

/** One entry: its stable key (what a mark holds), what a row draws and what the filter reads. */
export interface ListEntry {
  readonly key: string;
  readonly label: string;
  /** Short texts beside the name (a kind, "flow created"); the first is drawn bright when `bright`. */
  readonly notes: readonly string[];
  readonly bright?: true;
  /** A dim line under the row (the first steps). */
  readonly summary?: string;
  /** The text the filter searches besides the label (the kind, the steps). */
  readonly search: string;
  /** The group the entry belongs to; absent for an entry of its own. */
  readonly group?: string;
  /** The entry is shown and opens a preview, but has no mark (what a mark stands for cannot name it). */
  readonly unmarkable?: true;
}

/** A group of entries drawn as one row (the rungs of a ladder). */
export interface ListGroup {
  readonly key: string;
  readonly label: string;
  readonly summary?: string;
}

/** What the panel keeps of one list between two drawings. */
export interface ListView {
  readonly query: string;
  /** The key of the entry shown in the preview. */
  readonly open?: string;
  /** The groups shown open. */
  readonly expanded: readonly string[];
}

export const EMPTY_VIEW: ListView = { query: '', expanded: [] };

/** What a press or a key on the list asks for; `list` is the id of the list. */
export type ListAction =
  | { readonly kind: 'list.filter'; readonly list: string; readonly query: string }
  | { readonly kind: 'list.find'; readonly list: string }
  | { readonly kind: 'list.open'; readonly list: string; readonly key: string }
  | { readonly kind: 'list.back'; readonly list: string }
  /** Toggle `keys` (one entry, or a group whole). */
  | { readonly kind: 'list.mark'; readonly list: string; readonly keys: readonly string[] }
  /** Mark `keys`, up to the limit, unmarking nothing ("mark all" of what is shown). */
  | { readonly kind: 'list.markAll'; readonly list: string; readonly keys: readonly string[] }
  /** Toggle the entry whose row holds the cursor. */
  | { readonly kind: 'list.markCurrent'; readonly list: string }
  | { readonly kind: 'list.group'; readonly list: string; readonly group: string }
  /** No entry of the list marked. */
  | { readonly kind: 'list.clear'; readonly list: string }
  /** Read the entries of the list again (after a read that failed). */
  | { readonly kind: 'list.reload'; readonly list: string };

/** Whether a press of the panel is one of a list. */
export function isListAction(action: { readonly kind: string }): action is ListAction {
  return action.kind.startsWith('list.');
}

/** The texts of a list, in the language of the panel. */
export interface ListTexts {
  readonly filter: string;
  readonly placeholder: string;
  /** The counter; `limit` only for a list with marks and a limit. */
  readonly counter: (marked: number, visible: number, limit?: number) => string;
  readonly empty: string;
  readonly noMatch: string;
  readonly more: (count: number) => string;
  readonly back: string;
  readonly mark?: string;
  readonly unmark?: string;
  /** Said beside an entry that has no mark (`unmarkable`). */
  readonly unmarkable?: string;
  /** The button of the row under the cursor (`x`). */
  readonly markCurrent?: string;
}

/** The marks of a list that takes them. */
export interface ListMarks {
  readonly marked: ReadonlySet<string>;
  /** At most this many may be marked (what the tool takes in one call). */
  readonly limit?: number;
}

export interface ListSpec {
  /** The id of the list: the prefix of its element keys and the `list` of its actions. */
  readonly id: string;
  readonly entries: readonly ListEntry[];
  readonly groups: readonly ListGroup[];
  /** Absent: a list to read (the log), with no marks, no counter of marks and no `x`. */
  readonly marks?: ListMarks;
  readonly view: ListView;
  readonly texts: ListTexts;
  /** The body of the preview of an entry (under its name). */
  readonly preview: (entry: ListEntry) => readonly ListNode[];
  /** VS Code draws no hotkeys. */
  readonly hotkeys: boolean;
}

export interface ListButton {
  readonly type: 'Button';
  readonly key: string;
  readonly label: string;
  readonly action: ListAction;
  readonly hotkey?: string;
  readonly plain?: true;
  readonly dimColor?: true;
}

export interface ListInput {
  readonly type: 'Input';
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly list: string;
}

export interface ListBox {
  readonly type: 'Box';
  readonly props: { readonly flexDirection: 'row' | 'column'; readonly columnGap?: number };
  readonly children: readonly ListNode[];
}

export type ListNode = TreeText | ListButton | ListInput | ListBox;

// ---- the keys of the elements: made here and nowhere else ----------------------------------------

/** The key of the filter field. */
export const filterKey = (id: string): string => `${id}-filter`;
/** The key of the mark of the entry at `index` of the entries. */
export const markKey = (id: string, index: number): string => `${id}-${String(index)}`;
/** The key of the name (the preview) of the entry at `index`. */
export const rowKey = (id: string, index: number): string => `${id}-open-${String(index)}`;
const groupMarkKey = (id: string, index: number): string => `${id}-group-${String(index)}`;
const groupOpenKey = (id: string, index: number): string => `${id}-group-open-${String(index)}`;

/** The key of the row of `key` to put the cursor on after its preview closed. */
export function rowKeyOf(id: string, keys: readonly string[], key: string): string | undefined {
  const at = keys.indexOf(key);
  return at < 0 ? undefined : rowKey(id, at);
}

/** The entry key of an element key of the list (a mark or a name of a row), for `x` on the cursor. */
export function entryOfElement(
  id: string,
  keys: readonly string[],
  element: string | undefined,
): string | undefined {
  if (element === undefined) return undefined;
  const match = new RegExp(`^${id}-(?:open-)?(\\d+)$`, 'u').exec(element);
  return match === null ? undefined : keys[Number(match[1])];
}

// ---- the filter -----------------------------------------------------------------------------------

/** The filter's text as it is compared: lower case, without the marks of letters (ł reads as l). */
export function folded(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/gu, 'l')
    .replace(/đ/gu, 'd')
    .replace(/ø/gu, 'o')
    .replace(/ß/gu, 'ss');
}

/** Whether every word of the query is found in the entry (its label or its search text). */
export function matches(entry: ListEntry, query: string): boolean {
  const words = folded(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = folded(`${entry.label} ${entry.search}`);
  return words.every((word) => haystack.includes(word));
}

/** The entries the filter of `view` shows, in their order. */
export function visibleEntries(entries: readonly ListEntry[], view: ListView): ListEntry[] {
  return entries.filter((entry) => matches(entry, view.query));
}

// ---- the drawing ----------------------------------------------------------------------------------

const dim: TextProps = { dimColor: true };
const row = (children: readonly ListNode[], columnGap = 1): ListBox => ({
  type: 'Box',
  props: { flexDirection: 'row', columnGap },
  children,
});

/** `[x]`, `[ ]`, or `[-]` for a group of which only some entries are marked. */
function box(marked: number, of: number): string {
  if (marked === 0) return '[ ]';
  return marked === of ? '[x]' : '[-]';
}

function notesOf(entry: ListEntry): TreeText[] {
  return entry.notes.map((note, at) =>
    text(inline(note, NOTE), at === 0 && entry.bright === true ? {} : dim),
  );
}

function entryRows(spec: ListSpec, entry: ListEntry, index: number, indent: string): ListNode[] {
  const mark: ListNode[] =
    spec.marks === undefined
      ? []
      : entry.unmarkable === true
        ? [text('   ')]
        : [
            {
              type: 'Button',
              key: markKey(spec.id, index),
              label: box(spec.marks.marked.has(entry.key) ? 1 : 0, 1),
              action: { kind: 'list.mark', list: spec.id, keys: [entry.key] },
              plain: true,
            },
          ];
  const head = row([
    ...(indent === '' ? [] : [text(indent)]),
    ...mark,
    {
      type: 'Button',
      key: rowKey(spec.id, index),
      label: inline(entry.label, LABEL),
      action: { kind: 'list.open', list: spec.id, key: entry.key },
      plain: true,
    },
    ...notesOf(entry),
    ...(entry.unmarkable === true && spec.texts.unmarkable !== undefined
      ? [text(inline(spec.texts.unmarkable, LABEL), dim)]
      : []),
  ]);
  const summary =
    entry.summary === undefined
      ? []
      : [text(`${indent}      ${inline(entry.summary, SUMMARY)}`, dim)];
  return [head, ...summary];
}

/**
 * The rows of the list: the entries of their own, and each group as one row with its rungs under it,
 * at most `WINDOW` entries drawn (a group row counts as one).
 */
function rows(spec: ListSpec, visible: readonly ListEntry[]): ListNode[] {
  const index = new Map(spec.entries.map((entry, at) => [entry.key, at] as const));
  const filtering = spec.view.query.trim() !== '';
  const out: ListNode[] = [];
  const drawn = new Set<string>();
  let shown = 0;
  let hidden = 0;
  for (const entry of visible) {
    const groupAt =
      entry.group === undefined ? -1 : spec.groups.findIndex((g) => g.key === entry.group);
    const group = groupAt < 0 ? undefined : spec.groups[groupAt];
    if (group === undefined) {
      if (shown >= WINDOW) {
        hidden += 1;
        continue;
      }
      shown += 1;
      out.push(...entryRows(spec, entry, index.get(entry.key) ?? 0, ''));
      continue;
    }
    if (drawn.has(group.key)) continue;
    drawn.add(group.key);
    const members = visible.filter((item) => item.group === group.key);
    if (shown >= WINDOW) {
      hidden += members.length;
      continue;
    }
    shown += 1;
    const open = filtering || spec.view.expanded.includes(group.key);
    const marks = spec.marks;
    const groupMark: ListButton[] =
      marks === undefined
        ? []
        : [
            {
              type: 'Button',
              key: groupMarkKey(spec.id, groupAt),
              label: box(
                members.filter((item) => marks.marked.has(item.key)).length,
                members.length,
              ),
              action: { kind: 'list.mark', list: spec.id, keys: members.map((item) => item.key) },
              plain: true,
            },
          ];
    out.push(
      row([
        ...groupMark,
        {
          type: 'Button',
          key: groupOpenKey(spec.id, groupAt),
          label: `${open ? '▾' : '▸'} ${inline(group.label, LABEL)}`,
          action: { kind: 'list.group', list: spec.id, group: group.key },
          plain: true,
        },
      ]),
    );
    if (group.summary !== undefined) out.push(text(`      ${inline(group.summary, SUMMARY)}`, dim));
    if (!open) continue;
    for (const member of members) {
      if (shown >= WINDOW) {
        hidden += 1;
        continue;
      }
      shown += 1;
      out.push(...entryRows(spec, member, index.get(member.key) ?? 0, '  '));
    }
  }
  if (hidden > 0) out.push(text(spec.texts.more(hidden), dim));
  return out;
}

function previewOf(spec: ListSpec, entry: ListEntry): ListNode[] {
  const back: ListButton = {
    type: 'Button',
    key: `${spec.id}-back`,
    label: `← ${spec.texts.back}`,
    action: { kind: 'list.back', list: spec.id },
    ...(spec.hotkeys ? { hotkey: 'b' } : {}),
  };
  const marked = spec.marks?.marked.has(entry.key) === true;
  const mark: ListButton[] =
    spec.marks === undefined || entry.unmarkable === true
      ? []
      : [
          {
            type: 'Button',
            key: `${spec.id}-preview-mark`,
            label:
              `${box(marked ? 1 : 0, 1)} ${(marked ? spec.texts.unmark : spec.texts.mark) ?? ''}`.trimEnd(),
            action: { kind: 'list.mark', list: spec.id, keys: [entry.key] },
            ...(spec.hotkeys ? { hotkey: 'x' } : {}),
          },
        ];
  return [
    row([back, ...mark], 2),
    text(' '),
    row([text(inline(entry.label, LABEL), { bold: true }), ...notesOf(entry)], 2),
    ...spec.preview(entry),
  ];
}

/** The parts of a list: its head (the filter and the counter, or the preview) and its rows. */
export interface ListParts {
  /** The entry open in the preview; absent while the list is shown. */
  readonly open?: ListEntry;
  readonly head: readonly ListNode[];
  readonly rows: readonly ListNode[];
}

/**
 * The list as panel nodes: the preview of the entry open in `view`, or the filter with its button and
 * the counter, then the rows. An `open` key the list no longer holds draws the list. A caller puts its
 * own buttons (the build of the marked) between the head and the rows.
 */
export function listParts(spec: ListSpec): ListParts {
  const open = spec.entries.find((entry) => entry.key === spec.view.open);
  if (open !== undefined) return { open, head: previewOf(spec, open), rows: [] };
  if (spec.entries.length === 0) return { head: [text(spec.texts.empty, dim)], rows: [] };
  const visible = visibleEntries(spec.entries, spec.view);
  const marks = spec.marks;
  const markedCount =
    marks === undefined ? 0 : spec.entries.filter((entry) => marks.marked.has(entry.key)).length;
  const filter: ListInput = {
    type: 'Input',
    key: filterKey(spec.id),
    label: spec.texts.filter,
    placeholder: spec.texts.placeholder,
    value: spec.view.query,
    list: spec.id,
  };
  const find: ListButton = {
    type: 'Button',
    key: `${spec.id}-find`,
    label: spec.texts.filter,
    action: { kind: 'list.find', list: spec.id },
    dimColor: true,
    ...(spec.hotkeys ? { hotkey: 'f' } : {}),
  };
  const current: ListButton[] =
    marks === undefined || !spec.hotkeys || spec.texts.markCurrent === undefined
      ? []
      : [
          {
            type: 'Button',
            key: `${spec.id}-mark-current`,
            label: spec.texts.markCurrent,
            action: { kind: 'list.markCurrent', list: spec.id },
            hotkey: 'x',
            dimColor: true,
          },
        ];
  return {
    head: [
      row([filter, find], 2),
      row(
        [text(spec.texts.counter(markedCount, visible.length, marks?.limit), dim), ...current],
        2,
      ),
    ],
    rows: visible.length === 0 ? [text(spec.texts.noMatch, dim)] : rows(spec, visible),
  };
}

/** The whole list as nodes: `listParts` with the head over the rows. */
export function listTree(spec: ListSpec): ListNode[] {
  const parts = listParts(spec);
  return [...parts.head, ...parts.rows];
}

// ---- the view of a list ---------------------------------------------------------------------------

export function withQuery(view: ListView, query: string): ListView {
  return view.query === query ? view : { ...view, query };
}

export function withOpen(view: ListView, key: string): ListView {
  return view.open === key ? view : { ...view, open: key };
}

/** The list again, with the filter and the open groups as they were. */
export function withBack(view: ListView): ListView {
  if (view.open === undefined) return view;
  return { query: view.query, expanded: view.expanded };
}

export function withGroupToggled(view: ListView, group: string): ListView {
  return {
    ...view,
    expanded: view.expanded.includes(group)
      ? view.expanded.filter((item) => item !== group)
      : [...view.expanded, group],
  };
}

/**
 * The marks after a press on `keys`: one key toggles; several (a group) are all marked, unless all of
 * them are marked already, then all are unmarked. With `limit`, marking stops at the limit (the keys
 * that do not fit stay unmarked).
 */
export function toggledMarks(
  marked: readonly string[],
  keys: readonly string[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const all = keys.every((key) => marked.includes(key));
  if (all) return marked.filter((key) => !keys.includes(key));
  return addedMarks(marked, keys, limit);
}

/** `keys` marked on top of `marked`, in their order, up to `limit`; nothing is unmarked. */
export function addedMarks(
  marked: readonly string[],
  keys: readonly string[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const out = [...marked];
  for (const key of keys) {
    if (out.length >= limit) break;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
