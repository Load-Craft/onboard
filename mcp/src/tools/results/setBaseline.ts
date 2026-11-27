// `results_set_baseline` (module results): Set a run as the baseline for its scenario and
// environment pair.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// The baseline of the pair is read first: it is what the undo pins again (the same tool with that
// run). A pair that had none has no undo, since the backend has no call that removes a baseline; a
// previous baseline with no measurements cannot be pinned again either. A run that already is the
// baseline is not written.
// Log: args "{run_id}", result "run {run_id} is the baseline": the log values carry the run's handle.

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import { createResolver } from '../../resolve/handles.js';
import { renderSetBaseline, type SetBaselineData } from '../../render/results/setBaseline.js';
import { callBackend, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getExecutionBaseline } from './compareRuns.js';
import { RESULTS_SET_BASELINE } from './meta.generated.js';
import { runIdArgument, runOf } from './run.js';

/** PUT /projects/{project_id}/gatling/executions/{execution_id}/baseline (REST API v1) */
export function pinExecutionAsBaseline(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'pin_execution_as_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_put'>
> {
  return callBackend(
    ctx,
    'pin_execution_as_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_put',
    { path },
  );
}

/** A refusal of the backend (409: a self-check run, no scenario and load, no result) as the tool's own error. */
function refused(run: string, error: unknown): unknown {
  return error instanceof LoadcraftApiError && error.status === 409
    ? new ToolError('results_baseline_refused', { params: { run }, cause: error })
    : error;
}

export const resultsSetBaseline = moduleTool(RESULTS_SET_BASELINE, {
  title: 'Set a run as the baseline for its scenario and environment pair',
  input: { run_id: runIdArgument() },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const resolver = createResolver(ctx);
    let before: Awaited<ReturnType<typeof getExecutionBaseline>>;
    try {
      before = await getExecutionBaseline(ctx, { project_id: projectId, execution_id: id });
    } catch (error) {
      throw refused(run, error);
    }
    const { baseline } = before;
    const known = before.state === 'not_established' || baseline === null ? null : baseline;
    const log = { values: { run_id: run } };
    if (known?.is_this_execution === true) {
      const data: SetBaselineData = {
        run_id: run,
        execution_id: id,
        changed: false,
        previous: null,
        undoable: false,
      };
      return { status: 'done', data, inert: true, update: { log } };
    }
    try {
      await pinExecutionAsBaseline(ctx, { project_id: projectId, execution_id: id });
    } catch (error) {
      throw refused(run, error);
    }
    const previous =
      known === null
        ? null
        : {
            run_id: resolver.shortExecution(known.execution_id),
            execution_id: known.execution_id,
            has_measurements: before.state === 'established' && known.has_measurements,
          };
    const undoable = previous?.has_measurements === true;
    const data: SetBaselineData = {
      run_id: run,
      execution_id: id,
      changed: true,
      previous,
      undoable,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          ...log,
          ...(previous !== null && undoable
            ? { undo_args: { run_id: previous.execution_id } }
            : {}),
        },
      },
    };
  },
  render: renderSetBaseline,
});
