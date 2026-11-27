// The vocabulary of the data tools for what a column holds (the backend's `credential` is `secret`
// here: tools/data/semantics.ts says why).

import type { Translator } from '../../context.js';

export type ColumnSemantics = 'identity' | 'secret' | 'entity-ref' | 'synthetic' | 'derived';

export function semanticsText(semantics: ColumnSemantics, t: Translator): string {
  return t(`data.semantics.${semantics}`);
}
