// The view of `functional_save_catalog` and of the lines of its consent card. The names and the
// short values are texts a person or a model wrote: they arrive masked and made one line. Long
// values (a prompt, a list) are only counted.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { fieldLine, type FieldFact } from './consentFields.js';

export type CatalogKind = 'catalog_test_type' | 'catalog_validator' | 'catalog_assertion_type';

/** What the card froze. `name` and `kind` are also the slots of the log entry. */
export interface SaveCatalogFacts {
  readonly kind: CatalogKind;
  readonly name: string;
  readonly entry_id?: string;
  readonly created: boolean;
  readonly builtin: boolean;
  readonly fields: readonly FieldFact[];
}

/** What the log keeps for taking the change back. */
export type CatalogUndo = 'kept' | 'partial' | 'none' | 'withheld';

export interface SaveCatalogData {
  readonly kind: CatalogKind;
  readonly entry_id: string;
  readonly name: string;
  readonly created: boolean;
  /** The fields written; empty when nothing differed. */
  readonly changed: readonly string[];
  /** Changed fields the backend cannot put back (it ignores a null). */
  readonly not_undoable: readonly string[];
  readonly undo: CatalogUndo;
}

export function cardViewSaveCatalog(facts: SaveCatalogFacts, t: Translator): CardView {
  const lines = [
    facts.created
      ? t('functional_save_catalog.card.new', {
          kind: t(`functional_save_catalog.kind.${facts.kind}`),
        })
      : t('functional_save_catalog.card.change', {
          kind: t(`functional_save_catalog.kind.${facts.kind}`),
          id: facts.entry_id ?? '',
        }),
    ...facts.fields.map((item) => fieldLine('functional_save_catalog', item, t)),
  ];
  if (facts.builtin) lines.push(t('functional_save_catalog.card.builtin'));
  return {
    title: t('functional_save_catalog.card.title', { name: facts.name }),
    lines,
    undo: t(
      facts.created
        ? 'functional_save_catalog.card.undo.created'
        : 'functional_save_catalog.card.undo.changed',
    ),
  };
}

export function renderSaveCatalog(data: SaveCatalogData, t: Translator): string {
  const kind = t(`functional_save_catalog.kind.${data.kind}`);
  if (data.created) {
    return t('functional_save_catalog.created', { kind, name: data.name, id: data.entry_id });
  }
  if (data.changed.length === 0) {
    return t('functional_save_catalog.unchanged', { kind, name: data.name });
  }
  const lines = [
    t('functional_save_catalog.updated', {
      kind,
      name: data.name,
      fields: data.changed.join(', '),
    }),
  ];
  if (data.not_undoable.length > 0) {
    lines.push(t('functional_save_catalog.not_undoable', { fields: data.not_undoable.join(', ') }));
  }
  if (data.undo === 'withheld') lines.push(t('functional_save_catalog.withheld'));
  return lines.join('\n');
}
