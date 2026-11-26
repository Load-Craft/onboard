// The environments of a project as the project tools take them: the input of one environment and
// of its fixed headers, the plan checked before anything is sent, the values of the headers read
// from the env file, and the writes that bring LoadCraft to the plan. Every step first looks at
// what is already there, so a repeated call finishes the work instead of doing it twice: a
// duplicated environment cannot be repaired through the API. A fixed header of an environment (a
// key the application wants in every request) is given as the name of the header and the variable
// of the env file that holds its value; the value is read here, masked, and sent to LoadCraft, and
// appears in no result, log or file.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import {
  createEnvironment,
  listEnvironmentRecords,
  MASKED_VALUE,
  protectEnvironment,
  setDefaultEnvironment,
  setEnvironmentHeaders,
  type Caps,
  type EnvironmentRecord,
  type HeaderToSet,
} from '../../api/environments.js';
import { inline } from '../../render/primitives.js';
import type { EnvironmentDiff } from '../../render/views/projectSetup.js';
import { readEnvValues } from '../../workspace/envFile.js';

/** Said when an environment carries a field the tool does not know (`protected`, `limits`, …). */
const LIMIT_HINT =
  'use limit: [max virtual users, max requests per second] to protect an environment, ' +
  'headers: [{ name, from_env }] for a fixed header';
/** Said when a header carries a field the tool does not know (a value written in the call). */
const HEADER_HINT =
  'a header takes name and from_env only; a header value is never passed in the call: put it ' +
  'in the env file and give the name of its variable in from_env';

/**
 * An object that refuses fields it does not know: the error names each field and what to use
 * instead. A dropped field would leave an environment without its protection and report success.
 */
export function strictFields<T extends z.ZodRawShape>(hint: string, shape: T) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Unknown field ${issue.keys.map((key) => `"${key}"`).join(', ')}: ${hint}`
        : undefined,
  });
}

/** Longest header value sent; the backend stores it as it is. */
const HEADER_VALUE_MAX = 8192;
/** The names the backend keeps as written (`SAFE_HEADER_KEY_RE`, `codegen/validation.py:23` @ d93e08d80): others are rewritten. */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
/** Set by the HTTP client or the transport, or the way a test account signs in; never a fixed header. */
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'authorization',
]);
const ENV_VARIABLE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const headerInput = strictFields(HEADER_HINT, {
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Header name, e.g. x-api-key (letters, digits, hyphens).'),
  from_env: z
    .string()
    .trim()
    .regex(ENV_VARIABLE, 'from_env is the name of a variable in the env file, e.g. STORE_API_KEY')
    .max(200)
    .describe(
      'Name of the variable in the env file that holds the value. The value is read from the ' +
        'file, never from the call, and never shown.',
    ),
});

export const environmentInput = strictFields(LIMIT_HINT, {
  name: z.string().trim().min(1).max(100).describe('Environment name, unique in the project.'),
  api: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('API address, http(s); a bare host such as api.perf.example.com gets https://.'),
  frontend: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe('Address a person opens in the browser, if the application has a frontend.'),
  default: z
    .boolean()
    .optional()
    .describe(
      'Make this the default environment; at most one may be marked (none marked: the default ' +
        'stays where it is).',
    ),
  limit: z
    .array(z.number().int().min(1))
    .length(2)
    .optional()
    .describe(
      '[max virtual users, max requests per second]. Makes the environment protected: ' +
        'LoadCraft cuts every test on it down to these limits.',
    ),
  headers: z
    .array(headerInput)
    .max(20)
    .optional()
    .describe(
      'Fixed headers LoadCraft sends in every request to this environment, when the ' +
        'documentation requires one (an API key) or the connection test answers 400/401 without ' +
        'it. Each is { name, from_env: VARIABLE }. Ask the user for the variable name, never for ' +
        'the value. The call sets the headers of the environment to these (it replaces the set).',
    ),
});

export type EnvironmentInput = z.infer<typeof environmentInput>;

/** Connection tests running at the same time. */
export const PROBES_AT_ONCE = 4;

/** One requested environment, validated and with normalized addresses. */
export interface PlannedEnvironment {
  readonly name: string;
  readonly baseUrl: string;
  readonly frontendUrl?: string;
  readonly isDefault: boolean;
  readonly limit?: { readonly maxVu: number; readonly maxRps: number };
  /** The fixed headers as requested: the name and the variable, in the order of the call. */
  readonly headerRefs: readonly { readonly name: string; readonly variable: string }[];
  /** The same with their values, read from the env file (empty until `withHeaderValues`). */
  readonly headers: readonly HeaderToSet[];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `https://host/` → `https://host`: the form the backend stores and the sklep world uses. */
function canonical(url: URL): string {
  const { href } = url;
  return href.endsWith('/') && url.search === '' && url.hash === '' ? href.slice(0, -1) : href;
}

/**
 * An http(s) address; a bare host gets `https://`. User name and password in the address are
 * refused: the backend masks them on read, and the result of this tool would carry them.
 * The error names the field, never the value.
 */
export function address(raw: string, environment: string, field: 'api' | 'frontend'): string {
  const text = raw.trim();
  const invalid = () =>
    new ToolError('init_project_address_invalid', { params: { environment, field } });
  let url: URL;
  try {
    url = new URL(SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    throw invalid();
  }
  const http = url.protocol === 'http:' || url.protocol === 'https:';
  if (!http || url.hostname === '' || url.username !== '' || url.password !== '') throw invalid();
  return canonical(url);
}

/** The same address written two ways (case of the host, trailing slash) compares equal. */
function sameAddress(stored: string | null, requested: string): boolean {
  if (stored === null) return false;
  try {
    return canonical(new URL(stored)) === requested;
  } catch {
    return stored === requested;
  }
}

/** Validates the environments before anything is sent: names, one default, addresses. */
export function planEnvironments(environments: readonly EnvironmentInput[]): PlannedEnvironment[] {
  const seen = new Set<string>();
  for (const environment of environments) {
    if (seen.has(environment.name)) {
      throw new ToolError('init_project_environment_repeated', {
        params: { name: environment.name },
      });
    }
    seen.add(environment.name);
  }
  const defaults = environments.filter((environment) => environment.default === true);
  if (defaults.length > 1) {
    throw new ToolError('init_project_default_repeated', {
      params: { names: defaults.map((environment) => environment.name).join(', ') },
    });
  }
  // None marked: the default stays where it is (the environment the project was created with, or
  // the one a person chose since); it never moves without being asked for.
  const chosen = defaults[0]?.name;
  return environments.map((environment) => {
    const [maxVu, maxRps] = environment.limit ?? [];
    return {
      name: environment.name,
      baseUrl: address(environment.api, environment.name, 'api'),
      ...(environment.frontend === undefined
        ? {}
        : { frontendUrl: address(environment.frontend, environment.name, 'frontend') }),
      isDefault: environment.name === chosen,
      ...(maxVu === undefined || maxRps === undefined ? {} : { limit: { maxVu, maxRps } }),
      headerRefs: planHeaders(environment.name, environment.headers ?? []),
      headers: [],
    };
  });
}

/** Names checked before anything is sent; an error names the header, never a value. */
function planHeaders(
  environment: string,
  headers: readonly { name: string; from_env: string }[],
): { name: string; variable: string }[] {
  const seen = new Set<string>();
  return headers.map((header) => {
    const lower = header.name.toLowerCase();
    if (!HEADER_NAME.test(header.name) || RESERVED_HEADERS.has(lower)) {
      throw new ToolError('init_project_header_name_invalid', {
        params: { environment, name: inline(header.name, 100) },
      });
    }
    if (seen.has(lower)) {
      throw new ToolError('init_project_header_repeated', {
        params: { environment, name: header.name },
      });
    }
    seen.add(lower);
    return { name: header.name, variable: header.from_env };
  });
}

function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reads the value of every requested header from the env file (once, and only when a header is
 * requested) before anything is written: a missing variable stops the call with nothing sent. The
 * values are registered with the secret scope, so no output of the call can carry them.
 */
export async function withHeaderValues(
  ctx: ToolContext,
  file: string,
  planned: readonly PlannedEnvironment[],
): Promise<PlannedEnvironment[]> {
  const variables = [
    ...new Set(planned.flatMap((environment) => environment.headerRefs.map((ref) => ref.variable))),
  ];
  if (variables.length === 0) return [...planned];
  const { values, shown } = await readEnvValues(
    ctx.config.workspaceRoot,
    file,
    variables,
    ctx.secrets,
  );
  return planned.map((environment) => ({
    ...environment,
    headers: environment.headerRefs.map((ref) => {
      const value = values.get(ref.variable);
      if (value === undefined) {
        throw new ToolError('init_project_header_variable_missing', {
          params: {
            environment: environment.name,
            name: ref.name,
            variable: ref.variable,
            file: shown,
          },
        });
      }
      const text = value.reveal();
      if (hasControlCharacter(text) || [...text].length > HEADER_VALUE_MAX) {
        throw new ToolError('init_project_header_value_invalid', {
          params: { variable: ref.variable, file: shown },
        });
      }
      return { name: ref.name, value };
    }),
  }));
}

const limitOf = (planned: PlannedEnvironment): Caps | null => planned.limit ?? null;

function storedLimit(record: EnvironmentRecord): Caps | null {
  return record.protected ? record.caps : null;
}

function sameLimit(a: Caps | null, b: Caps | null): boolean {
  if (a === null || b === null) return a === b;
  return a.maxVu === b.maxVu && a.maxRps === b.maxRps;
}

/** What differs between the stored environment and the request; LoadCraft keeps its values. */
function differences(record: EnvironmentRecord, planned: PlannedEnvironment): EnvironmentDiff[] {
  const diffs: EnvironmentDiff[] = [];
  if (!sameAddress(record.baseUrl, planned.baseUrl)) {
    diffs.push({ field: 'api', current: record.baseUrl, requested: planned.baseUrl });
  }
  if (planned.frontendUrl !== undefined && !sameAddress(record.frontendUrl, planned.frontendUrl)) {
    diffs.push({ field: 'frontend', current: record.frontendUrl, requested: planned.frontendUrl });
  }
  const current = storedLimit(record);
  const requested = limitOf(planned);
  if (!sameLimit(current, requested)) diffs.push({ field: 'limit', current, requested });
  return diffs;
}

export interface EnvironmentState {
  readonly record: EnvironmentRecord;
  readonly created: boolean;
  /** The protection was set or tightened by this call. */
  readonly protectionSet: boolean;
  readonly differs: readonly EnvironmentDiff[];
}

/**
 * The limit to set so the environment is at least as strict as requested, or null when it already
 * is. A tighter protection is always safe to apply, so it is applied to every environment of the
 * request, one created by this call or not. Each limit is the lower of the stored and the
 * requested one: a protection is never loosened here (a looser request is only reported).
 */
function strictest(record: EnvironmentRecord, limit: Required<Caps>): Required<Caps> | null {
  const stored = record.protected ? record.caps : {};
  const target = {
    maxVu: Math.min(limit.maxVu, stored.maxVu ?? limit.maxVu),
    maxRps: Math.min(limit.maxRps, stored.maxRps ?? limit.maxRps),
  };
  return record.protected && sameLimit(stored, target) ? null : target;
}

/**
 * Brings the protection of an environment up to the requested limit (the project request has no
 * fields for protection, so the environment created with the project needs this too). What the
 * backend answers is checked and a failed write is the named error: the environment is then left
 * without the protection, and the text says so.
 */
async function tighten(
  ctx: ToolContext,
  projectId: string,
  planned: PlannedEnvironment,
  state: EnvironmentState,
): Promise<EnvironmentState> {
  if (planned.limit === undefined) return state;
  const target = strictest(state.record, planned.limit);
  if (target === null) return state;
  const notProtected = () =>
    new ToolError('init_project_environment_not_protected', {
      params: { environment: planned.name },
    });
  let record: EnvironmentRecord;
  try {
    record = await protectEnvironment(ctx, projectId, state.record.id, target);
  } catch (error) {
    if (ctx.signal.aborted || !(error instanceof ToolError)) throw error;
    throw notProtected();
  }
  if (!sameLimit(storedLimit(record), target)) throw notProtected();
  return { ...state, record, protectionSet: true, differs: differences(record, planned) };
}

const hasHeader = (record: EnvironmentRecord, name: string): boolean =>
  Object.keys(record.headers).some((stored) => stored.toLowerCase() === name.toLowerCase());

/** The backend reports every header it stored (values masked): one that is absent was not stored. */
function checkHeadersStored(record: EnvironmentRecord, planned: PlannedEnvironment): void {
  if (planned.headers.every((header) => hasHeader(record, header.name))) return;
  throw new ToolError('init_project_headers_not_set', { params: { environment: planned.name } });
}

/**
 * Sets the requested fixed headers of an environment that exists. The update replaces the whole
 * set, so the headers the environment already has are sent back with it; one the backend masks
 * cannot be sent back, and the call stops before the write rather than drop it. Every header of
 * the request is sent again each time: a masked stored value cannot be compared.
 */
async function applyHeaders(
  ctx: ToolContext,
  projectId: string,
  planned: PlannedEnvironment,
  state: EnvironmentState,
): Promise<EnvironmentState> {
  if (planned.headers.length === 0) return state;
  const ours = new Set(planned.headers.map((header) => header.name.toLowerCase()));
  const keep: Record<string, unknown> = {};
  const lost: string[] = [];
  for (const [name, value] of Object.entries(state.record.headers)) {
    if (ours.has(name.toLowerCase())) continue;
    if (value === MASKED_VALUE) lost.push(name);
    else keep[name] = value;
  }
  if (lost.length > 0) {
    throw new ToolError('init_project_headers_unpreservable', {
      params: {
        environment: planned.name,
        names: lost.map((name) => inline(name, 100)).join(', '),
      },
    });
  }
  const record = await setEnvironmentHeaders(
    ctx,
    projectId,
    state.record.id,
    planned.headers,
    keep,
  );
  checkHeadersStored(record, planned);
  return { ...state, record: { ...state.record, headers: record.headers } };
}

/**
 * Missing environments are created in the order of the request; existing ones are compared, and
 * only their protection is tightened to the requested limit (addresses and a looser protection
 * are never changed, only reported). The default moves to the requested one only when another one has it.
 */
export async function ensureEnvironments(
  ctx: ToolContext,
  projectId: string,
  planned: readonly PlannedEnvironment[],
): Promise<EnvironmentState[]> {
  const existing = new Map(
    (await listEnvironmentRecords(ctx, projectId)).map((record) => [record.name, record]),
  );
  const states: EnvironmentState[] = [];
  for (const environment of planned) {
    const stored = existing.get(environment.name);
    if (stored !== undefined) {
      const state: EnvironmentState = {
        record: stored,
        created: false,
        protectionSet: false,
        differs: differences(stored, environment),
      };
      const tightened = await tighten(ctx, projectId, environment, state);
      states.push(await applyHeaders(ctx, projectId, environment, tightened));
      continue;
    }
    const record = await createEnvironment(ctx, projectId, environment);
    checkHeadersStored(record, environment);
    states.push({ record, created: true, protectionSet: false, differs: [] });
  }
  const defaultName = planned.find((environment) => environment.isDefault)?.name;
  const wanted = states.find((state) => state.record.name === defaultName);
  if (wanted === undefined) return states;
  if (!wanted.record.isDefault) await setDefaultEnvironment(ctx, projectId, wanted.record.id);
  // Creating with `is_default` or moving the default clears the flag of every other environment.
  return states.map((state) => ({
    ...state,
    record: { ...state.record, isDefault: state === wanted },
  }));
}

/** Runs `task` for every item, at most `limit` at a time; results keep the order of `items`. */
export async function inBatches<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
