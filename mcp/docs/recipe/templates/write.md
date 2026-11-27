# Recipe template SET

Use it in steps 10 and 11 when step 2 printed `template   SET`.
The example is `project_update`. Copy its shape. Replace its names with the names step 2 printed.

## The view (step 10)

```ts
// The view of `project_update`: which fields changed, and whether the change can be undone.

import type { Translator } from '../../context.js';
import { quoted, type UndoState } from '../../tools/kit/transitional.js';

export interface UpdateData {
  readonly project_id: string;
  /** The name after the call. */
  readonly name: string;
  /** The description after the call; null when the project has none. */
  readonly description: string | null;
  /** The fields the write changed; empty when nothing was sent. */
  readonly changed: readonly string[];
  readonly undo: UndoState;
}

export function renderUpdate(data: UpdateData, t: Translator): string {
  const name = quoted(data.name);
  if (data.changed.length === 0) return t('project_update.unchanged', { name });
  const fields = data.changed.map((field) => t(`project_update.field.${field}`)).join(', ');
  const lines = [t('project_update.header', { name, fields })];
  if (data.undo === 'withheld') lines.push(t('project_update.undo_withheld'));
  return lines.join('\n');
}
```

Change in your view:

- `UpdateData`: the fields of the brief, each "after the call". Keep `changed` and `undo` as they are.
- Add `'<tool_name>.field.<field>'` to both dictionaries for every field the tool can change.

## `run` (step 11)

```ts
// `project_update` (module project): Update a project's name or description.
// Log: args "{name}", result "{changed}".

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { renderUpdate, type UpdateData } from '../../render/project/update.js';
import { callBackend, type BodyOf, type CallContext } from '../moduleCall.js';
import { moduleTool } from '../moduleTool.js';
import {
  applyChange,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
} from '../kit/transitional.js';
import { PROJECT_UPDATE } from './meta.generated.js';

// The readers the scaffold wrote stay here, unchanged: getProject, updateProject.

export const projectUpdate = moduleTool(PROJECT_UPDATE, {
  title: "Update a project's name or description",
  input: {
    name: z.string().trim().min(1).max(255).optional().describe('The new name.'),
    description: z
      .string()
      .max(8000)
      .optional()
      .describe('The new description; an empty text clears it.'),
  },
  async run(ctx, args) {
    // 1. rules, before any request
    if (args.name === undefined && args.description === undefined) {
      refuseRule('update_at_least_one');
    }
    // 2. the project
    const path = { project_id: projectIdOf(ctx, undefined) };
    // 3. read, compare, write only what differs
    const change = await applyChange(ctx, {
      read: () => getProject(ctx, path),
      current: (before) => ({ name: before.name, description: before.description ?? '' }),
      wanted: { name: args.name, description: args.description },
      send: (fields) => updateProject(ctx, path, fields),
    });
    // 4. the data: the object after the call
    const now = change.after ?? change.before;
    const data: UpdateData = {
      project_id: path.project_id,
      name: thirdParty(ctx, now.name, LIMITS.name),
      description: thirdPartyOrNull(ctx, now.description, LIMITS.sentence),
      changed: change.changed,
      undo: change.undo,
    };
    // 5. the outcome: `inert` when nothing was sent, the undo when one is kept
    return {
      status: 'done',
      data,
      ...(change.after === null ? { inert: true as const } : {}),
      update: {
        log: {
          values: { name: data.name, changed: change.changed.join(', ') || 'nothing' },
          ...(change.undoArgs === undefined ? {} : { undo_args: change.undoArgs }),
        },
      },
    };
  },
  render: renderUpdate,
});
```

Change in your `run`:

- Keep the `title` and the `input` the scaffold wrote.
- The scaffold wrote no reader for the read before the write: write one in the same form as the reader it wrote.
- `current`: the fields the brief lists as compared. A field that can be `null`: `before.<field> ?? ''`.
- `wanted`: the same field names, from `args`. They must be the argument names: the undo calls the tool with them.
- A field that is a list or an object: STOP `S-08`.
- The object is not the project: add its id to `path` with the code step 2 printed under `arguments`.
- `log.values`: see "Log values" in the core. Keep the `undo_args` line as it is.
- Never send `null`. Never write `undo_args` yourself.
