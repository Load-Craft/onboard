// Sentinel cases of the tools of module project (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import { seedProjectNotes } from '../../fake-backend/routes/project.js';
import { SKLEP_IDS } from '../../golden/index.js';

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'project_list_notes',
    label: 'notes of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        { text: 'Accept the cookie banner first.', scope: { kind: 'url_path', url_path: '/' } },
      ]);
    },
  },
  {
    tool: 'project_list_notes',
    label: 'format data, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ format: 'data' }),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        { text: 'Log in before the cart.', scope: { kind: 'plan_step', plan_step: 'Log in' } },
      ]);
    },
  },
];
