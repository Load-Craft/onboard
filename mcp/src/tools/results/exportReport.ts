// `results_export_report` (module results): Export the archived Gatling HTML report to a local
// folder and return its path.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The report is read file by file and saved under `loadcraft/reports/<run>/` of the workspace
// (`reportFiles.ts`): an earlier export of the run is replaced only with `overwrite: true`, and that
// is checked before anything is read from the backend. The files are the user's report, saved as
// they are; the model sees only their numbers and the path of the report, relative to the workspace.
// The index operation of the report (`…/report`, a redirect to its `index.html`) is not called.
// Log: args "{run_id}", result "{path}": the log values carry the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { isRunNotFound, LoadcraftApiError } from '../../http/apiError.js';
import { renderExportReport, type ExportData } from '../../render/results/exportReport.js';
import {
  callBackend,
  isUuid,
  projectIdOf,
  runHandle,
  runOf,
  type CallContext,
} from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { RESULTS_EXPORT_REPORT } from './meta.generated.js';
import { checkTarget, exportReport, reportDirOf, type ReportFile } from './reportFiles.js';
import { isRunRef, RunRef } from './run.js';

/** The first file of a report, the one the result points at. */
const ENTRY = 'index.html';

type AssetOp =
  'get_execution_report_asset_api_v1_projects__project_id__gatling_executions__execution_id__report__filepath__get';

/** GET /projects/{project_id}/gatling/executions/{execution_id}/report/{filepath} (REST API v1) */
export function getExecutionReportAsset(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string; readonly filepath: string },
): Promise<OpOutput<AssetOp>> {
  return callBackend(
    ctx,
    'get_execution_report_asset_api_v1_projects__project_id__gatling_executions__execution_id__report__filepath__get',
    { path },
  );
}

/**
 * The handle of the run as the call names it, read without the backend (`e-1a2b3c4d`, or the first
 * eight digits of a UUID): the argument, else `ids.run_id` of the state when it is a run reference,
 * as `runOf` takes them. Undefined when neither names one: `runOf` then answers `missing_argument`.
 */
function localHandleOf(
  ctx: Parameters<typeof fromState>[0],
  given: string | undefined,
): string | undefined {
  const kept = fromState(ctx, 'ids.run_id');
  const value = given ?? (isRunRef(kept) ? kept.trim() : undefined);
  if (value === undefined) return undefined;
  return isUuid(value) ? runHandle(value) : value;
}

export const resultsExportReport = moduleTool(RESULTS_EXPORT_REPORT, {
  title: 'Export the Gatling report of a run',
  input: {
    run_id: RunRef.optional().describe(
      'The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace.',
    ),
    overwrite: z
      .boolean()
      .default(false)
      .describe(
        'true: replace a report of this run exported earlier; without it an existing folder is refused.',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const root = ctx.config.stateRoot;
    // the folder first, then the backend: a report exported before is refused without a request
    const local = localHandleOf(ctx, args.run_id);
    if (local !== undefined) checkTarget(root, local, args.overwrite);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const read = async (filepath: string): Promise<ReportFile> => {
      try {
        const blob = await getExecutionReportAsset(ctx, {
          project_id: projectId,
          execution_id: id,
          filepath,
        });
        return { kind: 'file', bytes: new Uint8Array(await blob.arrayBuffer()) };
      } catch (error) {
        if (isRunNotFound(error, id)) throw error;
        if (error instanceof LoadcraftApiError && error.status === 404) return { kind: 'missing' };
        throw error;
      }
    };
    const result = await exportReport(root, run, args.overwrite, read);
    const path = `${reportDirOf(run)}/${ENTRY}`;
    const data: ExportData = {
      run,
      run_id: id,
      path,
      files: result.saved.length,
      bytes: result.bytes,
      missingCount: result.missing,
      skippedLinks: result.skippedLinks,
      truncated: result.truncated,
    };
    return { status: 'done', data, update: { log: { values: { run_id: run, path } } } };
  },
  render: renderExportReport,
});
