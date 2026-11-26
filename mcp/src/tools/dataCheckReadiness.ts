// `data_check_readiness`: the data plan of a scenario or composition without the data hub. One row
// per data slot (auto, missing, pinned, wrong columns, stale binding), what blocks the test, and
// the calls that fill a slot of plain data from its own columns. It reads and changes nothing and
// calls no model; a run of the load weighs the rows itself.

import * as z from 'zod/v4';

import { defineTool } from '../registry.js';
import { renderDataPlan, type DataPlanView } from '../render/views/data.js';
import { planOf, readSlots, refusalsOf } from './data/readPlan.js';
import { generationSteps } from './data/suggestion.js';
import {
  environmentField,
  projectArgs,
  projectField,
  resolveTarget,
  scenarioField,
} from './data/target.js';

const input = z.strictObject({
  scenario: scenarioField,
  environment: environmentField,
  project: projectField,
});

export const dataCheckReadiness = defineTool<typeof input, DataPlanView>({
  name: 'data_check_readiness',
  title: 'Check the test data of a scenario',
  description:
    'Check whether the datasets cover a run of a scenario or composition on an environment. ' +
    'Creates nothing. One row per data slot (auto, missing, pinned, wrong columns, stale ' +
    'binding), what to fix before the test, and the exact calls that fill a slot of plain data; ' +
    'read-only, no model is called and no password is shown. The data hub proposes more with ' +
    'data_suggest_actions.',
  input,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const { projectId, target, environment } = await resolveTarget(ctx, args);
    const request = {
      projectId,
      target,
      ...(environment === undefined ? {} : { environment }),
      refused: refusalsOf(ctx, projectId, target.id),
    };
    const slots = await readSlots(ctx, request);
    const { view } = planOf(request, slots, { actions: [], reply: null });
    const base = { scenario: args.scenario, ...projectArgs(args.project) };
    const data: DataPlanView = { ...view, steps: generationSteps(base, view) };
    return {
      status: 'done',
      data,
      update: { checks: { data: { datasets_ready: { ok: data.ready } } } },
    };
  },
  render: renderDataPlan,
});
