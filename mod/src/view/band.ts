/**
 * The band above the prompt: one row with the project, the environment and the eight steps of a
 * test session, drawn from the session state (`state/types.ts`). Pure: no `$`, no clock, no
 * exception. `register.ts` reads the state, calls `bandTree` and returns what it gives.
 *
 * The tree is plain data (what `$.ui.resolve(e)` constructors return): a Box with one Text whose
 * runs are Texts of their own. Colours are theme keys, apart from the one accent green.
 */

import { skippedWord, stepName, type Locale } from '../i18n.js';
import type { ModState } from '../state/types.js';
import { short } from './tree.js';

/** A node of a render tree as the band builds it (`RenderElement` of the mods API, as data). */
export interface Tree {
  readonly type: 'Box' | 'Text';
  readonly props?: Readonly<Record<string, string | number | boolean>>;
  readonly children?: readonly (Tree | string)[];
}

/** LoadCraft green: the one colour of the band that is not a key of the user's theme. */
export const ACCENT = '#2fb67c';

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** Claude Code cuts the status line at 2000 characters; the mod keeps to one short line. */
const STATUS_LIMIT = 200;
/** A project or environment name longer than this is cut: it is a label, not the place to read it. */
const NAME_LIMIT = 32;
const SEPARATOR = '  ';
const DONE_MARK = '✓';
const PROTECTED_MARK = '⚠';
const SKIPPED_MARK = '—';

/** A piece of the row: its text and how it is drawn. */
interface Piece {
  readonly text: string;
  readonly kind: 'title' | 'label' | 'protected' | 'done' | 'current' | 'ahead' | 'skipped';
}

const STYLES: Readonly<Record<Piece['kind'], Readonly<Record<string, string | number | boolean>>>> =
  {
    title: { color: ACCENT, weight: 'bold' },
    label: { color: 'inactive' },
    protected: { color: 'warning' },
    done: { color: ACCENT },
    current: { weight: 'bold', inverse: true },
    ahead: { dimColor: true },
    skipped: { dimColor: true },
  };

/**
 * A name that came from the server, made fit for one line of a terminal: escape sequences, control
 * characters, bidi and zero-width marks go (`inline`, the same rule as every view of the server),
 * line breaks and runs of spaces become one space, and a long name ends in an ellipsis.
 */
function label(value: string): string {
  return short(value, NAME_LIMIT);
}

function known(state: ModState): state is ModState & { project: NonNullable<ModState['project']> } {
  return !state.isStale && state.project !== undefined && state.step >= 1 && state.step <= 8;
}

/** `sklep · perf ⚠`: the project and the environment, as the row and the status line write them. */
function scope(state: ModState & { project: NonNullable<ModState['project']> }): string[] {
  const environment = state.environment;
  return environment === undefined
    ? [label(state.project.name)]
    : [label(state.project.name), label(environment.name)];
}

function length(pieces: readonly (Piece | string)[]): number {
  return pieces.reduce<number>(
    (sum, piece) => sum + [...(typeof piece === 'string' ? piece : piece.text)].length,
    0,
  );
}

function stepPiece(
  state: ModState,
  locale: Locale,
  step: number,
  detail: 'name' | 'number',
): Piece {
  const number = String(step).padStart(2, '0');
  const named = `${number} ${stepName(locale, step)}`;
  const done = state.done.includes(step);
  // The current step keeps its tick: the report read is step 7 done while the user is still in it.
  if (step === state.step) {
    return { kind: 'current', text: done ? `${DONE_MARK} ${named}` : named };
  }
  if (!done && state.skipped.includes(step)) {
    return detail === 'name'
      ? { kind: 'skipped', text: `${SKIPPED_MARK} ${named} (${skippedWord(locale)})` }
      : { kind: 'skipped', text: `${SKIPPED_MARK}${number}` };
  }
  if (detail === 'name')
    return { kind: done ? 'done' : 'ahead', text: done ? `${DONE_MARK} ${named}` : named };
  return { kind: done ? 'done' : 'ahead', text: done ? `${DONE_MARK}${number}` : number };
}

/** The pieces of the row, in order, with the plain strings that lie between them. */
function row(
  state: ModState & { project: NonNullable<ModState['project']> },
  locale: Locale,
  detail: 'name' | 'number',
  head: 'title' | 'scope' | 'none',
): (Piece | string)[] {
  const parts: (Piece | string)[] = [];
  if (head === 'title') parts.push({ kind: 'title', text: 'LoadCraft' }, ' · ');
  if (head !== 'none') {
    const [project, environment] = scope(state);
    parts.push({ kind: 'label', text: project ?? '' });
    if (environment !== undefined) {
      parts.push(' · ', { kind: 'label', text: environment });
      if (state.environment?.protected === true) {
        parts.push(' ', { kind: 'protected', text: PROTECTED_MARK });
      }
    }
    parts.push(SEPARATOR);
  }
  const between = detail === 'name' ? SEPARATOR : ' ';
  STEPS.forEach((step, index) => {
    if (index > 0) parts.push(between);
    parts.push(stepPiece(state, locale, step, detail));
  });
  return parts;
}

function currentOnly(state: ModState, locale: Locale): (Piece | string)[] {
  return [stepPiece(state, locale, state.step, 'name')];
}

function toNode(part: Piece | string): Tree | string {
  return typeof part === 'string'
    ? part
    : { type: 'Text', props: STYLES[part.kind], children: [part.text] };
}

/**
 * The row for a terminal `width` cells wide, or `undefined` while there is nothing to show (no
 * project known yet, or no step). It tries the widest form first and takes the first that fits:
 * the names of all eight steps; the numbers with the name of the current step only; the same
 * without the title; without the project and environment; the current step alone. Whatever is left
 * over is cut at the right edge by the Text, never wrapped, so the row is always one line.
 */
export function bandTree(state: ModState, locale: Locale, width: number): Tree | undefined {
  if (!known(state)) return undefined;
  const candidates: (Piece | string)[][] = [
    row(state, locale, 'name', 'title'),
    row(state, locale, 'number', 'title'),
    row(state, locale, 'number', 'scope'),
    row(state, locale, 'number', 'none'),
    currentOnly(state, locale),
  ];
  const chosen =
    candidates.find((parts) => length(parts) <= width) ?? candidates[candidates.length - 1] ?? [];
  return {
    type: 'Box',
    props: { flexDirection: 'row' },
    children: [{ type: 'Text', props: { wrap: 'truncate-end' }, children: chosen.map(toNode) }],
  };
}

function isTree(value: unknown): value is Tree {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value.type === 'Box' || value.type === 'Text' || value.type === 'engine')
  );
}

/**
 * Our row and what the hooks below ours drew, in one Box. Before Claude Code 2.1.323 all mods
 * share one drawing of the band and a tree that leaves out `beneath` hides the other mods' rows;
 * from 2.1.323 each mod has a row of its own and the child draws nothing. The Box has no width,
 * height or overflow, so it stays valid in both.
 */
export function bandRow(
  tree: Tree | undefined,
  beneath: unknown,
  extra: readonly Tree[] = [],
  card?: unknown,
): Tree {
  return {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [
      // The card, when there is one, is the first row: it is what asks for attention.
      ...(isTree(card) ? [card] : []),
      ...(tree === undefined ? [] : [tree]),
      ...extra,
      ...(isTree(beneath) ? [beneath] : []),
    ],
  };
}

/**
 * The step in one line, for the status line of a surface that has no band (VS Code):
 * `LoadCraft · sklep · qa ⚠ · 06 Run (5/8)`. `undefined` while there is nothing to show.
 */
export function statusLine(state: ModState, locale: Locale): string | undefined {
  if (!known(state)) return undefined;
  const [project, environment] = scope(state);
  const where = [project ?? '', ...(environment === undefined ? [] : [environment])].join(' · ');
  const mark = state.environment?.protected === true ? ` ${PROTECTED_MARK}` : '';
  const step = `${String(state.step).padStart(2, '0')} ${stepName(locale, state.step)}`;
  const skipped = state.skipped
    .filter((number) => number !== state.step && !state.done.includes(number))
    .map((number) => ` · ${String(number).padStart(2, '0')} ${skippedWord(locale)}`)
    .join('');
  const text = `LoadCraft · ${where}${mark} · ${step} (${state.done.length}/8)${skipped}`;
  const chars = [...text];
  return chars.length > STATUS_LIMIT ? `${chars.slice(0, STATUS_LIMIT - 1).join('')}…` : text;
}
