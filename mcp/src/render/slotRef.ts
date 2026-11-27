// How a view names a data slot: the label a person reads, and the key the `slot` parameter of
// the data tools take. A model sees only the text of a result, so the key has to be in it.

import type { Translator } from '../context.js';
import { inline } from './primitives.js';

/**
 * `User accounts (slot: accounts)`; just the key when the label is the key itself. The label is
 * cut to `labelLimit` characters when given; the key never is, so it can be copied as it stands.
 */
export function slotRef(label: string, key: string, t: Translator, labelLimit?: number): string {
  const name = inline(label, labelLimit);
  const slot = inline(key);
  return name === slot || name === '' ? slot : t('slot.ref', { label: name, key: slot });
}
