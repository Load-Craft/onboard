// `run_start`: starts a load test of a composition or a scenario on an environment the user named,
// with the load clamped to the environment's limits, after the user's confirmation where the
// environment is protected or the load was clamped, and after a data check under that load. The open
// warning `flows_need_input` of the bound project is shown with it; it blocks nothing.

import * as z from 'zod';

import { openNeedsInput } from '../flow/needsInput.js';
import { awaitOperation, maxWaitInput } from '../ops/operation.js';
import { inline } from '../render/primitives.js';
import { defineTool } from '../registry.js';
import { needsInputRunLine } from '../render/views/needsInput.js';
import {
  renderRunConfirm,
  renderRunDone,
  renderRunStarted,
  type RunConfirmData,
  type RunDoneData,
} from '../render/views/run.js';
import { profileSchema, startTestRun, thresholdsSchema } from './run/start.js';
import { testRunOperation } from './run/wait.js';

const input = z.strictObject({
  scenario: z
    .string()
    .min(1)
    .describe('Name of the composition or scenario to run (as run_plan was given it).'),
  environment: z
    .string()
    .min(1)
    .describe(
      'Name of the environment to run on, as the user chose it. Required: never pick one for the user.',
    ),
  profile: profileSchema.describe(
    'The load profile: the `profile` object of a run_plan entry, as is. `vusers` is required ' +
      '(1 for smoke); `ramp` and `hold` are seconds.',
  ),
  thresholds: thresholdsSchema
    .optional()
    .describe('Pass/fail thresholds of the run: p95 response time in ms, error rate in percent.'),
  confirm_capped: z
    .boolean()
    .optional()
    .describe(
      'Set to true only after the user agreed to run on a protected environment or with the ' +
        'load clamped to its limits (the previous call said so, with the numbers).',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the end of the test'),
});

export const runStart = defineTool({
  name: 'run_start',
  title: 'Run a load test',
  description:
    'Step 06: run_start starts a load test (sends real traffic) of a composition or scenario on the ' +
    'environment the user named, with a profile from run_plan. It clamps every phase to the ' +
    "environment's limits before start, checks the data for exactly that load, then waits for the " +
    'end of the test (at most max_wait_s per call). A finished test returns its times, final ' +
    'numbers and chart, with the run handle for results_get_report; a test still running returns the ' +
    'test_run handle: call process_wait with it until the test ends. Stopping the wait never stops the ' +
    "test. A protected environment or a clamped profile needs the user's consent: the first call " +
    'starts nothing and asks for it with the numbers; ask the user, then repeat with ' +
    'confirm_capped: true. It never picks an environment and never prepares data (the data_* tools do). ' +
    'A clamped test says nothing about the full load.',
  input,
  annotations: { openWorldHint: true, idempotentHint: false },
  // Claude Code shows the permission prompt for this tool on every call, in every mode.
  meta: { 'anthropic/requiresUserInteraction': true },
  async run(ctx, args) {
    // the warning of the state belongs to the bound project: a run of another one shows none
    const open = args.project === undefined ? openNeedsInput(ctx.state.process()) : undefined;
    const needsInput = open === undefined ? {} : { needsInput: open };
    const started = await startTestRun(ctx, args);
    // Nothing was sent: a finished answer asking for consent (there is nothing to wait for).
    if (started.kind === 'confirm') {
      return { status: 'done', data: { ...started.data, ...needsInput } };
    }
    const waited = await awaitOperation(ctx, testRunOperation, started.executionId, {
      maxWaitS: args.max_wait_s,
      saved: started.saved,
    });
    if (waited.status === 'done') return { ...waited, data: { ...waited.data, ...needsInput } };
    const warning = needsInputRunLine(open, ctx.t);
    if (started.kind === 'joined') {
      const { saved } = started;
      return {
        ...waited,
        data: {
          ...waited.data,
          message: [
            ...warning,
            ctx.t('runStart.joined', {
              target: inline(saved.target.name, 80),
              environment: inline(saved.environment.name, 80),
              handle: waited.operation,
            }),
            `↗ ${ctx.services.links.executionLive(saved.project.id, started.executionId).url}`,
            waited.data.message,
          ].join('\n'),
        },
      };
    }
    // The wait ended before the test did. The model sees the text only, so the lines of the start
    // and the link of the live page go in front of the progress, as they will in the final view.
    return {
      ...waited,
      data: {
        ...waited.data,
        message: [
          ...warning,
          renderRunStarted(started.data, ctx.t),
          `↗ ${started.data.link}`,
          waited.data.message,
        ].join('\n'),
      },
    };
  },
  render: (data: RunConfirmData | RunDoneData, t) =>
    [
      ...needsInputRunLine(data.needsInput, t),
      'needsConfirmation' in data ? renderRunConfirm(data, t) : renderRunDone(data, t),
    ].join('\n'),
});
