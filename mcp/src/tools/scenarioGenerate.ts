// `scenario_generate`: one scenario per flow, the composition with the weights the user approved, and
// the automatic self-check of every scenario. The work itself lives in `scenario/generate.ts`. It
// names the flows that are pinned to an older docs version (a scenario reads the docs of its flow,
// not the current ones) and keeps the warning `flows_on_old_docs` of the state in step with the
// project's flows.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { withUpdate } from '../outcome.js';
import { defineTool } from '../registry.js';
import { renderBuildScenarioResult } from '../render/views/buildScenario.js';
import { needsInputScenarioLines } from '../render/views/needsInput.js';
import { oldDocsLines } from '../render/views/oldDocs.js';
import { createResolver } from '../resolve/handles.js';
import { flowWarnings } from './scenario/flowWarnings.js';
import { checkProportionValues, flowsOfCall, generateScenarios } from './scenario/generate.js';
import { MAX_SCENARIO_FLOWS } from './scenario/limits.js';

// Strict like the other tools: a field of the proposal is refused, not dropped.
const input = z.strictObject({
  name: z.string().min(1).max(100).describe('Name of the composition this scenario will become.'),
  flows: z
    .array(z.string().min(1))
    .max(MAX_SCENARIO_FLOWS)
    .optional()
    .describe(
      'Names of the flows to combine (1-20). Without it: the flows of the last proposal for this `name`.',
    ),
  proportions: z
    .record(z.string(), z.number())
    .describe('Percent of traffic per flow name, adding up to 100.'),
  data_mix: z
    .union([z.enum(['normal', 'realistic']), z.record(z.string(), z.number())])
    .optional()
    .describe(
      'Test data when generating: "normal" (typical only, default), "realistic" (95% typical, 4% invalid, 1% edge cases) or weights by test type name.',
    ),
  max_wait_s: maxWaitInput('the scenarios'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

export const scenarioGenerate = defineTool({
  name: 'scenario_generate',
  title: 'Generate a load scenario',
  description:
    'Step 04: generate one scenario per flow, one after another (minutes each), combine them into ' +
    'the composition `name` with `proportions` (percent per flow, adding up to 100, the split ' +
    'the user approved after scenario_suggest_split) and `data_mix`, and show the automatic ' +
    'self-check of each scenario, which sends real requests (one user, one pass) to the ' +
    "project's default environment. For an existing composition with the same flows only the " +
    'weights change, nothing is generated. A failed flow creates no composition; calling again ' +
    'with the same arguments reuses ready scenarios and generates only the missing ones. Does not ' +
    'prepare test data or run a load test.',
  input,
  annotations: { openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const proportions = args.proportions;
    checkProportionValues(proportions);
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project);
    const flows = await flowsOfCall(ctx, resolver, project.id, {
      name: args.name,
      flows: args.flows,
      proportions,
    });
    const old = await flowWarnings(ctx, project.id, flows, 'scenario_generate');
    const outcome = await generateScenarios(ctx, project, {
      name: args.name,
      flows,
      proportions,
      dataMix: args.data_mix ?? 'normal',
      maxWaitS: args.max_wait_s,
    });
    // the warnings come with the start of the generation too: a running result shows them in its note
    const warning = [
      ...oldDocsLines(old.names, 0, 'scenario', ctx.t),
      ...needsInputScenarioLines(old.needsInput, ctx.t),
    ].join('\n');
    const shown =
      warning === ''
        ? outcome
        : outcome.status === 'done'
          ? {
              ...outcome,
              data: {
                ...outcome.data,
                ...(old.names.length === 0 ? {} : { oldDocs: old.names }),
                ...(old.needsInput === undefined ? {} : { needsInput: old.needsInput }),
              },
            }
          : {
              ...outcome,
              data: {
                ...outcome.data,
                note:
                  outcome.data.note === undefined ? warning : `${outcome.data.note}\n${warning}`,
              },
            };
    return withUpdate(shown, old.update);
  },
  render: renderBuildScenarioResult,
});
