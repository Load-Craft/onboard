// `project_disconnect_telemetry` (module project): Disconnect the project's log server.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Disconnect the log server", result "disconnected": the data of the result carries the
// fields.
// Consent: level 3, `delete` (docs/consent-card.md). The first call reads the connected log server and
// makes the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// No log server connected: nothing to ask and nothing sent. Nothing is sent while an operation of
// this workspace still runs on the project (`delete_busy`): an analysis may be reading that server.
// The card names the server (its label and the host of its address: the path and the query may carry a token). No undo is kept: connecting
// again needs credentials, which the log does not keep (`project_connect_telemetry`).

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewDisconnectTelemetry,
  renderDisconnectTelemetry,
  type DisconnectTelemetryData,
  type DisconnectTelemetryFacts,
} from '../../render/project/disconnectTelemetry.js';
import { busy, liveOperation } from '../delete/checks.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_DISCONNECT_TELEMETRY } from './meta.generated.js';

/** DELETE /projects/{project_id}/telemetry-source (REST API v1) */
export function deleteTelemetrySource(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'delete_telemetry_source_api_v1_projects__project_id__telemetry_source_delete'>
> {
  return callBackend(
    ctx,
    'delete_telemetry_source_api_v1_projects__project_id__telemetry_source_delete',
    { path },
  );
}

/** GET /projects/{project_id}/telemetry-source (REST API v1) */
export function getTelemetrySource(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_telemetry_source_api_v1_projects__project_id__telemetry_source_get'>> {
  return callBackend(
    ctx,
    'get_telemetry_source_api_v1_projects__project_id__telemetry_source_get',
    {
      path,
    },
  );
}

/** The host of the address: the path and the query may carry a token, so they are never shown. */
function hostOf(ctx: CallContext, raw: string): string | null {
  try {
    return thirdParty(ctx, new URL(raw).host, LIMITS.label);
  } catch {
    return null;
  }
}

export const projectDisconnectTelemetry = moduleTool(PROJECT_DISCONNECT_TELEMETRY, {
  title: "Disconnect the project's log server",
  input: {},
  async card(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const { telemetry_source: source } = await getTelemetrySource(ctx, { project_id: projectId });
    if (source === null || source === undefined) {
      const data: DisconnectTelemetryData = { disconnected: false, label: null, host: null };
      return { unchanged: data };
    }
    const label = thirdParty(ctx, source.label, LIMITS.label);
    const operation = liveOperation(ctx, projectId);
    if (operation !== undefined) throw busy(operation, `log server "${label}"`);
    const facts: DisconnectTelemetryFacts = {
      label,
      host: hostOf(ctx, source.url),
      tools: source.enabled_tools?.length ?? 0,
    };
    return { facts };
  },
  cardView: cardViewDisconnectTelemetry,
  async run(ctx, _args, facts) {
    await deleteTelemetrySource(ctx, { project_id: projectIdOf(ctx, undefined) });
    const data: DisconnectTelemetryData = {
      disconnected: true,
      label: facts.label,
      host: facts.host,
    };
    return { status: 'done', data, update: { log: { values: {} } } };
  },
  render: renderDisconnectTelemetry,
});
