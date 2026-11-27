// `flows_set_poll_terminals` (module flows): Set the success and failure terminal statuses that
// answer a flow's open poll-loop questions.
// The name, the description, the class, the consent level, the annotations and the log templates
// are the catalog's (meta.generated.ts); this file holds the input, the reads and the view.
// One status field per call. The flow is read first (its name and its version: the way back). The
// statuses are comma-separated texts (the catalog has no list argument): split and trimmed, empty
// items dropped; 1 to 20 success statuses, up to 20 failure ones, else a rule refusal before any
// request. The backend saves a new flow version also when the statuses are the ones already set, so
// no call is inert; a field with no poll loop is its 422. The undo is `flows_restore_version` to the
// version read before the call: a version keeps the open questions, so blocks, edges and the open
// question all come back (answering again would only overwrite the statuses).
// State: the open questions of the answer replace the flows warning (as `flows_restore_version`);
// the check `questions_answered` is met when none is left open.
// Log: args "{flow_id}", result "{field} answered as v{version}; {open} open": the data carries
// the fields.
// Arguments (the catalog's): flow_id, field, success_terminals, failure_terminals.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { needsInputUpdate } from '../../flow/needsInput.js';
import {
  renderSetPollTerminals,
  type SetPollTerminalsData,
} from '../../render/flows/setPollTerminals.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { commaList } from './commaList.js';
import { getFlow } from './get.js';
import { flowRefOf } from './shared.js';
import { FLOWS_SET_POLL_TERMINALS } from './meta.generated.js';

/** POST /projects/{project_id}/flows/{flow_id}/poll-terminals (REST API v1) */
export function resolvePollTerminals(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'resolve_poll_terminals_api_v1_projects__project_id__flows__flow_id__poll_terminals_post'>,
): Promise<
  OpOutput<'resolve_poll_terminals_api_v1_projects__project_id__flows__flow_id__poll_terminals_post'>
> {
  return callBackend(
    ctx,
    'resolve_poll_terminals_api_v1_projects__project_id__flows__flow_id__poll_terminals_post',
    { path, body },
  );
}

const NAME_LIMIT = 100;
const MAX_STATUSES = 20;

export const flowsSetPollTerminals = moduleTool(FLOWS_SET_POLL_TERMINALS, {
  title: 'Set the success and failure terminal statuses that answer a…',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow (id or name); default: the only one of this workspace.'),
    field: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The status field of an open poll question: the field of a poll_status item in flows_get.',
      ),
    success_terminals: z
      .string()
      .min(1)
      .max(1000)
      .describe('The statuses that mean the job succeeded, comma-separated (at most 20).'),
    failure_terminals: z
      .string()
      .max(1000)
      .optional()
      .describe(
        'The statuses that mean it failed, comma-separated (at most 20); without it, none.',
      ),
  },
  async run(ctx, args) {
    const success = commaList(args.success_terminals);
    const failure = commaList(args.failure_terminals);
    if (success.length === 0) refuseRule('poll_terminals_success_needed');
    if (success.length > MAX_STATUSES || failure.length > MAX_STATUSES) {
      refuseRule('poll_terminals_too_many');
    }
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const path = { project_id: projectId, flow_id: found.id };
    const before = await getFlow(ctx, path);
    const answer = await resolvePollTerminals(ctx, path, {
      answers: [{ field: args.field, success_terminals: success, failure_terminals: failure }],
    });
    const open = answer.needs_input.length;
    const data: SetPollTerminalsData = {
      project_id: projectId,
      flow: { id: found.id },
      name: thirdParty(ctx, before.name, NAME_LIMIT),
      field: thirdParty(ctx, args.field, LIMITS.name),
      success: success.map((status) => thirdParty(ctx, status, LIMITS.label)),
      failure: failure.map((status) => thirdParty(ctx, status, LIMITS.label)),
      version: answer.current_version,
      previous: before.current_version,
      open,
    };
    const needs = needsInputUpdate(
      ctx.state.process(),
      [
        {
          id: found.id,
          count: open,
          definite: answer.needs_input.filter((item) => item['definite'] === true).length,
        },
      ],
      'flows_set_poll_terminals',
      'some',
    );
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(projectId, found.id)],
      update: {
        ...(needs ?? {}),
        ...(open === 0 ? { checks: { flows: { questions_answered: { ok: true } } } } : {}),
        log: {
          values: { flow_id: found.id, field: data.field, version: data.version, open },
          undo_args: {
            undo_tool: 'flows_restore_version',
            flow_id: found.id,
            version: before.current_version,
          },
        },
      },
    };
  },
  render: renderSetPollTerminals,
});
