// The view of `functional_save_test_types` and of the lines of its consent card. Names and short
// values are texts a person or a model wrote: they arrive masked and made one line. Long values (a
// prompt, a list of examples) are only counted.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';
import { fieldLine, type FieldFact } from './consentFields.js';

export type TestTypesSource = 'custom' | 'catalog' | 'suggestions';

/** One item of an addition: its name (or the catalog name) and the fields it sets. */
export interface TestTypeItemFact {
  readonly name: string;
  readonly fields: readonly FieldFact[];
}

/** What the card froze. `n` is the slot of the log entry (the count of test types). */
export interface SaveTestTypesFacts {
  readonly mode: 'add' | 'update';
  readonly n: number;
  readonly source?: TestTypesSource;
  /** An addition: at most 20 items, and how many there are in all. */
  readonly items?: readonly TestTypeItemFact[];
  /** An update: the test type now, and the fields that would change. */
  readonly test_type_id?: string;
  readonly name?: string;
  readonly fields?: readonly FieldFact[];
}

/** What the log keeps for taking the change back. */
export type TestTypesUndo = 'kept' | 'partial' | 'none' | 'withheld' | 'one_by_one';

export interface SaveTestTypesData {
  readonly mode: 'add' | 'update';
  /** Test types added or changed (at most 20 shown) and how many in all. */
  readonly saved: readonly { readonly id: string; readonly name: string }[];
  readonly count: number;
  /** A catalog addition: entries the project already had. */
  readonly skipped: number;
  /** An update: the fields written; empty when everything was as given. */
  readonly changed: readonly string[];
  readonly not_undoable: readonly string[];
  readonly undo: TestTypesUndo;
}

const P = 'functional_save_test_types';

export function cardViewSaveTestTypes(facts: SaveTestTypesFacts, t: Translator): CardView {
  if (facts.mode === 'update') {
    return {
      title: t(`${P}.card.title_update`, { name: facts.name ?? '' }),
      lines: [
        t(`${P}.card.change`, { id: facts.test_type_id ?? '' }),
        ...(facts.fields ?? []).map((item) => fieldLine(P, item, t)),
      ],
      undo: t(`${P}.card.undo.update`),
    };
  }
  const items = facts.items ?? [];
  const lines = [t(`${P}.card.source.${facts.source ?? 'custom'}`, { count: facts.n })];
  for (const item of items) {
    const sets = item.fields.map((field) =>
      field.value === null
        ? `${field.field} (${num(field.size, t.locale)})`
        : `${field.field}: ${field.value}`,
    );
    lines.push(
      t(`${P}.card.item`, { name: item.name, sets: sets.length === 0 ? '-' : sets.join(', ') }),
    );
  }
  if (facts.n > items.length) lines.push(t(`${P}.card.more`, { count: facts.n - items.length }));
  return {
    title: t(`${P}.card.title`, { n: facts.n }),
    lines,
    undo: t(`${P}.card.undo.add`),
  };
}

export function renderSaveTestTypes(data: SaveTestTypesData, t: Translator): string {
  if (data.mode === 'update') {
    const name = data.saved[0]?.name ?? '';
    if (data.changed.length === 0) return t(`${P}.unchanged`, { name });
    const lines = [t(`${P}.updated`, { name, fields: data.changed.join(', ') })];
    if (data.not_undoable.length > 0) {
      lines.push(t(`${P}.not_undoable`, { fields: data.not_undoable.join(', ') }));
    }
    if (data.undo === 'withheld') lines.push(t(`${P}.withheld`));
    return lines.join('\n');
  }
  const lines = [t.plural(`${P}.added`, data.count)];
  lines.push(...data.saved.map((item) => t(`${P}.saved`, { name: item.name, id: item.id })));
  if (data.count > data.saved.length) {
    lines.push(t(`${P}.more`, { count: data.count - data.saved.length }));
  }
  if (data.skipped > 0) lines.push(t.plural(`${P}.skipped`, data.skipped));
  if (data.undo === 'one_by_one') lines.push(t(`${P}.one_by_one`));
  return lines.join('\n');
}
