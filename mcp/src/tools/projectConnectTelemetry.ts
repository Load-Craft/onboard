// `project_connect_telemetry`: connects the customer's log server as a source of evidence for the
// diagnosis. The server is probed from the LoadCraft side first (nothing is stored when it does not
// answer), then saved with the tools the backend will call.

import type { ToolContext } from '../context.js';
import * as z from 'zod';

import { getCompat } from '../api/status.js';
import {
  probeTelemetrySource,
  saveTelemetrySource,
  type TelemetryToolInfo,
} from '../api/telemetry.js';
import { ToolError } from '../errors.js';
import { LoadcraftApiError, quotesBackendText } from '../http/apiError.js';
import { defineTool } from '../registry.js';
import { inline } from '../render/primitives.js';
import {
  renderSetTelemetrySource,
  type TelemetryData,
  type TelemetryToolView,
} from '../render/views/setTelemetrySource.js';
import { createResolver } from '../resolve/handles.js';
import { content } from './moduleCall.js';

/** Longest backend sentence quoted back to the model. */
const DETAIL_LIMIT = 200;

const input = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('Short name of the log server, 1-60 characters.'),
  url: z
    .string()
    .describe(
      'Address (https) of the log server that speaks MCP over HTTP and is reachable from the ' +
        'internet; no sign-in details in the address.',
    ),
  enabled_tools: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Names of the server tools the diagnosis may call; default: every tool that needs only ' +
        'the start and end of the test.',
    ),
});

/** Rejects, before anything is sent, an address that carries sign-in details or is not https. */
function checkUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ToolError('telemetry_url_invalid', {
      message: 'The address is not a valid address.',
    });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ToolError('telemetry_url_credentials', {
      message: 'The address must not contain sign-in details.',
    });
  }
  // A secret may ride in the query or the fragment as well; the backend refuses both for the same reason.
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new ToolError('telemetry_url_query', {
      message: 'The address must not carry a query or a fragment.',
    });
  }
  if (parsed.protocol !== 'https:') {
    throw new ToolError('telemetry_url_scheme', { message: 'The address must use https.' });
  }
}

/** The tools of the view: what the server offers, then enabled names it does not offer. */
function toolViews(
  ctx: ToolContext,
  offered: readonly TelemetryToolInfo[],
  enabled: readonly string[],
): TelemetryToolView[] {
  const on = new Set(enabled);
  const known = new Set(offered.map((tool) => tool.name));
  const fromServer = offered.map((tool): TelemetryToolView => {
    const isOn = on.has(tool.name);
    return {
      // the telemetry server's names are a third party's text, shown masked (FIX-76)
      name: content(ctx, tool.name, 120),
      eligible: tool.eligible,
      enabled: isOn,
      ...(tool.eligible ? {} : { reason: 'extra_input' as const }),
    };
  });
  const missing = enabled
    .filter((name) => !known.has(name))
    .map((name): TelemetryToolView => ({
      name: content(ctx, name, 120),
      eligible: false,
      enabled: true,
      reason: 'not_offered',
    }));
  return [...fromServer, ...missing];
}

export const projectConnectTelemetry = defineTool({
  name: 'project_connect_telemetry',
  title: 'Connect a log server',
  description:
    "Connects the customer's log server (MCP over HTTP, reachable from the internet) as a source " +
    'of evidence for the diagnosis, and checks the connection. The backend calls only the tools ' +
    'whose required inputs are start and end, for the whole test plus two minutes on each side. ' +
    'Replaces the source the project had. A local (stdio) server cannot be used.',
  input,
  annotations: { idempotentHint: true },
  async run(ctx, args) {
    checkUrl(args.url);
    const url = args.url.trim();
    // Fails with `backend_too_old` before anything is stored on a server the plugin cannot work with.
    await getCompat(ctx);
    const { id } = await createResolver(ctx).project();
    let offered: TelemetryToolInfo[];
    try {
      offered = await probeTelemetrySource(ctx, id, url);
    } catch (error) {
      // 422: the address is refused (private network, not HTTP); 502: the server did not answer.
      if (error instanceof LoadcraftApiError && (error.status === 422 || error.status === 502)) {
        // A 502 carries the text of the log server's failure: not shown; only a 422 refusal is.
        const detail = quotesBackendText(error.status)
          ? inline(error.message, DETAIL_LIMIT)
          : ctx.t('error.detail.withheld');
        throw new ToolError('telemetry_unreachable', {
          message: 'LoadCraft could not reach the log server.',
          params: { detail },
          cause: error,
        });
      }
      throw error;
    }
    const requested =
      args.enabled_tools === undefined ? undefined : [...new Set(args.enabled_tools)];
    const enabled = requested ?? offered.filter((tool) => tool.eligible).map((tool) => tool.name);
    await saveTelemetrySource(ctx, id, { label: args.label, url, enabledTools: enabled });
    const data: TelemetryData = {
      label: args.label,
      connected: true,
      tools: toolViews(ctx, offered, enabled),
      window: 'whole_run_±120s',
    };
    return { status: 'done', data };
  },
  render: renderSetTelemetrySource,
});
