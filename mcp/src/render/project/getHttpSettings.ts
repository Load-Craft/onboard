// The view of `project_get_http_settings`: the base URL, the names of the fixed headers (never
// their values), the protocol options, the pauses and the capture settings of the project. The
// texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface ProtocolView {
  readonly connection_timeout_ms: number | null;
  readonly request_timeout_ms: number | null;
  readonly max_connections_per_host: number | null;
  readonly user_agent: string | null;
  readonly warm_up_url: string | null;
  /** The proxy kind and port; its host, user name and password are never read. */
  readonly proxy: { readonly type: string; readonly port: number | null } | null;
  readonly no_proxy_count: number;
  readonly silent_patterns_count: number;
  /** The names of the options that are switched on. */
  readonly options_on: readonly string[];
}

export interface HttpSettingsData {
  readonly project_id: string;
  readonly base_url: string | null;
  /** The names of the fixed headers (at most 30). */
  readonly headers: readonly string[];
  readonly header_count: number;
  readonly protocol: ProtocolView;
  readonly pause_distribution: string;
  readonly pause_std_dev_percent: number;
  readonly think_time_ms: number;
  readonly poll_max_iterations: number;
  readonly probes_enabled: boolean;
  readonly capture_request_bodies: boolean;
  readonly capture_sample_percent: number;
  readonly throttle_steps: number;
  readonly global_assertions: number;
  readonly slo_tier: string;
  readonly scenarios_count: number;
  readonly configurations_count: number;
  readonly feeders_count: number;
  readonly updated_at: string | null;
}

function protocolLine(protocol: ProtocolView, t: Translator): string | undefined {
  const parts: string[] = [];
  if (protocol.request_timeout_ms !== null) {
    parts.push(t('project_get_http_settings.request_timeout', { ms: protocol.request_timeout_ms }));
  }
  if (protocol.connection_timeout_ms !== null) {
    parts.push(
      t('project_get_http_settings.connection_timeout', { ms: protocol.connection_timeout_ms }),
    );
  }
  if (protocol.max_connections_per_host !== null) {
    parts.push(
      t('project_get_http_settings.max_connections', { count: protocol.max_connections_per_host }),
    );
  }
  if (protocol.user_agent !== null) {
    parts.push(t('project_get_http_settings.user_agent', { value: protocol.user_agent }));
  }
  if (protocol.warm_up_url !== null) {
    parts.push(t('project_get_http_settings.warm_up', { url: protocol.warm_up_url }));
  }
  if (protocol.proxy !== null) {
    parts.push(
      t('project_get_http_settings.proxy', {
        type: protocol.proxy.type,
        port: protocol.proxy.port === null ? '-' : String(protocol.proxy.port),
      }),
    );
  }
  return parts.length === 0
    ? undefined
    : t('project_get_http_settings.protocol', { parts: parts.join(', ') });
}

export function renderGetHttpSettings(data: HttpSettingsData, t: Translator): string {
  const lines = [
    t('project_get_http_settings.header'),
    data.base_url === null
      ? t('project_get_http_settings.no_base_url')
      : t('project_get_http_settings.base_url', { url: data.base_url }),
  ];
  if (data.header_count > 0) {
    const rest = data.header_count - data.headers.length;
    lines.push(
      t('project_get_http_settings.headers', {
        count: data.header_count,
        names: `${data.headers.join(', ')}${rest > 0 ? ` (+${String(rest)})` : ''}`,
      }),
    );
  } else {
    lines.push(t('project_get_http_settings.no_headers'));
  }
  const protocol = protocolLine(data.protocol, t);
  if (protocol !== undefined) lines.push(protocol);
  if (data.protocol.options_on.length > 0) {
    lines.push(
      t('project_get_http_settings.options_on', { names: data.protocol.options_on.join(', ') }),
    );
  }
  lines.push(
    t('project_get_http_settings.pauses', {
      distribution: data.pause_distribution,
      think: data.think_time_ms,
      deviation: data.pause_std_dev_percent,
      polls: data.poll_max_iterations,
    }),
    t('project_get_http_settings.capture', {
      probes: t(
        data.probes_enabled ? 'project_get_http_settings.on' : 'project_get_http_settings.off',
      ),
      bodies: t(
        data.capture_request_bodies
          ? 'project_get_http_settings.on'
          : 'project_get_http_settings.off',
      ),
      sample: data.capture_sample_percent,
    }),
    t('project_get_http_settings.limits', {
      throttle: data.throttle_steps,
      assertions: data.global_assertions,
      tier: data.slo_tier,
    }),
    t('project_get_http_settings.counts', {
      scenarios: data.scenarios_count,
      configurations: data.configurations_count,
      feeders: data.feeders_count,
    }),
  );
  return lines.join('\n');
}
