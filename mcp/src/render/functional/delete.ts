// The view of `functional_delete` and of the lines of its consent card: exactly what is deleted, of
// which kind, and what kind of thing it is (a project's own, or shared by all projects). The names are
// texts a person or a model wrote: they arrive masked and made one line.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';

export type DeleteKind =
  | 'flow'
  | 'template'
  | 'test_type'
  | 'validator'
  | 'run'
  | 'catalog_test_type'
  | 'catalog_validator'
  | 'catalog_assertion_type';

/** What the card froze. `kind` and `names` are also the slots of the log entry. */
export interface FunctionalDeleteFacts {
  readonly kind: DeleteKind;
  readonly names: string;
  readonly item_id: string;
  /** A flow: its version and blocks; a run: its status. */
  readonly version?: string;
  readonly blocks?: number;
  readonly status?: string;
  /** A catalog entry that came with LoadCraft. */
  readonly builtin?: boolean;
}

export interface FunctionalDeleteData {
  readonly kind: DeleteKind;
  readonly item_id: string;
  readonly names: string;
  readonly count: number;
}

const P = 'functional_delete';

export function cardViewFunctionalDelete(facts: FunctionalDeleteFacts, t: Translator): CardView {
  const lines = [t(`${P}.card.item.${facts.kind}`, { id: facts.item_id })];
  if (facts.version !== undefined) {
    lines.push(t(`${P}.card.flow`, { version: facts.version, blocks: facts.blocks ?? 0 }));
  }
  if (facts.status !== undefined) lines.push(t(`${P}.card.status`, { status: facts.status }));
  if (facts.builtin === true) lines.push(t(`${P}.card.builtin`));
  lines.push(t(`${P}.card.what.${facts.kind}`));
  return {
    title: t(`${P}.card.title.${facts.kind}`, { name: facts.names }),
    lines,
    undo: t(`${P}.card.undo`),
  };
}

export function renderFunctionalDelete(data: FunctionalDeleteData, t: Translator): string {
  return [t(`${P}.done.${data.kind}`, { name: data.names }), t(`${P}.irreversible`)].join('\n');
}
