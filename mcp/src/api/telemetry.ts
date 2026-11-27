// Reads and writes behind `project_connect_telemetry`: the connection test of a log server and the
// project's telemetry source. Each answer is narrowed to what the tool shows.

import { must, type ApiContext } from './context.js';

/** A tool of the customer's log server, as the connection test lists it. */
export interface TelemetryToolInfo {
  readonly name: string;
  /**
   * True when the backend can call the tool on its own: its only required inputs are `start`
   * and `end`, the window of the run (`window_tool`).
   */
  readonly eligible: boolean;
}

export interface TelemetrySourceInput {
  readonly label: string;
  readonly url: string;
  readonly enabledTools: readonly string[];
}

/**
 * Connects to the log server from the LoadCraft side and lists its tools; nothing is stored.
 * The backend answers 422 for an address its network guard refuses and 502 when the server
 * cannot be reached.
 */
export async function probeTelemetrySource(
  api: ApiContext,
  projectId: string,
  url: string,
): Promise<TelemetryToolInfo[]> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/telemetry-source/test', {
      params: { path: { project_id: projectId } },
      body: { url },
      signal: api.signal,
    }),
  );
  return (data.tools ?? []).map((tool) => ({ name: tool.name, eligible: tool.window_tool }));
}

/** Replaces the project's telemetry source; the backend keeps one per project. */
export async function saveTelemetrySource(
  api: ApiContext,
  projectId: string,
  source: TelemetrySourceInput,
): Promise<void> {
  await must(
    api.services.http.PUT('/api/v1/projects/{project_id}/telemetry-source', {
      params: { path: { project_id: projectId } },
      body: {
        kind: 'mcp',
        label: source.label,
        url: source.url,
        enabled_tools: [...source.enabledTools],
      },
      signal: api.signal,
    }),
  );
}
