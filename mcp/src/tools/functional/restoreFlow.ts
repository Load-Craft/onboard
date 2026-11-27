// `functional_restore_flow` (module functional): Restore a functional flow to a saved version; the
// current state is snapshotted first.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The backend keeps the state before the restore as a new saved version, which is the way
// back: the tool reads the saved versions before and after, takes the one that appeared as the
// snapshot, and declares the undo as the same tool with that version. A restore that left no new
// version (nothing to tell it by) declares no undo. A version the flow lacks is the backend's
// `not_found`.
// Log: args "{flow_id} {version}", result "{name}: version {version} restored": the data carries
// `name` and `version`; the arguments of the undo are the flow and the snapshot (`update.log.undo_args`).
// Arguments (the catalog's): `flow_id`, `version`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { renderRestoreFlow, type RestoreFlowData } from '../../render/functional/restoreFlow.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { listTestFlows, listVersions } from './getFlows.js';

import { fromState } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_RESTORE_FLOW } from './meta.generated.js';

/** POST /test-flows/{flow_id}/versions/{version}/restore (REST API v1) */
export function restoreVersion(
  ctx: CallContext,
  path: { readonly flow_id: string; readonly version: string },
): Promise<
  OpOutput<'restore_version_api_v1_test_flows__flow_id__versions__version__restore_post'>
> {
  return callBackend(
    ctx,
    'restore_version_api_v1_test_flows__flow_id__versions__version__restore_post',
    { path },
  );
}

const NAME_LIMIT = 120;

/**
 * A flow the backend does not know is a plain "not found", which says nothing of why: when no
 * functional flow exists at all (for the documentation version of the workspace, when it has one), the
 * project has no functional tests, and that is what the user needs to hear. When flows exist, the
 * flow asked for is the one that is missing and the original error stands.
 */
async function explainMissingFlow(
  ctx: CallContext & Parameters<typeof fromState>[0],
): Promise<void> {
  const docs = fromState(ctx, 'ids.docs_id');
  try {
    const flows = await listTestFlows(ctx, {
      limit: 1,
      ...(typeof docs === 'string' ? { spec_id: docs } : {}),
    });
    if (flows.length === 0) throw new ToolError('functional_no_flows');
  } catch (error) {
    if (error instanceof ToolError && !(error instanceof LoadcraftApiError)) throw error;
    // the list could not be read: the original error is the better answer
  }
}

export const functionalRestoreFlow = moduleTool(FUNCTIONAL_RESTORE_FLOW, {
  title: 'Restore a functional flow to a saved version',
  input: {
    flow_id: uuidArgument().describe('The functional flow.'),
    version: z.string().min(1).max(60).describe('The saved version to restore (its label).'),
  },
  async run(ctx, args) {
    const flowId = args.flow_id.toLowerCase();
    let before: Awaited<ReturnType<typeof listVersions>>;
    try {
      before = await listVersions(ctx, { flow_id: flowId });
    } catch (error) {
      if (error instanceof LoadcraftApiError && error.status === 404) await explainMissingFlow(ctx);
      throw error;
    }
    const known = new Set(before.map((entry) => entry.id));
    const flow = await restoreVersion(ctx, { flow_id: flowId, version: args.version });
    const after = await listVersions(ctx, { flow_id: flowId });
    // the snapshot of the state before the restore is the saved version that appeared with it
    const appeared = after.filter((entry) => !known.has(entry.id));
    const [snapshot] = [...appeared].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const kept = snapshot === undefined ? null : snapshot.version;
    const shown = kept === null ? null : content(ctx, kept, NAME_LIMIT);
    // a label the mask would change would be restored in its masked form: not offered for undo
    // (`content` has taught the scope the secrets it found, so the check comes after it)
    const undoable = kept !== null && ctx.secrets.scrub(kept) === kept && shown === kept;
    const data: RestoreFlowData = {
      flow_id: flowId,
      name: content(ctx, flow.name, NAME_LIMIT),
      version: content(ctx, args.version, NAME_LIMIT),
      snapshot: shown,
      blocks: flow.blocks_count,
      undoable,
    };
    return {
      status: 'done',
      data,
      ...(undoable && kept !== null
        ? { update: { log: { undo_args: { flow_id: flowId, version: kept } } } }
        : {}),
    };
  },
  render: renderRestoreFlow,
});
