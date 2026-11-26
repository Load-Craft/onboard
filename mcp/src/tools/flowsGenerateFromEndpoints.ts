// `flows_generate_from_endpoints`: builds one flow from a name, a description and the endpoints the
// user chose in the conversation. The way itself lives in `flows/fromEndpoints.ts`.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { renderBuildFlows } from '../render/views/buildFlows.js';
import { buildFromEndpoints } from './flows/fromEndpoints.js';

/** Limits of a hand-built flow's fields (`GenerateFlowRequest`). */
const MAX_NAME = 255;
const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;
const MAX_ENDPOINTS = 50;

// Strict like the other tools: a field of another way is refused, not dropped.
const input = z.strictObject({
  name: z.string().min(1).max(MAX_NAME).describe('Name of the new flow.'),
  description: z
    .string()
    .min(MIN_DESCRIPTION)
    .max(MAX_DESCRIPTION)
    .describe('What the journey does, 10 to 2000 characters.'),
  endpoints: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_ENDPOINTS)
    .describe(
      'The endpoints in order, as "METHOD /path" or METHOD:/path, a UUID or an operationId.',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the flow'),
});

export const flowsGenerateFromEndpoints = defineTool({
  name: 'flows_generate_from_endpoints',
  title: 'Generate a flow from endpoints',
  description:
    'Generate one flow from a description and chosen endpoints. name, description and endpoints ' +
    'are chosen with the user; an existing flow with that name is never overwritten. Like every ' +
    'long operation, it returns a handle when max_wait_s passes; pass it to process_wait. ' +
    'Creates a flow.',
  input,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    return buildFromEndpoints(ctx, {
      ...(args.project === undefined ? {} : { project: args.project }),
      name: args.name,
      description: args.description,
      endpoints: args.endpoints,
      maxWaitS: args.max_wait_s,
    });
  },
  render: renderBuildFlows,
});
