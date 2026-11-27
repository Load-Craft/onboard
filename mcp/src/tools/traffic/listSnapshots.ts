// `traffic_list_snapshots` (module traffic): List traffic snapshots, newest first, with quality
// summary and limits; include=format_sample adds the packet format by example.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "", result "{count} snapshots": the data carries `count`.
// The source's query (a sender's text that can hold a credential of a metrics store), the entry
// route, the packet id and the checksum are not read; labels, timezones and kinds pass `content()`.
// The format sample gives the names and JSON types of a packet's fields and the CSV header, never a
// value; it is an auxiliary read (docs/tools/traffic/list-snapshots.md).

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderListSnapshots,
  type FormatSample,
  type SnapshotItem,
  type SnapshotsData,
} from '../../render/traffic/listSnapshots.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { TRAFFIC_LIST_SNAPSHOTS } from './meta.generated.js';

/** GET /projects/{project_id}/production-traffic/snapshots (REST API v1) */
export function listSnapshots(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'list_snapshots_api_v1_projects__project_id__production_traffic_snapshots_get'>
> {
  return callBackend(
    ctx,
    'list_snapshots_api_v1_projects__project_id__production_traffic_snapshots_get',
    { path },
  );
}

/** GET /projects/{project_id}/production-traffic/samples (REST API v1) */
export function getTrafficSamples(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'get_traffic_samples_api_v1_projects__project_id__production_traffic_samples_get'>
> {
  return callBackend(
    ctx,
    'get_traffic_samples_api_v1_projects__project_id__production_traffic_samples_get',
    { path },
  );
}

type List =
  OpOutput<'list_snapshots_api_v1_projects__project_id__production_traffic_snapshots_get'>;
type Samples =
  OpOutput<'get_traffic_samples_api_v1_projects__project_id__production_traffic_samples_get'>;

const NAME_LIMIT = 80;
const FIELDS_SHOWN = 40;
const COLUMNS_SHOWN = 20;
const DEPTH = 4;

async function readSamples(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<Samples | null> {
  try {
    return await getTrafficSamples(ctx, path);
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

/** The JSON type of a value, `object` and `array` aside. */
const typeOf = (value: unknown): string =>
  value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value;

/** The paths of a sample's fields with their types; a list stands for its first item. */
function fieldsOf(
  ctx: CallContext,
  value: unknown,
  prefix: string,
  depth: number,
  out: { path: string; type: string }[],
): void {
  if (out.length >= FIELDS_SHOWN) return;
  if (Array.isArray(value)) {
    const [first] = value as unknown[];
    if (first === undefined || depth >= DEPTH) out.push({ path: `${prefix}[]`, type: 'array' });
    else if (typeof first === 'object' && first !== null)
      fieldsOf(ctx, first, `${prefix}[]`, depth + 1, out);
    else out.push({ path: `${prefix}[]`, type: typeOf(first) });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      const name = content(ctx, key, NAME_LIMIT);
      const path = prefix === '' ? name : `${prefix}.${name}`;
      if (typeof inner === 'object' && inner !== null && depth < DEPTH) {
        fieldsOf(ctx, inner, path, depth + 1, out);
      } else {
        out.push({ path, type: Array.isArray(inner) ? 'array' : typeOf(inner) });
      }
      if (out.length >= FIELDS_SHOWN) return;
    }
  }
}

function sampleOf(ctx: CallContext, samples: Samples): FormatSample {
  const fields: { path: string; type: string }[] = [];
  fieldsOf(ctx, samples.packet ?? {}, '', 0, fields);
  const header = (samples.csv ?? '').split(/\r?\n/u)[0] ?? '';
  const title = (samples.packet_schema as { title?: unknown } | undefined)?.title;
  return {
    schema_title:
      typeof title === 'string' && title !== '' ? content(ctx, title, NAME_LIMIT) : null,
    fields,
    csv_columns: header
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column !== '')
      .slice(0, COLUMNS_SHOWN)
      .map((column) => content(ctx, column, NAME_LIMIT)),
  };
}

function itemOf(ctx: CallContext, snapshot: NonNullable<List['snapshots']>[number]): SnapshotItem {
  const quality = snapshot.quality;
  return {
    id: snapshot.id,
    created_at: snapshot.created_at,
    channel: snapshot.channel,
    token_label:
      snapshot.token_label == null ? null : content(ctx, snapshot.token_label, NAME_LIMIT),
    window_start: snapshot.window_start,
    window_end: snapshot.window_end,
    bucket_seconds: snapshot.bucket_seconds,
    unit: snapshot.unit,
    timezone: content(ctx, snapshot.timezone, NAME_LIMIT),
    routes: snapshot.routes_count ?? 0,
    rows: snapshot.rows_count ?? 0,
    total_count: quality.total_count ?? 0,
    source_kind: content(ctx, snapshot.source.kind, NAME_LIMIT),
    quality: {
      buckets: quality.buckets ?? 0,
      gaps: quality.gaps ?? 0,
      partials: quality.partials ?? 0,
      resets: quality.resets ?? 0,
      unusable: quality.unusable ?? 0,
      session_profile: quality.session_profile != null,
    },
  };
}

export const trafficListSnapshots = moduleTool(TRAFFIC_LIST_SNAPSHOTS, {
  title: 'List traffic snapshots',
  input: {
    include: z
      .array(z.enum(['format_sample']))
      .max(1)
      .optional()
      .describe('"format_sample": the field names and shape of a traffic packet (no values).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('How many snapshots to return (1-100).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const wantsSample = args.include?.includes('format_sample') === true;
    const [list, samples] = await settleAll([
      listSnapshots(ctx, path),
      wantsSample ? readSamples(ctx, path) : Promise.resolve(null),
    ]);
    const all = list.snapshots ?? [];
    const snapshots = all.slice(0, args.limit).map((snapshot) => itemOf(ctx, snapshot));
    const data: SnapshotsData = {
      project_id: projectId,
      count: all.length,
      shown: snapshots.length,
      snapshots,
      limits: {
        snapshots_kept_per_sender: list.limits?.snapshots_kept_per_sender ?? 0,
        max_window_days: list.limits?.max_window_days ?? 0,
      },
      format_state: !wantsSample ? 'none' : samples === null ? 'unavailable' : 'read',
      format_sample: samples === null ? null : sampleOf(ctx, samples),
    };
    return { status: 'done', data };
  },
  render: renderListSnapshots,
});
