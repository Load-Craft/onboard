// `flows_generate_from_suggestions`: builds flows from journey proposals saved by
// `flows_suggest_journeys`, picked by name. The way itself lives in `flows/fromSuggestions.ts`.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { renderBuildFlows } from '../render/views/buildFlows.js';
import { buildFromSuggestions } from './flows/fromSuggestions.js';
import { MAX_SUGGESTIONS } from './flows/limits.js';

// Strict like the other tools: a field of another way is refused, not dropped.
const input = z.strictObject({
  suggestions: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SUGGESTIONS)
    .describe('Names of proposals saved by flows_suggest_journeys, exactly as it listed them.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the flows'),
});

export const flowsGenerateFromSuggestions = defineTool({
  name: 'flows_generate_from_suggestions',
  title: 'Generate flows from proposals',
  description:
    'Generate flows for the approved journey proposals. suggestions = names of proposals saved ' +
    'by flows_suggest_journeys; LoadCraft generates them in the background while the call stays ' +
    'open and reports progress, and a journey that fails does not stop the others. Like every ' +
    'long operation, it returns a handle when max_wait_s passes; pass it to process_wait. ' +
    'Creates flows.',
  input,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    return buildFromSuggestions(ctx, {
      ...(args.project === undefined ? {} : { project: args.project }),
      suggestions: args.suggestions,
      maxWaitS: args.max_wait_s,
    });
  },
  render: renderBuildFlows,
});
