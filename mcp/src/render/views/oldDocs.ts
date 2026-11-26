// The lines every view draws for flows on an older docs version: the names (the first ten, then how
// many more), what that means where the view stands, and the next step, `flows_migrate_docs` with a
// preview. The import of the documentation, the status and the proposal of a scenario share them.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** Names listed before "and N more". */
const SHOWN = 10;
const NAME_LIMIT = 60;

/** Where the lines are drawn: a list of the project's flows, or the flows of one scenario. */
export type OldDocsContext = 'list' | 'scenario';

/** `a, b, c` of the first names, `a, b and 3 more` past them; `more` counts names not in `names`. */
function namesText(names: readonly string[], more: number, t: Translator): string {
  const shown = names.slice(0, SHOWN).map((name) => inline(name, NAME_LIMIT));
  const rest = names.length - shown.length + more;
  const joined = shown.join(', ');
  return rest > 0 ? t('oldDocs.more', { names: joined, count: rest }) : joined;
}

/** Nothing for no flow; else the names, what they mean in `context`, and the next step. */
export function oldDocsLines(
  names: readonly string[],
  more: number,
  context: OldDocsContext,
  t: Translator,
): string[] {
  const count = names.length + more;
  if (count === 0) return [];
  const key = context === 'scenario' ? 'oldDocs.scenario' : 'oldDocs.list';
  const head = t.plural(key, count, { names: namesText(names, more, t) });
  return [...wrap(head, VIEW_WIDTH, 2), ...wrap(t('oldDocs.next'), VIEW_WIDTH, 2)];
}
