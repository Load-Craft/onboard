// `project_apply_setup`: the configuration the setup gate of the bound project waits for. It applies
// the profile composed from the proposals of the analysis it names, creates the default validators
// and test types the project lacks, and reports the setup as LoadCraft now has it: the
// documentation, the profile, what was provisioned, what the gate still misses, and whether the
// default environment serves the documented GET operations.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { defineTool } from '../registry.js';
import { renderApplySetup } from '../render/views/projectSetup.js';
import { createResolver } from '../resolve/handles.js';
import { applySetup } from './project/setup.js';

const input = z.strictObject({
  analysis: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Handle of the finished analysis whose proposals to apply (setup_analysis:<id>, from ' +
        'project_analyze_setup). Without it the profile is left as it is and only the default ' +
        'validators and test types are added.',
    ),
});

export const projectApplySetup = defineTool({
  name: 'project_apply_setup',
  title: 'Apply the setup of a LoadCraft project',
  description:
    'Apply the reviewed profile, seed default validators and test types, then check conformance ' +
    'of the default environment: applies the profile fields the analysis proposed (analysis: ' +
    'its handle), adds the default validators and test types the project lacks (nothing is ' +
    'duplicated) and reports what the generation gate still misses. The result shows the API ' +
    'map (title, operations, areas), whether the default environment serves the documented GET ' +
    'operations of the documentation the analysis imported (skipped when that environment is ' +
    'protected), and the profile fields the analysis was unsure of: ask the user about those.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    await getCompat(ctx);
    const project = await createResolver(ctx).project();
    return applySetup(ctx, project, args.analysis);
  },
  render: renderApplySetup,
});
