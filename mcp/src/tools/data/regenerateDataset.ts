// `data_regenerate_dataset` (module data): Regenerate a dataset's rows from its recipe: mode=expand
// adds rows, mode=reroll replaces all.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2, costly (docs/consent-card.md): the recipe's generators run, and a column
// made by a model calls the LLM. The first call reads the dataset and makes the card (rows now and
// after, the recipe); a repeat with the same arguments asks the person; only their yes sends the
// request. The backend keeps the rows that were as an earlier revision.
// Operations: expand -> POST .../feeders/{id}/expand {target_rows}; reroll -> POST .../regenerate
// {rows?}. A dataset with no saved recipe is `data_regenerate_no_recipe` (before any question).
// Log: args "Regenerate rows of dataset {name}", result "dataset {name}: {rows} rows".
// Undo (`update.log.undo_args`): `data_restore_dataset` with the dataset.
// Arguments (the catalog's): dataset_id (default: the only dataset of the workspace), mode,
// rows; mode=expand needs rows above the current count.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewRegenerateDataset,
  renderRegenerateDataset,
  type RegenerateDatasetData,
  type RegenerateDatasetFacts,
} from '../../render/data/regenerateDataset.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { ToolError } from '../../errors.js';
import { datasetIdOf } from './datasetId.js';
import { DATA_REGENERATE_DATASET } from './meta.generated.js';
import { getFeeder } from './updateDataset.js';

/** POST /projects/{project_id}/gatling/feeders/{feeder_id}/expand (REST API v1) */
export function expandFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  body: BodyOf<'expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post'>,
): Promise<
  OpOutput<'expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post'>
> {
  return callBackend(
    ctx,
    'expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/feeders/{feeder_id}/regenerate (REST API v1) */
export function regenerateFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  body: BodyOf<'regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post'>,
): Promise<
  OpOutput<'regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post'>
> {
  return callBackend(
    ctx,
    'regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post',
    { path, body },
  );
}

const NAME_LIMIT = 120;
const SHOWN = 20;

export const dataRegenerateDataset = moduleTool(DATA_REGENERATE_DATASET, {
  title: "Regenerate a dataset's rows from its recipe",
  input: {
    dataset_id: uuidArgument()
      .optional()
      .describe('The dataset; default: the only one in this workspace.'),
    mode: z
      .enum(['expand', 'reroll'])
      .describe(
        'expand: add new rows up to `rows`, existing rows stay; reroll: replace all rows with fresh ones.',
      ),
    rows: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .optional()
      .describe(
        'expand: the target row count (required, above the current count); reroll: the new row count (default: the current count).',
      ),
  },
  async card(ctx, args) {
    if (args.mode === 'expand' && args.rows === undefined) {
      refuseRule('regenerate_expand_needs_rows');
    }
    const projectId = projectIdOf(ctx, undefined);
    const feeder = await getFeeder(ctx, {
      project_id: projectId,
      feeder_id: datasetIdOf(ctx, args.dataset_id),
    });
    const name = thirdParty(ctx, feeder.name, NAME_LIMIT);
    if (!feeder.has_recipe) throw new ToolError('data_regenerate_no_recipe', { params: { name } });
    if (args.mode === 'expand' && (args.rows ?? 0) <= feeder.record_count) {
      refuseRule('regenerate_expand_above_current');
    }
    const facts: RegenerateDatasetFacts = {
      dataset_id: feeder.id,
      name,
      mode: args.mode,
      rows_now: feeder.record_count,
      rows_after: args.rows ?? feeder.record_count,
      recipe: feeder.recipe_summary
        .slice(0, SHOWN)
        .map(
          (item) =>
            `${thirdParty(ctx, item.column_name, NAME_LIMIT)}: ${thirdParty(ctx, item.generator, LIMITS.name)}`,
        ),
      recipe_count: feeder.recipe_summary.length,
    };
    return { facts };
  },
  cardView: cardViewRegenerateDataset,
  async run(ctx, args, facts) {
    const path = {
      project_id: projectIdOf(ctx, undefined),
      feeder_id: datasetIdOf(ctx, args.dataset_id),
    };
    const feeder =
      args.mode === 'expand'
        ? await expandFeeder(ctx, path, { target_rows: args.rows ?? facts.rows_after })
        : await regenerateFeeder(ctx, path, args.rows === undefined ? {} : { rows: args.rows });
    const data: RegenerateDatasetData = {
      dataset_id: feeder.id,
      name: thirdParty(ctx, feeder.name, NAME_LIMIT),
      mode: args.mode,
      rows_before: facts.rows_now,
      rows: feeder.record_count,
      columns: feeder.columns.slice(0, SHOWN).map((column) => thirdParty(ctx, column, NAME_LIMIT)),
      columnCount: feeder.columns.length,
    };
    return {
      status: 'done',
      data,
      update: {
        log: { values: { name: data.name, rows: data.rows }, undo_args: { dataset_id: feeder.id } },
      },
    };
  },
  render: renderRegenerateDataset,
});
