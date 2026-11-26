// `data_create_accounts`: step 05, accounts for a data slot, created in the customer's system through
// the register request. It is the only tool that creates accounts, and Claude Code asks the user
// before every call of it (`anthropic/requiresUserInteraction`); the data plan and the other data
// actions are the other `data_*` tools.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import {
  renderProvisionConfirm,
  renderProvisionRunning,
  type ProvisionConfirmView,
} from '../render/views/data.js';
import { createResolver } from '../resolve/handles.js';
import {
  accountProvisionOperation,
  provisionOrJoin,
  type ProvisionData,
} from './dataCreateAccounts/operation.js';

/** Accounts one call may create; the backend takes 1 000 per call, the plugin calls it in batches. */
const MAX_ACCOUNTS = 20_000;

const input = z.strictObject({
  scenario: z.string().min(1).describe('Name of a composition or a scenario of the project.'),
  slot: z
    .string()
    .min(1)
    .describe(
      'Key of the data slot that reads the accounts: the slot key shown in the data plan (data_check_readiness).',
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(MAX_ACCOUNTS)
    .describe(
      'How many accounts this provisioning should leave in the dataset (1 to 20000); the same count again finishes an interrupted one.',
    ),
  environment: z
    .string()
    .optional()
    .describe('Environment the accounts are created on; default: the default environment.'),
  register_operation: z
    .string()
    .optional()
    .describe(
      "The operation of the project's API spec that creates an account (`METHOD:/path` or operation id); " +
        'only when no flow holds a register request and the user chose one.',
    ),
  confirm_protected: z
    .boolean()
    .optional()
    .describe(
      'Only after the user agreed: create accounts on a PROTECTED environment (same consent as run_start).',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the accounts'),
});

const isConfirm = (data: ProvisionData | ProvisionConfirmView): data is ProvisionConfirmView =>
  'needsConfirmation' in data;

export const dataCreateAccounts = defineTool({
  name: 'data_create_accounts',
  title: 'Create test accounts',
  description:
    "Step 05: data_create_accounts CREATES accounts in the customer's system for a data slot of a " +
    'scenario or composition, on the chosen environment, in batches of 50 through the register ' +
    'request; saves them in a dataset (passwords masked) and pins it to the slot. Call it only ' +
    'when the user asked for accounts; it needs the project consent to send requests to the target. ' +
    'If the environment is protected nothing is sent until the user agrees and `confirm_protected: true` ' +
    'is passed. When no flow holds a register request it answers with candidate operations: ask the ' +
    'user which one creates an account and repeat with `register_operation`. Many accounts take ' +
    'longer than one call (at most max_wait_s): the result then carries the account_provision ' +
    'handle; call process_wait with it, never this tool again. The same call with the same count adds only ' +
    'the accounts an interrupted provisioning is missing. It never reads the plan and never loads ' +
    'accounts from a file (data_check_readiness and data_create_dataset do). A slot of plain data is refused with ' +
    '`slot_not_accounts`; the refusal says how to fill it.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  // Claude Code shows the permission prompt for this tool on every call, in every mode.
  meta: { 'anthropic/requiresUserInteraction': true },
  async run(ctx, args) {
    await getCompat(ctx);
    const resolver = createResolver(ctx);
    const { id: projectId } = await resolver.project(args.project?.trim() ?? '');
    const target = await resolver.runScenarioTarget(projectId, args.scenario);
    const environment =
      args.environment === undefined
        ? undefined
        : await resolver.environment(projectId, args.environment);
    const outcome = await provisionOrJoin(
      ctx,
      {
        projectId,
        target,
        ...(environment === undefined ? {} : { environment }),
        slot: args.slot,
        count: args.count,
        register_operation: args.register_operation,
        confirm_protected: args.confirm_protected,
      },
      args.max_wait_s,
    );
    const { joined, ...result } = outcome;
    if (result.status === 'done') return result;
    // The series goes on in this server process: the model sees the text only, so the line that
    // says so goes in front of the progress and the handle.
    return {
      ...result,
      data: {
        ...result.data,
        message: [
          renderProvisionRunning({ slot: args.slot, joined, operation: result.operation }, ctx.t),
          result.data.message,
        ].join('\n'),
      },
    };
  },
  render: (data: ProvisionData | ProvisionConfirmView, t) =>
    isConfirm(data)
      ? renderProvisionConfirm(data, t)
      : accountProvisionOperation.spec.view(data, t),
});
