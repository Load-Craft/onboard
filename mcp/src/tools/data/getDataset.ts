// `data_get_dataset` (module data): Get a dataset: columns, recipe, row count; include adds rows
// (secrets masked), consumers, history, feed snippet, Redis status.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{dataset_id} include={include}", result "{name}: {rows} rows": the data of the result
// carries the fields.

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderDataset,
  type ConsumerView,
  type DatasetData,
  type DatasetView,
  type HistoryView,
  type IncludePart,
  type Part,
  type PreviewView,
  type RedisView,
} from '../../render/data/getDataset.js';
import { MIN_SECRET_LENGTH } from '../../security/mask.js';
import { isSecretField } from '../../security/secretFields.js';
import {
  callBackend,
  content,
  type BodyOf,
  type CallContext,
  type QueryOf,
} from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { datasetIdOf } from './datasetId.js';
import { semanticsOf } from './semantics.js';
import { DATA_GET_DATASET } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/feeders/{feeder_id} (REST API v1) */
export function getFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  query?: QueryOf<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>,
): Promise<OpOutput<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>> {
  return callBackend(
    ctx,
    'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/gatling/feeders/{feeder_id}/preview (REST API v1) */
export function getFeederPreview(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  query?: QueryOf<'get_feeder_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__preview_get'>,
): Promise<
  OpOutput<'get_feeder_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__preview_get'>
> {
  return callBackend(
    ctx,
    'get_feeder_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__preview_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/gatling/feeders/{feeder_id}/audit (REST API v1) */
export function getFeederAudit(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<
  OpOutput<'get_feeder_audit_api_v1_projects__project_id__gatling_feeders__feeder_id__audit_get'>
> {
  return callBackend(
    ctx,
    'get_feeder_audit_api_v1_projects__project_id__gatling_feeders__feeder_id__audit_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/feeders/{feeder_id}/used-in (REST API v1) */
export function getFeederUsedIn(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<
  OpOutput<'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get'>
> {
  return callBackend(
    ctx,
    'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/feeders/{feeder_id}/redis/status (REST API v1) */
export function gatlingFeederRedisStatus(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<
  OpOutput<'gatling_feeder_redis_status_api_v1_projects__project_id__gatling_feeders__feeder_id__redis_status_get'>
> {
  return callBackend(
    ctx,
    'gatling_feeder_redis_status_api_v1_projects__project_id__gatling_feeders__feeder_id__redis_status_get',
    { path },
  );
}

/** POST /projects/{project_id}/gatling/feeders/preview-snippet (REST API v1) */
export function previewFeederSnippet(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post'>,
): Promise<
  OpOutput<'preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post'>
> {
  return callBackend(
    ctx,
    'preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post',
    { path, body },
  );
}

const COLUMNS_SHOWN = 30;
const CELL_LIMIT = 60;
const NAME_LIMIT = 120;
const TEXT_LIMIT = 300;
const REVISIONS_SHOWN = 20;
const CONSUMERS_SHOWN = 30;
const SNIPPET_LINES = 40;

type Feeder = OpOutput<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>;
type Path = { readonly project_id: string; readonly feeder_id: string };

/** An auxiliary read: an API error of the backend leaves the part out, anything else ends the call. */
async function optional<T>(read: Promise<Part<T>>): Promise<Part<T>> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof LoadcraftApiError) return { unavailable: true };
    throw error;
  }
}

/** The metadata of the dataset: what the backend says of it, never its content or its connection settings. */
function datasetOf(ctx: CallContext, feeder: Feeder): DatasetView {
  const semantics = feeder.column_semantics ?? {};
  return {
    id: feeder.id,
    name: content(ctx, feeder.name, NAME_LIMIT),
    file_name: content(ctx, feeder.file_name, NAME_LIMIT),
    type: feeder.feeder_type,
    strategy: feeder.strategy,
    consumption: feeder.consumption,
    row_count: feeder.record_count,
    columns: feeder.columns.slice(0, COLUMNS_SHOWN).map((name) => ({
      name: content(ctx, name, NAME_LIMIT),
      semantics: semanticsOf(semantics[name]),
    })),
    columns_total: feeder.columns.length,
    recipe: feeder.recipe_summary.slice(0, COLUMNS_SHOWN).map((item) => ({
      column: content(ctx, item.column_name, NAME_LIMIT),
      generator: content(ctx, item.generator, TEXT_LIMIT),
    })),
    has_recipe: feeder.has_recipe,
    provenance: feeder.provenance,
    scenario_id: feeder.auto_linked_scenario_id,
    manually_edited: feeder.manually_edited,
    description:
      feeder.description === null || feeder.description === ''
        ? null
        : content(ctx, feeder.description, TEXT_LIMIT),
    created_at: feeder.created_at,
    updated_at: feeder.updated_at,
  };
}

const cellText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';

async function readPreview(
  ctx: CallContext,
  path: Path,
  rows: number,
  offset: number,
  secretColumns: ReadonlySet<string>,
): Promise<PreviewView> {
  const answer = await getFeederPreview(ctx, path, { rows, offset });
  // A secret cell is registered before any other is shown, so a quote of it in a plain cell is masked.
  for (const row of answer.rows) {
    for (const column of secretColumns) {
      const cell = cellText(row[column]).trim();
      if (cell.length >= MIN_SECRET_LENGTH) ctx.secrets.add(cell);
    }
  }
  const secret = (column: string): boolean => secretColumns.has(column) || isSecretField(column);
  const shown = answer.columns.filter((column) => !secret(column));
  return {
    offset: answer.offset,
    total_rows: answer.total_rows,
    has_more: answer.has_more,
    columns: shown.map((column) => content(ctx, column, NAME_LIMIT)),
    hidden_columns: answer.columns
      .filter((column) => secret(column))
      .map((column) => content(ctx, column, NAME_LIMIT)),
    cells: answer.rows.map((row) =>
      shown.map((column) => content(ctx, cellText(row[column]), CELL_LIMIT)),
    ),
  };
}

async function readConsumers(ctx: CallContext, path: Path): Promise<readonly ConsumerView[]> {
  const answer = await getFeederUsedIn(ctx, path);
  return answer.consumers.slice(0, CONSUMERS_SHOWN).map((item) => ({
    kind: item.kind,
    id: item.id,
    name: content(ctx, item.name, NAME_LIMIT),
    usage: item.usage,
    rows_note: content(ctx, item.rows_note, NAME_LIMIT),
    slots: (item.slots ?? []).map((slot) => content(ctx, slot, NAME_LIMIT)),
  }));
}

async function readHistory(ctx: CallContext, path: Path): Promise<HistoryView> {
  const answer = await getFeederAudit(ctx, path);
  return {
    provenance: answer.provenance,
    created_by: answer.created_by === null ? null : content(ctx, answer.created_by, NAME_LIMIT),
    revisions_total: answer.revisions.length,
    revisions: answer.revisions.slice(0, REVISIONS_SHOWN).map((revision) => ({
      change_type: content(ctx, revision.change_type, NAME_LIMIT),
      created_at: revision.created_at,
      created_by:
        revision.created_by === null ? null : content(ctx, revision.created_by, NAME_LIMIT),
    })),
  };
}

async function readRedis(ctx: CallContext, path: Path): Promise<RedisView> {
  const answer = await gatlingFeederRedisStatus(ctx, path);
  return {
    ok: answer.ok,
    remaining: answer.remaining,
    latency_ms: answer.latency_ms,
    detail: content(ctx, answer.detail, TEXT_LIMIT),
  };
}

async function readSnippet(
  ctx: CallContext,
  projectId: string,
  feeder: Feeder,
): Promise<readonly string[]> {
  const answer = await previewFeederSnippet(
    ctx,
    { project_id: projectId },
    {
      feeder_type: feeder.feeder_type,
      file_name: feeder.file_name,
      strategy: feeder.strategy,
      feed_records_count: feeder.feed_records_count,
      feeder_options: feeder.feeder_options,
      jdbc_config: feeder.jdbc_config,
      redis_config: feeder.redis_config,
    },
  );
  return answer.snippet
    .split('\n')
    .slice(0, SNIPPET_LINES)
    .map((line) => content(ctx, line, TEXT_LIMIT));
}

export const dataGetDataset = moduleTool(DATA_GET_DATASET, {
  title: 'Get a dataset',
  input: {
    dataset_id: uuidArgument()
      .optional()
      .describe('The dataset; default: the only one in this workspace.'),
    include: z
      .array(z.enum(['rows', 'consumers', 'history', 'snippet', 'redis']))
      .max(5)
      .optional()
      .describe(
        'rows: a masked preview (secret columns hidden); consumers: who uses it; history: revisions; snippet: the feed snippet; redis: pool status.',
      ),
    rows: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('With include rows: how many rows (1-50).'),
    offset: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .default(0)
      .describe('With include rows: the first row.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const datasetId = datasetIdOf(ctx, args.dataset_id);
    const wants = new Set<IncludePart>(args.include ?? []);
    const path = { project_id: projectId, feeder_id: datasetId };
    // The dataset first and alone: its answer carries the whole content, and the cells of its secret
    // columns are registered as secrets of the call before anything else is read or shown.
    const feeder = await getFeeder(ctx, path);
    const secretColumns = new Set(
      feeder.columns.filter(
        (column) => feeder.column_semantics?.[column] === 'credential' || isSecretField(column),
      ),
    );
    const [preview, consumers, history, redis, snippet] = await settleAll([
      wants.has('rows')
        ? optional(readPreview(ctx, path, args.rows, args.offset, secretColumns))
        : Promise.resolve(null),
      wants.has('consumers') ? optional(readConsumers(ctx, path)) : Promise.resolve(null),
      wants.has('history') ? optional(readHistory(ctx, path)) : Promise.resolve(null),
      wants.has('redis') ? optional(readRedis(ctx, path)) : Promise.resolve(null),
      wants.has('snippet') ? optional(readSnippet(ctx, projectId, feeder)) : Promise.resolve(null),
    ]);
    const dataset = datasetOf(ctx, feeder);
    const data: DatasetData = {
      project_id: projectId,
      dataset,
      included: [...wants],
      preview,
      consumers,
      history,
      snippet,
      redis,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            dataset_id: datasetId,
            include: wants.size === 0 ? 'none' : [...wants].join(', '),
            name: dataset.name,
            rows: dataset.row_count,
          },
        },
      },
    };
  },
  render: renderDataset,
});
