# Recipe template OBJECT

Use it in steps 10 and 11 when step 2 printed `template   OBJECT`.
The example is `scenario_get` with one part, `drift`. Copy its shape. Replace its names with the names step 2 printed.

## The view (step 10)

```ts
// The view of `scenario_get`: the scenario, then each part the call asked for.

import type { Translator } from '../../context.js';
import { idTag, minute, partLines, quoted, type Part } from '../../tools/kit/transitional.js';

export interface DriftView {
  readonly score: number;
  readonly checked_at: string;
}

export interface GetData {
  readonly project_id: string;
  readonly id: string;
  readonly name: string;
  readonly version: number;
  /** Present with `include: ["drift"]`. */
  readonly drift: Part<DriftView>;
}

export function renderGet(data: GetData, t: Translator): string {
  return [
    t('scenario_get.header', {
      name: quoted(data.name),
      version: data.version,
      id: idTag(data.id),
    }),
    ...partLines(t, 'scenario', t('scenario_get.drift'), data.drift, (drift) => [
      t('scenario_get.drift_line', { score: drift.score, checked: minute(drift.checked_at) }),
    ]),
  ].join('\n');
}
```

Change in your view:

- `GetData`: one field per row of the field table of the brief. One `Part<...>` field per `include` value.
- One `...partLines(t, '<module>', <label>, data.<part>, ...)` block per part.
- A tool with no part: delete the `partLines` block and the imports of `partLines` and `Part`.

## `run` (step 11)

```ts
// `scenario_get` (module scenario): Get a scenario. Shortened: only the part `drift` is shown.
// Log: args "{scenario_id}", result "{name} v{version}; self-check {self_check}".

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { renderGet, type GetData } from '../../render/scenario/get.js';
import { callBackend, type CallContext } from '../moduleCall.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import {
  includes,
  LIMITS,
  mapPart,
  projectIdOf,
  refId,
  settleAll,
  thirdParty,
} from '../kit/transitional.js';
import { SCENARIO_GET } from './meta.generated.js';

// The readers the scaffold wrote stay here, unchanged: getScenario, getStaleness.

export const scenarioGet = moduleTool(SCENARIO_GET, {
  title: 'Get a scenario',
  input: {
    scenario_id: uuidArgument().optional().describe('The scenario.'),
    include: z
      .array(z.enum(['contract', 'drift', 'artifact']))
      .max(3)
      .optional()
      .describe('…'),
  },
  async run(ctx, args) {
    // 1. rules: none. 2. the project and the object
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = refId(
      ctx,
      'scenario_id',
      args.scenario_id,
      'ids.scenario_ids',
    ).toLowerCase();
    // 3. the reads: the main one, then each auxiliary one as a part
    const want = includes(args.include);
    const [detail, drift] = await settleAll([
      getScenario(ctx, { project_id: projectId, scenario_id: scenarioId }),
      want.part('drift', () => getStaleness(ctx, { scenario_id: scenarioId })),
    ]);
    // 4. the data: every field through its row of recipe/mask.md
    const data: GetData = {
      project_id: projectId,
      id: detail.id,
      name: thirdParty(ctx, detail.name, LIMITS.name),
      version: detail.current_version,
      drift: mapPart(drift, (answer) => ({
        score: answer.staleness_score,
        checked_at: answer.checked_at,
      })),
    };
    // 5. the outcome: every log slot the data does not carry under the same name
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            scenario_id: scenarioId,
            self_check: detail.self_check?.status ?? 'none',
          },
        },
      },
    };
  },
  render: renderGet,
});
```

Change in your `run`:

- Keep the `title` and the `input` the scaffold wrote.
- Step 2 printed the code for each argument under `arguments`: use exactly that code. Import `runOf` and `runIdArgument` from `'../kit/transitional.js'`, never from another module.
- The brief says the tool also works without the argument and without a value in the state: write `refIdOrNone(...)` in place of `refId(...)`. It gives `undefined`.
- A rule of the brief: add `if (<condition>) refuseRule('<key>');` as the first lines of `run`. Import `refuseRule`.
- One line in `settleAll([...])` per operation: see "Which read" in the core.
- A part taken from the main answer: `want.has('<value>') ? { state: 'read', value: <...> } : { state: 'skipped' }`.
- Every field of the data through its row of `docs/recipe/mask.md`.
- `log.values`: see "Log values" in the core.
- Step 2 printed `S-13`: add the state update of the brief to `update`, next to `log`.
