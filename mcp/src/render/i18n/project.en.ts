// Texts of the tools of module project, English: the key set of project.pl.ts. A key starts with the
// name of a tool of the module (`project_list.`) or with `project.` for a text its tools share.

import type { Entry } from './core.js';

export const projectEn = {
  'project_list_notes.header': {
    one: '{count} note about the project:',
    other: '{count} notes about the project:',
  },
  'project_list_notes.empty':
    'No notes about this project yet: the agent saves them while it walks the application.',
  'project_list_notes.scope.url_path': 'page {at}',
  'project_list_notes.scope.plan_step': 'step "{at}"',
  'project_list_notes.scope.project': 'project',
  'project_list_notes.more': 'showing the first {shown} of {total} notes',
} as const satisfies Readonly<Record<string, Entry>>;
