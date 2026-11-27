// `process_cancel`: stops a running operation: a test, a scenario generation, a journey refinement, flows
// built from a recording, the walk of paths from a description (gently: what was built is saved).
// It
// touches the customer's system only for a test (the load stops), so it is called after the user
// says so. An operation that is no longer running is reported, not treated as an error.
//
// A test is stopped whether or not this workspace recorded it: one started from the application,
// by another session or before a /clear has no entry in `state.json`, and still loads the
// customer's system. Such a test is found in LoadCraft by its handle, short handle or id, and with
// no argument only the one test this workspace recorded is stopped, others are listed.

import * as z from 'zod';

import { listRunningExecutions, cancelRun, readRun, type RunStatus } from '../api/executions.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { getDescribeRun } from '../api/describe.js';
import { LoadcraftApiError } from '../http/apiError.js';
import {
  cancelOperation,
  encodeHandle,
  endOperation,
  forgetOperation,
  listOperations,
  parseHandle,
} from '../ops/operation.js';
import type { ToolOutcome } from '../outcome.js';
import { defineTool } from '../registry.js';
import { createResolver, type Handle } from '../resolve/handles.js';
import { renderCancel, type CancelData } from '../render/views/cancel.js';
import { ENDED, findPlanRun, isPlanHandle } from './flowsDescribeJourneys.js';
import { ALL_OPERATION_KINDS } from './operationKinds.js';

const input = z.strictObject({
  operation: z
    .string()
    .optional()
    .describe(
      'What to stop: an operation handle exactly as a tool returned it (<kind>:<id>, e.g. ' +
        '"test_run:0b5c77aa-…"), or a test execution by its short handle ("e-0b5c77aa") or id, ' +
        'also one started elsewhere. Omit it to stop the one test this repository started, or to list the running tests.',
    ),
  project: z
    .string()
    .optional()
    .describe(
      'Project name or id, for a test execution that this workspace did not start; default: the ' +
        'project of this repository.',
    ),
  from_panel: z.boolean().optional().describe('Set only by the LoadCraft panel.'),
});

/** Entries of the list of what can be stopped that an error shows. */
const LISTED = 10;

const underWay = (status: RunStatus): boolean =>
  status === 'pending' || status === 'building' || status === 'running';

/** Stoppable operations of the project: its running tests, and the recorded operations that can stop. */
async function stoppable(ctx: ToolContext, projectId: string): Promise<string> {
  const { t } = ctx;
  const resolver = createResolver(ctx);
  const items: string[] = [];
  let tests: readonly { id: string; status: string }[] | undefined;
  try {
    tests = await listRunningExecutions(ctx, projectId, ctx.clock.now());
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log.info('running tests of the project unavailable for the list of process_cancel', {
      error,
    });
  }
  for (const test of tests ?? []) {
    items.push(
      t('cancel.running.item', {
        handle: resolver.shortExecution(test.id),
        status: t(`cancel.status.${test.status}`),
      }),
    );
  }
  const others = listOperations(ctx.state).filter((operation) => {
    const kind = ALL_OPERATION_KINDS.find((candidate) => candidate.kind === operation.kind);
    if (kind?.cancel === undefined) return false;
    return operation.kind !== 'test_run' || tests === undefined;
  });
  for (const operation of others) {
    items.push(t('cancel.running.local', { handle: operation.handle }));
  }
  if (items.length === 0) {
    return t(tests === undefined ? 'cancel.running.unavailable' : 'cancel.running.none');
  }
  const shown = items.slice(0, LISTED).join(', ');
  const more = items.length - LISTED;
  return more > 0 ? t('resolve.more', { names: shown, count: more }) : shown;
}

async function unknownTarget(
  ctx: ToolContext,
  projectId: string,
  value: string,
): Promise<ToolError> {
  const running = await stoppable(ctx, projectId);
  return new ToolError('cancel_target_unknown', {
    params: { value: value.slice(0, 120), running },
  });
}

/** Stops through the record of the workspace: the kind knows the saved data of the operation. */
async function stopRecorded(ctx: ToolContext, handle: string): Promise<ToolOutcome<CancelData>> {
  const { cancelled, stopping } = await cancelOperation(ctx, ALL_OPERATION_KINDS, handle);
  const note = stopping ? 'stopping' : cancelled ? 'stopped' : 'not_running';
  return done({ operation: handle, cancelled, note });
}

function done(data: CancelData): ToolOutcome<CancelData> {
  return { status: 'done', data };
}

/** A test execution that the workspace has no record of: LoadCraft says whether it is under way. */
async function stopExecution(
  ctx: ToolContext,
  project: Handle,
  execution: Handle,
): Promise<ToolOutcome<CancelData>> {
  const handle = encodeHandle('test_run', execution.id);
  const row = await readRun(ctx, project.id, execution.id).catch(async (error: unknown) => {
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw await unknownTarget(ctx, project.id, execution.id);
    }
    throw error;
  });
  if (!underWay(row.status)) {
    return done({
      operation: handle,
      cancelled: false,
      note: 'ended',
      ended: row.status,
      execution: createResolver(ctx).shortExecution(execution.id),
    });
  }
  const cancelled = await cancelRun(ctx, project.id, execution.id);
  await forgetOperation(ctx.state, handle);
  return done({ operation: handle, cancelled, note: cancelled ? 'stopped' : 'not_running' });
}

/**
 * The short handle of a plan (`r-xxxxxxxx`, what `flows_describe_journeys` returned): the run it names is
 * found in the workspace state, read in LoadCraft, and stopped through the handle of its operation.
 * A run that already ended is only reported: nothing is sent for it.
 */
async function stopPlan(
  ctx: ToolContext,
  projectArg: string | undefined,
  given: string,
): Promise<ToolOutcome<CancelData>> {
  const found = findPlanRun(ctx, given);
  if (found === undefined) {
    const project = await createResolver(ctx).project(projectArg);
    throw await unknownTarget(ctx, project.id, given);
  }
  const handle = encodeHandle('record_run', found.id);
  const run = await getDescribeRun(ctx, found.saved.projectId, found.id).catch(
    async (error: unknown) => {
      if (error instanceof LoadcraftApiError && error.status === 404) {
        // LoadCraft forgot the run: the operation ends as lost, written with the error entry
        endOperation(ctx, handle, 'lost');
        throw await unknownTarget(ctx, found.saved.projectId, given);
      }
      throw error;
    },
  );
  if (ENDED.has(run.status)) {
    return done({ operation: handle, cancelled: false, note: 'plan_ended', ended: run.status });
  }
  return stopRecorded(ctx, handle);
}

const isRecorded = (ctx: ToolContext, handle: string): boolean =>
  listOperations(ctx.state).some((operation) => operation.handle === handle);

/** The project of the call, the execution named by `given` in it (a short handle or an id). */
async function findExecution(
  ctx: ToolContext,
  projectArg: string | undefined,
  given: string,
): Promise<{ project: Handle; execution: Handle }> {
  const resolver = createResolver(ctx);
  const project = await resolver.project(projectArg);
  try {
    return { project, execution: await resolver.execution(project.id, given) };
  } catch (error) {
    if (error instanceof ToolError && error.code === 'not_found') {
      throw await unknownTarget(ctx, project.id, given);
    }
    throw error;
  }
}

/**
 * No argument. Only a test this workspace recorded (started from here) may be stopped unasked, and
 * only when it is the single test running: in a shared project any other running test may belong to
 * someone else, so it is listed for the user to choose and never stopped.
 */
async function stopOrList(
  ctx: ToolContext,
  projectArg: string | undefined,
): Promise<ToolOutcome<CancelData>> {
  const project = await createResolver(ctx).project(projectArg);
  const running = await listRunningExecutions(ctx, project.id, ctx.clock.now());
  const [only] = running;
  if (only === undefined) {
    return done({ cancelled: false, note: 'none_running', project: project.name });
  }
  const handle = encodeHandle('test_run', only.id);
  if (running.length === 1 && isRecorded(ctx, handle)) return stopRecorded(ctx, handle);
  throw new ToolError('cancel_which', { params: { running: await stoppable(ctx, project.id) } });
}

export const processCancel = defineTool({
  name: 'process_cancel',
  title: 'Cancel an operation',
  description:
    'Stops a running LoadCraft operation: a test run (the load on the target stops), a scenario ' +
    'generation, a journey refinement, flows built from a recording, or the walk of paths from a ' +
    'description (the path in progress ends, the flows built so far are saved). Pass the handle a tool returned; a plan that flows_describe_journeys returned (r-xxxxxxxx) the user turned down is stopped with its r- handle. A test that this ' +
    'repository did not start (the application, another session) is stopped by its short handle ' +
    '(e-xxxxxxxx) or id; with no argument only the one test this repository started is stopped, and ' +
    'any other running test is listed instead, never stopped unasked. Call it only after the user agreed to stop the ' +
    'test. Reports when the operation was no longer running. Other operations cannot be stopped; ' +
    'wait for them instead.',
  input,
  annotations: { destructiveHint: true },
  async run(ctx, args) {
    const given = args.operation?.trim() ?? '';
    if (given === '') return stopOrList(ctx, args.project);
    if (isPlanHandle(given)) return stopPlan(ctx, args.project, given);
    if (given.includes(':')) {
      const { kind, id } = parseHandle(given);
      if (isRecorded(ctx, given) || kind !== 'test_run') return stopRecorded(ctx, given);
      const { project, execution } = await findExecution(ctx, args.project, id);
      return stopExecution(ctx, project, execution);
    }
    const { project, execution } = await findExecution(ctx, args.project, given);
    const handle = encodeHandle('test_run', execution.id);
    if (isRecorded(ctx, handle)) return stopRecorded(ctx, handle);
    return stopExecution(ctx, project, execution);
  },
  render: renderCancel,
});
