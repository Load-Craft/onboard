// `flows_generate_from_har`: builds flows from a browser recording (HAR), as one flow or split into
// the journeys LoadCraft finds. The way itself lives in `flows/fromHar.ts`.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { renderBuildFlows } from '../render/views/buildFlows.js';
import { buildFromHar } from './flows/fromHar.js';

const MAX_NAME = 255;

// Strict like the other tools: a field of another way is refused, not dropped.
const input = z.strictObject({
  har: z
    .string()
    .min(1)
    .describe(
      'Path of the .har file, as given to flows_import_har; it is sent first when LoadCraft does not hold it.',
    ),
  split: z
    .boolean()
    .optional()
    .describe(
      'Required, agreed with the user: true = one flow per journey LoadCraft finds, false = one flow from the whole recording (name required).',
    ),
  name: z
    .string()
    .min(1)
    .max(MAX_NAME)
    .optional()
    .describe('Name of the flow when split is false.'),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('With split: true: names of the proposed journeys to build; default all of them.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the flows'),
});

export const flowsGenerateFromHar = defineTool({
  name: 'flows_generate_from_har',
  title: 'Generate flows from a recording',
  description:
    'Generate flows from an analyzed HAR session; split=true lets the backend propose journeys ' +
    'first. har = the .har recording (sent first when needed) and split, agreed with the user ' +
    'beforehand: split false builds one flow named name; split true lets LoadCraft split the ' +
    'recording into journeys and accepts the split at once (all journeys, or those named in ' +
    'paths). Like every long operation, it returns a handle when max_wait_s passes; pass it to ' +
    'process_wait. Creates flows.',
  input,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    return buildFromHar(ctx, {
      ...(args.project === undefined ? {} : { project: args.project }),
      har: args.har,
      ...(args.split === undefined ? {} : { split: args.split }),
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.paths === undefined ? {} : { paths: args.paths }),
      maxWaitS: args.max_wait_s,
    });
  },
  render: renderBuildFlows,
});
