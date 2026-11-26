// `results_get_errors`: the error groups of a run (status or kind, how many requests, which endpoints)
// or one group by its hash, with the console lines folded into it. The requests behind a group,
// with what they sent and got back, are the job of `results_get_traces`; the view points there.

import * as z from 'zod';

import { formatInput, renderDataBlock } from '../render/dataBlock.js';
import { renderErrors, type ErrorsData } from '../render/views/failures.js';
import { defineTool } from '../registry.js';
import { createResolver } from '../resolve/handles.js';
import { readRunError, readRunErrors } from './results/failures.js';

const input = z.object({
  execution: z
    .string()
    .min(1)
    .describe(
      'The run (a test or a self-check): its handle (e-1a2b3c4d) from run_start, process_get_status or scenario_check_self, or its UUID.',
    ),
  hash: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'One error group by its hash from an earlier list (http-400, unmet_check); without it, every group.',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  format: formatInput,
});

export const resultsGetErrors = defineTool({
  name: 'results_get_errors',
  title: 'Get the errors of a run',
  description:
    'Reads the error groups of a test run or a self-check run: the HTTP status or the kind of failure ' +
    '(no response, a check not met), how many requests failed that way, their share and the endpoints; ' +
    'with hash, one group with its message, first and last time and the console lines folded into it. ' +
    'Read-only. For the requests behind the errors, with their responses, call results_get_traces.',
  input,
  annotations: { readOnlyHint: true },
  async run(ctx, args) {
    const resolver = createResolver(ctx);
    const { id: projectId } = await resolver.project(args.project?.trim() ?? '');
    const { id: executionId } = await resolver.execution(projectId, args.execution);
    const run = resolver.shortExecution(executionId);
    if (args.hash !== undefined) {
      const group = await readRunError(ctx, projectId, executionId, args.hash.trim());
      const data: ErrorsData = {
        run,
        one: true,
        groups: [group],
        seriesSource: 'prometheus',
        retention: null,
      };
      return { status: 'done', data, update: { log: { values: { run_id: run } } } };
    }
    const errors = await readRunErrors(ctx, projectId, executionId);
    const data: ErrorsData = {
      run,
      one: false,
      groups: errors.groups,
      seriesSource: errors.seriesSource,
      retention: errors.retention,
    };
    return { status: 'done', data, update: { log: { values: { run_id: run } } } };
  },
  render: (data, t, args) =>
    args.format === 'data' ? renderDataBlock(data) : renderErrors(data, t),
});
