// The view of `project_get_envs`: one block per environment, its flags in brackets, then the names
// of its fixed headers and variables and the kind of its authentication. Values are never in the
// data, so the view cannot show one. The texts arrive made one line and masked by the tool
// (`content` of tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

/** The name of a header or a variable; `inherited` only in the effective view. */
export interface EnvName {
  readonly name: string;
  readonly inherited?: boolean;
}

export interface EnvAuth {
  /**
   * The kind of authentication (`none`, `bearer`, …); null when the secret mask hides it. The keys of
   * its settings, never their values.
   */
  readonly type: string | null;
  readonly keys: readonly string[];
}

export interface EnvCaps {
  readonly max_vu: number | null;
  readonly max_rps: number | null;
}

export interface EnvItem {
  readonly id: string;
  readonly name: string;
  readonly base_url: string;
  readonly frontend_url: string | null;
  /** Whether a proxy is set; its address is not read. */
  readonly proxy: boolean;
  /** `null` where the answer does not say (the effective view carries no flags). */
  readonly is_default: boolean | null;
  readonly is_active: boolean | null;
  readonly protected: boolean | null;
  readonly caps: EnvCaps | null;
  /** The environment of the state (`ids.env_id`). */
  readonly current: boolean;
  readonly parent_environment_id: string | null;
  readonly auth: EnvAuth;
  readonly headers: readonly EnvName[];
  readonly header_count: number;
  readonly variables: readonly EnvName[];
  readonly variable_count: number;
  /** The settings taken from the parent, in the effective view only. */
  readonly inherited?: readonly string[];
}

export interface EnvsData {
  readonly mode: 'list' | 'one' | 'effective';
  readonly project_id: string;
  /** How many environments the project has (1 for one). */
  readonly count: number;
  /** How many of them the data carries. */
  readonly shown: number;
  readonly environments: readonly EnvItem[];
}

function flagsOf(item: EnvItem, t: Translator): string {
  const flags: string[] = [];
  if (item.is_default === true) flags.push(t('project_get_envs.flag.default'));
  if (item.current) flags.push(t('project_get_envs.flag.current'));
  if (item.is_active === false) flags.push(t('project_get_envs.flag.inactive'));
  if (item.protected === true) {
    const caps = item.caps;
    flags.push(
      caps === null || caps.max_vu === null || caps.max_rps === null
        ? t('project_get_envs.flag.protected')
        : t('project_get_envs.flag.protected_caps', { vu: caps.max_vu, rps: caps.max_rps }),
    );
  }
  return flags.length === 0 ? '' : ` (${flags.join(', ')})`;
}

function namesOf(names: readonly EnvName[], total: number, t: Translator): string {
  const listed = names.map((entry) =>
    entry.inherited === true ? `${entry.name} ${t('project_get_envs.inherited_mark')}` : entry.name,
  );
  const rest = total - names.length;
  return rest > 0
    ? `${listed.join(', ')} ${t('project_get_envs.names_more', { count: rest })}`
    : listed.join(', ');
}

/** The lines of one environment; the first carries the name unless the header already does. */
function itemLines(item: EnvItem, t: Translator, prefix: string, single = false): string[] {
  const lines = [`${prefix}${item.name}${flagsOf(item, t)} ${item.base_url}`];
  const detail = (text: string): void => {
    lines.push(`   ${text}`);
  };
  if (item.frontend_url !== null) {
    detail(t('project_get_envs.frontend', { url: item.frontend_url }));
  }
  if (item.header_count > 0) {
    detail(t('project_get_envs.headers', { names: namesOf(item.headers, item.header_count, t) }));
  }
  if (item.variable_count > 0) {
    detail(
      t('project_get_envs.variables', {
        names: namesOf(item.variables, item.variable_count, t),
      }),
    );
  }
  const { type, keys } = item.auth;
  if (type === 'none' && keys.length === 0 && single) {
    // one environment shown: no authentication is a fact to state, not a line to leave out
    detail(t('project_get_envs.auth_none'));
  } else if (type !== null && type !== 'none' && keys.length === 0) {
    detail(t('project_get_envs.auth', { type }));
  } else if (keys.length > 0) {
    detail(
      t('project_get_envs.auth_keys', {
        type: type ?? t('project_get_envs.auth_set'),
        keys: keys.join(', '),
      }),
    );
  }
  if (item.inherited !== undefined && item.inherited.length > 0) {
    detail(t('project_get_envs.inherited', { fields: item.inherited.join(', ') }));
  }
  if (item.parent_environment_id !== null) {
    detail(t('project_get_envs.parent', { id: item.parent_environment_id }));
  }
  return lines;
}

export function renderGetEnvs(data: EnvsData, t: Translator): string {
  const [only] = data.environments;
  if (data.mode !== 'list') {
    if (only === undefined) return t('project_get_envs.empty');
    return [
      t(data.mode === 'effective' ? 'project_get_envs.one_effective' : 'project_get_envs.one', {
        name: only.name,
      }),
      ...itemLines(only, t, '', true),
      t('project_get_envs.footer'),
    ].join('\n');
  }
  if (data.count === 0) return t('project_get_envs.empty');
  const lines = [t.plural('project_get_envs.header', data.count)];
  data.environments.forEach((item, index) => {
    lines.push(...itemLines(item, t, `${String(index + 1)}. `));
  });
  if (data.shown < data.count) {
    lines.push(t('project_get_envs.more', { shown: data.shown, total: data.count }));
  }
  lines.push(t('project_get_envs.footer'));
  return lines.join('\n');
}
