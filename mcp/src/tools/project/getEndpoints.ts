// `project_get_endpoints` (module project): Get the endpoints of the API docs: the list, or one
// with its schema and validator bindings.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The documentation is the project's own text and arrives through a third party's pen, so
// every name, summary, description and path passes the mask of a third party's text (`content`);
// examples, defaults and enumerated values are never read. A schema is kept short: its type and
// the names of its top-level properties.
// Log: args "{endpoint}", result "{count} endpoints": the log values carry `endpoint`, the data
// `count`.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderGetEndpoints,
  type Bindings,
  type EndpointDetail,
  type EndpointItem,
  type EndpointsData,
  type SchemaShape,
} from '../../render/project/getEndpoints.js';
import {
  callBackend,
  includes,
  isUuid,
  ownDoc,
  projectIdOf,
  refuseRule,
  settleAll,
  type CallContext,
} from '../kit/transitional.js';
import { idOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { PROJECT_GET_ENDPOINTS } from './meta.generated.js';

/** GET /openapi-specs/{spec_id}/endpoints (REST API v1) */
export function getSpecEndpoints(
  ctx: CallContext,
  path: { readonly spec_id: string },
): Promise<OpOutput<'get_spec_endpoints_api_v1_openapi_specs__spec_id__endpoints_get'>> {
  return callBackend(ctx, 'get_spec_endpoints_api_v1_openapi_specs__spec_id__endpoints_get', {
    path,
  });
}

/** GET /openapi-specs/{spec_id}/endpoints/{endpoint_id} (REST API v1) */
export function getEndpointDetails(
  ctx: CallContext,
  path: { readonly spec_id: string; readonly endpoint_id: string },
): Promise<
  OpOutput<'get_endpoint_details_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__get'>
> {
  return callBackend(
    ctx,
    'get_endpoint_details_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__get',
    { path },
  );
}

/** GET /openapi-specs/{spec_id}/endpoints/{endpoint_id}/binding-metadata (REST API v1) */
export function getEndpointBindingMetadata(
  ctx: CallContext,
  path: { readonly spec_id: string; readonly endpoint_id: string },
): Promise<
  OpOutput<'get_endpoint_binding_metadata_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__binding_metadata_get'>
> {
  return callBackend(
    ctx,
    'get_endpoint_binding_metadata_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__binding_metadata_get',
    { path },
  );
}

const INPUT = {
  docs_id: uuidArgument()
    .optional()
    .describe(
      'The documentation version; default: the one of this workspace (see project_get_docs).',
    ),
  endpoint: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe(
      'One endpoint: its id, operationId or "METHOD /path" (POST /checkout); without it, the list.',
    ),
  include: z
    .array(z.enum(['bindings']))
    .max(1)
    .optional()
    .describe(
      '"bindings": expected statuses, response schemas in short and suggested assertions (with endpoint only).',
    ),
  method: z
    .enum(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
    .optional()
    .describe('List only endpoints of this method.'),
  query: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'List only endpoints whose path, summary or operationId contains this text (any case).',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('How many endpoints of the list to return (1-200).'),
};

/** The longest text kept, and how many names of each kind. */
const TEXT_LIMIT = 200;
const DESCRIPTION_LIMIT = 300;
const TAGS_SHOWN = 5;
const PROPERTIES_SHOWN = 15;
const SECURITY_SHOWN = 10;
const PARAMETERS_SHOWN = 40;
const RESPONSES_SHOWN = 20;
const ASSERTIONS_SHOWN = 15;
const STATUSES_SHOWN = 20;

const METHOD_AND_PATH = /^([A-Za-z]+)\s+(\/\S*)$/u;

type Summary =
  OpOutput<'get_spec_endpoints_api_v1_openapi_specs__spec_id__endpoints_get'>['endpoints'][number];
type Detail =
  OpOutput<'get_endpoint_details_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__get'>;
type Metadata =
  OpOutput<'get_endpoint_binding_metadata_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__binding_metadata_get'>;

/** A text of the stored OpenAPI document: documentation of the project's API, read as such. */
const text = (ctx: CallContext, value: string, max = TEXT_LIMIT): string => ownDoc(ctx, value, max);

function itemOf(ctx: CallContext, endpoint: Summary): EndpointItem {
  return {
    id: endpoint.id,
    method: endpoint.method.toUpperCase(),
    path: text(ctx, endpoint.path),
    operation_id: endpoint.operation_id === null ? null : text(ctx, endpoint.operation_id),
    summary: endpoint.summary === null ? null : text(ctx, endpoint.summary),
    tags: endpoint.tags.slice(0, TAGS_SHOWN).map((tag) => text(ctx, tag, 60)),
    parameters_count: endpoint.parameters_count,
    has_request_body: endpoint.has_request_body,
    crud_operation: endpoint.crud_operation,
    async_pattern: endpoint.async_pattern,
  };
}

/** The type and the names of the top-level properties of a schema; nothing else of it is read. */
function shapeOf(
  ctx: CallContext,
  schema: Readonly<Record<string, unknown>> | undefined,
): SchemaShape {
  const type = schema?.['type'];
  const properties = schema?.['properties'];
  const items = schema?.['items'];
  const itemType =
    typeof items === 'object' && items !== null && !Array.isArray(items)
      ? (items as Record<string, unknown>)['type']
      : undefined;
  return {
    type: typeof type === 'string' ? text(ctx, type, 30) : null,
    properties:
      typeof properties === 'object' && properties !== null && !Array.isArray(properties)
        ? Object.keys(properties)
            .slice(0, PROPERTIES_SHOWN)
            .map((name) => text(ctx, name, 60))
        : [],
    items: typeof itemType === 'string' ? text(ctx, itemType, 30) : null,
  };
}

function detailOf(ctx: CallContext, detail: Detail): EndpointDetail {
  const description = detail.description;
  return {
    id: detail.id,
    method: detail.method.toUpperCase(),
    path: text(ctx, detail.path),
    operation_id: detail.operation_id === null ? null : text(ctx, detail.operation_id),
    summary: detail.summary === null ? null : text(ctx, detail.summary),
    tags: detail.tags.slice(0, TAGS_SHOWN).map((tag) => text(ctx, tag, 60)),
    parameters_count: detail.parameters.length,
    has_request_body: detail.request_body !== null,
    crud_operation: detail.crud_operation,
    async_pattern: detail.async_pattern,
    description:
      description === null || description === '' ? null : text(ctx, description, DESCRIPTION_LIMIT),
    deprecated: detail.deprecated,
    security: detail.security
      .flatMap((requirement) => Object.keys(requirement))
      .slice(0, SECURITY_SHOWN)
      .map((name) => text(ctx, name, 60)),
    parameters: detail.parameters.slice(0, PARAMETERS_SHOWN).map((parameter) => ({
      name: text(ctx, parameter.name, 80),
      in: parameter.location,
      type: text(ctx, parameter.schema_type, 30),
      required: parameter.required,
    })),
    request_body:
      detail.request_body === null
        ? null
        : {
            content_type: text(ctx, detail.request_body.content_type, 80),
            required: detail.request_body.required,
            schema: shapeOf(ctx, detail.request_body.schema_def),
          },
    responses: detail.responses.slice(0, RESPONSES_SHOWN).map((response) => ({
      status: response.status_code,
      content_type: response.content_type === null ? null : text(ctx, response.content_type, 80),
      schema: shapeOf(ctx, response.schema_def),
    })),
  };
}

function bindingsOf(ctx: CallContext, metadata: Metadata): Bindings {
  return {
    expected_statuses: (metadata.expected_status_codes ?? []).slice(0, STATUSES_SHOWN),
    response_schemas: Object.entries(metadata.response_schemas ?? {})
      .slice(0, STATUSES_SHOWN)
      .map(([status, schema]) => ({ status: text(ctx, status, 10), schema: shapeOf(ctx, schema) })),
    assertions: (metadata.suggested_assertions ?? [])
      .slice(0, ASSERTIONS_SHOWN)
      .map((assertion) => ({
        type: text(ctx, assertion.type, 60),
        description: text(ctx, assertion.description, 150),
      })),
  };
}

/** The endpoint the model named, as its id: a UUID goes as it is, a name is looked up in the list. */
function resolve(ctx: ToolContext, endpoints: readonly Summary[], wanted: string): string {
  const pair = METHOD_AND_PATH.exec(wanted);
  const matches = endpoints.filter((endpoint) =>
    pair === null
      ? endpoint.operation_id === wanted
      : endpoint.method.toLowerCase() === (pair[1] ?? '').toLowerCase() &&
        endpoint.path === pair[2],
  );
  const [only] = matches;
  if (only === undefined) throw new ToolError('not_found', { params: { available: '' } });
  if (matches.length > 1) {
    throw new ToolError('ambiguous', {
      params: {
        kind: ctx.t('project_get_endpoints.kind'),
        name: text(ctx, wanted, 100),
        candidates: matches
          .map(
            (endpoint) =>
              `${endpoint.method.toUpperCase()} ${text(ctx, endpoint.path, 100)} (${endpoint.id})`,
          )
          .join(', '),
      },
    });
  }
  return only.id;
}

/** The metadata of the validators is an auxiliary read: an error of the backend leaves it out. */
async function readBindings(
  ctx: CallContext,
  path: { readonly spec_id: string; readonly endpoint_id: string },
): Promise<Metadata | null> {
  try {
    return await getEndpointBindingMetadata(ctx, path);
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

export const projectGetEndpoints = moduleTool(PROJECT_GET_ENDPOINTS, {
  title: 'Get the endpoints of the API docs',
  input: INPUT,
  async run(ctx, args) {
    const one = args.endpoint !== undefined;
    if (one && (args.method !== undefined || args.query !== undefined)) {
      refuseRule('filter_with_endpoint');
    }
    if (!one && args.include !== undefined) refuseRule('include_without_endpoint');
    const projectId = projectIdOf(ctx, undefined);
    const docsId = idOf(ctx, 'docs_id', args.docs_id?.toLowerCase(), 'ids.docs_id');
    const base = { project_id: projectId, docs_id: docsId } as const;
    const logValues = { endpoint: args.endpoint ?? '' };
    const wantsBindings = includes(args.include).has('bindings');
    const none = { endpoints: [], detail: null, bindings: null, bindings_state: 'none' } as const;

    if (args.endpoint === undefined) {
      const { endpoints } = await getSpecEndpoints(ctx, { spec_id: docsId });
      const method = args.method;
      const needle = args.query?.toLowerCase();
      const matching = endpoints.filter(
        (endpoint) =>
          (method === undefined || endpoint.method.toLowerCase() === method) &&
          (needle === undefined ||
            [endpoint.path, endpoint.summary ?? '', endpoint.operation_id ?? ''].some((field) =>
              field.toLowerCase().includes(needle),
            )),
      );
      const shown = matching.slice(0, args.limit).map((endpoint) => itemOf(ctx, endpoint));
      const data: EndpointsData = {
        ...none,
        ...base,
        mode: 'list',
        count: matching.length,
        total: endpoints.length,
        shown: shown.length,
        endpoints: shown,
      };
      return { status: 'done', data, update: { log: { values: logValues } } };
    }

    const wanted = args.endpoint.trim();
    const endpointId = isUuid(wanted)
      ? wanted.toLowerCase()
      : resolve(ctx, (await getSpecEndpoints(ctx, { spec_id: docsId })).endpoints, wanted);
    const path = { spec_id: docsId, endpoint_id: endpointId };
    const [detail, metadata] = await settleAll([
      getEndpointDetails(ctx, path),
      wantsBindings ? readBindings(ctx, path) : Promise.resolve(null),
    ]);
    const bindings = metadata === null ? null : bindingsOf(ctx, metadata);
    const data: EndpointsData = {
      ...base,
      mode: 'one',
      count: 1,
      total: 1,
      shown: 1,
      endpoints: [],
      detail: detailOf(ctx, detail),
      bindings,
      bindings_state: !wantsBindings ? 'none' : bindings === null ? 'unavailable' : 'read',
    };
    return { status: 'done', data, update: { log: { values: logValues } } };
  },
  render: renderGetEndpoints,
});
