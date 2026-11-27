// `project_get_envs` (module project): Get the project's environments: the list, or one
// (effective=true resolves inherited values). Header and variable values are masked.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The answers hold secrets (header and variable values, the settings of the authentication):
// they are read through `callBackend`, which registers them, and only NAMES go into the data. The
// names, the addresses and the kind of authentication are the project's own text and pass the mask
// of a third party's text (`content`); an address loses its credentials, query and fragment.
// Log: args "{env}", result "{count} environments": the log values and the data carry the fields.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { REDACTED } from '../../secret.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderGetEnvs,
  type EnvItem,
  type EnvName,
  type EnvsData,
} from '../../render/project/getEnvs.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_GET_ENVS } from './meta.generated.js';

/** GET /projects/{project_id}/environments (REST API v1) */
export function listProjectEnvironments(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_project_environments_api_v1_projects__project_id__environments_get'>,
): Promise<OpOutput<'list_project_environments_api_v1_projects__project_id__environments_get'>> {
  return callBackend(
    ctx,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/environments/default (REST API v1) */
export function getDefaultEnvironment(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'get_default_environment_api_v1_projects__project_id__environments_default_get'>
> {
  return callBackend(
    ctx,
    'get_default_environment_api_v1_projects__project_id__environments_default_get',
    { path },
  );
}

/** GET /projects/{project_id}/environments/{environment_id} (REST API v1) */
export function getEnvironment(
  ctx: CallContext,
  path: { readonly project_id: string; readonly environment_id: string },
): Promise<
  OpOutput<'get_environment_api_v1_projects__project_id__environments__environment_id__get'>
> {
  return callBackend(
    ctx,
    'get_environment_api_v1_projects__project_id__environments__environment_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/environments/{environment_id}/effective (REST API v1) */
export function getEffectiveEnvironment(
  ctx: CallContext,
  path: { readonly project_id: string; readonly environment_id: string },
): Promise<
  OpOutput<'get_effective_environment_api_v1_projects__project_id__environments__environment_id__effective_get'>
> {
  return callBackend(
    ctx,
    'get_effective_environment_api_v1_projects__project_id__environments__environment_id__effective_get',
    { path },
  );
}

type EnvironmentOp =
  'get_environment_api_v1_projects__project_id__environments__environment_id__get';
type EnvironmentRecord = OpOutput<EnvironmentOp>;
type EffectiveRecord =
  OpOutput<'get_effective_environment_api_v1_projects__project_id__environments__environment_id__effective_get'>;

/** The environments the data carries, the names kept of each list, and the longest text kept. */
const ENVS_SHOWN = 50;
const NAMES_SHOWN = 30;
const NAME_LIMIT = 100;
const KEYS_SHOWN = 20;

const ENV_ARGUMENT = /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;

/** An address as origin and path only (no credentials, query or fragment), masked, one line. */
function addressOf(ctx: CallContext, raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return thirdParty(ctx, `${url.origin}${path}`, LIMITS.url);
  } catch {
    return thirdParty(ctx, raw.split(/[?#]/u)[0] ?? '', LIMITS.url);
  }
}

function namesOf(
  ctx: CallContext,
  names: readonly { readonly name: string; readonly inherited?: boolean }[],
): { list: EnvName[]; count: number } {
  return {
    list: names.slice(0, NAMES_SHOWN).map((entry) => ({
      name: thirdParty(ctx, entry.name, NAME_LIMIT),
      ...(entry.inherited === undefined ? {} : { inherited: entry.inherited }),
    })),
    count: names.length,
  };
}

const plain = (keys: readonly string[]): { name: string }[] => keys.map((name) => ({ name }));

function keysOf(ctx: CallContext, record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record)
    .slice(0, KEYS_SHOWN)
    .map((key) => thirdParty(ctx, key, NAME_LIMIT));
}

/**
 * The kind of authentication as text. The effective answer keeps it under a field named `auth`, whose
 * credentials the secret mask registers; the type is a field naming a kind and stays readable. A type
 * the mask hides anyway comes back redacted: that is null, not a type.
 */
function shownType(ctx: CallContext, type: string): string | null {
  const shown = thirdParty(ctx, type, NAME_LIMIT);
  return shown === REDACTED ? null : shown;
}

function capsOf(caps: EnvironmentRecord['workload_caps']): EnvItem['caps'] {
  if (caps === null || caps === undefined) return null;
  const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { max_vu: number(caps['max_vu']), max_rps: number(caps['max_rps']) };
}

function itemOf(ctx: CallContext, env: EnvironmentRecord, currentId: string | undefined): EnvItem {
  const headers = namesOf(ctx, plain(Object.keys(env.default_headers)));
  const variables = namesOf(ctx, plain(Object.keys(env.variables)));
  return {
    id: env.id,
    name: thirdParty(ctx, env.name, NAME_LIMIT),
    base_url: addressOf(ctx, env.base_url),
    frontend_url:
      env.frontend_url === null || env.frontend_url === undefined
        ? null
        : addressOf(ctx, env.frontend_url),
    proxy: env.proxy_url !== null && env.proxy_url !== undefined && env.proxy_url !== '',
    is_default: env.is_default,
    is_active: env.is_active,
    protected: env.protected,
    caps: capsOf(env.workload_caps),
    current: env.id === currentId,
    parent_environment_id: env.parent_environment_id ?? null,
    auth: { type: shownType(ctx, env.auth_type), keys: keysOf(ctx, env.auth_config) },
    headers: headers.list,
    header_count: headers.count,
    variables: variables.list,
    variable_count: variables.count,
  };
}

function effectiveItemOf(
  ctx: CallContext,
  env: EffectiveRecord,
  currentId: string | undefined,
  isDefault: boolean | null,
): EnvItem {
  const headers = namesOf(ctx, env.headers);
  const variables = namesOf(ctx, env.variables);
  const inheritance = env.inheritance;
  const inherited =
    inheritance === undefined
      ? []
      : (['auth', 'base_url', 'frontend_url', 'proxy_url'] as const).filter(
          (field) => inheritance[field],
        );
  return {
    id: env.environment_id,
    name: thirdParty(ctx, env.name, NAME_LIMIT),
    base_url: addressOf(ctx, env.targets.api),
    frontend_url:
      env.targets.ui === null || env.targets.ui === undefined
        ? null
        : addressOf(ctx, env.targets.ui),
    proxy:
      env.targets.proxy !== null && env.targets.proxy !== undefined && env.targets.proxy !== '',
    // the effective answer carries no flags; the default is known when it was read as `default`
    is_default: isDefault,
    is_active: null,
    protected: null,
    caps: null,
    current: env.environment_id === currentId,
    parent_environment_id: inheritance?.parent_environment_id ?? null,
    auth: {
      type: shownType(ctx, env.auth.auth_type),
      keys: keysOf(ctx, env.auth.auth_config),
    },
    headers: headers.list,
    header_count: headers.count,
    variables: variables.list,
    variable_count: variables.count,
    inherited,
  };
}

export const projectGetEnvs = moduleTool(PROJECT_GET_ENVS, {
  title: "Get the project's environments",
  input: {
    env: z
      .string()
      .regex(ENV_ARGUMENT, 'env is an environment id (UUID) or "default"')
      .optional()
      .describe('One environment: its id, or "default" for the default one; without it, the list.'),
    effective: z
      .boolean()
      .default(false)
      .describe('true: values inherited from the parent environment are resolved (with env only).'),
  },
  async run(ctx, args) {
    if (args.effective && args.env === undefined) refuseRule('effective_without_env');
    const projectId = projectIdOf(ctx, undefined);
    const stateEnv = fromState(ctx, 'ids.env_id');
    const currentId = typeof stateEnv === 'string' ? stateEnv : undefined;
    const path = { project_id: projectId };
    const logValues = { env: args.env?.toLowerCase() ?? '' };

    let data: EnvsData;
    let defaultId: string | undefined;
    if (args.env === undefined) {
      const answer = await listProjectEnvironments(ctx, path);
      const environments = answer.items
        .slice(0, ENVS_SHOWN)
        .map((env) => itemOf(ctx, env, currentId));
      data = {
        mode: 'list',
        project_id: projectId,
        count: answer.items.length,
        shown: environments.length,
        environments,
      };
      defaultId = answer.items.find((env) => env.is_default)?.id;
    } else {
      const wanted = args.env.toLowerCase();
      // `default` is read first: the effective view and the state both need its id
      const record =
        wanted === 'default'
          ? await getDefaultEnvironment(ctx, path)
          : args.effective
            ? null
            : await getEnvironment(ctx, { ...path, environment_id: wanted });
      if (wanted === 'default' && record === null) {
        throw new ToolError('not_found', { params: { available: '' } });
      }
      if (args.effective) {
        const effective = await getEffectiveEnvironment(ctx, {
          ...path,
          environment_id: record?.id ?? wanted,
        });
        data = {
          mode: 'effective',
          project_id: projectId,
          count: 1,
          shown: 1,
          environments: [effectiveItemOf(ctx, effective, currentId, record?.is_default ?? null)],
        };
      } else if (record !== null) {
        data = {
          mode: 'one',
          project_id: projectId,
          count: 1,
          shown: 1,
          environments: [itemOf(ctx, record, currentId)],
        };
      } else {
        throw new ToolError('not_found', { params: { available: '' } });
      }
      defaultId = record?.is_default === true ? record.id : undefined;
    }
    return {
      status: 'done',
      data,
      update: {
        ...(defaultId === undefined ? {} : { ids: { env_id: defaultId } }),
        log: { values: logValues },
      },
    };
  },
  render: renderGetEnvs,
});
