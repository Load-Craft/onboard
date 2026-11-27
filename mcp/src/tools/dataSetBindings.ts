// `data_set_bindings`: the slot-to-dataset picks of a scenario or composition, the whole map at once
// (a slot left out loses its pick; `{}` clears every pick). For a composition the picks also go to
// each member scenario that reads the slot and whose columns the dataset covers, since a member's
// self-check reads its own picks. The previous map is kept in the log entry for the undo.

import * as z from 'zod/v4';

import { defineTool } from '../registry.js';
import { renderBindings, type BindingsView } from '../render/views/data.js';
import { setBindings } from './data/bindings.js';
import { projectArgs, projectField, resolveTarget, scenarioField } from './data/target.js';

const input = z.strictObject({
  scenario: scenarioField,
  bindings: z
    .record(z.string(), z.string().trim().min(1))
    .describe(
      'Slot key to dataset (its name or id), the whole map: a slot left out loses its pick, {} ' +
        'clears them all. Copy the map a data result prints; it holds the picks kept so far.',
    ),
  project: projectField,
});

export const dataSetBindings = defineTool<typeof input, BindingsView>({
  name: 'data_set_bindings',
  title: 'Set the datasets of the data slots',
  description:
    'Set the slot-to-dataset bindings of a scenario or composition (whole map replaced; {} ' +
    'clears). For a composition each member scenario that reads a slot gets the pick too, when ' +
    'the dataset has its columns. Sends nothing to the target; data_check_readiness shows the ' +
    'result.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  // names and texts of LoadCraft's answers in the data are shown masked (FIX-76)
  maskNames: true,
  async run(ctx, args) {
    const { projectId, target } = await resolveTarget(ctx, args);
    const result = await setBindings(ctx, projectId, target, args.bindings);
    const data: BindingsView = {
      target: { kind: target.kind, name: target.name },
      bound: result.bound,
      cleared: result.cleared,
      unchanged: result.unchanged,
      count: result.bound.length,
      next: {
        tool: 'data_check_readiness',
        args: { scenario: args.scenario, ...projectArgs(args.project) },
      },
    };
    return {
      status: 'done',
      data,
      ...(result.unchanged ? { inert: true } : {}),
      update: {
        checks: { data: { bindings_set: { ok: result.bound.length > 0 } } },
        log: {
          undo_args: {
            scenario: args.scenario,
            bindings: result.previous,
            ...projectArgs(args.project),
          },
        },
      },
    };
  },
  render: renderBindings,
});
