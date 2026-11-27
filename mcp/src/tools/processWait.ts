// `process_wait`: continues an operation by its handle, in the same call or in a later one. The kind of the
// handle decides what is awaited and how the finished result looks, so the text is the one the
// tool that started the operation draws. One call waits at most 100 s; a client abort ends the
// wait and never the operation.

import * as z from 'zod';

import { maxWaitInput, resumeOperation, viewOperation } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { isPlanHandle, planOperationHandle } from './flowsDescribeJourneys.js';
import { ALL_OPERATION_KINDS } from './operationKinds.js';

const input = z.strictObject({
  operation: z
    .string()
    .describe(
      'Operation handle exactly as a tool returned it (<kind>:<id>, e.g. "test_run:0b5c77aa-…"), or the plan handle flows_describe_journeys returned (r-xxxxxxxx).',
    ),
  max_wait_s: maxWaitInput('the operation'),
});

/** Any `record_run` handle: the view of the kind does not depend on the id. */
const PLAN_VIEW = 'record_run:0';

export const processWait = defineTool({
  name: 'process_wait',
  title: 'Wait for an operation',
  description:
    'Continues waiting for a long LoadCraft operation (a test run, a generation, a check, an ' +
    'analysis) that an earlier call left running: pass the handle from that result. Returns what ' +
    'the tool that started it returns, or the handle again when the time limit of the call ends ' +
    'first. It only waits and reads; stopping a test is process_cancel, and only after asking the user.',
  input,
  annotations: { readOnlyHint: true },
  run: (ctx, args) =>
    resumeOperation(
      ctx,
      ALL_OPERATION_KINDS,
      isPlanHandle(args.operation) ? planOperationHandle(ctx, args.operation) : args.operation,
      { maxWaitS: args.max_wait_s },
    ),
  render: (data, t, args) =>
    viewOperation(
      ALL_OPERATION_KINDS,
      isPlanHandle(args.operation) ? PLAN_VIEW : args.operation,
      data,
      t,
    ),
});
