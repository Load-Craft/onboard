// `project_set_active_docs` (module project): Set a stored docs version as the active one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// The stored versions are read first (the version active now is the way back, and the wanted one
// gives the title and the version of the result); the backend alone decides whether the wanted one
// exists and belongs to the project. A version that already is the active one is not written.
// Log: args "{docs_id}", result "{kind} v{version} active": the data of the result carries the
// fields; the arguments of the undo are the previous version (`update.log.undo_args`).

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import { renderSetActiveDocs, type SetActiveDocsData } from '../../render/project/setActiveDocs.js';
import { callBackend, projectIdOf, thirdParty, type CallContext } from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import {
  getAsyncapiSpec,
  getOpenapiSpec,
  listProjectAsyncapiSpecs,
  listProjectOpenapiSpecs,
} from './getDocs.js';
import { PROJECT_SET_ACTIVE_DOCS } from './meta.generated.js';

/** PUT /projects/{project_id}/openapi-specs/{spec_id}/activate (REST API v1) */
export function activateOpenapiSpec(
  ctx: CallContext,
  path: { readonly project_id: string; readonly spec_id: string },
): Promise<
  OpOutput<'activate_openapi_spec_api_v1_projects__project_id__openapi_specs__spec_id__activate_put'>
> {
  return callBackend(
    ctx,
    'activate_openapi_spec_api_v1_projects__project_id__openapi_specs__spec_id__activate_put',
    { path },
  );
}

/** PUT /projects/{project_id}/asyncapi-specs/{spec_id}/activate (REST API v1) */
export function activateAsyncapiSpec(
  ctx: CallContext,
  path: { readonly project_id: string; readonly spec_id: string },
): Promise<
  OpOutput<'activate_asyncapi_spec_api_v1_projects__project_id__asyncapi_specs__spec_id__activate_put'>
> {
  return callBackend(
    ctx,
    'activate_asyncapi_spec_api_v1_projects__project_id__asyncapi_specs__spec_id__activate_put',
    { path },
  );
}

const TEXT_LIMIT = 100;

interface Facts {
  readonly title: string;
  readonly version: string;
}

type Versions = {
  readonly current: string | null;
  readonly found: Facts | undefined;
};

/** The version active now and, when it is on the page of the list, the wanted one. */
async function readVersions(
  ctx: CallContext,
  kind: 'openapi' | 'asyncapi',
  projectId: string,
  wanted: string,
): Promise<Versions> {
  const path = { project_id: projectId };
  const list =
    kind === 'openapi'
      ? await listProjectOpenapiSpecs(ctx, path)
      : await listProjectAsyncapiSpecs(ctx, path);
  const specs: readonly (Facts & { readonly id: string })[] = list.specs;
  const found = specs.find((spec) => spec.id.toLowerCase() === wanted);
  return {
    current: list.current_spec_id ?? null,
    found: found === undefined ? undefined : { title: found.title, version: found.version },
  };
}

/** Title and version of a version read by its id; best effort, the activation does not depend on it. */
async function readFacts(
  ctx: CallContext,
  kind: 'openapi' | 'asyncapi',
  wanted: string,
): Promise<Facts | undefined> {
  try {
    const spec =
      kind === 'openapi'
        ? await getOpenapiSpec(ctx, { spec_id: wanted })
        : await getAsyncapiSpec(ctx, { spec_id: wanted });
    return { title: spec.title, version: spec.version };
  } catch (error) {
    if (error instanceof LoadcraftApiError) return undefined;
    throw error;
  }
}

export const projectSetActiveDocs = moduleTool(PROJECT_SET_ACTIVE_DOCS, {
  title: 'Set a stored docs version as the active one',
  input: {
    kind: z
      .enum(['openapi', 'asyncapi'])
      .default('openapi')
      .describe('Which documentation: openapi (default) or asyncapi.'),
    docs_id: uuidArgument().describe(
      'The stored version to make active (project_get_docs versions=true lists them).',
    ),
  },
  async run(ctx, args) {
    const { kind } = args;
    const wanted = args.docs_id.toLowerCase();
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId, spec_id: wanted };
    const { current, found } = await readVersions(ctx, kind, projectId, wanted);
    const changed = current?.toLowerCase() !== wanted;
    if (changed) {
      if (kind === 'openapi') await activateOpenapiSpec(ctx, path);
      else await activateAsyncapiSpec(ctx, path);
    }
    const facts = found ?? (await readFacts(ctx, kind, wanted));
    const undoable = changed && current !== null;
    const data: SetActiveDocsData = {
      project_id: projectId,
      kind,
      docs_id: wanted,
      title: facts === undefined ? null : thirdParty(ctx, facts.title, TEXT_LIMIT),
      version: facts === undefined ? null : thirdParty(ctx, facts.version, TEXT_LIMIT),
      changed,
      previous_id: current,
      undoable,
    };
    return {
      status: 'done',
      data,
      ...(changed ? {} : { inert: true as const }),
      update: {
        // the state keeps the active OpenAPI documentation only
        ...(kind === 'openapi' ? { ids: { docs_id: wanted } } : {}),
        ...(undoable ? { log: { undo_args: { kind, docs_id: current } } } : {}),
      },
    };
  },
  render: renderSetActiveDocs,
});
