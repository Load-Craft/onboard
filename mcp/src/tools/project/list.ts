// `project_list` (module project): List projects, or search projects, flows, scenarios and runs by
// text.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `query` the projects of the caller are listed (`is_active` narrows them); with it the
// backend searches projects, flows, load scenarios, runs and pages by a substring, across the
// caller's projects only. `is_active` with a query is refused locally (the search has no such
// filter). Names, descriptions, addresses and hits are texts a person wrote: they pass `content()`; a
// run hit is named by its handle. The project this workspace is bound to is marked.
// Log: args "{query}", result "{count} projects": the data carries `count`.
// Arguments (the catalog's): `query`, `is_active`, `limit`.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderProjectList,
  type ProjectListData,
  type ProjectRow,
  type SearchHit,
} from '../../render/project/list.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { handleOf } from '../run/common.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_LIST } from './meta.generated.js';

/** GET /projects (REST API v1) */
export function listProjects(
  ctx: CallContext,
  query?: QueryOf<'list_projects_api_v1_projects_get'>,
): Promise<OpOutput<'list_projects_api_v1_projects_get'>> {
  return callBackend(ctx, 'list_projects_api_v1_projects_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /search (REST API v1) */
export function searchDashboard(
  ctx: CallContext,
  query: QueryOf<'search_dashboard_api_v1_search_get'>,
): Promise<OpOutput<'search_dashboard_api_v1_search_get'>> {
  return callBackend(ctx, 'search_dashboard_api_v1_search_get', { query });
}

const NAME_LIMIT = 120;
const TEXT_LIMIT = 300;
const TYPES: ReadonlySet<string> = new Set(['api', 'frontend', 'both']);
const HITS: ReadonlySet<string> = new Set(['page', 'project', 'scenario', 'execution']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Project = OpOutput<'list_projects_api_v1_projects_get'>['projects'][number];
type Hit = OpOutput<'search_dashboard_api_v1_search_get'>['results'][number];

const text = (ctx: CallContext, value: string | null | undefined, max: number): string | null =>
  value === null || value === undefined || value === '' ? null : content(ctx, value, max);

function rowOf(ctx: CallContext, project: Project, current: string | null): ProjectRow {
  return {
    id: project.id,
    name: content(ctx, project.name, NAME_LIMIT),
    description: text(ctx, project.description, TEXT_LIMIT),
    type: TYPES.has(project.project_type) ? project.project_type : 'api',
    baseUrl: text(ctx, project.base_url, TEXT_LIMIT),
    active: project.is_active,
    flows: project.flows_count,
    testTypes: project.test_types_count,
    validators: project.validators_count,
    hasOpenapi: project.has_openapi_spec,
    hasAsyncapi: project.has_asyncapi_spec,
    updatedAt: project.updated_at,
    current: current !== null && project.id === current,
  };
}

function hitOf(ctx: CallContext, hit: Hit): SearchHit {
  return {
    type: HITS.has(hit.type) ? hit.type : 'other',
    title: content(ctx, hit.title, NAME_LIMIT),
    subtitle: text(ctx, hit.subtitle, TEXT_LIMIT),
    id: hit.id,
    run: hit.type === 'execution' && UUID.test(hit.id) ? handleOf(hit.id) : null,
    createdAt: hit.created_at ?? null,
  };
}

/** The project of this workspace, when it has one: no binding is not an error here. */
function currentProject(ctx: Parameters<typeof projectIdOf>[0]): string | null {
  try {
    return projectIdOf(ctx, undefined);
  } catch {
    return null;
  }
}

export const projectList = moduleTool(PROJECT_LIST, {
  title: 'List projects',
  input: {
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Search projects, flows, scenarios and runs by this text; without it, the list of projects.',
      ),
    is_active: z
      .boolean()
      .optional()
      .describe('Only active (true) or inactive (false) projects (the list, not the search).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('How many projects or search hits to return (1-100).'),
  },
  async run(ctx, args) {
    if (args.query !== undefined && args.is_active !== undefined) {
      throw new ToolError('invalid_arguments', {
        message: 'is_active narrows the list of projects, not a search: leave one of them out',
        params: { rule: 'list_active_with_query' },
      });
    }
    if (args.query !== undefined) {
      const query = args.query.trim();
      const answer = await searchDashboard(ctx, { q: query, limit: args.limit });
      const items = answer.results.slice(0, args.limit).map((hit) => hitOf(ctx, hit));
      const data: ProjectListData = {
        mode: 'search',
        query: content(ctx, query, NAME_LIMIT),
        count: answer.results.length,
        shown: items.length,
        limit: args.limit,
        items,
      };
      return { status: 'done', data };
    }
    const answer = await listProjects(ctx, {
      limit: args.limit,
      ...(args.is_active === undefined ? {} : { is_active: args.is_active }),
    });
    const current = currentProject(ctx);
    const items = answer.projects
      .slice(0, args.limit)
      .map((project) => rowOf(ctx, project, current));
    const data: ProjectListData = {
      mode: 'list',
      count: answer.total,
      shown: items.length,
      limit: args.limit,
      isActive: args.is_active ?? null,
      items,
    };
    return { status: 'done', data };
  },
  render: renderProjectList,
});
