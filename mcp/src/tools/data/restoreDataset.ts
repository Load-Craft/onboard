// `data_restore_dataset` (module data): Restore a dataset's previous content (a second call switches
// back).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. One request: the backend swaps the content with the previous revision and answers the dataset.
// A dataset with no revision of different content is the backend's refusal (a conflict). The cells of
// the dataset (`content`) are never read: only its name, its size and its column names, masked. The
// undo is the same tool with the same dataset (`update.log.undo_args`): a second call switches back.
// Log: args "{dataset_id}", result "{name}: previous content restored".
// Arguments (the catalog's): `dataset_id` (default: the only dataset of the workspace).

import type { OpOutput } from '../../http/operation.js';
import { renderRestoreDataset, type RestoreDatasetData } from '../../render/data/restoreDataset.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { datasetIdOf } from './datasetId.js';
import { DATA_RESTORE_DATASET } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/feeders/{feeder_id}/restore-previous (REST API v1) */
export function restorePreviousFeederContent(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<
  OpOutput<'restore_previous_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__restore_previous_post'>
> {
  return callBackend(
    ctx,
    'restore_previous_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__restore_previous_post',
    { path },
  );
}

const NAME_LIMIT = 120;
const COLUMNS_SHOWN = 20;

export const dataRestoreDataset = moduleTool(DATA_RESTORE_DATASET, {
  title: "Restore a dataset's previous content",
  input: {
    dataset_id: uuidArgument()
      .optional()
      .describe('The dataset; default: the only one in this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const datasetId = datasetIdOf(ctx, args.dataset_id);
    const feeder = await restorePreviousFeederContent(ctx, {
      project_id: projectId,
      feeder_id: datasetId,
    });
    const data: RestoreDatasetData = {
      dataset_id: datasetId,
      name: content(ctx, feeder.name, NAME_LIMIT),
      rows: feeder.record_count,
      columns: feeder.columns
        .slice(0, COLUMNS_SHOWN)
        .map((column) => content(ctx, column, NAME_LIMIT)),
      columnCount: feeder.columns.length,
      manuallyEdited: feeder.manually_edited,
    };
    return { status: 'done', data, update: { log: { undo_args: { dataset_id: datasetId } } } };
  },
  render: renderRestoreDataset,
});
