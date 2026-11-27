// `flows_apply_copilot_changes` (module flows): Apply the accepted copilot changes to a flow as one
// new version and record what was rejected.
// The name, the description, the class, the consent level, the annotations and the log templates are
// the catalog's (meta.generated.ts); this file holds the input, the reads and the view.
// The ids of the changes are comma-separated texts (the catalog has no list argument): `accept` (up
// to 50) are applied, `reject` (up to 50) are recorded as rejected; one of them at least, none in
// both. The model gives no change bodies: the backend compares each copilot change with the turn it
// recorded, so the tool reads the turn from the history (`message_id`) and sends the items exactly
// as they are, with their origin and without their status. The blocks of a change (stored request
// blocks) pass from that read to the apply write and are shown nowhere. A turn or a change the
// history does not hold is a code of the module before any write. The flow is read first: its version
// is `expected_version` (a flow that changed since is `flows_apply_version_conflict`, the backend's
// 409) and the way back. The apply saves ONE version; changes the backend drops are counted and its
// warnings shown. The rejections are then recorded in one request; if recording fails the flow stays
// saved and the view says so. A call that only rejects saves no version and has no undo. The undo
// is `flows_restore_version` to the version read before; it brings back the flow, not the outcomes
// recorded in the history.
// State: the flow's open questions as the new version has them (as `flows_restore_version`); the
// check `flows_built` is met after an apply.
// Log: args "{flow_id}", result "{applied}/{requested} changes applied as v{version}": the data
// carries the fields.
// Arguments (the catalog's): flow_id, message_id, accept, reject.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { ToolError } from '../../errors.js';
import { needsInputUpdate } from '../../flow/needsInput.js';
import { needsOfDetail } from '../../flow/questions.js';
import {
  renderApplyCopilotChanges,
  type ApplyCopilotChangesData,
} from '../../render/flows/applyCopilotChanges.js';
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
import { getCopilotHistory } from './getCopilotHistory.js';
import { flowRefOf } from './shared.js';
import { FLOWS_APPLY_COPILOT_CHANGES } from './meta.generated.js';

/** POST /projects/{project_id}/flows/{flow_id}/copilot/apply (REST API v1) */
export function applyCopilotProposal(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post'>,
): Promise<
  OpOutput<'apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post'>
> {
  return callBackend(
    ctx,
    'apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/flows/{flow_id}/copilot/changes/{change_id}/resolution (REST API v1) */
export function recordChangeResolution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string; readonly change_id: string },
  body: BodyOf<'record_change_resolution_api_v1_projects__project_id__flows__flow_id__copilot_changes__change_id__resolution_post'>,
): Promise<
  OpOutput<'record_change_resolution_api_v1_projects__project_id__flows__flow_id__copilot_changes__change_id__resolution_post'>
> {
  return callBackend(
    ctx,
    'record_change_resolution_api_v1_projects__project_id__flows__flow_id__copilot_changes__change_id__resolution_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/flows/{flow_id}/copilot/resolutions (REST API v1) */
export function recordChangeResolutions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'record_change_resolutions_api_v1_projects__project_id__flows__flow_id__copilot_resolutions_post'>,
): Promise<
  OpOutput<'record_change_resolutions_api_v1_projects__project_id__flows__flow_id__copilot_resolutions_post'>
> {
  return callBackend(
    ctx,
    'record_change_resolutions_api_v1_projects__project_id__flows__flow_id__copilot_resolutions_post',
    { path, body },
  );
}

const NAME_LIMIT = 100;
const MAX_IDS = 50;
const KNOWN_SHOWN = 10;
const WARNINGS_SHOWN = 10;

/** A field of an untyped dictionary of the backend, as text; empty when it is not one. */
type HistoryChange = NonNullable<
  OpOutput<'get_copilot_history_api_v1_projects__project_id__flows__flow_id__copilot_history_get'>['messages']
>[number]['changes'] extends infer List
  ? NonNullable<List> extends readonly (infer Item)[]
    ? Item
    : never
  : never;
type ApplyChange = NonNullable<
  BodyOf<'apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post'>['changes']
>[number];

/** A change of the history as the apply takes it: the model's fields, its origin, no outcome. */
function asApplied(change: HistoryChange): ApplyChange {
  return {
    id: change.id,
    type: change.type,
    target_block_id: change.target_block_id,
    description: change.description,
    origin: 'copilot',
    ...(change.before === undefined ? {} : { before: change.before }),
    ...(change.after === undefined ? {} : { after: change.after }),
    ...(change.block === undefined ? {} : { block: change.block }),
    ...(change.computed_before === undefined ? {} : { computed_before: change.computed_before }),
    ...(change.computed_after === undefined ? {} : { computed_after: change.computed_after }),
    ...(change.impact === undefined ? {} : { impact: change.impact }),
    ...(change.lint_after === undefined ? {} : { lint_after: change.lint_after }),
    ...(change.warnings === undefined ? {} : { warnings: change.warnings }),
  };
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

export const flowsApplyCopilotChanges = moduleTool(FLOWS_APPLY_COPILOT_CHANGES, {
  title: 'Apply the accepted copilot changes to a flow as one new ver…',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow (id or name); default: the only one of this workspace.'),
    message_id: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The copilot turn the changes come from: message_id of flows_ask_copilot or flows_get_copilot_history.',
      ),
    accept: z
      .string()
      .max(2000)
      .optional()
      .describe('Ids of the changes to apply, comma-separated (at most 50).'),
    reject: z
      .string()
      .max(2000)
      .optional()
      .describe('Ids of the changes to record as rejected, comma-separated (at most 50).'),
  },
  async run(ctx, args) {
    const accept = commaList(args.accept);
    const reject = commaList(args.reject);
    if (accept.length === 0 && reject.length === 0) refuseRule('copilot_apply_nothing');
    if (accept.length > MAX_IDS || reject.length > MAX_IDS) refuseRule('copilot_apply_too_many');
    if (accept.some((id) => reject.includes(id))) refuseRule('copilot_apply_overlap');
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const path = { project_id: projectId, flow_id: found.id };
    const before = await getFlow(ctx, path);
    const history = await getCopilotHistory(ctx, path);
    const turn = (history.messages ?? []).find((message) => message.message_id === args.message_id);
    if (turn === undefined) {
      throw new ToolError('flows_copilot_turn_unknown', {
        params: { id: thirdParty(ctx, args.message_id, LIMITS.name) },
      });
    }
    const proposed = turn.changes ?? [];
    const unknown = [...accept, ...reject].filter((id) => !proposed.some((one) => one.id === id));
    if (unknown.length > 0) {
      throw new ToolError('flows_copilot_change_unknown', {
        params: {
          ids: unknown.map((id) => thirdParty(ctx, id, LIMITS.word)).join(', '),
          known: proposed
            .slice(0, KNOWN_SHOWN)
            .map((one) => thirdParty(ctx, one.id, LIMITS.word))
            .join(', '),
        },
      });
    }
    const requested = accept
      .map((id) => proposed.find((one) => one.id === id))
      .filter((one): one is NonNullable<typeof one> => one !== undefined);
    let version = before.current_version;
    let applied = 0;
    let recorded = true;
    let warnings: ApplyCopilotChangesData['warnings'] = [];
    let after: Awaited<ReturnType<typeof applyCopilotProposal>>['flow'] | undefined;
    if (requested.length > 0) {
      const outcome = await applyCopilotProposal(ctx, path, {
        expected_version: before.current_version,
        message_id: args.message_id,
        changes: requested.map((change) => asApplied(change)),
      }).catch((error: unknown) => {
        throw error instanceof LoadcraftApiError && error.status === 409
          ? new ToolError('flows_apply_version_conflict', {
              params: { version: String(before.current_version) },
            })
          : error;
      });
      after = outcome.flow;
      version = outcome.flow.current_version;
      applied = outcome.changes_applied;
      recorded = outcome.resolution_recorded;
      warnings = (outcome.warnings ?? []).slice(0, WARNINGS_SHOWN).map((warning) => ({
        change: thirdParty(ctx, textOf(warning['change_id']), LIMITS.word),
        message: thirdParty(ctx, textOf(warning['message']), LIMITS.sentence),
      }));
    }
    if (reject.length > 0) {
      try {
        await recordChangeResolutions(ctx, path, {
          resolutions: reject.map((id) => ({ change_id: id, status: 'rejected' as const })),
        });
      } catch (error) {
        // the flow is saved already: the apply stands and the view says the outcomes were not recorded
        if (requested.length === 0) throw error;
        recorded = false;
      }
    }
    const saved = version > before.current_version;
    const data: ApplyCopilotChangesData = {
      project_id: projectId,
      flow: { id: found.id },
      name: thirdParty(ctx, before.name, NAME_LIMIT),
      message_id: thirdParty(ctx, args.message_id, LIMITS.name),
      requested: requested.length,
      applied,
      version,
      previous: before.current_version,
      saved,
      rejected: reject.map((id) => thirdParty(ctx, id, LIMITS.word)),
      recorded,
      warnings,
    };
    const needs =
      after === undefined
        ? undefined
        : needsInputUpdate(
            ctx.state.process(),
            [needsOfDetail(after)],
            'flows_apply_copilot_changes',
            'some',
          );
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(projectId, found.id)],
      update: {
        ...(needs ?? {}),
        ...(saved ? { checks: { flows: { flows_built: { ok: true } } } } : {}),
        log: {
          values: { flow_id: found.id, applied, requested: requested.length, version },
          ...(saved
            ? {
                undo_args: {
                  undo_tool: 'flows_restore_version',
                  flow_id: found.id,
                  version: before.current_version,
                },
              }
            : {}),
        },
      },
    };
  },
  render: renderApplyCopilotChanges,
});
