// Finding and creating a project by name, for `project_create`. The project name is unique in the
// whole LoadCraft instance, compared exactly (case included) by the create route; the search box
// matches substrings without case, so an exact match is picked here.

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import type { Named } from './lookup.js';

/** Most results `GET /api/v1/search` returns (`limit: int = Query(20, ge=1, le=50)`, `dashboard.py:429`). */
const SEARCH_LIMIT = 50;
/** Longest query the search accepts (`q: str = Query(min_length=1, max_length=100)`, `dashboard.py:428`). */
const SEARCH_QUERY_MAX = 100;

/** Text of the create route's refusal of a taken name (`projects.py:337-342`, 400 `{detail}`). */
const NAME_TAKEN = /already exists/i;

/**
 * Projects whose name or description contains `name` (any case), the newest `SEARCH_LIMIT` hits;
 * the caller picks the exact name. A name longer than the search accepts is searched by its first
 * characters: a substring still hits.
 */
export async function searchProjects(api: ApiContext, name: string): Promise<Named[]> {
  const data = await must(
    api.services.http.GET('/api/v1/search', {
      params: { query: { q: name.slice(0, SEARCH_QUERY_MAX), limit: SEARCH_LIMIT } },
      signal: api.signal,
    }),
  );
  return data.results
    .filter((item) => item.type === 'project')
    .map((item) => ({ id: item.id, name: item.title }));
}

/** The project, or null when LoadCraft no longer has it (404). */
export async function findProject(api: SecretApiContext, projectId: string): Promise<Named | null> {
  try {
    const data = await callOperation(
      api.services.http,
      'get_project_api_v1_projects__project_id__get',
      {
        path: { project_id: projectId },
      },
      { signal: api.signal, secrets: api.secrets },
    );
    return { id: data.id, name: data.name };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return null;
    throw error;
  }
}

export interface NewProject {
  readonly name: string;
  readonly description?: string;
  /** The first environment; the backend creates it as the project's default. */
  readonly environment: {
    readonly name: string;
    readonly baseUrl: string;
    readonly frontendUrl?: string;
  };
}

/**
 * `POST /api/v1/projects` with the first, default environment. The client always sends the API
 * token, so the token's principal becomes the owner. A taken name is `project_name_taken`.
 */
export async function createProject(api: SecretApiContext, project: NewProject): Promise<Named> {
  try {
    const data = await callOperation(
      api.services.http,
      'create_project_api_v1_projects_post',
      {
        body: {
          name: project.name,
          ...(project.description === undefined ? {} : { description: project.description }),
          project_type: 'api',
          environment_name: project.environment.name,
          base_url: project.environment.baseUrl,
          ...(project.environment.frontendUrl === undefined
            ? {}
            : { frontend_url: project.environment.frontendUrl }),
        },
      },
      { signal: api.signal, secrets: api.secrets },
    );
    return { id: data.id, name: data.name };
  } catch (error) {
    if (
      error instanceof LoadcraftApiError &&
      error.status === 400 &&
      NAME_TAKEN.test(error.message)
    ) {
      throw new ToolError('project_name_taken', { params: { name: project.name }, cause: error });
    }
    throw error;
  }
}
