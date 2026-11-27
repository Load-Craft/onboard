// Texts of the tools of module process, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { processEn } from './process.en.js';

export const processPl: { readonly [K in keyof typeof processEn]: Entry } = {
  'process_set_choices.header': 'Wybory zmienione: {paths}.',
  'process_set_choices.value': '{path} = {value}',
  'process_set_choices.cleared': '{path} wyczyszczone',
  'process_set_choices.unchanged': 'Wybory: nic do zmiany, są już takie, jak podano.',
  'process_set_choices.not_undoable':
    'Poprzednia wartość zawierała sekret i nie jest zapamiętana, więc tej zmiany nie da się cofnąć z dziennika.',
};
