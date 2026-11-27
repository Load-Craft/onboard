// Texts of the tools of module process, English: the key set of process.pl.ts. A key starts with the
// name of a tool of the module (`process_list.`) or with `process.` for a text its tools share.

import type { Entry } from './core.js';

export const processEn = {
  'process_set_choices.header': 'Choices updated: {paths}.',
  'process_set_choices.value': '{path} = {value}',
  'process_set_choices.cleared': '{path} cleared',
  'process_set_choices.unchanged': 'Choices: nothing to change, they are already as given.',
  'process_set_choices.not_undoable':
    'A previous value held a secret and is not kept, so this change cannot be undone from the log.',
} as const satisfies Readonly<Record<string, Entry>>;
