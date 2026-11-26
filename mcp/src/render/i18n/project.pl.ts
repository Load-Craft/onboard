// Texts of the tools of module project, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { projectEn } from './project.en.js';

export const projectPl: { readonly [K in keyof typeof projectEn]: Entry } = {
  'project_list_notes.header': {
    one: '{count} notatka o projekcie:',
    few: '{count} notatki o projekcie:',
    many: '{count} notatek o projekcie:',
    other: '{count} notatki o projekcie:',
  },
  'project_list_notes.empty':
    'Brak notatek o tym projekcie: agent zapisuje je, gdy przechodzi przez aplikację.',
  'project_list_notes.scope.url_path': 'strona {at}',
  'project_list_notes.scope.plan_step': 'krok „{at}”',
  'project_list_notes.scope.project': 'projekt',
  'project_list_notes.more': 'pokazano pierwsze {shown} z {total} notatek',
};
