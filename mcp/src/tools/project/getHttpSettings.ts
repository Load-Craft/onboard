// `project_get_http_settings` (module project): Get the project's HTTP settings for generated tests:
// base URL, protocol options, default headers (values masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the
// view. The answer holds secrets (the values of the default headers, the password of a proxy): it is
// read through `callBackend`, which registers them, and only NAMES and plain numbers go into the
// data; the proxy host and user name are not read. The names, the user agent and the addresses pass
// the mask of a third party's text (`content`).
// Log: args "", result "base URL {base_url}": the data carries `base_url`.

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetHttpSettings,
  type HttpSettingsData,
} from '../../render/project/getHttpSettings.js';
import {
  address,
  callBackend,
  projectIdOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_GET_HTTP_SETTINGS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/project (REST API v1) */
export function getGatlingProject(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_gatling_project_api_v1_projects__project_id__gatling_project_get'>> {
  return callBackend(ctx, 'get_gatling_project_api_v1_projects__project_id__gatling_project_get', {
    path,
  });
}

const HEADERS_SHOWN = 30;

/** The boolean options of the protocol the data names when they are on. */
const FLAGS = [
  'async_name_resolution',
  'disable_auto_referer',
  'disable_caching',
  'disable_warm_up',
  'infer_html_resources',
  'per_user_name_resolution',
  'share_connections',
  'silent_resources',
] as const;

export const projectGetHttpSettings = moduleTool(PROJECT_GET_HTTP_SETTINGS, {
  title: "Get the project's HTTP settings for generated tests",
  // the catalog names no arguments: the project is the one this workspace works on
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const settings = await getGatlingProject(ctx, { project_id: projectId });
    const config = settings.protocol_config;
    const headerNames = Object.keys(settings.default_headers);
    const userAgent = config.user_agent_header;
    const data: HttpSettingsData = {
      project_id: projectId,
      base_url: address(ctx, settings.base_url),
      headers: headerNames.slice(0, HEADERS_SHOWN).map((name) => thirdParty(ctx, name, 100)),
      header_count: headerNames.length,
      protocol: {
        connection_timeout_ms: config.connection_timeout_ms ?? null,
        request_timeout_ms: config.request_timeout_ms ?? null,
        max_connections_per_host: config.max_connections_per_host ?? null,
        user_agent:
          userAgent === null || userAgent === undefined ? null : thirdParty(ctx, userAgent, 100),
        warm_up_url: address(ctx, config.warm_up_url),
        proxy:
          config.proxy_host === null || config.proxy_host === undefined || config.proxy_host === ''
            ? null
            : { type: config.proxy_type, port: config.proxy_port ?? null },
        no_proxy_count: config.no_proxy_for?.length ?? 0,
        silent_patterns_count: config.silent_uri_patterns?.length ?? 0,
        options_on: FLAGS.filter((flag) => config[flag]),
      },
      pause_distribution: settings.pause_distribution,
      pause_std_dev_percent: settings.normal_pause_std_dev_percent,
      think_time_ms: settings.think_time_ms,
      poll_max_iterations: settings.default_poll_max_iterations,
      probes_enabled: settings.probes_enabled,
      capture_request_bodies: settings.capture_request_bodies,
      capture_sample_percent: settings.capture_request_bodies_sample_percent,
      throttle_steps: settings.throttle_steps.length,
      global_assertions: settings.global_assertions.length,
      slo_tier: settings.assertion_threshold_view.effective_tier,
      scenarios_count: settings.scenarios_count,
      configurations_count: settings.configurations_count,
      feeders_count: settings.feeders_count,
      updated_at: settings.updated_at,
    };
    // an address the project has not set is not a hole in the template of the log
    const logValues = data.base_url === null ? { base_url: 'none' } : {};
    return { status: 'done', data, update: { log: { values: logValues } } };
  },
  render: renderGetHttpSettings,
});
