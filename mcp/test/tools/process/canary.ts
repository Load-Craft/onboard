// Sentinel cases of the tools of module process (test/security/canaryCases.ts finds them here). The
// tool sends no request (`local`), so there is no answer to taint: the case proves that a value that
// looks like a secret is refused and reaches neither the result, the log nor the state file.

import type { Case } from '../../security/canaryCases.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'process_set_choices',
    label: 'a secret-shaped text in a field of the flows group, refused',
    stage: 'project',
    local: true,
    refusedAs: 'invalid_arguments',
    args: () => ({
      choices: {
        flows: {
          account_ref: `Authorization: Bearer ${SHAPE_CANARY}, password: ${BACKEND_CANARY}`,
        },
      },
    }),
  },
];
