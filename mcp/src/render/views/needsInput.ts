// The lines every view draws for flows the generator left open items on: in a list of the project's
// flows (the status) the names and how many items are definite, for the flows of a scenario what that
// means for it, before a run the open warning of the state. Each is a warning with the next step,
// never a refusal. The status, the proposal of a scenario and the start of a test share them.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** Names listed before "and N more". */
const SHOWN = 10;
const NAME_LIMIT = 60;

/** Flows with open items: their names (the first ones), how many more, and the definite items. */
export interface NeedsInputView {
  readonly flows: readonly string[];
  /** Flows with open items not named in `flows`. */
  readonly more?: number;
  /** Items whose steps get 401 as built. */
  readonly definite: number;
}

function namesText(names: readonly string[], more: number, t: Translator): string {
  const shown = names.slice(0, SHOWN).map((name) => inline(name, NAME_LIMIT));
  const rest = names.length - shown.length + more;
  const joined = shown.join(', ');
  return rest > 0 ? t('oldDocs.more', { names: joined, count: rest }) : joined;
}

const definiteText = (definite: number, t: Translator): string =>
  definite === 0 ? '' : t.plural('needsInput.definite', definite);

/** Nothing for no flow; else the flows of the list, the definite items and the next step. */
export function needsInputLines(view: NeedsInputView | undefined, t: Translator): string[] {
  const more = view?.more ?? 0;
  const count = (view?.flows.length ?? 0) + more;
  if (view === undefined || count === 0) return [];
  const head = t.plural('needsInput.list', count, {
    names: namesText(view.flows, more, t),
    definite: definiteText(view.definite, t),
  });
  return [...wrap(head, VIEW_WIDTH, 2), ...wrap(t('needsInput.next'), VIEW_WIDTH, 2)];
}

/** Nothing for no flow; else the chosen flows that have open items, for a scenario built from them. */
export function needsInputScenarioLines(view: NeedsInputView | undefined, t: Translator): string[] {
  if (view === undefined || view.flows.length === 0) return [];
  const head = t.plural('needsInput.scenario', view.flows.length, {
    names: namesText(view.flows, 0, t),
    definite: definiteText(view.definite, t),
  });
  return [...wrap(`⚠ ${head}`, VIEW_WIDTH, 2), ...wrap(t('needsInput.next'), VIEW_WIDTH, 2)];
}

/** Nothing without the warning; else one line before a test: how many flows, how many definite. */
export function needsInputRunLine(
  open: { readonly flows: number; readonly definite: number } | undefined,
  t: Translator,
): string[] {
  if (open === undefined || open.flows === 0) return [];
  return wrap(
    `⚠ ${t.plural('needsInput.run', open.flows, { definite: definiteText(open.definite, t) })}`,
    VIEW_WIDTH,
    2,
  );
}
