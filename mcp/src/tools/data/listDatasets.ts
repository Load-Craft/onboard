// `data_list_datasets` (module data): List the project's datasets: name, type, columns, row count
// (no rows).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the reads and the view. The
// answer is the summary of each dataset: the metadata only, never a cell, so no value of a dataset
// (an account's password among them) can reach the view, the data, the log or the state. The names
// of a dataset, its file and its columns are texts of a third party and pass `content`.
// Log: args "", result "{count} datasets": the data of the result carries `count`.
// Arguments: the catalog names none for this tool, so it takes none (only `format`).

import type { OpOutput } from '../../http/operation.js';
import {
  renderListDatasets,
  type DatasetItem,
  type DatasetListData,
} from '../../render/data/listDatasets.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { semanticsOf } from './semantics.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { DATA_LIST_DATASETS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/feeders (REST API v1) */
export function listFeeders(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'list_feeders_api_v1_projects__project_id__gatling_feeders_get'>> {
  return callBackend(ctx, 'list_feeders_api_v1_projects__project_id__gatling_feeders_get', {
    path,
  });
}

const DATASETS_SHOWN = 50;
const COLUMNS_SHOWN = 30;
const NAME_LIMIT = 120;
const COLUMN_LIMIT = 60;

type Summary =
  OpOutput<'list_feeders_api_v1_projects__project_id__gatling_feeders_get'>['feeders'][number];

function itemOf(ctx: CallContext, feeder: Summary): DatasetItem {
  const semantics = feeder.column_semantics ?? {};
  return {
    id: feeder.id,
    name: content(ctx, feeder.name, NAME_LIMIT),
    file_name: content(ctx, feeder.file_name, NAME_LIMIT),
    type: feeder.feeder_type,
    strategy: feeder.strategy,
    consumption: feeder.consumption,
    rows: feeder.record_count,
    columns: feeder.columns.slice(0, COLUMNS_SHOWN).map((name) => ({
      name: content(ctx, name, COLUMN_LIMIT),
      semantics: semanticsOf(semantics[name]),
    })),
    columns_total: feeder.columns.length,
    has_recipe: feeder.has_recipe,
    provenance: feeder.provenance,
    scenario_id: feeder.auto_linked_scenario_id,
    manually_edited: feeder.manually_edited,
    updated_at: feeder.updated_at,
  };
}

export const dataListDatasets = moduleTool(DATA_LIST_DATASETS, {
  title: "List the project's datasets",
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const answer = await listFeeders(ctx, { project_id: projectId });
    const datasets = answer.feeders.slice(0, DATASETS_SHOWN).map((feeder) => itemOf(ctx, feeder));
    const data: DatasetListData = {
      project_id: projectId,
      count: answer.total,
      shown: datasets.length,
      datasets,
    };
    return { status: 'done', data };
  },
  render: renderListDatasets,
});
