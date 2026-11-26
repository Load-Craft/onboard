// View of `flows_suggest_journeys`: the proposed user journeys as one line per proposal (name, kind, then
// the steps: arrows where the order is the plan, dots where the generator orders them; the rungs of
// a ladder as one entry), the API coverage line (always), and the lines that appear only when
// something is off: operations no journey covers, refinement units that failed, proposals that were
// not refined.

import type { Translator } from '../../context.js';
import { inline, num, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import {
  ARROW,
  GAP,
  INDENT,
  NAME_COLUMN_MAX,
  SET_SEPARATOR,
  SHOWN_ENTRIES,
} from '../suggestJourneysLayout.js';

export interface SuggestionView {
  readonly name: string;
  /** What each step does: the summary of its operation, or `METHOD /path`. */
  readonly steps: string[];
  /** Raw `pattern_type` of the backend; the view names only the ones that change the journey. */
  readonly patternType: string;
  readonly confidence?: number;
  /** Why the operations belong together. */
  readonly note?: string;
}

export interface SuggestionsData {
  readonly suggestions: SuggestionView[];
  /** Proposals beyond the ones given; the view lists its own limit of entries. */
  readonly more: number;
  readonly coverage: {
    /** Operations that appear in some proposal. */
    readonly covered: number;
    readonly total: number;
    /** Names of operations no proposal contains (at most 5). */
    readonly uncovered: string[];
    /** Uncovered operations beyond the ones named. */
    readonly more: number;
  };
  /** Refinement units that did not finish. */
  readonly failedUnits: string[];
  /** False when only the free heuristic ran. */
  readonly refined: boolean;
}

/** Kinds the view names with a label of the dictionary; any other kind is shown without one. */
const KINDS: ReadonlySet<string> = new Set([
  'semantic',
  'tag_group',
  'crud',
  'auth_rejection',
  'async_polling',
  'journey_slice',
]);
/** Kinds whose steps are a set: the generator, not the proposal, orders them when it builds. */
const UNORDERED: ReadonlySet<string> = new Set(['semantic', 'tag_group']);
/** The kind whose proposals are the rungs of one ladder, each longer than the one before. */
const LADDER = 'journey_slice';

/** Names from the backend or a model, each on one line, joined. */
const joined = (names: readonly string[], separator: string): string =>
  names.map((name) => inline(name)).join(separator);

function stepsText(suggestion: SuggestionView, t: Translator): string {
  const separator = UNORDERED.has(suggestion.patternType) ? SET_SEPARATOR : ARROW;
  const steps = suggestion.steps.length === 0 ? '—' : joined(suggestion.steps, separator);
  return KINDS.has(suggestion.patternType)
    ? `[${t(`suggest.type.${suggestion.patternType}`)}] ${steps}`
    : steps;
}

/** The rungs of the ladder as one entry: how many, where it starts and ends, and their names. */
function ladderLines(rungs: readonly SuggestionView[], t: Translator): string[] {
  const first = rungs[0];
  const last = rungs[rungs.length - 1];
  if (first === undefined || last === undefined) return [];
  const header = t.plural('suggest.ladder', rungs.length, {
    count: num(rungs.length, t.locale),
    first: `„${inline(first.name)}”`,
    firstSteps: t.plural('suggest.ladderSteps', first.steps.length, {
      count: num(first.steps.length, t.locale),
    }),
    last: `„${inline(last.name)}”`,
    lastSteps: t.plural('suggest.ladderSteps', last.steps.length, {
      count: num(last.steps.length, t.locale),
    }),
  });
  // Whole names only: the build takes a name exactly, so a name is never split across lines.
  const label = `${t('suggest.ladderRungs')} `;
  const lines: string[] = [];
  let line = '';
  for (const name of rungs.map((rung) => inline(rung.name))) {
    const next = line === '' ? name : `${line}${SET_SEPARATOR}${name}`;
    if (line !== '' && visibleWidth(INDENT + label + next) > VIEW_WIDTH) {
      lines.push(line);
      line = name;
    } else {
      line = next;
    }
  }
  lines.push(line);
  const hang = ' '.repeat(visibleWidth(INDENT + label));
  return [
    ...wrap(header, VIEW_WIDTH, INDENT.length),
    ...lines.map((text, index) => (index === 0 ? INDENT + label : hang) + text),
  ];
}

/** Name column and steps; steps wrapped under their own column. */
function proposalLines(raw: readonly SuggestionView[], t: Translator): string[] {
  const suggestions = raw.map((item) => ({ ...item, name: inline(item.name) }));
  const inColumn = suggestions.filter((item) => visibleWidth(item.name) <= NAME_COLUMN_MAX);
  const nameWidth = Math.max(0, ...inColumn.map((item) => visibleWidth(item.name)));
  const room = VIEW_WIDTH - nameWidth - GAP;
  return suggestions.flatMap((suggestion) => {
    const text = stepsText(suggestion, t);
    if (visibleWidth(suggestion.name) > NAME_COLUMN_MAX) {
      const [first = '', ...rest] = wrap(text, VIEW_WIDTH - INDENT.length);
      return [suggestion.name, INDENT + first, ...rest.map((line) => INDENT + line)];
    }
    const [first = '', ...rest] = wrap(text, room);
    const gap = ' '.repeat(nameWidth - visibleWidth(suggestion.name) + GAP);
    const hang = ' '.repeat(nameWidth + GAP);
    return [`${suggestion.name}${gap}${first}`, ...rest.map((line) => hang + line)];
  });
}

function coverageLines(data: SuggestionsData, t: Translator): string[] {
  const { covered, total, uncovered, more } = data.coverage;
  if (total === 0) return [];
  const names =
    more > 0
      ? t('resolve.more', { names: joined(uncovered, ', '), count: num(more, t.locale) })
      : joined(uncovered, ', ');
  return [
    t('suggest.coverage', {
      covered: num(covered, t.locale),
      total: num(total, t.locale),
      outside: num(total - covered, t.locale),
    }),
    ...(uncovered.length === 0
      ? []
      : wrap(t('suggest.uncovered', { names }), VIEW_WIDTH, INDENT.length)),
  ];
}

export function renderSuggestJourneys(data: SuggestionsData, t: Translator): string {
  const all = data.suggestions;
  const rungs = all.filter((item) => item.patternType === LADDER);
  // A lone rung is an ordinary proposal; two or more are one entry, listed after the others.
  const laddered = rungs.length >= 2;
  const ordinary = laddered ? all.filter((item) => item.patternType !== LADDER) : all;
  const room = SHOWN_ENTRIES - (laddered ? 1 : 0);
  const shown = ordinary.slice(0, room);
  const hidden = ordinary.length - shown.length + data.more;
  const header =
    all.length === 0
      ? [t('suggest.none')]
      : [
          t.plural('suggest.title', all.length + data.more),
          ...(all.some((item) => UNORDERED.has(item.patternType))
            ? wrap(t('suggest.unordered'), VIEW_WIDTH - INDENT.length).map((line) => INDENT + line)
            : []),
        ];
  const more = hidden > 0 ? [INDENT + t('suggest.more', { count: num(hidden, t.locale) })] : [];
  const failed =
    data.failedUnits.length === 0
      ? []
      : wrap(
          t('suggest.failed', { names: joined(data.failedUnits, ', ') }),
          VIEW_WIDTH,
          INDENT.length,
        );
  const heuristic = data.refined ? [] : wrap(t('suggest.heuristicOnly'), VIEW_WIDTH, INDENT.length);
  return [
    ...header,
    ...proposalLines(shown, t),
    ...(laddered ? ladderLines(rungs, t) : []),
    ...more,
    ...coverageLines(data, t),
    ...failed,
    ...heuristic,
  ].join('\n');
}
