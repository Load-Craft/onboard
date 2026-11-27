// `project_set_http_settings` (module project): Set the project's HTTP settings for generated tests
// (created on first use).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Set the HTTP settings of generated tests", result "HTTP settings saved": the data of
// the result carries the fields.
// Consent: level 2, escalates to 3 (secret_ref) when an env file sets the default headers
// (docs/consent-card.md). The first call reads the settings (and the file) and makes the card; a
// repeat with the same arguments asks the person; only their yes sends the write: a PUT of what
// changed, or the setup of the settings when the project has none yet. The card shows the base URL and
// the protocol options (from -> to) and, for headers, the names, the size and the hash of the file,
// never a value. The protocol takes the options of the catalog without the proxy: a proxy change
// needs its credentials, and those do not pass through a model.
// Undo: this tool with the previous base URL and options; the values of headers are not read back
// (the backend masks them), nor is a project that had no settings.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSetHttpSettings,
  renderSetHttpSettings,
  type ChangedPart,
  type ProtocolChange,
  type SetHttpSettingsData,
  type SetHttpSettingsFacts,
} from '../../render/project/setHttpSettings.js';
import { ToolError } from '../../errors.js';
import { readEnvEntries } from '../../workspace/envFile.js';
import {
  address,
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getGatlingProject } from './getHttpSettings.js';
import { PROJECT_SET_HTTP_SETTINGS } from './meta.generated.js';

/** PUT /projects/{project_id}/gatling/project (REST API v1) */
export function updateGatlingProject(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'update_gatling_project_api_v1_projects__project_id__gatling_project_put'>,
): Promise<OpOutput<'update_gatling_project_api_v1_projects__project_id__gatling_project_put'>> {
  return callBackend(
    ctx,
    'update_gatling_project_api_v1_projects__project_id__gatling_project_put',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/setup (REST API v1) */
export function setupGatlingProject(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'setup_gatling_project_api_v1_projects__project_id__gatling_setup_post'>,
): Promise<OpOutput<'setup_gatling_project_api_v1_projects__project_id__gatling_setup_post'>> {
  return callBackend(ctx, 'setup_gatling_project_api_v1_projects__project_id__gatling_setup_post', {
    path,
    body,
  });
}

type Current = OpOutput<'get_gatling_project_api_v1_projects__project_id__gatling_project_get'>;
type ProtocolConfig = Current['protocol_config'];

const FLAGS = [
  'async_name_resolution',
  'disable_auto_referer',
  'disable_caching',
  'disable_warm_up',
  'http2_enabled',
  'http2_prior_knowledge',
  'infer_html_resources',
  'per_user_name_resolution',
  'share_connections',
  'silent_resources',
] as const;

const flag = z.boolean().optional();
const protocolInput = z.strictObject({
  async_name_resolution: flag,
  disable_auto_referer: flag,
  disable_caching: flag,
  disable_warm_up: flag,
  http2_enabled: flag,
  http2_prior_knowledge: flag,
  infer_html_resources: flag,
  per_user_name_resolution: flag,
  share_connections: flag,
  silent_resources: flag,
  connection_timeout_ms: z.number().int().min(1).max(3_600_000).nullable().optional(),
  request_timeout_ms: z.number().int().min(1).max(3_600_000).nullable().optional(),
  max_connections_per_host: z.number().int().min(1).max(100_000).nullable().optional(),
  user_agent_header: z.string().max(300).nullable().optional(),
});

type ProtocolArgs = z.infer<typeof protocolInput>;
type ProtocolValue = string | number | boolean | null;

/** The longest header value a setting holds, as the backend keeps it. */
const HEADER_VALUE_MAX = 8192;
const HEADERS_MAX = 20;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/u;
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'authorization',
]);
const NAMES_SHOWN = 20;
const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'u',
);

/** The defaults of the settings the backend creates on first use (its schema's own). */
const SETUP_DEFAULTS = {
  capture_request_bodies: false,
  capture_request_bodies_sample_percent: 10,
  default_poll_max_iterations: 30,
  normal_pause_std_dev_percent: 20,
  pause_distribution: 'uniform',
  probes_enabled: false,
  think_time_ms: 1000,
} as const;
const DEFAULT_PROTOCOL: ProtocolConfig = {
  async_name_resolution: false,
  disable_auto_referer: false,
  disable_caching: false,
  disable_warm_up: false,
  http2_enabled: false,
  http2_prior_knowledge: false,
  infer_html_resources: false,
  per_user_name_resolution: false,
  proxy_type: 'http',
  share_connections: false,
  silent_resources: false,
};

/** The settings of the project; null when it has none yet (the backend answers 404). */
async function currentSettings(ctx: CallContext, projectId: string): Promise<Current | null> {
  try {
    return await getGatlingProject(ctx, { project_id: projectId });
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return null;
    throw error;
  }
}

function checkBaseUrl(given: string): void {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    return refuseRule('http_settings_base_url');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    refuseRule('http_settings_base_url');
  }
}

/** The options the call sets, as (key, value) pairs in the order of the catalog. */
function protocolEntries(protocol: ProtocolArgs | undefined): [string, ProtocolValue][] {
  const given = (protocol ?? {}) as Readonly<Record<string, ProtocolValue | undefined>>;
  return Object.entries(given).flatMap(([key, value]): [string, ProtocolValue][] =>
    value === undefined ? [] : [[key, value]],
  );
}

const valueNow = (config: ProtocolConfig, key: string): ProtocolValue => {
  const value = (config as unknown as Readonly<Record<string, ProtocolValue | undefined>>)[key];
  return value ?? (FLAGS.some((flag) => flag === key) ? false : null);
};

const shown = (ctx: CallContext, key: string, value: ProtocolValue): string =>
  value === null
    ? 'none'
    : key === 'user_agent_header'
      ? thirdParty(ctx, String(value), 100)
      : String(value);

/** The env file of the call: read, every value registered as a secret, described by names and hash. */
async function prepareHeaders(ctx: ToolContext, given: string) {
  const read = await readEnvEntries(ctx.config.workspaceRoot, given, ctx.secrets);
  const names = [...read.entries.keys()];
  if (names.length === 0) refuseRule('http_settings_headers_empty');
  if (names.length > HEADERS_MAX) refuseRule('http_settings_headers_count');
  const headers: Record<string, string> = {};
  for (const [name, secret] of read.entries) {
    const value = secret.reveal();
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      refuseRule('http_settings_header_name');
    }
    if (CONTROL.test(value) || [...value].length > HEADER_VALUE_MAX) {
      refuseRule('http_settings_header_value');
    }
    headers[name] = value;
  }
  return {
    headers,
    facts: {
      path: thirdParty(ctx, read.shown, LIMITS.name),
      size: read.size,
      sha256: read.sha256,
      names: names.slice(0, NAMES_SHOWN).map((name) => thirdParty(ctx, name, 100)),
      count: names.length,
    },
  };
}

/** What the call changes in the protocol: the options whose value differs from the one now. */
function protocolChanges(
  ctx: CallContext,
  config: ProtocolConfig,
  protocol: ProtocolArgs | undefined,
): {
  changes: ProtocolChange[];
  values: Record<string, ProtocolValue>;
  before: Record<string, ProtocolValue>;
} {
  const changes: ProtocolChange[] = [];
  const values: Record<string, ProtocolValue> = {};
  const before: Record<string, ProtocolValue> = {};
  for (const [key, to] of protocolEntries(protocol)) {
    const from = valueNow(config, key);
    if (from === to) continue;
    changes.push({ key, from: shown(ctx, key, from), to: shown(ctx, key, to) });
    values[key] = to;
    before[key] = from;
  }
  return { changes, values, before };
}

export const projectSetHttpSettings = moduleTool(PROJECT_SET_HTTP_SETTINGS, {
  title: "Set the project's HTTP settings for generated tests",
  input: {
    base_url: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe('The base URL of the tested application.'),
    protocol: protocolInput
      .optional()
      .describe('Protocol options to change (no proxy credentials); the rest stays.'),
    headers_env_file: z
      .string()
      .min(1)
      .max(260)
      .optional()
      .describe(
        'An env file of the project directory whose KEY=VALUE lines become the default headers.',
      ),
  },
  async card(ctx, args) {
    if (
      args.base_url === undefined &&
      protocolEntries(args.protocol).length === 0 &&
      args.headers_env_file === undefined
    ) {
      refuseRule('http_settings_at_least_one');
    }
    if (args.base_url !== undefined) checkBaseUrl(args.base_url);
    const projectId = projectIdOf(ctx, undefined);
    const current = await currentSettings(ctx, projectId);
    const file =
      args.headers_env_file === undefined
        ? undefined
        : await prepareHeaders(ctx, args.headers_env_file);
    const config = current?.protocol_config ?? DEFAULT_PROTOCOL;
    const protocol = protocolChanges(ctx, config, args.protocol);
    const baseNow = current?.base_url ?? null;
    const baseChanged = args.base_url !== undefined && args.base_url.trim() !== (baseNow ?? '');
    if (current !== null && !baseChanged && protocol.changes.length === 0 && file === undefined) {
      const data: SetHttpSettingsData = {
        created: false,
        changed: [],
        base_url: address(ctx, baseNow),
        protocol: {},
        headers: null,
        undo: 'none',
      };
      return { unchanged: data };
    }
    const facts: SetHttpSettingsFacts = {
      created: current === null,
      ...(args.base_url !== undefined && (baseChanged || current === null)
        ? {
            base_url: {
              from: address(ctx, baseNow),
              to: address(ctx, args.base_url.trim()) ?? '',
            },
          }
        : {}),
      ...(protocol.changes.length === 0 ? {} : { protocol: protocol.changes }),
      ...(file === undefined
        ? {}
        : {
            headers: {
              ...file.facts,
              current: current === null ? 0 : Object.keys(current.default_headers).length,
            },
          }),
    };
    // default headers are secrets of the application: the escalation of the catalog entry (level 3)
    return file === undefined ? { facts } : { facts, escalation: 'secret_ref' };
  },
  cardView: cardViewSetHttpSettings,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const current = await currentSettings(ctx, projectId);
    const file =
      args.headers_env_file === undefined
        ? undefined
        : await prepareHeaders(ctx, args.headers_env_file);
    // the person said yes to the file the card showed: a file that changed since is a new card
    if (file !== undefined && file.facts.sha256 !== facts.headers?.sha256) {
      throw new ToolError('project_file_changed', { params: { file: file.facts.path } });
    }
    const config = current?.protocol_config ?? DEFAULT_PROTOCOL;
    const protocol = protocolChanges(ctx, config, args.protocol);
    const baseNow = current?.base_url ?? null;
    const base =
      args.base_url !== undefined && (current === null || args.base_url.trim() !== (baseNow ?? ''))
        ? args.base_url.trim()
        : undefined;
    const protocolConfig =
      protocol.changes.length === 0 && current !== null
        ? undefined
        : { ...config, ...protocol.values };
    if (current === null) {
      await setupGatlingProject(ctx, path, {
        ...SETUP_DEFAULTS,
        ...(base === undefined ? {} : { base_url: base }),
        ...(file === undefined ? {} : { default_headers: file.headers }),
        ...(protocolConfig === undefined ? {} : { protocol_config: protocolConfig }),
      });
    } else {
      await updateGatlingProject(ctx, path, {
        ...(base === undefined ? {} : { base_url: base }),
        ...(file === undefined ? {} : { default_headers: file.headers }),
        ...(protocolConfig === undefined ? {} : { protocol_config: protocolConfig }),
      });
    }
    const changed: ChangedPart[] = [
      ...(base === undefined ? [] : (['base_url'] as const)),
      ...(protocol.changes.length === 0 ? [] : (['protocol'] as const)),
      ...(file === undefined ? [] : (['headers'] as const)),
    ];
    const undoArgs: Record<string, unknown> = {
      undo_tool: 'project_set_http_settings',
      ...(base === undefined || baseNow === null || baseNow === '' ? {} : { base_url: baseNow }),
      ...(protocol.changes.length === 0 ? {} : { protocol: protocol.before }),
    };
    const restorable = current !== null && Object.keys(undoArgs).length > 1;
    // a previous value the secret mask would change is not kept: it would reach the state file
    const clean = !ctx.secrets.containsSecret(undoArgs);
    const data: SetHttpSettingsData = {
      created: current === null,
      changed,
      base_url: address(ctx, base ?? baseNow),
      protocol: Object.fromEntries(
        Object.entries(protocol.values).map(([key, value]) => [key, shown(ctx, key, value)]),
      ),
      headers: file === undefined ? null : { names: file.facts.names, count: file.facts.count },
      undo: !restorable ? 'none' : clean ? 'values' : 'withheld',
    };
    return {
      status: 'done',
      data,
      update: { log: { values: {}, ...(restorable && clean ? { undo_args: undoArgs } : {}) } },
    };
  },
  render: renderSetHttpSettings,
});
