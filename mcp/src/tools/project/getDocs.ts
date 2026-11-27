// `project_get_docs` (module project): Get the project's active API docs (OpenAPI or AsyncAPI), the
// stored versions, or one version by id.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The specification document is never read into the result, only its metadata. The title,
// the version, the description, the source address and the protocol names are the project's own
// text and pass the mask of a third party's text (`content`); the address is origin and path only.
// Log: args "{kind} {docs_id}", result "{kind} v{version}": the data carries `kind` and `version`,
// the log values `docs_id`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetDocs,
  type DocsData,
  type DocsItem,
  type DocsKind,
} from '../../render/project/getDocs.js';
import {
  LIMITS,
  address,
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { PROJECT_GET_DOCS } from './meta.generated.js';

/** GET /projects/{project_id}/openapi (REST API v1) */
export function getProjectOpenapiSpec(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_project_openapi_spec_api_v1_projects__project_id__openapi_get'>> {
  return callBackend(ctx, 'get_project_openapi_spec_api_v1_projects__project_id__openapi_get', {
    path,
  });
}

/** GET /projects/{project_id}/asyncapi (REST API v1) */
export function getProjectAsyncapiSpec(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_project_asyncapi_spec_api_v1_projects__project_id__asyncapi_get'>> {
  return callBackend(ctx, 'get_project_asyncapi_spec_api_v1_projects__project_id__asyncapi_get', {
    path,
  });
}

/** GET /projects/{project_id}/openapi-specs (REST API v1) */
export function listProjectOpenapiSpecs(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get'>,
): Promise<OpOutput<'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get'>> {
  return callBackend(
    ctx,
    'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/asyncapi-specs (REST API v1) */
export function listProjectAsyncapiSpecs(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get'>,
): Promise<
  OpOutput<'list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get'>
> {
  return callBackend(
    ctx,
    'list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /openapi-specs/{spec_id} (REST API v1) */
export function getOpenapiSpec(
  ctx: CallContext,
  path: { readonly spec_id: string },
): Promise<OpOutput<'get_openapi_spec_api_v1_openapi_specs__spec_id__get'>> {
  return callBackend(ctx, 'get_openapi_spec_api_v1_openapi_specs__spec_id__get', { path });
}

/** GET /asyncapi-specs/{spec_id} (REST API v1) */
export function getAsyncapiSpec(
  ctx: CallContext,
  path: { readonly spec_id: string },
): Promise<OpOutput<'get_asyncapi_spec_api_v1_asyncapi_specs__spec_id__get'>> {
  return callBackend(ctx, 'get_asyncapi_spec_api_v1_asyncapi_specs__spec_id__get', { path });
}

/** The versions the data carries, and the longest text kept. */
const VERSIONS_SHOWN = 50;
const TEXT_LIMIT = 100;
const PROTOCOLS_SHOWN = 10;

type ActiveOpenapi = OpOutput<'get_project_openapi_spec_api_v1_projects__project_id__openapi_get'>;
type ActiveAsyncapi = NonNullable<
  OpOutput<'get_project_asyncapi_spec_api_v1_projects__project_id__asyncapi_get'>
>;
type OpenapiById = OpOutput<'get_openapi_spec_api_v1_openapi_specs__spec_id__get'>;
type AsyncapiById = OpOutput<'get_asyncapi_spec_api_v1_asyncapi_specs__spec_id__get'>;
type OpenapiVersion =
  OpOutput<'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get'>['specs'][number];
type AsyncapiVersion =
  OpOutput<'list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get'>['specs'][number];

interface Facts {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description?: string | null | undefined;
  readonly source_url?: string | null | undefined;
  readonly at: string;
  readonly spec_version?: string | null | undefined;
  readonly endpoints_count?: number | undefined;
  readonly channels_count?: number | undefined;
  readonly operations_count?: number | undefined;
  readonly protocols?: readonly string[] | undefined;
  readonly is_active?: boolean | undefined;
  readonly is_current?: boolean | undefined;
}

function itemOf(ctx: CallContext, facts: Facts, selectedId: string | undefined): DocsItem {
  const spec = facts.spec_version;
  return {
    id: facts.id,
    title: thirdParty(ctx, facts.title, TEXT_LIMIT),
    version: thirdParty(ctx, facts.version, TEXT_LIMIT),
    description: thirdPartyOrNull(ctx, facts.description, LIMITS.sentence),
    source_url: address(ctx, facts.source_url),
    at: facts.at,
    spec_version: spec === null || spec === undefined ? null : thirdParty(ctx, spec, 20),
    endpoints_count: facts.endpoints_count ?? null,
    channels_count: facts.channels_count ?? null,
    operations_count: facts.operations_count ?? null,
    protocols: (facts.protocols ?? [])
      .slice(0, PROTOCOLS_SHOWN)
      .map((name) => thirdParty(ctx, name, LIMITS.word)),
    is_active: facts.is_active ?? null,
    is_current: facts.is_current ?? null,
    selected: facts.id === selectedId,
  };
}

const openapiFacts = (spec: ActiveOpenapi | OpenapiById): Facts => ({
  id: spec.id,
  title: spec.title,
  version: spec.version,
  description: 'description' in spec ? spec.description : undefined,
  source_url: spec.source_url,
  at: 'uploaded_at' in spec ? spec.uploaded_at : spec.created_at,
  spec_version: 'openapi_version' in spec ? spec.openapi_version : undefined,
  endpoints_count: spec.endpoints.length,
});

const asyncapiFacts = (spec: ActiveAsyncapi | AsyncapiById): Facts => ({
  id: spec.id,
  title: spec.title,
  version: spec.version,
  description: spec.description,
  source_url: spec.source_url,
  at: 'uploaded_at' in spec ? spec.uploaded_at : spec.created_at,
  spec_version: 'asyncapi_version' in spec ? spec.asyncapi_version : undefined,
  channels_count: spec.channels?.length ?? 0,
  operations_count: spec.operations?.length ?? 0,
  protocols: spec.detected_protocols,
});

const versionFacts = (spec: OpenapiVersion | AsyncapiVersion): Facts => ({
  id: spec.id,
  title: spec.title,
  version: spec.version,
  description: spec.description,
  source_url: spec.source_url,
  at: spec.created_at,
  ...('endpoints_count' in spec
    ? { endpoints_count: spec.endpoints_count }
    : { channels_count: spec.channels_count, operations_count: spec.operations_count }),
  is_active: spec.is_active,
  is_current: spec.is_current,
});

export const projectGetDocs = moduleTool(PROJECT_GET_DOCS, {
  title: "Get the project's active API docs",
  input: {
    kind: z
      .enum(['openapi', 'asyncapi'])
      .default('openapi')
      .describe('Which documentation: openapi (default) or asyncapi.'),
    docs_id: uuidArgument()
      .optional()
      .describe('One stored version by its id; without it, the active documentation.'),
    versions: z
      .boolean()
      .default(false)
      .describe('true: the list of stored versions instead (not with docs_id).'),
  },
  async run(ctx, args) {
    if (args.versions && args.docs_id !== undefined) {
      refuseRule('versions_with_docs_id');
    }
    const kind: DocsKind = args.kind;
    const projectId = projectIdOf(ctx, undefined);
    const stateDocs = fromState(ctx, 'ids.docs_id');
    const selectedId = typeof stateDocs === 'string' ? stateDocs : undefined;
    const path = { project_id: projectId };
    const logValues = { docs_id: args.docs_id?.toLowerCase() ?? '' };
    const base = { kind, project_id: projectId } as const;

    let data: DocsData;
    if (args.versions) {
      const list =
        kind === 'openapi'
          ? await listProjectOpenapiSpecs(ctx, path)
          : await listProjectAsyncapiSpecs(ctx, path);
      const specs: readonly (OpenapiVersion | AsyncapiVersion)[] = list.specs;
      const items = specs
        .slice(0, VERSIONS_SHOWN)
        .map((spec) => itemOf(ctx, versionFacts(spec), selectedId));
      const current = specs.find((spec) => spec.id === list.current_spec_id);
      data = {
        ...base,
        mode: 'versions',
        version: current === undefined ? null : thirdParty(ctx, current.version, TEXT_LIMIT),
        count: specs.length,
        shown: items.length,
        current_id: list.current_spec_id ?? null,
        docs: null,
        versions: items,
      };
    } else {
      const wanted = args.docs_id?.toLowerCase();
      const facts: Facts | null =
        kind === 'openapi'
          ? openapiFacts(
              wanted === undefined
                ? await getProjectOpenapiSpec(ctx, path)
                : await getOpenapiSpec(ctx, { spec_id: wanted }),
            )
          : await asyncFactsOf(ctx, path, wanted);
      const docs = facts === null ? null : itemOf(ctx, facts, selectedId);
      data = {
        ...base,
        mode: wanted === undefined ? 'active' : 'version',
        version: docs?.version ?? null,
        count: docs === null ? 0 : 1,
        shown: docs === null ? 0 : 1,
        current_id: null,
        docs,
        versions: [],
      };
    }
    const shownId = data.docs?.id;
    return {
      status: 'done',
      data,
      update: {
        ...(shownId === undefined ? {} : { ids: { docs_id: shownId } }),
        log: { values: logValues },
      },
    };
  },
  render: renderGetDocs,
});

/** The AsyncAPI documentation asked for; null when the project has none (the backend answers null). */
async function asyncFactsOf(
  ctx: CallContext,
  path: { readonly project_id: string },
  wanted: string | undefined,
): Promise<Facts | null> {
  if (wanted !== undefined) return asyncapiFacts(await getAsyncapiSpec(ctx, { spec_id: wanted }));
  const active = await getProjectAsyncapiSpec(ctx, path);
  return active === null ? null : asyncapiFacts(active);
}
