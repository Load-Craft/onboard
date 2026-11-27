// The map LoadCraft draws of a project's API documentation: its title, how many operations it
// has and how they are grouped into areas. Only these three facts leave this file; the map also
// carries every operation with its cost in a prompt.

import { LoadcraftApiError } from '../http/apiError.js';
import { must, type ApiContext } from './context.js';

export interface ApiMap {
  /** Title of the API document; null when it has none. */
  readonly title: string | null;
  /** Operations of the specification, OPTIONS and HEAD not counted. */
  readonly operations: number;
  readonly areas: number;
}

/** `GET …/api-map`; null while the project has no specification to map (404). */
export async function getApiMap(api: ApiContext, projectId: string): Promise<ApiMap | null> {
  try {
    const data = await must(
      api.services.http.GET('/api/v1/projects/{project_id}/api-map', {
        params: { path: { project_id: projectId } },
        signal: api.signal,
      }),
    );
    return {
      title: data.title ?? null,
      operations: data.total_operations,
      areas: data.areas?.length ?? 0,
    };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return null;
    throw error;
  }
}
