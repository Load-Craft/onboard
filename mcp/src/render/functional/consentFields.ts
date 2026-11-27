// What the consent cards of module functional show of a field a call writes: a short plain value as
// masked text, anything longer or not text by its size. Shared by the cards of the tools that save
// fields (`functional_save_catalog`, `functional_save_test_types`, `functional_save_validators`).

import type { Translator } from '../../context.js';

/** One field the call writes: its name and how it is shown. */
export interface FieldFact {
  readonly field: string;
  /** A short value as text; null when the value is shown by its size only. */
  readonly value: string | null;
  /** Characters of a text, items of a list; 0 for a short value. */
  readonly size: number;
}

/** The line of a field on a card (`<prefix>.card.value` and `<prefix>.card.size` of the tool). */
export function fieldLine(prefix: string, item: FieldFact, t: Translator): string {
  return item.value === null
    ? t(`${prefix}.card.size`, { field: item.field, size: item.size })
    : t(`${prefix}.card.value`, { field: item.field, value: item.value });
}
