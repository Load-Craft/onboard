// Live gate: run 1 of the plugin on a real LoadCraft backend, through the built server
// (`dist/server.mjs`) as a separate stdio process, the way a client starts it. Every step is one
// or more tool calls; after each step the gate reads the backend over REST and checks the effect
// (flows saved, scenarios built, self-check passed, test completed, verdict and diagnosis stored,
// the clamped load in the run manifest), not the wording of the result. The texts are read only
// to drive the run as a model would: names of the proposed journeys, operation handles, the run.
//
//   LIVE_GATE_I_HAVE_APPROVAL=<backend origin> LIVE_GATE_TARGET_APPROVAL=<target origins> \
//     LIVE_GATE_API_TOKEN=… LANGFUSE_PUBLIC_KEY=… LANGFUSE_SECRET_KEY=… \
//     npm run gate -- --config <file> [--keep] [--reuse] [--report-dir <dir>]
//   npm run gate -- --fake [--fake-fault <fault>] [--reuse]   (faults: FAKE_FAULTS below)
//   --scenario docs|har|protected (a list, or the flag repeated; default docs) picks what is
//   walked: `docs` the documentation to the diagnosis of a test, `har` a recording split into flows
//   through the HAR channel, `protected` the consent and the clamp on the protected environment.
//   Only `docs` is walked by default: the other two have side effects on the target and cost more.
//
// The run sends real traffic to the target, builds Gatling scenarios and spends model tokens, so it
// refuses to start without an approval naming the backend's origin, an approval naming the origin
// of every target the load goes to (the environments it creates), an explicit backend address and a
// reachable cost counter, and stops when the cost limit or the time limit is reached (or on SIGINT
// and SIGTERM: the same cleanup). `--fake` runs the same
// steps against the fake backend of the tests (no approval needed, nothing real is touched).
// Exit codes: 0 passed, 1 failed (a step, the cost or the time limit), 2 refused to start.
// See mcp/docs/live-gate.md.

import { once } from 'node:events';
import { lookup } from 'node:dns/promises';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { ARROW, GAP, INDENT, SET_SEPARATOR } from '../src/render/suggestJourneysLayout.ts';

// ---- configuration --------------------------------------------------------------------------

/** A fixed header of an environment: its name and the variable of the env file that holds the value. */
export interface GateHeader {
  readonly name: string;
  readonly from_env: string;
}

export interface GateEnvironment {
  readonly name: string;
  /** API address of the target application in this environment. */
  readonly api: string;
  readonly frontend?: string;
  /**
   * Fixed headers LoadCraft sends in every request to the target (an API key the application
   * requires). The values are never written in the configuration: they are read from `envFile`.
   */
  readonly headers?: readonly GateHeader[];
  /**
   * The env file, outside the repository, that holds the variables named in `headers[].from_env`
   * (relative paths are against the configuration file). Only those variables are copied into the
   * gate's workspace; the file itself is never changed.
   */
  readonly envFile?: string;
  /** [max virtual users, max requests per second]; makes the environment protected. */
  readonly limit?: readonly [number, number];
}

export interface GateProfile {
  readonly type: 'ramp_concurrency';
  readonly vusers: number;
  readonly ramp: number;
}

/** What the gate walks: the order is the order of the steps. */
export const SCENARIOS = ['docs', 'har', 'protected', 'describe'] as const;
export type GateScenario = (typeof SCENARIOS)[number];

/** A recording of the target application, for the scenario `har`. */
export interface GateRecording {
  /** The .har file; copied into the temporary workspace, the file itself is never changed. */
  readonly file: string;
  /** Flows the split must give: the number of journeys of the recording (default 2). */
  readonly minFlows?: number;
}

/** Flows from a description, for the scenario `describe`: walked by the LoadCraft browser. */
export interface GateDescription {
  /** What users do in the application, in plain words (at least 20 characters). */
  readonly description: string;
  /**
   * The env file of the target application that holds the account of the LoadCraft browser; only
   * its two keys are copied into the gate's workspace, the file itself is never changed.
   */
  readonly envFile: string;
  /** Key of the login in that file; default TEST_USER_EMAIL. */
  readonly emailKey?: string;
  /** Key of the password in that file; default TEST_USER_PASSWORD. */
  readonly passwordKey?: string;
  /** Paths the plan must have, 2 to 10 (default 2): one path is what a run without a split walks. */
  readonly minPaths?: number;
  /** Most browser actions per path, 1 to 60; default: LoadCraft decides. */
  readonly maxSteps?: number;
  /** Time limit of the walk in minutes, above 0 and at most 20 (default 20). */
  readonly timeoutMin?: number;
}

export interface GateConfig {
  /** LoadCraft backend: `url` is its origin (the API lives under `/api/v1`). */
  readonly backend: { readonly url: string; readonly appUrl?: string };
  /** Files copied into the gate's own workspace; the target repository is never written. */
  readonly workspace: { readonly openapi: string; readonly overview?: string };
  /** The recording the scenario `har` sends; required by that scenario only. */
  readonly har?: GateRecording;
  /** The description and the account the scenario `describe` walks; required by it only. */
  readonly describe?: GateDescription;
  /** The test project is `<prefix>-<UTC time>`. */
  readonly projectPrefix: string;
  /** Name of the composition `scenario_generate` makes from the journeys. */
  readonly composition: string;
  readonly environments: { readonly main: GateEnvironment; readonly capped: GateEnvironment };
  /**
   * How many of the proposed journeys become flows (a number), or `{count?, names?, prefer?}`:
   * with `names` the gate takes exactly those proposals (each must be in the text of
   * `flows_suggest_journeys`); with `prefer` (case-insensitive regular expressions matched to the name and
   * the steps) it takes the first safe proposal of each pattern and fills the rest of `count` with
   * the default choice; without both it takes the first `count` that do not delete, change accounts
   * or administer.
   */
  readonly journeys:
    | number
    | {
        readonly count?: number;
        readonly names?: readonly string[];
        readonly prefer?: readonly string[];
      };
  /**
   * Accounts created for a slot that lacks them (a number, at least what the profile needs), or
   * `{ file }`: a CSV file of accounts the customer already has, outside the repository. The gate
   * then copies it into its workspace and loads it with `data_create_dataset` (`file` with
   * `scenario` and `slot`, its consent card confirmed), pins it with `data_set_bindings`; it
   * creates no account.
   */
  readonly accounts: number | { readonly file: string };
  readonly profile: GateProfile;
  readonly thresholds?: { readonly p95_ms?: number; readonly error_rate_pct?: number };
  readonly telemetry?: { readonly label: string; readonly url: string };
  readonly costLimitUsd: number;
  readonly langfuse: {
    readonly url: string;
    readonly api: 'v2' | 'v1';
    /**
     * The tracing environment of the gate backend (`LANGFUSE_TRACING_ENVIRONMENT` in its
     * environment, e.g. `mcp-live-gate`); only its observations are counted. Required.
     */
    readonly environment: string;
  };
  readonly timeoutMin: number;
  /**
   * `max_wait_s` of the tools that wait for an operation; absent: the tool's default. A short wait
   * makes the gate continue with `process_wait` and the handle, as a model does after a long step.
   */
  readonly maxWaitS?: number;
  /** Backend origins the gate must never run against (besides LIVE_GATE_FORBIDDEN_BACKENDS). */
  readonly forbiddenBackends: readonly string[];
}

const DEFAULTS = {
  projectPrefix: 'live-gate',
  composition: 'gate-mix',
  journeys: 2,
  accounts: 30,
  profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
  thresholds: { p95_ms: 2000, error_rate_pct: 5 },
  costLimitUsd: 3,
  timeoutMin: 45,
  forbiddenBackends: [],
} as const;

/** The small ramp the gate may send: it checks the chain, not the capacity of the target. */
export const MAX_VUSERS = 20;
/** Longest test the gate may start, in seconds, all phases of the profile together. */
export const MAX_DURATION_S = 60;
/** Most accounts the gate creates for one slot (what the configuration asks for or the slot needs). */
export const MAX_ACCOUNTS = 200;
const MAX_COST_USD = 20;
const MAX_TIMEOUT_MIN = 120;
/** The only keys a profile may have: any other one could change or lengthen the test unseen. */
const PROFILE_KEYS: readonly string[] = ['type', 'vusers', 'ramp'];
/** Keys of a load profile that add seconds to a test, as `run_start` and the backend read them. */
const DURATION_KEYS: readonly string[] = ['ramp', 'hold', 'duration', 'pause', 'interval'];
/** The port the LoadCraft development backend listens on by default. */
const DEV_BACKEND_PORT = 8000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What is missing or of the wrong type in the configuration (with the defaults filled in). */
function shapeProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const section = (name: string, value: unknown): Record<string, unknown> | undefined => {
    if (isObject(value)) return value;
    problems.push(`${name} must be an object`);
    return undefined;
  };
  const kind = (
    name: string,
    value: unknown,
    type: 'string' | 'number',
    required: boolean,
  ): void => {
    if (value === undefined && !required) return;
    if (typeof value !== type) problems.push(`${name} must be a ${type}`);
  };
  for (const key of ['projectPrefix', 'composition'] as const) {
    kind(key, config[key], 'string', true);
  }
  for (const key of ['costLimitUsd', 'timeoutMin'] as const) {
    kind(key, config[key], 'number', true);
  }
  const { accounts } = config;
  if (!(
    typeof accounts === 'number' ||
    (isObject(accounts) && typeof accounts.file === 'string')
  )) {
    problems.push('accounts must be a number or { "file": "<path>" }');
  }
  const { journeys } = config;
  if (isObject(journeys)) {
    kind('journeys.count', journeys.count, 'number', false);
    const { names } = journeys;
    if (
      names !== undefined &&
      !(Array.isArray(names) && names.every((x) => typeof x === 'string' && x.trim() !== ''))
    ) {
      problems.push('journeys.names must be a list of journey names (non-empty strings)');
    }
    const { prefer } = journeys;
    if (prefer !== undefined) {
      if (!(
        Array.isArray(prefer) && prefer.every((x) => typeof x === 'string' && x.trim() !== '')
      )) {
        problems.push('journeys.prefer must be a list of patterns (non-empty strings)');
      } else {
        for (const pattern of prefer as string[]) {
          try {
            new RegExp(pattern, PREFER_FLAGS);
          } catch {
            problems.push(`journeys.prefer: "${pattern}" is not a regular expression`);
          }
        }
      }
    }
  } else {
    kind('journeys', journeys, 'number', true);
  }
  kind('maxWaitS', config.maxWaitS, 'number', false);
  const backend = section('backend', config.backend);
  if (backend !== undefined) kind('backend.url', backend.url, 'string', false);
  if (backend !== undefined) kind('backend.appUrl', backend.appUrl, 'string', false);
  const workspace = section('workspace', config.workspace);
  if (workspace !== undefined) {
    kind('workspace.openapi', workspace.openapi, 'string', false);
    kind('workspace.overview', workspace.overview, 'string', false);
  }
  if (config.har !== undefined) {
    const har = section('har', config.har);
    if (har !== undefined) {
      kind('har.file', har.file, 'string', true);
      kind('har.minFlows', har.minFlows, 'number', false);
    }
  }
  if (config.describe !== undefined) {
    const described = section('describe', config.describe);
    if (described !== undefined) {
      kind('describe.description', described.description, 'string', true);
      kind('describe.envFile', described.envFile, 'string', true);
      kind('describe.emailKey', described.emailKey, 'string', false);
      kind('describe.passwordKey', described.passwordKey, 'string', false);
      for (const key of ['minPaths', 'maxSteps', 'timeoutMin'] as const) {
        kind(`describe.${key}`, described[key], 'number', false);
      }
    }
  }
  const environments = section('environments', config.environments);
  if (environments !== undefined) {
    for (const key of ['main', 'capped'] as const) {
      const environment = section(`environments.${key}`, environments[key]);
      if (environment === undefined) continue;
      kind(`environments.${key}.name`, environment.name, 'string', true);
      kind(`environments.${key}.api`, environment.api, 'string', true);
      kind(`environments.${key}.frontend`, environment.frontend, 'string', false);
      kind(`environments.${key}.envFile`, environment.envFile, 'string', false);
      const { headers } = environment;
      if (headers !== undefined) {
        if (!Array.isArray(headers)) {
          problems.push(`environments.${key}.headers must be a list of { name, from_env }`);
        } else {
          headers.forEach((header: unknown, index) => {
            const item = section(`environments.${key}.headers[${String(index)}]`, header);
            if (item === undefined) return;
            kind(`environments.${key}.headers[${String(index)}].name`, item.name, 'string', true);
            kind(
              `environments.${key}.headers[${String(index)}].from_env`,
              item.from_env,
              'string',
              true,
            );
            // A literal value would put the secret into the configuration file.
            for (const field of Object.keys(item)) {
              if (field !== 'name' && field !== 'from_env') {
                problems.push(
                  `environments.${key}.headers[${String(index)}].${field} is not accepted: a ` +
                    'header value is never written in the configuration, give from_env and envFile',
                );
              }
            }
          });
        }
      }
      const { limit } = environment;
      if (
        limit !== undefined &&
        !(Array.isArray(limit) && limit.length === 2 && limit.every((n) => typeof n === 'number'))
      ) {
        problems.push(`environments.${key}.limit must be a list of two numbers`);
      }
    }
  }
  section('profile', config.profile);
  const langfuse = section('langfuse', config.langfuse);
  if (langfuse !== undefined) {
    for (const key of ['url', 'api', 'environment'] as const) {
      kind(`langfuse.${key}`, langfuse[key], 'string', false);
    }
  }
  if (config.thresholds !== undefined) section('thresholds', config.thresholds);
  if (config.telemetry !== undefined) {
    const telemetry = section('telemetry', config.telemetry);
    if (telemetry !== undefined) {
      kind('telemetry.label', telemetry.label, 'string', true);
      kind('telemetry.url', telemetry.url, 'string', true);
    }
  }
  const { forbiddenBackends } = config;
  if (!(
    Array.isArray(forbiddenBackends) && forbiddenBackends.every((x) => typeof x === 'string')
  )) {
    problems.push('forbiddenBackends must be a list of strings');
  }
  return problems;
}

/** The configuration file with the defaults filled in; relative paths are against the file. */
export function readConfig(path: string): GateConfig {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isObject(raw)) throw new Error(`${path}: the configuration must be a JSON object`);
  const base = dirname(resolve(path));
  const at = (value: unknown): string =>
    typeof value === 'string' && value !== '' && !isAbsolute(value)
      ? resolve(base, value)
      : String(value ?? '');
  const merged: Record<string, unknown> = { ...DEFAULTS, ...raw };
  const problems = shapeProblems(merged);
  if (problems.length > 0) {
    throw new Error(
      `${path}: the configuration cannot be used:\n${problems.map((item) => `  - ${item}`).join('\n')}`,
    );
  }
  const workspace = isObject(merged.workspace) ? merged.workspace : {};
  const resolvedEnvironments = isObject(merged.environments)
    ? Object.fromEntries(
        Object.entries(merged.environments).map(([key, environment]) => [
          key,
          isObject(environment) && typeof environment.envFile === 'string'
            ? { ...environment, envFile: at(environment.envFile) }
            : environment,
        ]),
      )
    : merged.environments;
  const har = isObject(merged.har) ? merged.har : undefined;
  const accountsFile = isObject(merged.accounts) ? merged.accounts : undefined;
  const described = isObject(merged.describe) ? merged.describe : undefined;
  return {
    ...(merged as unknown as GateConfig),
    environments: resolvedEnvironments as unknown as GateConfig['environments'],
    ...(accountsFile === undefined ? {} : { accounts: { file: at(accountsFile.file) } }),
    ...(described === undefined
      ? {}
      : {
          describe: {
            ...(described as unknown as GateDescription),
            envFile: at(described.envFile),
          },
        }),
    ...(har === undefined
      ? {}
      : {
          har: {
            file: at(har.file),
            ...(typeof har.minFlows === 'number' ? { minFlows: har.minFlows } : {}),
          },
        }),
    workspace: {
      openapi: at(workspace.openapi),
      ...(typeof workspace.overview === 'string' ? { overview: at(workspace.overview) } : {}),
    },
  };
}

// ---- addresses ------------------------------------------------------------------------------

/** An http(s) origin in one spelling: lower-case host without a final dot, the port always given. */
export interface Origin {
  readonly protocol: 'http:' | 'https:';
  /** Host as the URL parser writes it (an IPv6 address in brackets), lower case, no final dot. */
  readonly host: string;
  readonly port: number;
  /** `<protocol>//<host>:<port>` */
  readonly origin: string;
}

/**
 * The origin an address names, or why it is not one. Only `http://` and `https://` with a host,
 * nothing after it but `/`, and no user name or password; a missing port is the default one.
 */
export function normalizeOrigin(raw: string): Origin | { readonly error: string } {
  const text = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) {
    return { error: `"${text}" has no http:// or https:// in front` };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: `"${text}" is not an address` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `"${text}" is not http or https` };
  }
  if (url.username !== '' || url.password !== '') {
    return { error: `"${text}" carries a user name or a password` };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { error: `"${text}" has a path, a query or a fragment; give the origin only` };
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/u, '');
  if (host === '') return { error: `"${text}" has no host` };
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  return { protocol: url.protocol, host, port, origin: `${url.protocol}//${host}:${String(port)}` };
}

function isOrigin(value: Origin | { readonly error: string }): value is Origin {
  return !('error' in value);
}

/** The origin requests go to, as the URL parser writes it (default port left out). */
function originOf(url: string): string | undefined {
  return isOrigin(normalizeOrigin(url)) ? new URL(url.trim()).origin : undefined;
}

/** The eight 16-bit groups of an IPv6 address (`::`, an IPv4 tail), or undefined. */
function ipv6Groups(text: string): number[] | undefined {
  if (isIP(text) !== 6) return undefined;
  let address = text.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/u.exec(address)?.[1];
  if (v4 !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.split('.').map(Number);
    address = `${address.slice(0, -v4.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = address.split('::');
  const part = (side: string): number[] =>
    side === '' ? [] : side.split(':').map((group) => parseInt(group, 16));
  const left = part(head);
  const right = tail === undefined ? [] : part(tail);
  const zeros = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<number>(zeros).fill(0), ...right];
}

/** One spelling of an IP address: IPv4 dotted (also when mapped into IPv6), IPv6 in full groups. */
export function canonicalAddress(raw: string): string {
  const text = raw.replace(/^\[|\]$/gu, '').toLowerCase();
  if (isIP(text) === 4) return text;
  const groups = ipv6Groups(text);
  if (groups === undefined) return text;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [, , , , , , high = 0, low = 0] = groups;
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return groups.map((group) => group.toString(16)).join(':');
}

/** The addresses of the network interfaces of this machine (LAN, link-local, loopback), canonical. */
export function machineAddresses(): string[] {
  const found = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) found.add(canonicalAddress(entry.address));
  }
  return [...found];
}

/**
 * 127.0.0.0/8, 0.0.0.0, ::1, :: (also IPv4-mapped), and every address of an interface of this
 * machine (`machine`, by default the ones it has now): an address of this very machine.
 */
export function isLocalAddress(
  raw: string,
  machine: readonly string[] = machineAddresses(),
): boolean {
  const address = canonicalAddress(raw);
  if (machine.some((own) => canonicalAddress(own) === address)) return true;
  if (isIP(address) === 4) return address.startsWith('127.') || address === '0.0.0.0';
  return address === '0:0:0:0:0:0:0:1' || address === '0:0:0:0:0:0:0:0';
}

/** `localhost` and every name under it (RFC 6761) point at this machine whatever DNS says. */
function isLocalName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

function isLoadcraftHost(host: string): boolean {
  return host === 'loadcraft.io' || host.endsWith('.loadcraft.io');
}

/** Resolves a host to its addresses; an IP literal resolves to itself. */
export type Resolve = (host: string) => Promise<string[]>;

export const resolveHost: Resolve = async (host) => {
  const bare = host.replace(/^\[|\]$/gu, '');
  if (isIP(bare) !== 0) return [bare];
  const found = await lookup(bare, { all: true });
  return found.map((entry) => entry.address);
};

function listOf(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** The forbidden backends, each with where it was named; an entry that is not an origin is an error. */
function forbiddenEntries(
  config: GateConfig,
  env: Readonly<Record<string, string | undefined>>,
): { entries: { source: string; origin: Origin }[]; errors: string[] } {
  const entries: { source: string; origin: Origin }[] = [];
  const errors: string[] = [];
  const add = (source: string, raw: string): void => {
    const parsed = normalizeOrigin(raw);
    if (isOrigin(parsed)) entries.push({ source, origin: parsed });
    else {
      errors.push(
        `${source} entry ${parsed.error}: write every forbidden backend as an origin, ` +
          'for example http://127.0.0.1:8001; the gate does not start while one cannot be read.',
      );
    }
  };
  for (const raw of listOf(env.LIVE_GATE_FORBIDDEN_BACKENDS)) {
    add('LIVE_GATE_FORBIDDEN_BACKENDS', raw);
  }
  for (const raw of config.forbiddenBackends) add('forbiddenBackends', raw);
  return { entries, errors };
}

/**
 * Every reason not to start that the configuration alone shows, empty when it may start. `fake`
 * skips only the approval: the fake backend is a local test double, nothing real is loaded.
 * The addresses the host resolves to are checked by `checkTarget`.
 */
export function checkLaunch(
  config: GateConfig,
  env: Readonly<Record<string, string | undefined>>,
  options: {
    readonly fake?: boolean;
    readonly machine?: readonly string[];
    /** The scenarios to walk; what only one of them needs is checked when it is named. */
    readonly scenarios?: readonly GateScenario[];
  } = {},
): string[] {
  const refusals: string[] = [];
  const machine = options.machine ?? machineAddresses();
  const backend = normalizeOrigin(config.backend.url ?? '');
  if (!isOrigin(backend)) {
    refusals.push(
      `backend.url must be the explicit http(s) origin of the backend, there is no default: ${backend.error}.`,
    );
  }
  if (options.fake !== true) {
    const given = env.LIVE_GATE_I_HAVE_APPROVAL ?? '';
    const approval = normalizeOrigin(given);
    const expected = isOrigin(backend) ? backend.origin : 'the origin of backend.url';
    if (!isOrigin(backend) || !isOrigin(approval) || approval.origin !== backend.origin) {
      refusals.push(
        'The live gate sends real traffic, builds Gatling scenarios and spends model tokens. ' +
          'Once the owner of the backend agreed to this run, set LIVE_GATE_I_HAVE_APPROVAL to ' +
          `exactly that backend's origin: expected ${expected}, got ${JSON.stringify(given)}` +
          (isOrigin(approval) ? ` (${approval.origin}).` : '.'),
      );
    }
  }
  if (isOrigin(backend)) {
    if (isLoadcraftHost(backend.host)) {
      refusals.push(
        `backend.url ${backend.origin} is a hosted loadcraft.io instance; the gate runs only ` +
          'against a backend started for it.',
      );
    }
    if (
      backend.port === DEV_BACKEND_PORT &&
      (isLocalName(backend.host) || isLocalAddress(backend.host, machine))
    ) {
      refusals.push(devPortRefusal('backend.url', backend.origin, BACKEND_ADVICE));
    }
  }
  refusals.push(...forbiddenEntries(config, env).errors);
  refusals.push(...targetRefusals(config, env, options.fake === true, machine));
  if (config.backend.appUrl !== undefined && !isOrigin(normalizeOrigin(config.backend.appUrl))) {
    refusals.push('backend.appUrl must be an http(s) origin.');
  }

  if ((env.LIVE_GATE_API_TOKEN ?? '') === '') {
    refusals.push('LIVE_GATE_API_TOKEN is not set (an API token of the gate backend).');
  }
  if (!isOrigin(normalizeOrigin(config.langfuse.url ?? ''))) {
    refusals.push(
      'langfuse.url must be the http(s) origin of the Langfuse the backend reports to.',
    );
  }
  if (
    typeof config.langfuse.environment !== 'string' ||
    config.langfuse.environment.trim() === ''
  ) {
    refusals.push(
      'langfuse.environment must name the tracing environment of the gate backend ' +
        '(LANGFUSE_TRACING_ENVIRONMENT there, e.g. mcp-live-gate): without it the cost of other ' +
        'backends would be counted, or none at all.',
    );
  }
  if (config.langfuse.api !== 'v2' && config.langfuse.api !== 'v1') {
    refusals.push('langfuse.api must be "v2" or "v1".');
  }
  for (const key of ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'] as const) {
    if ((env[key] ?? '') === '') {
      refusals.push(`${key} is not set: without the cost counter the gate does not start.`);
    }
  }
  if (!(
    Number.isFinite(config.costLimitUsd) &&
    config.costLimitUsd > 0 &&
    config.costLimitUsd <= MAX_COST_USD
  )) {
    refusals.push(
      `costLimitUsd must be more than 0 and at most ${String(MAX_COST_USD)} US dollars.`,
    );
  }
  if (!(
    Number.isFinite(config.timeoutMin) &&
    config.timeoutMin > 0 &&
    config.timeoutMin <= MAX_TIMEOUT_MIN
  )) {
    refusals.push(`timeoutMin must be more than 0 and at most ${String(MAX_TIMEOUT_MIN)} minutes.`);
  }
  if (
    config.maxWaitS !== undefined &&
    !(Number.isInteger(config.maxWaitS) && config.maxWaitS >= 1 && config.maxWaitS <= 100)
  ) {
    refusals.push('maxWaitS must be a whole number of seconds from 1 to 100.');
  }

  refusals.push(...checkProfile(config.profile));
  const { profile } = config;
  const { main, capped } = config.environments;
  if (main.limit !== undefined) {
    refusals.push(
      'environments.main must have no limit: the full test runs on an unprotected environment.',
    );
  }
  const cap = capped.limit;
  if (cap === undefined || !(cap[0] >= 1 && cap[0] < profile.vusers && cap[1] >= 1)) {
    refusals.push(
      'environments.capped needs limit [max users, max requests/s] with max users below ' +
        'profile.vusers, or the check of the clamped load proves nothing.',
    );
  }
  if (main.name === capped.name) {
    refusals.push('environments.main and environments.capped need different names.');
  }
  refusals.push(...headerRefusals(config));
  const wish = journeyWish(config);
  if (!(Number.isInteger(wish.count) && wish.count >= 1 && wish.count <= 5)) {
    refusals.push('journeys (or journeys.count) must be a whole number from 1 to 5.');
  }
  if (wish.names !== undefined && wish.prefer !== undefined) {
    refusals.push('journeys.names and journeys.prefer exclude each other; give one of them.');
  }
  if (wish.prefer !== undefined) {
    if (new Set(wish.prefer).size !== wish.prefer.length) {
      refusals.push('journeys.prefer lists a pattern twice.');
    }
    if (wish.prefer.length < 1 || wish.prefer.length > 5) {
      refusals.push('journeys.prefer must list from 1 to 5 patterns.');
    }
    if (wish.prefer.length > wish.count) {
      refusals.push('journeys.prefer lists more patterns than journeys.count takes.');
    }
  }
  if (wish.names !== undefined) {
    if (new Set(wish.names).size !== wish.names.length) {
      refusals.push('journeys.names lists a name twice.');
    }
    if (wish.names.length < 1 || wish.names.length > 5) {
      refusals.push('journeys.names must list from 1 to 5 names.');
    }
    if (typeof config.journeys === 'object' && config.journeys.count !== undefined) {
      if (config.journeys.count !== wish.names.length) {
        refusals.push(
          'journeys.count differs from the number of journeys.names; give one of them.',
        );
      }
    }
  }
  if (typeof config.accounts === 'object') {
    if (config.accounts.file.trim() === '') {
      refusals.push('accounts.file must name the CSV file of accounts, outside the repository.');
    }
  } else if (!(
    Number.isInteger(config.accounts) &&
    config.accounts >= profile.vusers &&
    config.accounts <= MAX_ACCOUNTS
  )) {
    refusals.push(
      `accounts must be a whole number from profile.vusers to ${String(MAX_ACCOUNTS)} (got ${JSON.stringify(config.accounts)}).`,
    );
  }
  if (config.workspace.openapi === '') {
    refusals.push('workspace.openapi must name the OpenAPI document of the target.');
  }
  if (options.scenarios?.includes('har') === true) {
    refusals.push(...harRefusals(config.har));
  }
  if (options.scenarios?.includes('describe') === true) {
    refusals.push(...describeRefusals(config));
  }
  return refusals;
}

/** Most flows the split of the recording may be asked to give. */
export const MAX_MIN_FLOWS = 10;
/** Flows a split gives when the configuration does not say: one journey is no split. */
export const DEFAULT_MIN_FLOWS = 2;

/** The scenario `har` needs a recording and a number of flows that proves the split happened. */
function harRefusals(har: GateRecording | undefined): string[] {
  if (har === undefined || typeof har.file !== 'string' || har.file === '') {
    return [
      'the scenario har needs har.file, the recording of the target application ' +
        '(see "The recording" in docs/live-gate.md), or leave it out with --scenario docs,protected.',
    ];
  }
  const min = har.minFlows ?? DEFAULT_MIN_FLOWS;
  if (!(Number.isInteger(min) && min >= 2 && min <= MAX_MIN_FLOWS)) {
    return [
      `har.minFlows must be a whole number from 2 to ${String(MAX_MIN_FLOWS)}: ` +
        'one flow is what a call without a split gives, so it proves nothing about the split.',
    ];
  }
  return [];
}

/** Paths the plan of a description must have when the configuration does not say: one is no split. */
export const DEFAULT_MIN_PATHS = 2;
/** Most paths the plan may be asked to have. */
export const MAX_MIN_PATHS = 10;
/** The time limit of the walk of the paths, and its default. */
export const MAX_WALK_TIMEOUT_MIN = 20;
/** Fewest characters of a description, as `flows_describe_journeys` takes it. */
const MIN_DESCRIPTION_LENGTH = 20;
/**
 * A key an env file can hold: a copy of `KEY_PATTERN` in src/workspace/envFile.ts:25 @07c207e,
 * the rule the plugin reads the account with.
 */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const DEFAULT_EMAIL_KEY = 'TEST_USER_EMAIL';
const DEFAULT_PASSWORD_KEY = 'TEST_USER_PASSWORD';

/**
 * A header name the plugin accepts: a copy of `HEADER_NAME` and `RESERVED_HEADERS` in
 * src/tools/project/environments.ts (the names the backend keeps as written, without those the transport
 * sets or the account signs in with).
 */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/u;
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'authorization',
]);

/**
 * What is wrong with the fixed headers of the environments, before anything is sent: a name the
 * plugin refuses, a header twice, a variable that is not a key an env file can hold, headers
 * without the env file that holds their values. A value is never part of a refusal.
 */
function headerRefusals(config: GateConfig): string[] {
  const refusals: string[] = [];
  for (const key of ['main', 'capped'] as const) {
    const environment = config.environments[key];
    const headers = environment.headers ?? [];
    if (headers.length === 0) continue;
    const label = `environments.${key}`;
    if (typeof environment.envFile !== 'string' || environment.envFile === '') {
      refusals.push(
        `${label}.headers needs ${label}.envFile, the env file outside the repository that holds ` +
          'the values (a value is never written in the configuration).',
      );
    }
    const seen = new Set<string>();
    for (const header of headers) {
      const lower = header.name.toLowerCase();
      if (!HEADER_NAME.test(header.name) || RESERVED_HEADERS.has(lower)) {
        refusals.push(
          `${label}.headers: ${JSON.stringify(header.name)} is not a header name the plugin ` +
            'accepts (letters, digits and hyphens, starting with a letter; not Host, ' +
            'Content-Length, Transfer-Encoding, Connection or Authorization).',
        );
      } else if (seen.has(lower)) {
        refusals.push(`${label}.headers: ${header.name} is listed twice.`);
      }
      seen.add(lower);
      if (!ENV_KEY.test(header.from_env)) {
        refusals.push(
          `${label}.headers: from_env ${JSON.stringify(header.from_env)} is not a key an env file can hold.`,
        );
      }
    }
  }
  return refusals;
}

function isWhole(value: unknown, from: number, to: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= from && value <= to;
}

/**
 * The scenario `describe` needs a description, the env file of the account and the frontend of the
 * main environment: the LoadCraft browser opens the application there. Where the frontend may lead
 * is checked like every target (the approval, port 8000 of this machine, the forbidden backends);
 * whether the browser may open it is decided by the plugin and the backend.
 */
function describeRefusals(config: GateConfig): string[] {
  const described = config.describe;
  if (described === undefined || typeof described.description !== 'string') {
    return [
      'the scenario describe needs describe.description, what users do in the application, and ' +
        'describe.envFile, the env file of the target with the account of the LoadCraft browser ' +
        '(see "Flows from a description" in docs/live-gate.md), or leave it out of --scenario.',
    ];
  }
  const refusals: string[] = [];
  if (described.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    refusals.push(
      `describe.description must have at least ${String(MIN_DESCRIPTION_LENGTH)} characters: what users do, in plain words.`,
    );
  }
  if (typeof described.envFile !== 'string' || described.envFile === '') {
    refusals.push(
      'describe.envFile must name the env file of the target application with the account of the LoadCraft browser.',
    );
  }
  for (const key of ['emailKey', 'passwordKey'] as const) {
    const value = described[key];
    if (value !== undefined && !ENV_KEY.test(value)) {
      refusals.push(`describe.${key} ${JSON.stringify(value)} is not a key an env file can hold.`);
    }
  }
  if (described.minPaths !== undefined && !isWhole(described.minPaths, 1, MAX_MIN_PATHS)) {
    refusals.push(`describe.minPaths must be a whole number from 1 to ${String(MAX_MIN_PATHS)}.`);
  }
  if (described.maxSteps !== undefined && !isWhole(described.maxSteps, 1, 60)) {
    refusals.push('describe.maxSteps must be a whole number from 1 to 60.');
  }
  const limit = described.timeoutMin;
  if (
    limit !== undefined &&
    !(Number.isFinite(limit) && limit > 0 && limit <= MAX_WALK_TIMEOUT_MIN)
  ) {
    refusals.push(
      `describe.timeoutMin must be more than 0 and at most ${String(MAX_WALK_TIMEOUT_MIN)} minutes.`,
    );
  }
  const { frontend } = config.environments.main;
  if (frontend === undefined) {
    refusals.push(
      'environments.main.frontend must be given: the LoadCraft browser opens the application at ' +
        'the frontend of the main environment.',
    );
  }
  return refusals;
}

const BACKEND_ADVICE = 'start a separate backend for the gate on another port';
const TARGET_ADVICE = 'the load must not go to the development backend: use another port';

function devPortRefusal(label: string, origin: string, advice: string): string {
  return (
    `${label} ${origin} reaches this machine on port ${String(DEV_BACKEND_PORT)}, the default ` +
    `port of the LoadCraft development backend: ${advice}.`
  );
}

/** One address the load goes to, with the configuration keys that name it. */
interface Target {
  readonly labels: string;
  readonly origin: Origin;
}

/**
 * The origins of the environments the gate creates (`api`, and `frontend` when given), one entry
 * per origin; an address that is not an origin is a refusal.
 */
function readTargets(config: GateConfig): { targets: Target[]; refusals: string[] } {
  const found = new Map<string, { labels: string[]; origin: Origin }>();
  const refusals: string[] = [];
  const { main, capped } = config.environments;
  const named: [label: string, raw: string][] = [];
  for (const [key, environment] of [
    ['main', main],
    ['capped', capped],
  ] as const) {
    named.push([`environments.${key}.api`, environment.api]);
    if (environment.frontend !== undefined) {
      named.push([`environments.${key}.frontend`, environment.frontend]);
    }
  }
  for (const [label, raw] of named) {
    const parsed = normalizeOrigin(raw);
    if (!isOrigin(parsed)) {
      refusals.push(`${label} ${parsed.error}; the target must be an explicit http(s) origin.`);
      continue;
    }
    const known = found.get(parsed.origin);
    if (known === undefined) found.set(parsed.origin, { labels: [label], origin: parsed });
    else known.labels.push(label);
  }
  return {
    targets: [...found.values()].map(({ labels, origin }) => ({
      labels: labels.join(', '),
      origin,
    })),
    refusals,
  };
}

/** The origin a URL with a path (the telemetry source) is served from. */
function originOfUrl(raw: string): Origin | { readonly error: string } {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: `"${text}" is not an address` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `"${text}" is not http or https` };
  }
  if (url.username !== '' || url.password !== '') {
    return { error: `"${text}" carries a user name or a password` };
  }
  return normalizeOrigin(url.origin);
}

/**
 * Where the load goes, from the configuration alone: every environment's origin must be named in
 * LIVE_GATE_TARGET_APPROVAL (the way LIVE_GATE_I_HAVE_APPROVAL names the backend; `fake` needs no
 * approval), and none may be a hosted loadcraft.io instance or port 8000 of this machine. The
 * telemetry source only reads logs: it is checked for the same two, not approved.
 */
function targetRefusals(
  config: GateConfig,
  env: Readonly<Record<string, string | undefined>>,
  fake: boolean,
  machine: readonly string[],
): string[] {
  const { targets, refusals } = readTargets(config);
  for (const { labels, origin } of targets) {
    if (isLoadcraftHost(origin.host)) {
      refusals.push(
        `${labels} ${origin.origin} is a hosted loadcraft.io instance; the load never goes to one.`,
      );
    }
    if (
      origin.port === DEV_BACKEND_PORT &&
      (isLocalName(origin.host) || isLocalAddress(origin.host, machine))
    ) {
      refusals.push(devPortRefusal(labels, origin.origin, TARGET_ADVICE));
    }
  }
  if (!fake) {
    const approved = new Set<string>();
    for (const raw of listOf(env.LIVE_GATE_TARGET_APPROVAL)) {
      const parsed = normalizeOrigin(raw);
      if (isOrigin(parsed)) approved.add(parsed.origin);
      else {
        refusals.push(
          `LIVE_GATE_TARGET_APPROVAL entry ${parsed.error}: write every target as an origin, ` +
            'for example https://api.example.com.',
        );
      }
    }
    const missing = targets.filter(({ origin }) => !approved.has(origin.origin));
    if (missing.length > 0) {
      refusals.push(
        'The load and the accounts the gate creates go to the environments of its configuration. ' +
          'Once the owner of each target agreed to this run, set LIVE_GATE_TARGET_APPROVAL to the ' +
          'exact origins of every target, separated by commas: missing ' +
          `${missing.map(({ labels, origin }) => `${origin.origin} (${labels})`).join(', ')}.`,
      );
    }
  }
  if (config.telemetry !== undefined) {
    const telemetry = originOfUrl(config.telemetry.url ?? '');
    if (!isOrigin(telemetry)) {
      refusals.push(`telemetry.url ${telemetry.error}; give an http(s) address.`);
    } else {
      if (isLoadcraftHost(telemetry.host)) {
        refusals.push(`telemetry.url ${telemetry.origin} is a hosted loadcraft.io instance.`);
      }
      if (
        telemetry.port === DEV_BACKEND_PORT &&
        (isLocalName(telemetry.host) || isLocalAddress(telemetry.host, machine))
      ) {
        refusals.push(devPortRefusal('telemetry.url', telemetry.origin, TARGET_ADVICE));
      }
    }
  }
  return refusals;
}

/** Seconds a profile lasts: every phase it names, together. */
export function profileSeconds(profile: Readonly<Record<string, unknown>>): number {
  return DURATION_KEYS.reduce((total, key) => {
    const value = profile[key];
    return total + (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
}

/** Why the profile is not the small ramp of the gate; empty when it is. */
export function checkProfile(profile: unknown): string[] {
  if (!isObject(profile)) return ['profile must be an object.'];
  const refusals: string[] = [];
  const unknown = Object.keys(profile).filter((key) => !PROFILE_KEYS.includes(key));
  if (unknown.length > 0) {
    refusals.push(
      `profile has keys the gate does not take: ${unknown.join(', ')} (allowed: ${PROFILE_KEYS.join(', ')}).`,
    );
  }
  if (profile.type !== 'ramp_concurrency') {
    refusals.push('profile.type must be "ramp_concurrency" (the small ramp of the gate).');
  }
  const { vusers, ramp } = profile;
  if (!(
    typeof vusers === 'number' &&
    Number.isInteger(vusers) &&
    vusers >= 2 &&
    vusers <= MAX_VUSERS
  )) {
    refusals.push(
      `profile.vusers must be a whole number from 2 to ${String(MAX_VUSERS)} (got ${JSON.stringify(vusers)}).`,
    );
  }
  if (!(typeof ramp === 'number' && Number.isInteger(ramp) && ramp >= 1)) {
    refusals.push(
      `profile.ramp must be a whole number of seconds, at least 1 (got ${JSON.stringify(ramp)}).`,
    );
  }
  const seconds = profileSeconds(profile);
  if (seconds > MAX_DURATION_S) {
    refusals.push(
      `the profile lasts ${String(seconds)} s (${DURATION_KEYS.filter((key) => key in profile).join(' + ')}); ` +
        `the gate runs at most ${String(MAX_DURATION_S)} s.`,
    );
  }
  return refusals;
}

/** The profile sent to `run_start`: only the checked fields, never the object of the file. */
export function profileArgs(profile: GateProfile): GateProfile {
  return { type: profile.type, vusers: profile.vusers, ramp: profile.ramp };
}

/**
 * The second layer: where the hosts really lead. For the backend and for every target, refuses
 * when an address it resolves to is this machine (any interface of it) and the port is the
 * development port, and when it resolves to an address of a forbidden backend on the same port
 * (any address of this machine stands for all of them).
 */
export async function checkTarget(
  config: GateConfig,
  env: Readonly<Record<string, string | undefined>>,
  resolveName: Resolve = resolveHost,
  machine: readonly string[] = machineAddresses(),
): Promise<string[]> {
  const subjects: Target[] = [];
  const backend = normalizeOrigin(config.backend.url ?? '');
  if (isOrigin(backend)) subjects.push({ labels: 'backend.url', origin: backend });
  subjects.push(...readTargets(config).targets);
  const forbidden = forbiddenEntries(config, env).entries;
  const refusals: string[] = [];
  const addressesOf = async (origin: Origin): Promise<string[] | undefined> => {
    try {
      const found = await resolveName(origin.host);
      return found.length === 0 ? undefined : found.map(canonicalAddress);
    } catch {
      return undefined;
    }
  };
  const isMachine = (host: string, addresses: readonly string[]): boolean =>
    isLocalName(host) || addresses.some((address) => isLocalAddress(address, machine));
  for (const { labels, origin } of subjects) {
    const own = await addressesOf(origin);
    if (own === undefined) {
      refusals.push(
        `${labels} ${origin.origin}: the host does not resolve, so it cannot be checked.`,
      );
      continue;
    }
    const local = isMachine(origin.host, own);
    if (origin.port === DEV_BACKEND_PORT && local) {
      refusals.push(
        devPortRefusal(
          labels,
          origin.origin,
          labels === 'backend.url' ? BACKEND_ADVICE : TARGET_ADVICE,
        ),
      );
    }
    for (const { source, origin: other } of forbidden) {
      if (other.port !== origin.port) continue;
      const theirs = await addressesOf(other);
      if (theirs === undefined) {
        refusals.push(
          `${source} entry ${other.origin}: the host does not resolve, so it cannot be compared.`,
        );
        continue;
      }
      if ((local && isMachine(other.host, theirs)) || theirs.some((a) => own.includes(a))) {
        refusals.push(
          `${labels} ${origin.origin} reaches the same address and port as ${other.origin} ` +
            `from ${source}.`,
        );
      }
    }
  }
  return [...new Set(refusals)];
}

// ---- reading the texts --------------------------------------------------------------------

const HANDLE = String.raw`[a-z_]+:[A-Za-z0-9][A-Za-z0-9_-]{5,}`;
/** The handle of a finished project analysis, which the setup result names for `project_apply_setup`. */
const SETUP_ANALYSIS_HANDLE = /\bsetup_analysis:[A-Za-z0-9][A-Za-z0-9_-]{5,}/u;
const RUNNING = new RegExp(String.raw`still running in LoadCraft: (${HANDLE})`, 'u');
const NEEDS_USER = new RegExp(String.raw`waiting for the user: (${HANDLE})`, 'u');

/** The operation an unfinished result asks to `process_wait` for, read from its text. */
export function pendingOperation(
  text: string,
): { kind: 'running' | 'needs_user'; handle: string } | undefined {
  const needsUser = NEEDS_USER.exec(text)?.[1];
  if (needsUser !== undefined) return { kind: 'needs_user', handle: needsUser };
  const running = RUNNING.exec(text)?.[1];
  return running === undefined ? undefined : { kind: 'running', handle: running };
}

/** One proposal as the view lists it: the name and the text of its steps (arrows between them). */
export interface Proposal {
  readonly name: string;
  readonly steps: string;
}

/**
 * Lines after the proposals that the view writes without an indent: the count of covered
 * operations, the operations outside the journeys, the units that were not refined and the note
 * about heuristic proposals, in each language of the view (`render/i18n/{en,pl}.ts`).
 */
const AFTER_PROPOSALS: readonly RegExp[] = [
  /^[\d\s.,]+ (of|z) [\d\s.,]+ (operations|operacji) · /u,
  /^(outside the journeys|poza ścieżkami): /u,
  /^(not refined|bez doprecyzowania): /u,
  /^(heuristic proposals|propozycje heurystyczne), /u,
];

/** A row of a name column `gap` spaces wide or wider, then the steps. */
function nameGap(gap: number): RegExp {
  return new RegExp(String.raw`^(\S.*?) {${String(gap)},}(\S.*)$`, 'u');
}
/** The first line of the ladder entry; its lines are skipped: the gate does not choose rungs. */
const LADDER_HEADER = /^(ladder|drabina): /u;
const STEPS_LINE = new RegExp(String.raw`^ {${String(INDENT.length)}}(\S.*)$`, 'u');

/**
 * The proposals of `flows_suggest_journeys`, read from the text of its view
 * (`src/render/views/suggestJourneys.ts`, whose layout constants this uses). Three shapes:
 * a name, at least GAP spaces, then the steps (more lines of steps hang under that column, further
 * than INDENT); a name too long for the column alone on its line, the steps below it at INDENT; the
 * first line is the title and never a name. `gap` is the width of the gap after the name column
 * (GAP of `flows_suggest_journeys` by default; the plan of `flows_describe_journeys` has a narrower one).
 */
export function proposalsFromText(text: string, gap: number = GAP): Proposal[] {
  const NAME_GAP = nameGap(gap);
  const lines = text.split('\n');
  const found: { name: string; steps: string[] }[] = [];
  let current: { name: string; steps: string[] } | undefined;
  // The ladder is one entry whose rungs are nested supersets of each other and have no steps in the
  // text, so their risk could not be judged: its lines are not proposals.
  let ladder = false;
  for (const [index, line] of lines.entries()) {
    if (!/^\s/u.test(line)) ladder = false;
    if (AFTER_PROPOSALS.some((marker) => marker.test(line))) break;
    if (LADDER_HEADER.test(line)) {
      ladder = true;
      current = undefined;
      continue;
    }
    if (ladder) continue;
    if (/^\s/u.test(line)) {
      // A hanging line or an indented one: more steps of the proposal above.
      const more = line.trim();
      if (current !== undefined && more !== '' && !isTail(line)) current.steps.push(more);
      continue;
    }
    if (index === 0) continue;
    const row = NAME_GAP.exec(line);
    if (row !== null) {
      current = { name: row[1] ?? '', steps: [row[2] ?? ''] };
      found.push(current);
    } else if (STEPS_LINE.test(lines[index + 1] ?? '')) {
      current = { name: line.trim(), steps: [] };
      found.push(current);
    } else {
      current = undefined;
    }
  }
  return found
    .filter((item) => item.name !== '')
    .map((item) => ({ name: item.name, steps: item.steps.join(' ') }));
}

/** The line that says how many proposals the list leaves out (`… and 14 more`). */
function isTail(line: string): boolean {
  return /^ {2}… /u.test(line);
}

/** Names of the proposed journeys, in the order of the list. */
export function journeysFromText(text: string): string[] {
  return proposalsFromText(text).map((item) => item.name);
}

/** Words of a step that delete, deactivate or disable something. */
const DESTRUCTIVE =
  /\b(delet\w*|remov\w*|deactivat\w*|disabl\w*|revok\w*|purg\w*|destroy\w*|wip(e|es|ed|ing)|suspend\w*|ban|bans|banned)\b/iu;
/** A method the view may show for a step without a summary. */
const DELETE_METHOD = /\bDELETE\b/u;
/** A step that changes who can do what: a verb of change near passwords, roles or permissions. */
const ACCOUNT_CHANGE =
  /\b(chang\w*|reset\w*|updat\w*|set|sets|grant\w*|assign\w*|modif\w*|edit\w*)\b[^→]{0,60}\b(passwords?|permissions?|privileges?|roles?|credentials?)\b/iu;
/** Administration paths: `admin` as a word beginning, in the name or in a step. */
const ADMINISTRATION = /\badmin/iu;

/**
 * Why a proposal is not taken by default, or undefined for a proposal the gate may run: it deletes
 * or deactivates something (a step with a word such as delete or remove, or the method DELETE),
 * changes accounts or permissions, or administers (the name or a step says admin). Only the text of
 * the view is read; it shows the summary of each operation or `METHOD /path`.
 */
export function riskOf(proposal: Proposal): string | undefined {
  const steps = proposal.steps.split(ARROW).flatMap((part) => part.split(SET_SEPARATOR));
  const destructive = steps.find((step) => DESTRUCTIVE.test(step) || DELETE_METHOD.test(step));
  if (destructive !== undefined) return `a step that deletes or deactivates: "${destructive}"`;
  const account = steps.find((step) => ACCOUNT_CHANGE.test(step));
  if (account !== undefined) return `a step that changes accounts or permissions: "${account}"`;
  if (ADMINISTRATION.test(proposal.name)) return 'an administration journey (admin in the name)';
  const admin = steps.find((step) => ADMINISTRATION.test(step));
  if (admin !== undefined) return `an administration step: "${admin}"`;
  return undefined;
}

export interface JourneyWish {
  readonly count: number;
  readonly names?: readonly string[];
  readonly prefer?: readonly string[];
}

/** The label of the kind that opens the steps of a proposal in the view. */
const KIND_LABEL = /^\[[^\]]*\] ?/u;

/** Flags of the `journeys.prefer` patterns: case does not matter, the text is Unicode. */
const PREFER_FLAGS = 'iu';

/** What the configuration asks for: a number of journeys, or exactly the named ones. */
export function journeyWish(config: Pick<GateConfig, 'journeys'>): JourneyWish {
  const { journeys } = config;
  if (typeof journeys === 'number') return { count: journeys };
  const names = journeys.names;
  const prefer = journeys.prefer;
  const count = journeys.count ?? names?.length ?? prefer?.length ?? DEFAULTS.journeys;
  return {
    count,
    ...(names === undefined ? {} : { names }),
    ...(prefer === undefined ? {} : { prefer }),
  };
}

export interface JourneyChoice {
  /** The names to build flows from. */
  readonly taken: string[];
  /** Proposals the default choice left out, with the reason. */
  readonly skipped: { readonly name: string; readonly reason: string }[];
  /** With `prefer`: what each pattern found, and what filled the places it left empty. */
  readonly notes?: string[];
  /** Why the gate cannot go on; undefined when `taken` is what was asked for. */
  readonly problem?: string;
}

/**
 * The journeys the gate builds flows from. With `names`: exactly those, each compared exactly with
 * the names in the text (a missing one is a problem that lists the available names). With
 * `prefer`: for each pattern, in order, the first proposal (in the order of the text) not yet taken
 * whose name matches it (only when no name matches: whose steps) and that `riskOf` does not flag; a pattern that finds nothing is no
 * failure, its place is filled like the places below. Without: the first `count` proposals that
 * `riskOf` does not flag.
 */
export function chooseJourneys(proposals: readonly Proposal[], wish: JourneyWish): JourneyChoice {
  const available = proposals.map((item) => item.name);
  if (wish.names !== undefined) {
    const missing = wish.names.filter((name) => !available.includes(name));
    if (missing.length > 0) {
      return {
        taken: [],
        skipped: [],
        problem:
          `journeys.names not found among the proposals: ${missing.map((n) => `"${n}"`).join(', ')}; ` +
          `available (${String(available.length)}): ${available.map((n) => `"${n}"`).join(', ')}. ` +
          'The gate does not choose the rungs of a ladder (the one entry that lists them), so a rung is not among the available names.',
      };
    }
    return { taken: [...wish.names], skipped: [] };
  }
  const skipped: { name: string; reason: string }[] = [];
  const safe: string[] = [];
  const risks = new Map<string, string>();
  for (const item of proposals) {
    const reason = riskOf(item);
    if (reason === undefined) safe.push(item.name);
    else {
      skipped.push({ name: item.name, reason });
      risks.set(item.name, reason);
    }
  }
  if (wish.prefer !== undefined)
    return choosePreferred(proposals, wish.prefer, wish.count, safe, skipped, risks);
  if (safe.length < wish.count) {
    return {
      taken: [],
      skipped,
      problem:
        `${String(safe.length)} safe proposals of ${String(available.length)} (needed ${String(wish.count)}); ` +
        `the rest delete, deactivate, change accounts or administer: ` +
        `${skipped.map((s) => `"${s.name}"`).join(', ')}. ` +
        'Name the journeys to take in journeys.names.',
    };
  }
  return { taken: safe.slice(0, wish.count), skipped };
}

function choosePreferred(
  proposals: readonly Proposal[],
  prefer: readonly string[],
  count: number,
  safe: readonly string[],
  skipped: { name: string; reason: string }[],
  risks: ReadonlyMap<string, string>,
): JourneyChoice {
  const taken: string[] = [];
  const notes: string[] = [];
  for (const source of prefer.slice(0, count)) {
    const pattern = new RegExp(source, PREFER_FLAGS);
    const byName = proposals.filter((item) => pattern.test(item.name));
    // The kind label (`[journey]`) is the view's, not a step: it is not matched.
    const bySteps = proposals.filter((item) => pattern.test(item.steps.replace(KIND_LABEL, '')));
    const free = (item: Proposal): boolean => !risks.has(item.name) && !taken.includes(item.name);
    // The name decides first, in the order of the proposals; the steps only when no name matches.
    const hit = byName.find(free) ?? (byName.length === 0 ? bySteps.find(free) : undefined);
    if (hit !== undefined) {
      taken.push(hit.name);
      notes.push(`journeys.prefer /${source}/ matched: "${hit.name}"`);
      continue;
    }
    const hits = [...byName, ...bySteps.filter((item) => !byName.includes(item))];
    const left = hits.filter((item) => risks.has(item.name));
    if (hits.length === 0) {
      notes.push(`journeys.prefer /${source}/ matched no proposal`);
    } else if (left.length === hits.length) {
      notes.push(
        `journeys.prefer /${source}/ matched only proposals left out: ` +
          left.map((item) => `"${item.name}" (${risks.get(item.name) ?? ''})`).join('; '),
      );
    } else {
      notes.push(`journeys.prefer /${source}/ matched only proposals already taken`);
    }
  }
  const missing = count - taken.length;
  const filler = safe.filter((name) => !taken.includes(name)).slice(0, missing);
  for (const name of filler) notes.push(`taken by the default choice instead: "${name}"`);
  const all = [...taken, ...filler];
  if (all.length < count) {
    return {
      taken: [],
      skipped,
      notes,
      problem:
        `${String(all.length)} safe proposals found for journeys.prefer and the default choice ` +
        `(needed ${String(count)}); the rest delete, deactivate, change accounts or administer: ` +
        `${skipped.map((s) => `"${s.name}"`).join(', ')}. ` +
        'Name the journeys to take in journeys.names.',
    };
  }
  return { taken: all, skipped, notes };
}

/** The run a `run_start` result names: the id from its live page, the short handle from the end line. */
export function executionFromText(text: string): { id: string; handle: string } | undefined {
  const id = /\/executions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//u.exec(
    text,
  )?.[1];
  if (id === undefined) return undefined;
  return { id, handle: `e-${id.slice(0, 8)}` };
}

/** Replaces every occurrence of every secret; applied to everything the gate writes. */
export function scrubber(secrets: readonly string[]): (text: string) => string {
  const needles = secrets.filter((secret) => secret.length >= 4);
  return (text) => needles.reduce((all, needle) => all.split(needle).join('[secret]'), text);
}

// ---- the cost counter -----------------------------------------------------------------------

export interface CostCounter {
  /** US dollars of model calls the backend reported since the gate started. */
  read(): Promise<number>;
}

export function langfuseCounter(
  config: GateConfig['langfuse'],
  keys: { publicKey: string; secretKey: string },
  since: Date,
): CostCounter {
  const path = config.api === 'v2' ? '/api/public/v2/metrics' : '/api/public/metrics';
  const auth = `Basic ${Buffer.from(`${keys.publicKey}:${keys.secretKey}`).toString('base64')}`;
  return {
    async read() {
      const query = {
        view: 'observations',
        metrics: [{ measure: 'totalCost', aggregation: 'sum' }],
        dimensions: [],
        filters: [
          {
            column: 'environment',
            operator: '=',
            value: config.environment.trim(),
            type: 'string',
          },
        ],
        fromTimestamp: since.toISOString(),
        toTimestamp: new Date(Date.now() + 60_000).toISOString(),
      };
      const url = new URL(path, config.url);
      url.searchParams.set('query', JSON.stringify(query));
      const response = await fetch(url, {
        headers: { authorization: auth, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      }).catch((error: unknown) => {
        // `fetch failed` alone does not say whether the connection was refused, reset or too slow.
        const cause = error instanceof Error ? error.cause : undefined;
        const code = isObject(cause) && typeof cause.code === 'string' ? ` [${cause.code}]` : '';
        throw new Error(`${error instanceof Error ? error.message : String(error)}${code}`, {
          cause: error,
        });
      });
      if (!response.ok)
        throw new Error(`the cost counter answered HTTP ${String(response.status)}`);
      const body: unknown = await response.json();
      const rows = isObject(body) && Array.isArray(body.data) ? body.data : undefined;
      if (rows === undefined) throw new Error('the cost counter answered without a data list');
      let total = 0;
      for (const row of rows) {
        const value = isObject(row) ? row.sum_totalCost : undefined;
        const number = typeof value === 'string' ? Number(value) : value;
        if (number === null || number === undefined) continue;
        if (typeof number !== 'number' || !Number.isFinite(number)) {
          throw new Error('the cost counter answered with a cost that is not a number');
        }
        total += number;
      }
      return total;
    },
  };
}

// ---- the backend, read directly -------------------------------------------------------------

export class Backend {
  readonly #origin: string;
  readonly #token: string;

  constructor(origin: string, token: string) {
    this.#origin = origin;
    this.#token = token;
  }

  async request(
    method: string,
    path: string,
    json?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${this.#origin}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: 'application/json',
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      // A redirect would lead to an address the checks before the start never saw.
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  async get(path: string): Promise<unknown> {
    const { status, body } = await this.request('GET', path);
    if (status !== 200) throw new Error(`GET ${path} answered HTTP ${String(status)}`);
    return body;
  }
}

/** What the gate says in the report about the project setting it changed. */
export const PROBES_NOTE = "probes enabled by the gate (the equivalent of the user's setting)";

/**
 * Turns on the probes of a project: the project setting a user switches on in the frontend
 * (`PUT /projects/{id}/gatling/project` with `probes_enabled`), without which `data_create_accounts`
 * and the self-check refuse to send requests to the target. Only for the project the gate created
 * in this run (its name is the one the gate gave it), and the result is read back with a GET.
 * Returns the problems found; empty when the setting is on.
 */
export async function enableProbes(
  api: Pick<Backend, 'request'>,
  projectId: string,
  projectName: string,
): Promise<string[]> {
  const detail = await api.request('GET', `/projects/${projectId}`);
  const found = isObject(detail.body) ? detail.body.name : undefined;
  if (detail.status !== 200 || found !== projectName) {
    return [
      `project ${projectId} is not the project this run created ("${projectName}"); the gate does not change its probes`,
    ];
  }
  const settings = `/projects/${projectId}/gatling/project`;
  const put = await api.request('PUT', settings, { probes_enabled: true });
  if (put.status !== 200) return [`PUT ${settings} answered HTTP ${String(put.status)}`];
  const read = await api.request('GET', settings);
  if (read.status !== 200) return [`GET ${settings} answered HTTP ${String(read.status)}`];
  const on = isObject(read.body) && read.body.probes_enabled === true;
  return on ? [] : [`the backend still shows probes_enabled=false after the PUT of ${settings}`];
}

interface EnvironmentRow {
  id: string;
  name: string;
  protected: boolean;
  workload_caps: { max_vu?: number | null; max_rps?: number | null } | null;
  /** The fixed headers; a value the backend considers secret is shown as its mask. */
  default_headers?: Record<string, unknown> | null;
}

interface ScenarioRow {
  id: string;
  name: string;
  source_flow_id: string | null;
  current_version: number | null;
  self_check: { status: string } | null;
  feeder_slots: {
    slot: string;
    label: string | null;
    identity_kind: string | null;
    role: string | null;
  }[];
}

interface ExecutionRow {
  id: string;
  status: string;
  sla_verdict: { status: string; reason?: string | null } | null;
  warnings: string[];
  run_manifest: {
    target_environment_id?: string | null;
    workload?: { value?: { type?: string; vusers?: number; ramp?: number } } | null;
  } | null;
}

interface DescribeRunRow {
  status: string;
  awaiting: boolean;
  approved: string[];
  paths: { name: string; status: string; flowId: string | null; reason: string | null }[];
}

function arrayAt(body: unknown, key: string): Record<string, unknown>[] {
  const value = isObject(body) ? body[key] : undefined;
  return Array.isArray(value) ? value.filter(isObject) : [];
}

const reads = {
  async environments(api: Backend, projectId: string): Promise<EnvironmentRow[]> {
    return arrayAt(await api.get(`/projects/${projectId}/environments`), 'items') as never;
  },
  async flows(api: Backend, projectId: string): Promise<{ id: string; name: string }[]> {
    return arrayAt(await api.get(`/projects/${projectId}/flows?limit=100`), 'flows') as never;
  },
  async flowFacts(api: Backend, projectId: string, flowId: string): Promise<HarFlowFacts> {
    const body = await api.get(`/projects/${projectId}/flows/${flowId}`);
    const blocks = isObject(body) && Array.isArray(body.blocks) ? body.blocks.filter(isObject) : [];
    const sourceOf = (block: Record<string, unknown>): unknown =>
      isObject(block.config) ? block.config.source : block.source;
    return {
      name: isObject(body) ? String(body.name) : flowId,
      requests: blocks.filter((block) => block.type === 'request').length,
      recordedPauses: blocks.filter(
        (block) => block.type === 'pause' && sourceOf(block) === 'recording',
      ).length,
    };
  },
  async scenarios(api: Backend, projectId: string): Promise<ScenarioRow[]> {
    const rows = arrayAt(
      await api.get(`/projects/${projectId}/gatling/scenarios?limit=100`),
      'scenarios',
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      source_flow_id: typeof row.source_flow_id === 'string' ? row.source_flow_id : null,
      current_version: typeof row.current_version === 'number' ? row.current_version : null,
      self_check: isObject(row.self_check) ? { status: String(row.self_check.status) } : null,
      feeder_slots: (Array.isArray(row.feeder_slots) ? row.feeder_slots : [])
        .filter(isObject)
        .map((slot) => ({
          slot: String(slot.slot),
          label: typeof slot.label === 'string' ? slot.label : null,
          identity_kind: typeof slot.identity_kind === 'string' ? slot.identity_kind : null,
          role: typeof slot.role === 'string' ? slot.role : null,
        })),
    }));
  },
  async scenario(api: Backend, projectId: string, id: string): Promise<ScenarioRow['self_check']> {
    const body = await api.get(`/projects/${projectId}/gatling/scenarios/${id}`);
    const check = isObject(body) ? body.self_check : undefined;
    return isObject(check) ? { status: String(check.status) } : null;
  },
  async compositions(api: Backend, projectId: string): Promise<{ id: string; name: string }[]> {
    return arrayAt(
      await api.get(`/projects/${projectId}/gatling/compositions?limit=100`),
      'compositions',
    ) as never;
  },
  async executionRows(api: Backend, projectId: string): Promise<{ id: string; status: string }[]> {
    return arrayAt(
      await api.get(`/projects/${projectId}/gatling/executions?limit=100`),
      'executions',
    ).map((row) => ({ id: String(row.id), status: String(row.status) }));
  },
  async flowBody(api: Backend, projectId: string, flowId: string): Promise<unknown> {
    return api.get(`/projects/${projectId}/flows/${flowId}`);
  },
  /** The runs of a description the token's user started in the project, newest first. */
  async describeRuns(api: Backend, projectId: string): Promise<{ id: string; status: string }[]> {
    return arrayAt(
      await api.get(`/projects/${projectId}/scenario-from-description/runs?status=all&limit=100`),
      'runs',
    ).map((row) => ({ id: String(row.run_id), status: String(row.status) }));
  },
  async describeRun(api: Backend, projectId: string, runId: string): Promise<DescribeRunRow> {
    const body = await api.get(`/projects/${projectId}/scenario-from-description/runs/${runId}`);
    if (!isObject(body)) throw new Error(`the run ${runId} is not a JSON object`);
    return {
      status: String(body.status),
      awaiting: body.awaiting_split_approval === true,
      approved: Array.isArray(body.approved_paths_names)
        ? body.approved_paths_names.map(String)
        : [],
      paths: (Array.isArray(body.paths) ? body.paths : []).filter(isObject).map((item) => ({
        name: String(item.name),
        status: String(item.status),
        flowId: typeof item.flow_id === 'string' ? item.flow_id : null,
        reason: typeof item.failure_reason === 'string' ? item.failure_reason : null,
      })),
    };
  },
  async executionIds(api: Backend, projectId: string): Promise<string[]> {
    return arrayAt(
      await api.get(`/projects/${projectId}/gatling/executions?limit=100`),
      'executions',
    ).map((row) => String(row.id));
  },
  async execution(api: Backend, projectId: string, id: string): Promise<ExecutionRow> {
    const body = await api.get(`/projects/${projectId}/gatling/executions/${id}`);
    if (!isObject(body)) throw new Error(`the run ${id} is not a JSON object`);
    return {
      id: String(body.id),
      status: String(body.status),
      sla_verdict: isObject(body.sla_verdict)
        ? {
            status: String(body.sla_verdict.status),
            reason: typeof body.sla_verdict.reason === 'string' ? body.sla_verdict.reason : null,
          }
        : null,
      warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
      run_manifest: isObject(body.run_manifest) ? (body.run_manifest as never) : null,
    };
  },
};

/** Every project of the instance, page by page (`GET /api/v1/projects`). */
async function listProjects(api: Backend): Promise<{ id: string; name: string }[]> {
  const page = 100;
  const all: { id: string; name: string }[] = [];
  for (let offset = 0; offset < 100 * page; offset += page) {
    const rows = arrayAt(
      await api.get(`/projects?limit=${String(page)}&offset=${String(offset)}`),
      'projects',
    );
    for (const row of rows) all.push({ id: String(row.id), name: String(row.name) });
    if (rows.length < page) break;
  }
  return all;
}

/** Names the gate gives its projects: `<prefix>-YYYYMMDD-HHMMSS`. */
export function isGateProject(name: string, prefix: string): boolean {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped}-\\d{8}-\\d{6}$`, 'u').test(name);
}

/** The command that deletes a project the gate left behind; the token stays in the variable. */
export function deleteCommand(origin: string, projectId: string): string {
  return `curl -X DELETE -H "Authorization: Bearer $LIVE_GATE_API_TOKEN" ${origin}/api/v1/projects/${projectId}`;
}

/**
 * Projects a previous gate left behind (a failed or stopped run keeps its project). A new run
 * does not start next to them unless `--reuse` says so: the coordinator decides whether they are
 * inspected or deleted first.
 */
async function leftoverRefusal(
  api: Backend,
  origin: string,
  prefix: string,
): Promise<string | undefined> {
  const leftovers = (await listProjects(api)).filter((project) =>
    isGateProject(project.name, prefix),
  );
  if (leftovers.length === 0) return undefined;
  return [
    `${String(leftovers.length)} project(s) of an earlier gate run are still on the backend:`,
    ...leftovers.map(
      (project) => `  - ${project.name} (${project.id}): ${deleteCommand(origin, project.id)}`,
    ),
    'Inspect and delete them, or start with --reuse to run next to them (they stay untouched).',
  ].join('\n');
}

// ---- the run --------------------------------------------------------------------------------

/** One tool call of a step, as the report lists it. */
export interface CallRecord {
  readonly tool: string;
  readonly args: unknown;
  readonly ms: number;
  readonly isError: boolean;
  readonly text: string;
}

type StepStatus = 'passed' | 'failed' | 'needs human' | 'skipped' | 'not run';

export interface StepRecord {
  readonly number: number;
  readonly name: string;
  readonly tool: string;
  status: StepStatus;
  ms: number;
  costUsd: number | null;
  readonly calls: CallRecord[];
  /** Checks of the effect: what was expected and what the backend shows. */
  readonly checks: { readonly ok: boolean; readonly what: string }[];
  /** Differences from the expected course that do not fail the step. */
  readonly differences: string[];
  failure?: string;
}

class StepFailure extends Error {}

/** Stops the run from outside the step: the cost or the time limit. */
class Interrupt extends Error {}

/** An operation waits for a person (a request for help): the gate ends as "needs a human". */
class NeedsHuman extends Error {}

export interface RunState {
  projectId?: string | undefined;
  projectName: string;
  mainEnvId?: string | undefined;
  cappedEnvId?: string | undefined;
  journeys: string[];
  /** Credentials of the recording of the scenario `har`: looked for in every answer, masked in the report. */
  recordingSecrets: readonly string[];
  flowIds: Map<string, string>;
  scenarioIds: string[];
  mainRun?: { id: string; handle: string } | undefined;
  /** The clamped run of the scenario `protected`: its handle and the users its manifest records. */
  cappedRun?: { handle: string; vusers: number } | undefined;
  /** The last operation the gate saw unfinished, cancelled if the run stops meanwhile. */
  pending?: string | undefined;
  /** Every tool call of the run, for the search of the password of the account. */
  readonly calls: CallRecord[];
  /** The run of the scenario `describe`: its plan, its id, the paths and how the channel answered. */
  readonly describe: {
    plan?: string | undefined;
    runId?: string | undefined;
    paths: Proposal[];
    /** The plan has one path: LoadCraft did not split the description and walks it at once. */
    single?: boolean | undefined;
    /** The walk ended: nothing of it is left to stop. */
    ended: boolean;
    handshake?: Handshake | undefined;
  };
  /** While the paths are walked: when the time limit of the walk is reached (clock of the gate). */
  walkDeadline?: { readonly at: number; readonly minutes: number } | undefined;
}

export interface Session {
  readonly client: Client;
  readonly api: Backend;
  readonly config: GateConfig;
  readonly workspace: string;
  readonly state: RunState;
  signal: AbortSignal;
  /** The clock of the time limits. */
  readonly now: () => number;
  /** The password of the account: looked for in every answer, never written. */
  readonly watched: readonly string[];
}

const CALL_TIMEOUT_MS = 330_000;
/** Tools with `max_wait_s`, the ones that wait for a long operation. */
const WAITING_TOOLS: ReadonlySet<string> = new Set([
  'project_analyze_setup',
  'flows_suggest_journeys',
  'flows_generate_from_suggestions',
  'flows_generate_from_endpoints',
  'flows_generate_from_har',
  'scenario_generate',
  'run_start',
  'results_analyze_run',
  'flows_describe_journeys',
  'flows_record_journeys',
  'process_wait',
]);
/** The follow-up calls of one step (`process_wait` and repeated calls together) before the gate gives up. */
export const MAX_CONTINUATIONS = 60;

/**
 * The tool a result asks to call again with the same arguments to FINISH the operation (the
 * generation of one scenario ends, the next call composes), read from the phrase of the plugin
 * (`buildScenario.generationDone` in `render/i18n/en.ts`). A hint that sends the model back after a
 * failure (“call … again with the same arguments: …”) has no “to finish” and is not read as one.
 * `test/liveGate.continue.test.ts` holds this pattern to the dictionary of the plugin.
 */
const FINISH_BY_CALLING_AGAIN = /\bCall ([a-z_]+) again with the same arguments to finish\b/u;

export function continuationOf(text: string): string | undefined {
  return FINISH_BY_CALLING_AGAIN.exec(text)?.[1];
}

function textOf(result: unknown): string {
  const content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  return content
    .filter(isObject)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

async function call(
  session: Session,
  step: StepRecord,
  tool: string,
  args: unknown,
): Promise<CallRecord> {
  const started = Date.now();
  const maxWait = session.config.maxWaitS;
  const sent =
    maxWait !== undefined && WAITING_TOOLS.has(tool) && isObject(args)
      ? { ...args, max_wait_s: maxWait }
      : args;
  const result = await session.client.callTool(
    { name: tool, arguments: sent as Record<string, unknown> },
    { signal: session.signal, timeout: CALL_TIMEOUT_MS },
  );
  const record: CallRecord = {
    tool,
    args: sent,
    ms: Date.now() - started,
    isError: isObject(result) && result.isError === true,
    text: textOf(result),
  };
  step.calls.push(record);
  session.state.calls.push(record);
  return record;
}

/**
 * One call and, while its text says the operation goes on, `process_wait` with its handle; when the result
 * (or the one of `process_wait`) asks to call the same tool again with the same arguments to finish, that
 * call is made, identical. Waits and repeated calls count together against MAX_CONTINUATIONS.
 */
export async function callToEnd(
  session: Session,
  step: StepRecord,
  tool: string,
  args: unknown,
): Promise<CallRecord> {
  let last = await call(session, step, tool, args);
  let repeats = 0;
  for (let again = 0; again < MAX_CONTINUATIONS; again += 1) {
    if (last.isError) break;
    const pending = pendingOperation(last.text);
    if (pending === undefined) {
      session.state.pending = undefined;
      if (continuationOf(last.text) !== tool) return last;
      repeats += 1;
      step.differences.push(
        `${tool} called again with the same arguments to finish (${String(repeats)}): ${firstLine(last.text)}`,
      );
      last = await call(session, step, tool, args);
      continue;
    }
    if (pending.kind === 'needs_user') {
      // Cancelled when the gate ends: nobody will help while it is away.
      session.state.pending = pending.handle;
      throw new NeedsHuman(
        `the operation ${pending.handle} waits for a person: ${firstLine(last.text)}`,
      );
    }
    session.state.pending = pending.handle;
    last = await call(session, step, 'process_wait', { operation: pending.handle });
  }
  if (last.isError)
    throw new StepFailure(`the tool answered with an error: ${firstLine(last.text)}`);
  throw new StepFailure(
    `the operation did not end after ${String(MAX_CONTINUATIONS)} follow-up calls (waits and repeated calls)`,
  );
}

/** What a result says before the call it names next, on one line (the view wraps it). */
function resultSummary(text: string): string {
  const said = text.split('\n→ ')[0]?.replace(/\s+/gu, ' ').trim() ?? '';
  return said === '' ? '(empty)' : said;
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? '(empty)';
}

/** `failed` is what the report says when the check fails; it defaults to `what`. */
export function check(step: StepRecord, ok: boolean, what: string, failed: string = what): void {
  step.checks.push({ ok, what: ok ? what : failed });
  if (!ok) throw new StepFailure(failed);
}

/**
 * A check of what the backend shows. Passed: the expectation and the backend's value. Failed: the
 * report says what the backend has, so a failure never reads like the expectation that was met.
 */
export function checkBackend(
  step: StepRecord,
  ok: boolean,
  expected: string,
  backend: string,
): void {
  check(
    step,
    ok,
    `${expected} (backend: ${backend})`,
    `expected ${expected}; the backend has ${backend}`,
  );
}

/** A check of the status of an object in the backend against the one it must have. */
export function checkStatus(step: StepRecord, subject: string, got: string, want: string): void {
  check(
    step,
    got === want,
    `${subject} ${want} (backend: ${got})`,
    `${subject}: backend status is ${got}; expected ${want}`,
  );
}

function requireOk(record: CallRecord): void {
  if (record.isError)
    throw new StepFailure(`the tool answered with an error: ${firstLine(record.text)}`);
}

function evenSplit(names: readonly string[]): Record<string, number> {
  const base = Math.floor(100 / names.length);
  let rest = 100 - base * names.length;
  return Object.fromEntries(
    names.map((name) => {
      const share = base + (rest > 0 ? 1 : 0);
      rest -= 1;
      return [name, share];
    }),
  );
}

/** How many accounts to create for a slot; the backend's `need` never takes it past the ceiling. */
export function accountCount(accounts: number, need: number | null): number {
  const count = Math.max(accounts, need ?? 0);
  if (count > MAX_ACCOUNTS) {
    throw new Error(
      `the slot needs ${String(count)} accounts, above the ceiling of ${String(MAX_ACCOUNTS)} the gate creates; ` +
        'create them by hand or run the gate on a smaller profile.',
    );
  }
  return count;
}

// ---- accounts from a file -------------------------------------------------------------------

/** Where the copy of the accounts file lies in the gate's workspace, the only path the tool is given. */
export const ACCOUNTS_COPY_PATH = 'loadcraft/accounts.csv';

/** The tool that loads an accounts file (`file` with `scenario` and `slot`); it also makes the rows of a slot. */
export const ACCOUNTS_FILE_TOOL = 'data_create_dataset';
/** The read-only data plan of a target, with the calls that fill its slots of plain data. */
export const DATA_PLAN_TOOL = 'data_check_readiness';
/** The tool that pins datasets to the slots of a target (the whole map at once). */
export const BINDINGS_TOOL = 'data_set_bindings';

// ---- the calls a data result names ----------------------------------------------------------

/** A call a result names as the way on, with the arguments to pass as they are. */
export interface NamedCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/**
 * The token of a consent card, read from the phrase of the plugin (`data.card.next` in
 * `render/i18n/en.ts`); the text is read with its line breaks undone, since the card wraps it.
 * The tools answer with text only, so the token is read where a model reads it.
 */
const CONSENT_CARD = /\bcall ([a-z_]+) again with the same arguments and confirm: "([^"\s]+)"/u;

export function consentOf(text: string): { tool: string; token: string } | undefined {
  const found = CONSENT_CARD.exec(text.replace(/\s+/gu, ' '));
  return found === null ? undefined : { tool: found[1] ?? '', token: found[2] ?? '' };
}

/** Where a JSON value of a call ends: the first comma outside strings, maps and lists. */
function valueEnd(text: string): number {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '\\') i += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) return i;
  }
  return text.length;
}

/**
 * A call as a data view prints it (`callPieces` in `render/views/data.ts`): the tool, then
 * `key: <JSON>` separated by commas; undefined when it does not read as one.
 */
export function callFromText(text: string): NamedCall | undefined {
  const head = /^([a-z_]+)(?: |$)/u.exec(text.trim());
  if (head === null) return undefined;
  const args: Record<string, unknown> = {};
  let rest = text.trim().slice(head[0].length).trim();
  while (rest !== '') {
    const key = /^([a-z_][a-z0-9_]*): /u.exec(rest);
    if (key === null) return undefined;
    rest = rest.slice(key[0].length);
    const end = valueEnd(rest);
    try {
      args[key[1] ?? ''] = JSON.parse(rest.slice(0, end)) as unknown;
    } catch {
      return undefined;
    }
    rest = rest.slice(end + 1).trim();
  }
  return { tool: head[1] ?? '', args };
}

/** The lines of one call: the first after its lead, then the indented lines that continue it. */
function callAt(lines: readonly string[], at: number, lead: number): NamedCall | undefined {
  const parts = [(lines[at] ?? '').slice(lead)];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\s+\S/u.test(line)) break;
    parts.push(line.trim());
  }
  return callFromText(parts.join(' '));
}

/**
 * The numbered calls a data result lists under its header (`data.steps` and `data.steps.suggested`
 * in `render/i18n/en.ts`: “the call(s) that …:”), in their order.
 */
export function stepsFromText(text: string): NamedCall[] {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => /^the calls? that .*:$/u.test(line));
  if (header < 0) return [];
  const steps: NamedCall[] = [];
  for (let i = header + 1; i < lines.length; i += 1) {
    const number = /^\d+\. /u.exec(lines[i] ?? '');
    if (number === null) continue;
    const step = callAt(lines, i, number[0].length);
    if (step !== undefined) steps.push(step);
  }
  return steps;
}

/** The call a data result names as the next one (`data.steps.next`: “→ next: …”). */
export function nextCallOf(text: string): NamedCall | undefined {
  const lead = '→ next: ';
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.startsWith(lead));
  return at < 0 ? undefined : callAt(lines, at, lead.length);
}

/** The path of the accounts file of the configuration; none when the accounts are made by number. */
export function accountsFileOf(accounts: GateConfig['accounts']): string | undefined {
  return typeof accounts === 'object' ? accounts.file : undefined;
}

/** The rows of a CSV text as cells (quotes and doubled quotes), separator found from the header line. */
function csvCells(text: string): string[][] {
  const header = text.split(/\r?\n/u, 1)[0] ?? '';
  const separator = [',', ';', '\t'].find((item) => header.includes(item)) ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"' && text.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(i + 1) === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((item) => item !== '')) rows.push(row);
  return rows;
}

/**
 * The accounts file for the gate's workspace and the passwords to look for in everything the gate
 * writes, or why the file cannot be used. The file goes into the workspace unchanged; a refusal
 * never quotes a cell. A file with no password column, or with a password shorter than the search
 * can tell from ordinary words, is refused: the search for passwords would prove nothing on it.
 */
export function accountsFileCopy(
  text: string,
): { files: Record<string, string>; watched: string[]; rows: number } | { refusal: string } {
  const [header, ...rows] = csvCells(text);
  if (header === undefined) return { refusal: 'the accounts file is empty' };
  if (rows.length === 0) return { refusal: 'the accounts file has no row of accounts' };
  const secretColumns = header.flatMap((name, index) => (SECRET_NAME.test(name) ? [index] : []));
  if (secretColumns.length === 0) {
    return {
      refusal:
        'the accounts file has no column with a password in its header, so the search for the passwords would prove nothing',
    };
  }
  const watched: string[] = [];
  for (const [position, row] of rows.entries()) {
    for (const column of secretColumns) {
      const value = row[column] ?? '';
      if (value === '') continue;
      if (value.length < MIN_LEAK_LENGTH) {
        return {
          refusal:
            `line ${String(position + 2)} of the accounts file has a password shorter than ` +
            `${String(MIN_LEAK_LENGTH)} characters: a shorter value is not looked for in the answers`,
        };
      }
      watched.push(value);
    }
  }
  if (watched.length === 0) {
    return { refusal: 'the accounts file has a password column but no password in it' };
  }
  return {
    files: { [ACCOUNTS_COPY_PATH]: text },
    watched: [...new Set(watched)],
    rows: rows.length,
  };
}

/** The files of the gate's workspace that hold a secret are readable by their owner only. */
const PRIVATE_FILES: readonly string[] = [ACCOUNTS_COPY_PATH];

/** Writes `files` under `workspace`; a file with passwords in it gets the mode 0600. */
export function writeWorkspaceFiles(
  workspace: string,
  files: Readonly<Record<string, string>>,
): void {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(workspace, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, PRIVATE_FILES.includes(relative) ? { mode: 0o600 } : {});
    if (PRIVATE_FILES.includes(relative)) chmodSync(target, 0o600);
  }
}

/** The report line of a slot loaded from the accounts file: the rows before and after the call. */
export function accountsFileLine(
  before: { readonly slot: string; readonly have: number | null; readonly need: number | null },
  key: string,
  after: { readonly have: number | null } | undefined,
): string {
  const rows = `${String(before.have)} → ${String(after?.have ?? null)} rows (needed ${String(before.need)})`;
  const grown = (after?.have ?? 0) - (before.have ?? 0);
  return (
    `slot "${before.slot}" (${key}): ${rows}; ` +
    (grown > 0
      ? `accounts loaded from the file: ${String(grown)}`
      : 'no account was added to the slot')
  );
}

// ---- the tool that creates accounts ---------------------------------------------------------

/**
 * The report line of a slot that `data_create_accounts` worked on: written only after the call
 * answered, and the number comes from the slot's rows before and after (the backend's preflight),
 * not from what the gate asked for.
 */
export function accountsLine(
  before: { readonly slot: string; readonly have: number | null; readonly need: number | null },
  key: string,
  after: { readonly have: number | null } | undefined,
): string {
  const rows = `${String(before.have)} → ${String(after?.have ?? null)} rows (needed ${String(before.need)})`;
  const grown = (after?.have ?? 0) - (before.have ?? 0);
  return (
    `slot "${before.slot}" (${key}): ${rows}; ` +
    (grown > 0 ? `accounts created: ${String(grown)}` : 'no account was added to the slot')
  );
}

/** Key of the slot that holds the accounts of users, in the preflight and in the call that fills it. */
const ACCOUNTS_SLOT = 'accounts';

/** The tool that creates accounts for a slot. The only place that names it. */
export const PROVISION_TOOL = 'data_create_accounts';

/** One call that creates `count` accounts for `slot` on `environment`; the user agreed when `confirmed`. */
export function provisionCall(
  composition: string,
  environment: string,
  account: { readonly slot: string; readonly count: number },
  confirmed = false,
): { readonly tool: string; readonly args: Record<string, unknown> } {
  return {
    tool: PROVISION_TOOL,
    args: {
      scenario: composition,
      environment,
      slot: account.slot,
      count: account.count,
      ...(confirmed ? { confirm_protected: true } : {}),
    },
  };
}

// ---- the recording --------------------------------------------------------------------------

/** Where the recording lies in the gate's workspace; it is a visible directory, not a hidden one. */
export const RECORDING_PATH = 'loadcraft/recording.har';
/** A secret shorter than this is not looked for in the answers: it would match ordinary words. */
const MIN_LEAK_LENGTH = 8;
const SECRET_HEADER =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-session-id|x-amz-security-token)$/iu;
/** A copy of the rule of `isSecretField` in src/security/secretFields.ts: a name that says the value is secret. */
const SECRET_NAME =
  /pass(?:word|wd|phrase)|pwd|has[lł]o|secret|token|credential|(?:api|private|access)[_-]?key|^key$|authorization|cookie/iu;

function stringsOf(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (isObject(value)) for (const item of Object.values(value)) stringsOf(item, out);
}

/** Strings a JSON body holds under a field of a secret name, at any depth. */
function secretsOfBody(text: unknown, out: string[]): void {
  if (typeof text !== 'string' || text === '') return;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (SECRET_NAME.test(key)) stringsOf(item, out);
        else walk(item);
      }
    }
  };
  try {
    walk(JSON.parse(text));
  } catch {
    for (const [key, value] of new URLSearchParams(text)) {
      if (SECRET_NAME.test(key)) out.push(value);
    }
  }
}

function pairsOf(value: unknown): { name?: unknown; value?: unknown }[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * The credentials a recording holds: values of credential headers (and the tokens and cookie values
 * inside them), cookies, and fields with secret names in the query, forms and JSON bodies. The
 * gate masks them in everything it writes and fails a step whose answer shows one of them. This
 * follows `recordingSecrets` in src/tools/flowsImportHar.ts; values shorter than 8 characters are left
 * out because they would match ordinary words of an answer.
 */
export function harSecretValues(content: string): string[] {
  let har: unknown;
  try {
    har = JSON.parse(content);
  } catch {
    return [];
  }
  const entries = isObject(har) && isObject(har.log) ? har.log.entries : undefined;
  const found: string[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isObject(entry)) continue;
    for (const side of [entry.request, entry.response]) {
      if (!isObject(side)) continue;
      for (const header of pairsOf(side.headers)) {
        if (typeof header.name !== 'string' || typeof header.value !== 'string') continue;
        if (!SECRET_HEADER.test(header.name) && !SECRET_NAME.test(header.name)) continue;
        const lower = header.name.toLowerCase();
        found.push(header.value);
        if (lower === 'cookie') {
          found.push(
            ...header.value.split(';').map((part) => part.slice(part.indexOf('=') + 1).trim()),
          );
        } else if (lower === 'set-cookie') {
          found.push(header.value.split(';')[0]?.split('=').slice(1).join('=').trim() ?? '');
        } else if (header.value.includes(' ')) {
          found.push(header.value.slice(header.value.indexOf(' ') + 1).trim());
        }
      }
      for (const cookie of pairsOf(side.cookies)) {
        if (typeof cookie.value === 'string') found.push(cookie.value);
      }
      const post = isObject(side.postData) ? side.postData : undefined;
      for (const field of [...pairsOf(side.queryString), ...pairsOf(post?.params)]) {
        if (
          typeof field.name === 'string' &&
          typeof field.value === 'string' &&
          SECRET_NAME.test(field.name)
        ) {
          found.push(field.value);
        }
      }
      secretsOfBody(post?.text, found);
      secretsOfBody(isObject(side.content) ? side.content.text : undefined, found);
    }
  }
  return [...new Set(found.filter((value) => value.length >= MIN_LEAK_LENGTH))];
}

/** How many of `secrets` appear in `texts`. A count, never the values: they must not be written. */
export function leakedSecrets(texts: readonly string[], secrets: readonly string[]): number {
  return secrets.filter(
    (secret) => secret.length >= MIN_LEAK_LENGTH && texts.some((text) => text.includes(secret)),
  ).length;
}

/** What the gate reads of a flow the recording gave. */
export interface HarFlowFacts {
  readonly name: string;
  readonly requests: number;
  /** Pauses whose source is the recording (the think time the person had). */
  readonly recordedPauses: number;
}

/**
 * Why the flows of a recording do not prove the split and the pauses. A split into journeys gives
 * one flow for each of them, a call without a split gives one; and a flow made from a recording
 * keeps the pauses the person made between requests (`source: recording`), the other sources are
 * defaults. A short flow without pauses is no failure while another one has them.
 */
export function harFlowProblems(flows: readonly HarFlowFacts[], minFlows: number): string[] {
  const problems: string[] = [];
  if (flows.length < minFlows) {
    problems.push(
      `${String(flows.length)} ${flows.length === 1 ? 'flow' : 'flows'} came out of the recording, ` +
        `at least ${String(minFlows)} are expected (a split gives one flow for each journey; ` +
        'fewer means the split through the HAR channel did not happen)',
    );
  }
  if (flows.length > 0 && flows.every((flow) => flow.recordedPauses === 0)) {
    problems.push('no flow has a pause taken from the recording');
  }
  return problems;
}

// ---- the protected environment --------------------------------------------------------------

/** The answer of a test that waits for the consent, in the words of the result of `run_start`. */
const ASKS_FOR_CONSENT = /not started:[\s\S]*nothing was sent/u;

/** Why a test on a protected environment without the consent of the user was not held back. */
export function withoutConsentProblems(
  text: string,
  before: readonly string[],
  after: readonly string[],
): string[] {
  const problems: string[] = [];
  if (!ASKS_FOR_CONSENT.test(text)) {
    problems.push('without consent the test is not started and the result does not ask for it');
  }
  if (after.some((run) => !before.includes(run))) {
    problems.push('a run was created without consent');
  }
  return problems;
}

/** Why the report of a clamped run does not say that its load was limited (requested and recorded). */
export function cappedReportProblems(text: string, requested: number, effective: number): string[] {
  const note = `load limited by the environment (${String(effective)} of ${String(requested)})`;
  return text.includes(note) ? [] : [`the report does not carry the note "${note}"`];
}

// ---- flows from a description ---------------------------------------------------------------

/** Where the account lies in the gate's workspace: `flows_describe_journeys` reads it from there. */
export const ACCOUNT_PATH = '.env';

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

/**
 * The values of an env file, read line by line the way the plugin reads them: a copy of `parseEnv`
 * in src/workspace/envFile.ts:86 @07c207e (`KEY=value`, `export KEY=value`, single quotes literal,
 * double quotes with `\n`, `\r`, `\t`, `\"`, `\\`, a `#` comment on its own line or after an unquoted
 * value when whitespace comes before it, a later assignment of a key wins).
 */
export function envValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    const line = raw.replace(/^[ \t]+/u, '');
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    let key = line.slice(0, equals).trim();
    if (/^export[ \t]/u.test(key)) key = key.slice(7).trim();
    const rest = line.slice(equals + 1).replace(/^[ \t]+/u, '');
    let value: string;
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let out = '';
      let closed = false;
      for (let i = 1; i < rest.length; i += 1) {
        const char = rest[i] ?? '';
        if (char === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && char === '\\' && i + 1 < rest.length) {
          const next = rest[i + 1] ?? '';
          out += DOUBLE_QUOTE_ESCAPES[next] ?? `\\${next}`;
          i += 1;
          continue;
        }
        out += char;
      }
      if (!closed) continue;
      value = out;
    } else {
      const comment = /[ \t]#/u.exec(rest);
      value = (comment === null ? rest : rest.slice(0, comment.index)).trim();
    }
    if (ENV_KEY.test(key)) values.set(key, value);
  }
  return values;
}

/** The account copied into the gate's workspace, and the password the gate looks for. */
export interface AccountCopy {
  /** The env file of the workspace: the login and the password, nothing else of the target's file. */
  readonly content: string;
  readonly password: string;
}

/**
 * The account of the LoadCraft browser from the target's env file. Only the two keys are copied,
 * in single quotes, which the plugin reads literally. The password is what the gate looks for in
 * every answer, so it must not be a word the answers hold anyway: at least 8 characters, not a part
 * of the description or of the login. The values are never written into a refusal.
 */
export function accountFile(
  text: string,
  described: GateDescription,
): AccountCopy | { readonly refusals: string[] } {
  const emailKey = described.emailKey ?? DEFAULT_EMAIL_KEY;
  const passwordKey = described.passwordKey ?? DEFAULT_PASSWORD_KEY;
  const values = envValues(text);
  const email = values.get(emailKey);
  const password = values.get(passwordKey);
  const refusals: string[] = [];
  for (const [key, value] of [
    [emailKey, email],
    [passwordKey, password],
  ] as const) {
    if (value === undefined) {
      refusals.push(`the env file has no ${key}`);
    } else if (value === '') {
      refusals.push(`${key} is empty in the env file`);
    } else if (/['\r\n]/u.test(value)) {
      refusals.push(
        `${key} holds a single quote or a line break, which the copy of the account cannot quote; ` +
          'give the account a value without them',
      );
    }
  }
  if (refusals.length > 0 || email === undefined || password === undefined) return { refusals };
  if (password.length < MIN_LEAK_LENGTH) {
    refusals.push(
      `the password (${passwordKey}) must have at least ${String(MIN_LEAK_LENGTH)} characters: a ` +
        'shorter one is found in ordinary words of the answers, so the search for it proves nothing',
    );
  } else if (described.description.toLowerCase().includes(password.toLowerCase())) {
    refusals.push(
      `the password (${passwordKey}) is a part of describe.description: the search for it would ` +
        'find the description in every call; give the account another password',
    );
  } else if (email.toLowerCase().includes(password.toLowerCase())) {
    refusals.push(
      `the password (${passwordKey}) is a part of the login: the search for it would find the ` +
        'login; give the account another password',
    );
  }
  if (refusals.length > 0) return { refusals };
  return {
    content:
      '# The account of the LoadCraft browser, copied by the live gate (only these two keys).\n' +
      `${emailKey}='${email}'\n${passwordKey}='${password}'\n`,
    password,
  };
}

/**
 * The gap after the name column of the view of `flows_describe_journeys` (src/render/views/describeFlows.ts:38
 * @07c207e); its arrow and indent are those of `flows_suggest_journeys`. The tests read the real view.
 */
const DESCRIBE_GAP = 2;
/** The first line of the plan in the view of `flows_describe_journeys` (locale `en`): `plan r-xxxxxxxx · …`. */
const PLAN_LINE = /^plan (r-[0-9a-f]{8})\b/mu;
/**
 * The count of paths in that line, in each locale of the view (`describe.paths` in
 * `render/i18n/{en,pl}.ts`: a test reads every plural form of both).
 */
const PLAN_COUNT = /^plan r-[0-9a-f]{8} · (\d+) (?:paths?|ścież(?:ka|ki|ek))(?![\p{L}])/mu;
const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
/** The run in LoadCraft: its live preview link, or the handle of the operation that follows it. */
const DESCRIBE_RUN = new RegExp(
  String.raw`(?:/scenario-from-description/runs/|record_run:)(${UUID})`,
  'u',
);

/** The plan a result of `flows_describe_journeys` shows: its handle, the run and the proposed paths. */
export interface PlanText {
  readonly plan?: string;
  readonly runId?: string;
  readonly paths: Proposal[];
  /** The count the header of the plan states (`· N paths`); a plan of one path has no steps to read. */
  readonly declared?: number;
}

/**
 * The plan read from the text of `flows_describe_journeys`, as a model reads it. Its paths are laid out
 * like the proposals of `flows_suggest_journeys` (a name column, the steps joined by arrows, a long name
 * alone on its line with the steps indented below), so they are read the same way, from the line
 * of the plan on. A plan of one path names it without steps (the walk began at once): no path to read, but its
 * header still counts it (`declared`).
 */
export function planFromText(text: string): PlanText {
  const head = PLAN_LINE.exec(text);
  if (head === null) return { paths: [] };
  const runId = DESCRIBE_RUN.exec(text)?.[1];
  const declared = PLAN_COUNT.exec(text)?.[1];
  return {
    plan: head[1] ?? '',
    ...(declared === undefined ? {} : { declared: Number(declared) }),
    ...(runId === undefined ? {} : { runId }),
    paths: proposalsFromText(text.slice(head.index), DESCRIBE_GAP),
  };
}

/** The run of the description named by any of `texts`. */
export function describeRunId(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const id = DESCRIBE_RUN.exec(text)?.[1];
    if (id !== undefined) return id;
  }
  return undefined;
}

export interface WalkChoice {
  /** What `flows_record_journeys` gets: `all` when every path is safe, else the names of the safe ones. */
  readonly approve: 'all' | string[];
  /** The names of the paths approved, in the order of the plan. */
  readonly names: string[];
  readonly skipped: { readonly name: string; readonly reason: string }[];
  readonly problem?: string;
}

/**
 * The paths the gate approves: every path of the plan that `riskOf` does not flag (it deletes or
 * deactivates something, changes accounts or permissions, or administers). The rest are left out
 * and named in the report.
 */
export function walkChoice(paths: readonly Proposal[]): WalkChoice {
  const names: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const item of paths) {
    const reason = riskOf(item);
    if (reason === undefined) names.push(item.name);
    else skipped.push({ name: item.name, reason });
  }
  if (names.length === 0) {
    return {
      approve: [],
      names,
      skipped,
      problem:
        `no path of the plan is safe to walk (${String(paths.length)} left out: ` +
        `${skipped.map((item) => `"${item.name}"`).join(', ')}); describe journeys that do not ` +
        'delete, change accounts or administer',
    };
  }
  return { approve: skipped.length === 0 ? 'all' : names, names, skipped };
}

/**
 * The classes of the action a person starts with a request (`config.action_start.class`): a copy of
 * `ActionClass` in src/flow/outline.ts:37 @07c207e.
 */
const ACTION_CLASSES: readonly string[] = ['page', 'form_submit', 'in_page', 'api_call'];

/** What the gate reads of a flow the walk saved. */
export interface DescribeFlowFacts {
  readonly name: string;
  readonly requests: number;
  /** Pauses LoadCraft assumed for a person (`source: default_human`). */
  readonly humanPauses: number;
  /** Of those, the ones before a request that carries the class of the action it starts. */
  readonly classifiedPauses: number;
}

/**
 * Counts the pauses of a person in a flow and, for each, the class of the action of the request
 * after it (the request the edges lead to from the pause, or the next one in the list of blocks
 * when the pause has no edge): what the outline of a flow shows as `assumed · form`.
 */
export function describeFlowFacts(flow: unknown): DescribeFlowFacts {
  const body = isObject(flow) ? flow : {};
  const blocks = Array.isArray(body.blocks) ? body.blocks.filter(isObject) : [];
  const byId = new Map(blocks.map((block) => [String(block.id), block]));
  const next = new Map<string, string>();
  for (const edge of Array.isArray(body.edges) ? body.edges.filter(isObject) : []) {
    const source = String(edge.source);
    if (!next.has(source)) next.set(source, String(edge.target));
  }
  const configOf = (block: Record<string, unknown> | undefined): Record<string, unknown> =>
    block !== undefined && isObject(block.config) ? block.config : {};
  const requestAfter = (index: number): Record<string, unknown> | undefined => {
    const start = blocks[index];
    let id = start === undefined ? undefined : next.get(String(start.id));
    if (id === undefined) return blocks.slice(index + 1).find((block) => block.type === 'request');
    for (let hops = 0; id !== undefined && hops < blocks.length; hops += 1) {
      const block = byId.get(id);
      if (block?.type === 'request') return block;
      id = next.get(id);
    }
    return undefined;
  };
  let humanPauses = 0;
  let classifiedPauses = 0;
  blocks.forEach((block, index) => {
    if (block.type !== 'pause' || configOf(block).source !== 'default_human') return;
    humanPauses += 1;
    const start = configOf(requestAfter(index)).action_start;
    const kind = isObject(start) ? start.class : undefined;
    if (typeof kind === 'string' && ACTION_CLASSES.includes(kind)) classifiedPauses += 1;
  });
  return {
    name: typeof body.name === 'string' ? body.name : '?',
    requests: blocks.filter((block) => block.type === 'request').length,
    humanPauses,
    classifiedPauses,
  };
}

/**
 * Why the saved flows do not hold the pauses of a person. LoadCraft puts an assumed pause before
 * every request after the first of a walked path, with the class of the action the person starts;
 * a flow of one request has nothing to pause before.
 */
export function describeFlowProblems(flows: readonly DescribeFlowFacts[]): string[] {
  return flows
    .filter((flow) => flow.requests >= 2 && flow.classifiedPauses === 0)
    .map(
      (flow) =>
        `flow "${flow.name}": ${String(flow.requests)} requests and no pause of a person with an ` +
        `action class (${String(flow.humanPauses)} pauses of a person)`,
    );
}

/** How the handshake of the run channel went, as the result of `flows_describe_journeys` shows it. */
export interface Handshake {
  readonly result: 'accepted' | 'refused' | 'unavailable' | 'not reached';
  readonly detail: string;
}

const CHANNEL_REFUSED = /^\[describe_channel_refused\][^(\n]*\(([^\n]*)\)\.?$/mu;

/**
 * The handshake of the run channel. The plan of the paths comes only through that channel, so a
 * plan in the text means the handshake was accepted; a refusal keeps its reason (the HTTP status
 * of a handshake refused before it was accepted, or the reason of the close code after it).
 */
export function handshakeOf(text: string): Handshake {
  if (/^\[describe_channel_refused\]/mu.test(text)) {
    return { result: 'refused', detail: CHANNEL_REFUSED.exec(text)?.[1] ?? firstLine(text) };
  }
  if (/^\[describe_channel_unavailable\]/mu.test(text)) {
    return { result: 'unavailable', detail: firstLine(text) };
  }
  if (planFromText(text).plan !== undefined) {
    return {
      result: 'accepted',
      detail:
        'the plan came through the channel of the run (the API token in a header, the Origin of LOADCRAFT_API_URL)',
    };
  }
  return { result: 'not reached', detail: firstLine(text) };
}

/** How many of `texts` show one of `secrets`: a count, never the values. */
export function answersWith(texts: readonly string[], secrets: readonly string[]): number {
  const needles = secrets.filter((secret) => secret.length >= MIN_LEAK_LENGTH);
  return texts.filter((text) => needles.some((needle) => text.includes(needle))).length;
}

function bindingProjectId(workspace: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(workspace, 'loadcraft', 'project.json'), 'utf8'),
    );
    const project = isObject(raw) && isObject(raw.project) ? raw.project : undefined;
    return typeof project?.id === 'string' ? project.id : undefined;
  } catch {
    return undefined;
  }
}

interface DryRunSlot {
  slot: string;
  /** Key of the slot as `data_create_accounts` takes it. */
  key: string | null;
  have: number | null;
  need: number | null;
  blocking?: boolean;
  status?: string;
}

async function preflight(
  session: Session,
  step: StepRecord,
  environment: string = session.config.environments.main.name,
): Promise<{ ready: boolean; slots: DryRunSlot[] }> {
  const record = await call(session, step, 'process_get_status', {
    preflight: {
      scenario: session.config.composition,
      environment,
      profile: profileArgs(session.config.profile),
    },
    format: 'data',
  });
  requireOk(record);
  let data: unknown;
  try {
    data = JSON.parse(record.text);
  } catch {
    throw new StepFailure(
      'process_get_status with format "data" did not answer with one JSON block',
    );
  }
  const facts = isObject(data) && isObject(data.data) ? data.data : undefined;
  if (facts === undefined) throw new StepFailure('the preflight facts have no data section');
  return {
    ready: facts.ready === true,
    slots: (Array.isArray(facts.slots) ? facts.slots : []).filter(isObject).map((slot) => ({
      slot: String(slot.slot),
      key: typeof slot.key === 'string' ? slot.key : null,
      have: typeof slot.have === 'number' ? slot.have : null,
      need: typeof slot.need === 'number' ? slot.need : null,
      ...(typeof slot.blocking === 'boolean' ? { blocking: slot.blocking } : {}),
      ...(typeof slot.status === 'string' ? { status: slot.status } : {}),
    })),
  };
}

function projectId(session: Session): string {
  const id = session.state.projectId;
  if (id === undefined) throw new StepFailure('the project of the gate is not known');
  return id;
}

/** The key a slot is called by and the stamps that say what kind it is (from the plan). */
interface SlotIdentity {
  readonly key: string;
  readonly identityKind: string | null;
  readonly role: string | null;
}

/** Key and kind of each slot by the label the preflight shows: the key `provision` takes. */
async function slotKeys(session: Session): Promise<Map<string, SlotIdentity>> {
  const keyOf = new Map<string, SlotIdentity>();
  for (const scenario of await reads.scenarios(session.api, projectId(session))) {
    for (const slot of scenario.feeder_slots) {
      keyOf.set(slot.label ?? slot.slot, {
        key: slot.slot,
        identityKind: slot.identity_kind,
        role: slot.role,
      });
    }
  }
  return keyOf;
}

/**
 * One dataset made by `data_create_dataset`, then pinned by the `data_set_bindings` call its result
 * names. The first call is a consent card that saves nothing; the gate acts with the owner's prior
 * approval of the run, so it repeats the call with the card's token itself.
 */
async function createDataset(
  session: Session,
  step: StepRecord,
  args: Record<string, unknown>,
): Promise<CallRecord> {
  const card = await call(session, step, ACCOUNTS_FILE_TOOL, args);
  requireOk(card);
  const consent = consentOf(card.text);
  // Every call shows its own card, and the gate confirms each one (no yes covers another call).
  check(
    step,
    consent?.tool === ACCOUNTS_FILE_TOOL,
    `${ACCOUNTS_FILE_TOOL} answers with a consent card first and names its token`,
  );
  const created = await call(session, step, ACCOUNTS_FILE_TOOL, {
    ...args,
    confirm: consent?.token ?? '',
  });
  requireOk(created);
  check(
    step,
    consentOf(created.text) === undefined,
    `${ACCOUNTS_FILE_TOOL} with the token of its card saves the dataset`,
    `${ACCOUNTS_FILE_TOOL} with the token of its card answered with a new card: ${firstLine(created.text)}`,
  );
  const pin = nextCallOf(created.text);
  check(
    step,
    pin?.tool === BINDINGS_TOOL,
    `${ACCOUNTS_FILE_TOOL} names the ${BINDINGS_TOOL} call that pins the dataset`,
  );
  if (pin !== undefined) requireOk(await call(session, step, pin.tool, pin.args));
  return created;
}

/**
 * Whether the backend itself judged the slot to be plain data: no account verdict and the role
 * `data`. The same rule as the plugin's (`isPlainDataSlot`, mcp/src/api/data.ts); a slot with no
 * stamp is an unknown, not plain data, and the column names never decide it.
 */
export function isPlainData(slot: {
  readonly identityKind: string | null;
  readonly role: string | null;
}): boolean {
  return slot.identityKind === null && slot.role === 'data';
}

/** A slot that the preflight does not accept as it is: missing or blocking, not `ok`. */
function stillOpen(slot: Pick<DryRunSlot, 'blocking' | 'status'>): boolean {
  return slot.blocking === true || slot.status === 'missing';
}

/**
 * What `data_create_accounts` (or the accounts file) is for: the slots of accounts that the preflight
 * still finds missing or blocking. A slot of plain data is filled by `data_create_dataset`, never by
 * accounts; a slot the preflight accepts (`ok`) is no reason to create anything, whatever its
 * `have` and `need` say: `need` is advice sized for the load, the status is the verdict.
 */
export function accountSlotsToFill(
  slots: readonly DryRunSlot[],
  kinds: ReadonlyMap<string, { identityKind: string | null; role: string | null }>,
): { fill: DryRunSlot[]; dataStillOpen: DryRunSlot[]; dataShort: DryRunSlot[] } {
  const fill: DryRunSlot[] = [];
  const dataStillOpen: DryRunSlot[] = [];
  const dataShort: DryRunSlot[] = [];
  for (const slot of slots) {
    const kind = kinds.get(slot.slot) ?? { identityKind: null, role: null };
    const open = stillOpen(slot);
    if (!isPlainData(kind)) {
      if (open) fill.push(slot);
    } else if (open) {
      dataStillOpen.push(slot);
    } else if (slot.have !== null && slot.need !== null && slot.have < slot.need) {
      dataShort.push(slot);
    }
  }
  return { fill, dataStillOpen, dataShort };
}

interface StepDefinition {
  readonly name: string;
  readonly tool: string;
  run(session: Session, step: StepRecord): Promise<void>;
}

/** The steps of the scenario `har`: the recording is sent, split through the HAR channel and read back. */
function recordingSteps(config: GateConfig): StepDefinition[] {
  const minFlows = config.har?.minFlows ?? DEFAULT_MIN_FLOWS;
  const noCredential = (session: Session, step: StepRecord): void => {
    check(
      step,
      leakedSecrets(
        step.calls.map((record) => record.text),
        session.state.recordingSecrets,
      ) === 0,
      `no credential of the recording is in the answers (${String(session.state.recordingSecrets.length)} looked for)`,
    );
  };
  return [
    {
      name: 'recording import',
      tool: 'flows_import_har',
      async run(session, step) {
        const record = await call(session, step, 'flows_import_har', { file: RECORDING_PATH });
        requireOk(record);
        noCredential(session, step);
        step.differences.push(`flows_import_har says: ${firstLine(record.text)}`);
      },
    },
    {
      name: 'flows from the recording',
      tool: 'flows_generate_from_har',
      async run(session, step) {
        const id = projectId(session);
        const before = (await reads.flows(session.api, id)).map((flow) => flow.id);
        const record = await callToEnd(session, step, 'flows_generate_from_har', {
          har: RECORDING_PATH,
          split: true,
        });
        requireOk(record);
        noCredential(session, step);
        const fresh = (await reads.flows(session.api, id)).filter(
          (flow) => !before.includes(flow.id),
        );
        const facts: HarFlowFacts[] = [];
        for (const flow of fresh) facts.push(await reads.flowFacts(session.api, id, flow.id));
        const problems = harFlowProblems(facts, minFlows);
        const pauses = facts.reduce((sum, flow) => sum + flow.recordedPauses, 0);
        check(
          step,
          problems.length === 0,
          problems.length === 0
            ? `${String(facts.length)} flows came out of the recording (at least ${String(minFlows)} expected): ` +
                facts.map((flow) => flow.name).join(', ')
            : problems.join('; '),
        );
        check(
          step,
          pauses > 0,
          `at least one flow has a pause taken from the recording (${String(pauses)} in all)`,
        );
        for (const flow of facts.filter(
          (item) => item.requests >= 2 && item.recordedPauses === 0,
        )) {
          step.differences.push(
            `flow "${flow.name}": ${String(flow.requests)} requests and no pause taken from the recording`,
          );
        }
      },
    },
  ];
}

/** Statuses of a run of the description that still holds an agent browser. */
const DESCRIBE_ACTIVE: ReadonlySet<string> = new Set(['queued', 'running']);

/**
 * The steps of the scenario `describe`: the plan of the paths, taken from the run's channel by
 * `flows_describe_journeys`, then the walk of the safe paths, approved by `flows_record_journeys` alone (a `process_wait`
 * never approves), under the time limit of the walk. The effects are read from the backend: the
 * run, its paths and the flows it saved.
 */
function describeSteps(config: GateConfig): StepDefinition[] {
  const described = config.describe;
  if (described === undefined) return [];
  const { main } = config.environments;
  const minPaths = described.minPaths ?? DEFAULT_MIN_PATHS;
  const limit = described.timeoutMin ?? MAX_WALK_TIMEOUT_MIN;
  const passwordCheck = (session: Session, step: StepRecord): void => {
    const texts = session.state.calls.map((record) => record.text);
    const found = answersWith(texts, session.watched);
    check(
      step,
      found === 0,
      found === 0
        ? `the password of the account is in no answer of a tool (${String(texts.length)} answers searched)`
        : `the password of the account is in ${String(found)} answer(s) of a tool`,
    );
  };
  return [
    {
      name: 'plan from the description',
      tool: 'flows_describe_journeys',
      async run(session, step) {
        const run = session.state.describe;
        let failure: unknown;
        try {
          await callToEnd(session, step, 'flows_describe_journeys', {
            description: described.description,
            environment: main.name,
            account: {
              from_env: ACCOUNT_PATH,
              ...(described.emailKey === undefined ? {} : { email_key: described.emailKey }),
              ...(described.passwordKey === undefined
                ? {}
                : { password_key: described.passwordKey }),
            },
            ...(described.maxSteps === undefined ? {} : { max_steps: described.maxSteps }),
          });
        } catch (error) {
          failure = error;
        }
        const texts = step.calls.map((record) => record.text);
        const last = texts.at(-1) ?? '';
        const plan = planFromText(last);
        run.runId = plan.runId ?? describeRunId(texts) ?? run.runId;
        // The handle of a plan is `r-` and the beginning of the run's id (the view of the plan says
        // so): a run whose plan never came is still stopped through the plugin.
        run.plan =
          plan.plan ??
          run.plan ??
          (run.runId === undefined ? undefined : `r-${run.runId.slice(0, 8)}`);
        run.paths = plan.paths;
        const count = plan.declared ?? plan.paths.length;
        run.single = count === 1;
        run.handshake = handshakeOf(last);
        const shake = `the handshake of the run channel: ${run.handshake.result} (${run.handshake.detail})`;
        if (failure !== undefined) {
          if (!(failure instanceof StepFailure) || session.signal.aborted) throw failure;
          check(step, run.handshake.result === 'accepted', shake);
          throw failure;
        }
        check(step, run.plan !== undefined, 'the result names the plan of the paths (r-…)');
        // One path is a result of the product (a description it does not split is walked at once):
        // it passes, and the report notes that the split did not happen.
        check(
          step,
          count >= 1,
          `the plan has ${String(count)} path${count === 1 ? '' : 's'} (the header of the plan)`,
        );
        if (count === 1) {
          if (minPaths > 1) {
            step.differences.push(
              `LoadCraft did not split the description: the plan has 1 path, describe.minPaths is ${String(minPaths)}; ` +
                'nothing to approve, the walk began at once',
            );
          }
        } else {
          check(
            step,
            count >= minPaths,
            `the plan has at least ${String(minPaths)} paths (read from the header: ${String(count)})`,
          );
        }
        check(step, run.handshake.result === 'accepted', shake);
        // The plan's handle is the beginning of the run's id: the run is found among the user's runs.
        const prefix = (run.plan ?? '').slice(2);
        run.runId =
          run.runId ??
          (await reads.describeRuns(session.api, projectId(session))).find((item) =>
            item.id.startsWith(prefix),
          )?.id;
        const id = run.runId;
        check(step, id !== undefined, `the run of the plan ${run.plan ?? ''} is on the backend`);
        if (id === undefined) return;
        const row = await reads.describeRun(session.api, projectId(session), id);
        if (run.single === true) {
          checkBackend(
            step,
            !row.awaiting,
            'the run of one path does not wait for an approval',
            `status ${row.status}, waiting for the approval: ${String(row.awaiting)}`,
          );
          step.differences.push(`plan ${run.plan ?? '?'}: one path, walked at once`);
          return;
        }
        checkBackend(
          step,
          row.awaiting && DESCRIBE_ACTIVE.has(row.status) && row.approved.length === 0,
          'the run waits in LoadCraft for the approval of its paths',
          `${row.status}, ` +
            `waiting for the approval: ${String(row.awaiting)}, approved: ${String(row.approved.length)}`,
        );
        step.differences.push(
          `plan ${run.plan ?? '?'}: ${run.paths.map((item) => item.name).join(', ')}`,
        );
      },
    },
    {
      name: 'walk of the approved paths',
      tool: 'flows_record_journeys',
      async run(session, step) {
        const run = session.state.describe;
        const plan = run.plan;
        if (plan === undefined) throw new StepFailure('no plan to approve');
        // A plan of one path has nothing to approve: flows_record_journeys gets the plan alone, as its
        // "next" says, and the walk is judged like any other.
        const single = run.single === true;
        const choice = single
          ? { approve: 'all' as const, names: [] as string[], skipped: [] }
          : walkChoice(run.paths);
        for (const item of choice.skipped) {
          step.differences.push(`path left out: "${item.name}" — ${item.reason}`);
        }
        if (!single) {
          check(
            step,
            choice.problem === undefined,
            choice.problem ?? `the safe paths are approved: ${choice.names.join(', ')}`,
          );
        }
        // A call cut before its first answer is stopped by the handle of the plan.
        session.state.pending = plan;
        session.state.walkDeadline = { at: session.now() + limit * 60_000, minutes: limit };
        try {
          await callToEnd(
            session,
            step,
            'flows_record_journeys',
            single ? { plan } : { plan, paths: choice.approve },
          );
        } finally {
          session.state.walkDeadline = undefined;
          run.runId = run.runId ?? describeRunId(step.calls.map((record) => record.text));
        }
        const id = run.runId;
        check(step, id !== undefined, `the run of the plan ${plan} is known`);
        if (id === undefined) return;
        const pid = projectId(session);
        const row = await reads.describeRun(session.api, pid, id);
        run.ended = !DESCRIBE_ACTIVE.has(row.status);
        checkStatus(step, 'the run', row.status, 'completed');
        if (!single) {
          const approved = [...row.approved].sort();
          checkBackend(
            step,
            approved.join('\n') === [...choice.names].sort().join('\n'),
            `LoadCraft walks exactly the approved paths: ${choice.names.join(', ')}`,
            row.approved.join(', '),
          );
        }
        for (const item of row.paths) {
          step.differences.push(
            `path "${item.name}": ${item.status}${item.reason === null ? '' : ` — ${item.reason}`}`,
          );
        }
        const saved = row.paths.filter((item) => item.status === 'saved' && item.flowId !== null);
        check(
          step,
          saved.length >= 1,
          `at least one path is saved (${String(saved.length)} of ${String(row.paths.length)})`,
        );
        const facts: DescribeFlowFacts[] = [];
        for (const item of saved) {
          facts.push(describeFlowFacts(await reads.flowBody(session.api, pid, item.flowId ?? '')));
        }
        const problems = describeFlowProblems(facts);
        check(
          step,
          problems.length === 0,
          problems.length === 0
            ? 'every saved flow of several requests has pauses of a person with an action class (' +
                facts
                  .map(
                    (flow) =>
                      `${flow.name}: ${String(flow.classifiedPauses)} of ${String(flow.humanPauses)} pauses with a class`,
                  )
                  .join('; ') +
                ')'
            : problems.join('; '),
        );
        passwordCheck(session, step);
      },
    },
  ];
}

/** What the backend shows in place of a header value it considers secret (`MASKED_VALUE`). */
const HEADER_MASK = '«masked»';

/**
 * Reads the fixed headers of an environment back from the backend: each configured header exists,
 * and its value is the one of the env file or the mask. The value is compared in memory and never
 * written: not in a check, not in the report.
 */
function headerChecks(
  step: StepRecord,
  row: EnvironmentRow | undefined,
  environment: GateEnvironment,
  values: ReadonlyMap<string, string>,
): void {
  const stored = row?.default_headers ?? {};
  for (const header of environment.headers ?? []) {
    const key = Object.keys(stored).find(
      (name) => name.toLowerCase() === header.name.toLowerCase(),
    );
    const label = `environment ${environment.name} has the header ${header.name}`;
    check(step, key !== undefined, label);
    if (key === undefined) continue;
    const seen = stored[key];
    const same = seen === values.get(header.from_env);
    check(
      step,
      same || seen === HEADER_MASK,
      same
        ? `${label}, with the value of ${header.from_env} from the env file`
        : seen === HEADER_MASK
          ? `${label}, its value masked by the backend (not compared)`
          : `${label}, but its value is not the one of ${header.from_env} in the env file`,
    );
  }
}

function steps(
  config: GateConfig,
  scenarios: readonly GateScenario[],
  headerValues: ReadonlyMap<string, string> = new Map(),
): StepDefinition[] {
  const { main, capped } = config.environments;
  const withHeaders = [main, capped].some((env) => (env.headers ?? []).length > 0);
  const environmentArgs = (env: GateEnvironment, isDefault: boolean) => ({
    name: env.name,
    api: env.api,
    ...(env.frontend === undefined ? {} : { frontend: env.frontend }),
    ...(isDefault ? { default: true } : {}),
    ...(env.limit === undefined ? {} : { limit: [...env.limit] }),
    ...(env.headers === undefined || env.headers.length === 0
      ? {}
      : { headers: env.headers.map(({ name, from_env }) => ({ name, from_env })) }),
  });
  const list: StepDefinition[] = [
    {
      name: 'project and environments',
      tool: 'project_create',
      async run(session, step) {
        // The setup in the order of the skill; each call is followed to its end, and the handle of
        // the analysis is read from the text of its result, the way a model reads it.
        const overview =
          config.workspace.overview === undefined ? {} : { overview: 'loadcraft/overview.md' };
        requireOk(
          await callToEnd(session, step, 'project_create', {
            name: session.state.projectName,
            ...overview,
            environment: {
              name: main.name,
              api: main.api,
              ...(main.frontend === undefined ? {} : { frontend: main.frontend }),
            },
          }),
        );
        requireOk(
          await callToEnd(session, step, 'project_save_env', {
            environments: [environmentArgs(main, true), environmentArgs(capped, false)],
            ...(withHeaders ? { env_file: HEADER_VALUES_PATH } : {}),
          }),
        );
        requireOk(await callToEnd(session, step, 'project_check_env', {}));
        const analysis = await callToEnd(session, step, 'project_analyze_setup', {
          openapi: 'loadcraft/openapi.json',
          ...overview,
        });
        requireOk(analysis);
        const handle = SETUP_ANALYSIS_HANDLE.exec(analysis.text)?.[0];
        const record = await callToEnd(
          session,
          step,
          'project_apply_setup',
          handle === undefined ? {} : { analysis: handle },
        );
        requireOk(record);
        const id = bindingProjectId(session.workspace);
        check(
          step,
          id !== undefined,
          'the workspace is bound to the new project (loadcraft/project.json)',
        );
        session.state.projectId = id;
        const environments = await reads.environments(session.api, projectId(session));
        const mainRow = environments.find((row) => row.name === main.name);
        const cappedRow = environments.find((row) => row.name === capped.name);
        check(step, mainRow !== undefined, `environment ${main.name} exists`);
        check(step, mainRow?.protected === false, `environment ${main.name} is not protected`);
        check(step, cappedRow?.protected === true, `environment ${capped.name} is protected`);
        const caps = cappedRow?.workload_caps ?? null;
        checkBackend(
          step,
          caps?.max_vu === capped.limit?.[0] && caps?.max_rps === capped.limit?.[1],
          `environment ${capped.name} has the limits ${JSON.stringify(capped.limit)}`,
          JSON.stringify(caps),
        );
        headerChecks(step, mainRow, main, headerValues);
        headerChecks(step, cappedRow, capped, headerValues);
        if (withHeaders) {
          const texts = session.state.calls.map((item) => item.text);
          const found = answersWith(texts, [...headerValues.values()]);
          check(
            step,
            found === 0,
            found === 0
              ? `no header value is in any answer of a tool (${String(texts.length)} answers searched)`
              : `a header value is in ${String(found)} answer(s) of a tool`,
          );
        }
        session.state.mainEnvId = mainRow?.id;
        session.state.cappedEnvId = cappedRow?.id;
        // The setup needs no probes; what comes after it (accounts, the self-check) does,
        // and the setting is the user's, made in the frontend. The gate does it for its own project.
        const problems = await enableProbes(
          session.api,
          projectId(session),
          session.state.projectName,
        );
        check(
          step,
          problems.length === 0,
          problems.length === 0
            ? 'the probes of the gate project are enabled (read back from the backend)'
            : problems.join('; '),
        );
        step.differences.push(PROBES_NOTE);
      },
    },
  ];
  if (config.telemetry !== undefined) {
    const telemetry = config.telemetry;
    list.push({
      name: 'telemetry source',
      tool: 'project_connect_telemetry',
      async run(session, step) {
        requireOk(await call(session, step, 'project_connect_telemetry', telemetry));
      },
    });
  }
  // What a composition, a test and the protected checks stand on: flows of the documentation, a
  // scenario built from them, data for the profile and a passed self-check. `docs` and `protected`
  // both need it; `har` stands on its own.
  const chain: StepDefinition[] = [
    {
      name: 'journey proposals',
      tool: 'flows_suggest_journeys',
      async run(session, step) {
        const record = await callToEnd(session, step, 'flows_suggest_journeys', {});
        requireOk(record);
        const proposals = proposalsFromText(record.text);
        const wish = journeyWish(config);
        check(
          step,
          proposals.length >= wish.count,
          `at least ${String(wish.count)} journeys are proposed (read from the text: ${String(proposals.length)})`,
        );
        const choice = chooseJourneys(proposals, wish);
        check(
          step,
          choice.problem === undefined,
          choice.problem === undefined
            ? 'the journeys to take are among the proposals'
            : choice.problem,
        );
        session.state.journeys = choice.taken;
        for (const note of choice.notes ?? []) step.differences.push(note);
        step.differences.push(`journeys taken: ${session.state.journeys.join(', ')}`);
        for (const item of choice.skipped.slice(0, 10)) {
          step.differences.push(`journey skipped: "${item.name}" — ${item.reason}`);
        }
        if (choice.skipped.length > 10) {
          step.differences.push(`… and ${String(choice.skipped.length - 10)} more skipped`);
        }
      },
    },
    {
      name: 'flows from the proposals',
      tool: 'flows_generate_from_suggestions',
      async run(session, step) {
        requireOk(
          await callToEnd(session, step, 'flows_generate_from_suggestions', {
            suggestions: session.state.journeys,
          }),
        );
        const flows = await reads.flows(session.api, projectId(session));
        for (const name of session.state.journeys) {
          const flow = flows.find((row) => row.name === name);
          check(step, flow !== undefined, `flow "${name}" is saved in the project`);
          if (flow !== undefined) session.state.flowIds.set(name, flow.id);
        }
      },
    },
    {
      name: 'composition proposal',
      tool: 'scenario_suggest_split',
      async run(session, step) {
        requireOk(
          await callToEnd(session, step, 'scenario_suggest_split', {
            name: config.composition,
            flows: session.state.journeys,
          }),
        );
      },
    },
    {
      name: 'scenario generation',
      tool: 'scenario_generate',
      async run(session, step) {
        requireOk(
          await callToEnd(session, step, 'scenario_generate', {
            name: config.composition,
            proportions: evenSplit(session.state.journeys),
            data_mix: 'realistic',
          }),
        );
        const id = projectId(session);
        const compositions = await reads.compositions(session.api, id);
        check(
          step,
          compositions.some((row) => row.name === config.composition),
          `composition "${config.composition}" is saved`,
        );
        const scenarios = await reads.scenarios(session.api, id);
        for (const [name, flowId] of session.state.flowIds) {
          const built = scenarios.find(
            (row) => row.source_flow_id === flowId && (row.current_version ?? 0) >= 1,
          );
          check(step, built !== undefined, `flow "${name}" has a built scenario (version ≥ 1)`);
          if (built !== undefined) session.state.scenarioIds.push(built.id);
        }
      },
    },
    {
      name: 'data plan',
      tool: DATA_PLAN_TOOL,
      async run(session, step) {
        requireOk(await call(session, step, DATA_PLAN_TOOL, { scenario: config.composition }));
      },
    },
    {
      name: 'data for the load',
      tool: 'data_create_accounts',
      async run(session, step) {
        const before = await preflight(session, step);
        if (!before.ready) {
          // A slot of plain data (coupon, notes, quantity …) is filled from its columns by the
          // `data_create_dataset` calls the data plan names, each pinned by the `data_set_bindings`
          // call its result names: no secret, nothing sent to the target. Only what stays short
          // after that is a slot of accounts, which `data_create_accounts` creates through the
          // register request.
          const plan = await call(session, step, DATA_PLAN_TOOL, {
            scenario: config.composition,
            environment: main.name,
          });
          requireOk(plan);
          const steps = stepsFromText(plan.text);
          for (const item of steps) {
            check(
              step,
              item.tool === ACCOUNTS_FILE_TOOL,
              `${DATA_PLAN_TOOL} names ${ACCOUNTS_FILE_TOOL} for a slot of plain data`,
              `${DATA_PLAN_TOOL} names ${item.tool}, not ${ACCOUNTS_FILE_TOOL}, for a slot of plain data`,
            );
            const created = await createDataset(session, step, item.args);
            step.differences.push(`${ACCOUNTS_FILE_TOOL} says: ${resultSummary(created.text)}`);
          }
          if (steps.length === 0) {
            step.differences.push(
              `${DATA_PLAN_TOOL} names no call that fills a slot of plain data`,
            );
          } else {
            requireOk(
              await call(session, step, DATA_PLAN_TOOL, {
                scenario: config.composition,
                environment: main.name,
              }),
            );
          }
          const filled = await preflight(session, step);
          const keyOf = await slotKeys(session);
          const { fill, dataStillOpen, dataShort } = accountSlotsToFill(filled.slots, keyOf);
          for (const slot of dataShort) {
            step.differences.push(
              `slot "${slot.slot}" of plain data is accepted (status ${slot.status ?? 'unknown'}) ` +
                `with ${String(slot.have)} rows against ${String(slot.need)} advised: ` +
                'no accounts were created for it (to be judged)',
            );
          }
          for (const slot of dataStillOpen) {
            step.differences.push(
              `slot "${slot.slot}" of plain data is still ${slot.status ?? 'blocking'} after ` +
                `${ACCOUNTS_FILE_TOOL}: accounts are not created for it`,
            );
          }
          if (!filled.ready) {
            check(
              step,
              fill.length > 0 || dataStillOpen.length > 0,
              'the data is not ready and the preflight names the slots short of it',
            );
            check(
              step,
              dataStillOpen.length === 0 || fill.length > 0,
              `the slot "${dataStillOpen[0]?.slot ?? ''}" of plain data stays ${dataStillOpen[0]?.status ?? 'blocking'} after ${ACCOUNTS_FILE_TOOL}: ` +
                'no accounts are made for plain data; fill it from a file (accounts.file is for accounts) or by hand',
            );
            for (const slot of fill) {
              const key = keyOf.get(slot.slot)?.key ?? slot.slot;
              if (typeof config.accounts === 'object') {
                // The accounts the customer already has: the copy in the workspace is loaded and
                // pinned to the slot; the gate creates nothing on the target.
                await createDataset(session, step, {
                  scenario: config.composition,
                  slot: key,
                  file: ACCOUNTS_COPY_PATH,
                });
                requireOk(
                  await call(session, step, DATA_PLAN_TOOL, {
                    scenario: config.composition,
                    environment: main.name,
                  }),
                );
                const loaded = (await preflight(session, step)).slots.find(
                  (item) => item.slot === slot.slot,
                );
                step.differences.push(accountsFileLine(slot, key, loaded));
                continue;
              }
              const count = accountCount(config.accounts, slot.need);
              const creating = provisionCall(config.composition, main.name, { slot: key, count });
              requireOk(await callToEnd(session, step, creating.tool, creating.args));
              const now = (await preflight(session, step)).slots.find(
                (item) => item.slot === slot.slot,
              );
              step.differences.push(accountsLine(slot, key, now));
            }
          } else {
            step.differences.push(
              `${ACCOUNTS_FILE_TOOL} filled the data; no accounts were created`,
            );
          }
        } else {
          step.differences.push('the data was ready without creating accounts');
        }
        const after = await preflight(session, step);
        check(step, after.ready, 'the preflight finds the data ready for the profile');
      },
    },
    {
      name: 'self-check',
      tool: 'scenario_check_self',
      async run(session, step) {
        const id = projectId(session);
        const scenarios = (await reads.scenarios(session.api, id)).filter((row) =>
          session.state.scenarioIds.includes(row.id),
        );
        const unchecked = scenarios.filter((row) => row.self_check?.status !== 'passed');
        if (unchecked.length > 0) {
          await callToEnd(session, step, 'scenario_check_self', {
            scenarios: unchecked.map((row) => row.name),
          });
        } else {
          step.differences.push('every scenario had passed its self-check after the generation');
        }
        for (const scenario of scenarios) {
          const state = await reads.scenario(session.api, id, scenario.id);
          checkStatus(step, `self-check of "${scenario.name}"`, state?.status ?? 'none', 'passed');
        }
      },
    },
    {
      name: 'load profiles',
      tool: 'run_plan',
      async run(session, step) {
        requireOk(
          await call(session, step, 'run_plan', {
            scenario: config.composition,
            environment: main.name,
            target_users: config.profile.vusers,
          }),
        );
      },
    },
  ];
  const docsTest: StepDefinition[] = [
    {
      name: 'test on the unprotected environment',
      tool: 'run_start',
      async run(session, step) {
        const record = await callToEnd(session, step, 'run_start', {
          scenario: config.composition,
          environment: main.name,
          profile: profileArgs(config.profile),
          ...(config.thresholds === undefined ? {} : { thresholds: config.thresholds }),
        });
        requireOk(record);
        const run = executionFromText(record.text);
        check(step, run !== undefined, 'the result names the run (link of its live page)');
        if (run === undefined) return;
        session.state.mainRun = run;
        const row = await reads.execution(session.api, projectId(session), run.id);
        checkStatus(step, `run ${run.handle}`, row.status, 'completed');
        checkBackend(
          step,
          row.sla_verdict !== null &&
            ['passed', 'failed', 'refused'].includes(row.sla_verdict.status),
          'the run has an SLA verdict',
          JSON.stringify(row.sla_verdict),
        );
        const workload = row.run_manifest?.workload?.value;
        checkBackend(
          step,
          workload?.vusers === config.profile.vusers &&
            row.run_manifest?.target_environment_id === session.state.mainEnvId,
          `the run manifest holds the requested load on ${main.name}`,
          JSON.stringify(workload ?? null),
        );
      },
    },
    {
      name: 'report',
      tool: 'results_get_report',
      async run(session, step) {
        const run = session.state.mainRun;
        if (run === undefined) throw new StepFailure('no run to report on');
        const record = await call(session, step, 'results_get_report', { execution: run.handle });
        requireOk(record);
        const result = await session.api.request(
          'GET',
          `/projects/${projectId(session)}/gatling/executions/${run.id}/result`,
        );
        check(
          step,
          result.status === 200,
          `the run has a stored result (HTTP ${String(result.status)})`,
        );
      },
    },
    {
      name: 'diagnosis',
      tool: 'results_analyze_run',
      async run(session, step) {
        const run = session.state.mainRun;
        if (run === undefined) throw new StepFailure('no run to diagnose');
        requireOk(await callToEnd(session, step, 'results_analyze_run', { execution: run.handle }));
        const stored = await session.api.request(
          'GET',
          `/projects/${projectId(session)}/gatling/executions/${run.id}/analysis`,
        );
        check(
          step,
          stored.status === 200,
          `the analysis of the run is stored (HTTP ${String(stored.status)})`,
        );
        const analysis =
          isObject(stored.body) && isObject(stored.body.analysis) ? stored.body.analysis : {};
        const causes =
          (Array.isArray(analysis.error_analyses) ? analysis.error_analyses.length : 0) +
          (Array.isArray(analysis.performance_concerns) ? analysis.performance_concerns.length : 0);
        const verdict = typeof analysis.verdict === 'string' ? analysis.verdict.trim() : '';
        check(
          step,
          causes > 0 || verdict !== '',
          `the diagnosis names at least one cause or states that nothing was found (causes: ${String(causes)})`,
        );
        if (causes === 0)
          step.differences.push('no cause found; the analysis states its verdict only');
      },
    },
  ];
  const protectedChecks: StepDefinition[] = [
    {
      name: 'consent on the protected environment',
      tool: 'run_start',
      async run(session, step) {
        const id = projectId(session);
        const before = await reads.executionIds(session.api, id);
        const record = await call(session, step, 'run_start', {
          scenario: config.composition,
          environment: capped.name,
          profile: profileArgs(config.profile),
        });
        requireOk(record);
        const after = await reads.executionIds(session.api, id);
        const problems = withoutConsentProblems(record.text, before, after);
        check(
          step,
          problems.length === 0,
          problems.length === 0
            ? 'no run was created without consent; the result asks for it and says nothing was sent'
            : problems.join('; '),
        );
      },
    },
    {
      name: 'consent for accounts on the protected environment',
      tool: PROVISION_TOOL,
      async run(session, step) {
        const before = await preflight(session, step, capped.name);
        const slot = before.slots.find((item) => item.key === ACCOUNTS_SLOT && item.have !== null);
        check(
          step,
          slot !== undefined,
          `the preflight on the protected environment names the slot of accounts ("${ACCOUNTS_SLOT}") with a count`,
        );
        if (slot === undefined) return;
        const key = ACCOUNTS_SLOT;
        const haveOf = (slots: readonly DryRunSlot[]): number | null =>
          slots.find((item) => item.slot === slot.slot)?.have ?? null;

        const asking = provisionCall(config.composition, capped.name, { slot: key, count: 1 });
        const refused = await call(session, step, asking.tool, asking.args);
        requireOk(refused);
        check(
          step,
          /nothing was sent/u.test(refused.text),
          'without consent the accounts are not created and the result says nothing was sent',
        );
        const unchanged = await preflight(session, step, capped.name);
        check(
          step,
          haveOf(unchanged.slots) === slot.have,
          `no account was created without consent (slot "${slot.slot}": ${String(slot.have)} before, ` +
            `${String(haveOf(unchanged.slots))} after)`,
        );

        const agreed = provisionCall(
          config.composition,
          capped.name,
          { slot: key, count: 1 },
          true,
        );
        requireOk(await callToEnd(session, step, agreed.tool, agreed.args));
        const created = await preflight(session, step, capped.name);
        const now = haveOf(created.slots);
        check(
          step,
          now !== null && slot.have !== null && now === slot.have + 1,
          `with consent exactly one account is created on ${capped.name} ` +
            `(slot "${slot.slot}": ${String(slot.have)} → ${String(now)})`,
        );
        step.differences.push(
          `one account was created on ${capped.name} (the same target as ${main.name}, by the consent of the run)`,
        );
      },
    },
    {
      name: 'clamped test with consent',
      tool: 'run_start',
      async run(session, step) {
        const record = await callToEnd(session, step, 'run_start', {
          scenario: config.composition,
          environment: capped.name,
          profile: profileArgs(config.profile),
          confirm_capped: true,
        });
        requireOk(record);
        const run = executionFromText(record.text);
        check(step, run !== undefined, 'the result names the clamped run');
        if (run === undefined) return;
        const row = await reads.execution(session.api, projectId(session), run.id);
        checkStatus(step, `run ${run.handle}`, row.status, 'completed');
        const workload = row.run_manifest?.workload?.value;
        const maxVu = capped.limit?.[0] ?? 0;
        check(
          step,
          row.run_manifest?.target_environment_id === session.state.cappedEnvId,
          `the run manifest names ${capped.name}`,
        );
        check(
          step,
          typeof workload?.vusers === 'number' && workload.vusers <= maxVu,
          `the run manifest does not exceed the limit of ${capped.name}: ` +
            `${String(workload?.vusers)} ≤ ${String(maxVu)} users (asked for ${String(config.profile.vusers)})`,
        );
        session.state.cappedRun = { handle: run.handle, vusers: workload?.vusers ?? 0 };
        for (const warning of row.warnings) {
          step.differences.push(
            `backend warning on the run (it clamped the load itself?): ${warning}`,
          );
        }
      },
    },
    {
      name: 'note of the clamped load in the report',
      tool: 'results_get_report',
      async run(session, step) {
        const run = session.state.cappedRun;
        if (run === undefined) throw new StepFailure('no clamped run to report on');
        const record = await call(session, step, 'results_get_report', { execution: run.handle });
        requireOk(record);
        const problems = cappedReportProblems(record.text, config.profile.vusers, run.vusers);
        check(
          step,
          problems.length === 0,
          problems.length === 0
            ? `the report of the clamped run carries the note (${String(run.vusers)} of ${String(config.profile.vusers)})`
            : problems.join('; '),
        );
      },
    },
  ];
  const closing: StepDefinition[] = [
    {
      name: 'final status',
      tool: 'process_get_status',
      async run(session, step) {
        requireOk(await call(session, step, 'process_get_status', {}));
      },
    },
  ];
  const wanted = (scenario: GateScenario): boolean => scenarios.includes(scenario);
  return [
    ...list,
    ...(wanted('docs') || wanted('protected') ? chain : []),
    ...(wanted('docs') ? docsTest : []),
    ...(wanted('har') ? recordingSteps(config) : []),
    ...(wanted('protected') ? protectedChecks : []),
    ...(wanted('describe') ? describeSteps(config) : []),
    ...closing,
  ];
}

// ---- the report -----------------------------------------------------------------------------

interface GateOutcome {
  readonly mode: 'live' | 'fake';
  readonly scenarios: readonly GateScenario[];
  readonly started: Date;
  readonly finished: Date;
  readonly config: GateConfig;
  readonly projectName: string;
  readonly serverVersion: string;
  readonly steps: readonly StepRecord[];
  readonly costUsd: number | null;
  readonly passed: boolean;
  /** An operation waits for a person: the gate neither passed nor failed. */
  readonly needsHuman?: string;
  readonly stoppedBy?: string;
  /** The scenario `describe`: how the run channel answered, and its lines in the server log. */
  readonly channel?: {
    readonly handshake: Handshake | undefined;
    readonly events: readonly string[];
    readonly walkLimitMin: number;
  };
  readonly cleanup: string;
  readonly stopping: readonly string[];
  readonly notes: readonly string[];
  readonly logTail: readonly string[];
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function excerpt(text: string, lines = 12): string {
  const all = text.split('\n');
  const head = all.slice(0, lines).join('\n');
  return all.length > lines ? `${head}\n… (${String(all.length - lines)} more lines)` : head;
}

/** The text of a call in the report: all of it for a failed step, where the reason can be anywhere. */
export function callText(status: StepStatus, text: string): string {
  return status === 'failed' ? text : excerpt(text);
}

export function renderReport(outcome: GateOutcome): string {
  const { config } = outcome;
  const failed = outcome.steps.find((step) => step.status === 'failed');
  const waiting = outcome.steps.find((step) => step.status === 'needs human');
  const result = outcome.passed
    ? 'PASSED'
    : outcome.needsHuman !== undefined
      ? 'NEEDS HUMAN'
      : 'FAILED';
  const lines: string[] = [
    '# Live gate report',
    '',
    `Result: **${result}**`,
    ...(failed === undefined
      ? []
      : [
          '',
          `Failed at step ${String(failed.number)} \`${failed.tool}\` (${failed.name}): ${failed.failure ?? ''}`,
        ]),
    ...(waiting === undefined
      ? []
      : [
          '',
          `Needs a human at step ${String(waiting.number)} \`${waiting.tool}\` (${waiting.name}): ${waiting.failure ?? ''}`,
          '',
          'The gate stopped the operation and kept the project; remove the obstacle on the target ' +
            '(a CAPTCHA, a one-time code, a second factor) and run the gate again.',
        ]),
    ...(outcome.stoppedBy === undefined ? [] : ['', `Stopped by: ${outcome.stoppedBy}`]),
    '',
    '| Item | Value |',
    '| --- | --- |',
    `| Mode | ${outcome.mode} |`,
    `| Scenarios | ${outcome.scenarios.join(', ')} |`,
    `| Started | ${outcome.started.toISOString()} |`,
    `| Duration | ${seconds(outcome.finished.getTime() - outcome.started.getTime())} |`,
    `| Backend | ${cell(originOf(config.backend.url) ?? config.backend.url)} |`,
    `| Server | ${cell(outcome.serverVersion)} |`,
    `| Project | ${cell(outcome.projectName)} |`,
    `| Environments | ${cell(config.environments.main.name)} (no limit), ${cell(config.environments.capped.name)} (limit ${cell(JSON.stringify(config.environments.capped.limit))}) |`,
    `| Profile | ${cell(JSON.stringify(profileArgs(config.profile)))} |`,
    `| AI cost | ${outcome.costUsd === null ? 'unknown' : `${outcome.costUsd.toFixed(4)} USD`} of ${config.costLimitUsd.toFixed(2)} USD limit (Langfuse ${config.langfuse.api}) |`,
    `| Time limit | ${String(config.timeoutMin)} min |`,
    ...(outcome.channel === undefined
      ? []
      : [`| Walk limit | ${String(outcome.channel.walkLimitMin)} min (describe) |`]),
    `| Cleanup | ${cell(outcome.cleanup)} |`,
    '',
    '## Steps',
    '',
    '| # | Step | Tool | Calls | Time | Cost so far | Result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...outcome.steps.map(
      (step) =>
        `| ${String(step.number)} | ${cell(step.name)} | \`${step.tool}\` | ${String(step.calls.length)} | ${seconds(step.ms)} | ${step.costUsd === null ? '—' : `${step.costUsd.toFixed(4)} USD`} | ${step.status.toUpperCase()} |`,
    ),
    '',
    '## Details',
  ];
  for (const step of outcome.steps) {
    lines.push('', `### ${String(step.number)}. ${step.name} — \`${step.tool}\` — ${step.status}`);
    if (step.status === 'not run') continue;
    if (step.failure !== undefined) lines.push('', `Failure: ${step.failure}`);
    if (step.checks.length > 0) {
      lines.push('', 'Checks of the effect (read from the backend):', '');
      for (const item of step.checks) lines.push(`- ${item.ok ? '✓' : '✗'} ${item.what}`);
    }
    if (step.differences.length > 0) {
      lines.push('', 'Differences and notes:', '');
      for (const item of step.differences) lines.push(`- ${item}`);
    }
    for (const [index, record] of step.calls.entries()) {
      lines.push(
        '',
        `Call ${String(index + 1)}: \`${record.tool}\` ${JSON.stringify(record.args)} — ${seconds(record.ms)} — ${record.isError ? 'error' : 'ok'}`,
        '',
        '```text',
        callText(step.status, record.text),
        '```',
      );
    }
  }
  if (outcome.channel !== undefined) {
    const { handshake, events } = outcome.channel;
    lines.push(
      '',
      '## Run channel of the description',
      '',
      'The plan of the paths and their approval go through the WebSocket channel of the run: the ' +
        'server sends the API token in a header and the Origin of LOADCRAFT_API_URL, and the backend ' +
        'compares that Origin with the Host it is reached at (behind a proxy: the Host the proxy passes on).',
      '',
      '| Item | Value |',
      '| --- | --- |',
      `| Handshake | ${handshake === undefined ? 'not reached (the step did not run)' : cell(`${handshake.result}: ${handshake.detail}`)} |`,
      `| Channel log | ${events.length === 0 ? '—' : cell(events.join(' · '))} |`,
      "| Operator's note | _the proxy in front of the backend, the Host it passes on and what the handshake answered: written by the operator after the run_ |",
    );
  }
  if (outcome.stopping.length > 0) {
    lines.push('', '## Stopping', '', ...outcome.stopping.map((line) => `- ${line}`));
  }
  if (outcome.notes.length > 0) {
    lines.push('', '## Notes', '', ...outcome.notes.map((line) => `- ${line}`));
  }
  if (outcome.logTail.length > 0) {
    lines.push('', '## Last lines of the server log', '', '```text', ...outcome.logTail, '```');
  }
  return `${lines.join('\n')}\n`;
}

// ---- running a gate -------------------------------------------------------------------------

interface GateRunOptions {
  readonly mode: 'live' | 'fake';
  readonly config: GateConfig;
  /** What is walked, in the order of `SCENARIOS`. */
  readonly scenarios: readonly GateScenario[];
  readonly token: string;
  readonly costs: CostCounter;
  readonly secrets: readonly string[];
  /**
   * The password of the account of the scenario `describe`: masked like the secrets, and looked
   * for in every answer and every line of the server log; found once, the gate fails.
   */
  readonly watched?: readonly string[];
  /** Value of each variable of the fixed headers, for the comparison with the backend; never written. */
  readonly headerValues?: ReadonlyMap<string, string>;
  readonly reportDir: string;
  readonly keep: boolean;
  /** Files of the gate workspace (relative path -> content). */
  readonly files: Readonly<Record<string, string>>;
  readonly serverPath: string;
  /** After the run: a failure (the fake's contract violations) and notes for the report. */
  readonly after?: () => Promise<{ failure?: string; notes: string[] }>;
  /** How often the cost and the time are read during a step; default 15 s. */
  readonly pollMs?: number;
  /** The clock of the time limit; default the real one. */
  readonly now?: () => number;
}

const COST_POLL_MS = 15_000;
/** Pause between the two sweeps for runs under way: a start in flight when the gate stopped. */
const SWEEP_PAUSE_MS = 3_000;
const ACTIVE_RUN: ReadonlySet<string> = new Set(['pending', 'queued', 'building', 'running']);
const LOG_TAIL = 40;
/** Lines of the server log about the run channel kept for the report. */
const CHANNEL_EVENTS = 30;

/** One line of the server log about the run channel of the description, or undefined for another. */
function channelEvent(record: unknown): string | undefined {
  if (!isObject(record) || record.channel !== 'describe' || typeof record.msg !== 'string') {
    return undefined;
  }
  if (!record.msg.startsWith('channel')) return undefined;
  const parts = [record.msg];
  if (typeof record.code === 'number') {
    const reason =
      typeof record.reason === 'string' && record.reason !== '' ? `: ${record.reason}` : '';
    parts.push(`(code ${String(record.code)}${reason})`);
  }
  if (typeof record.closeCode === 'number') parts.push(`(close code ${String(record.closeCode)})`);
  if (typeof record.reason === 'string' && typeof record.code !== 'number') {
    parts.push(`(${record.reason})`);
  }
  const error = isObject(record.error) ? record.error.message : undefined;
  if (typeof error === 'string') parts.push(`— ${error}`);
  return parts.join(' ');
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/u, 'Z')
    .replaceAll(':', '-');
}

async function runGate(
  options: GateRunOptions,
): Promise<{ passed: boolean; needsHuman: boolean; reportPath: string }> {
  const { config } = options;
  // The credentials of the recording are masked in everything the gate writes, like the token.
  const recordingSecrets = harSecretValues(options.files[RECORDING_PATH] ?? '');
  const watched = options.watched ?? [];
  const scrub = scrubber([...options.secrets, ...recordingSecrets, ...watched]);
  const described = options.scenarios.includes('describe');
  const say = (text: string): void => {
    process.stderr.write(`${scrub(text)}\n`);
  };
  const started = new Date();
  const projectName = `${config.projectPrefix}-${stamp(started).replace(/-/gu, '').replace('T', '-').replace('Z', '')}`;

  const workspace = mkdtempSync(join(tmpdir(), 'loadcraft-gate-'));
  writeWorkspaceFiles(workspace, options.files);

  const origin = originOf(config.backend.url) ?? config.backend.url;
  const logLines: string[] = [];
  const channelEvents: string[] = [];
  let logSeen = 0;
  let logLeaks = 0;
  const onLogLine = (line: string): void => {
    if (line.trim() === '') return;
    logSeen += 1;
    if (answersWith([line], watched) > 0) logLeaks += 1;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      record = undefined;
    }
    const event = channelEvent(record);
    if (event !== undefined && channelEvents.length < CHANNEL_EVENTS)
      channelEvents.push(scrub(event));
    // The debug lines are there for the channel; the tail of a failure shows the others.
    if (isObject(record) && record.level === 'debug') return;
    logLines.push(scrub(line));
    if (logLines.length > LOG_TAIL) logLines.shift();
  };
  let partialLine = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.serverPath],
    cwd: workspace,
    stderr: 'pipe',
    env: {
      ...getDefaultEnvironment(),
      LOADCRAFT_URL: config.backend.appUrl ?? origin,
      LOADCRAFT_API_URL: `${origin}/api/v1`,
      LOADCRAFT_API_TOKEN: options.token,
      LOADCRAFT_WORKSPACE: workspace,
      LOADCRAFT_LOCALE: 'en',
      // The handshake and the close codes of the run channel are logged at the debug level.
      LOADCRAFT_LOG_LEVEL: described ? 'debug' : 'info',
    },
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    const lines = (partialLine + chunk.toString()).split('\n');
    partialLine = lines.pop() ?? '';
    for (const line of lines) onLogLine(line);
  });
  const client = new Client({ name: 'loadcraft-live-gate', version: '1.0.0' });
  await client.connect(transport);
  const serverVersion = `${client.getServerVersion()?.name ?? '?'} ${client.getServerVersion()?.version ?? '?'}`;

  const now = options.now ?? Date.now;
  const definitions = steps(config, options.scenarios, options.headerValues);
  const records: StepRecord[] = definitions.map((definition, index) => ({
    number: index + 1,
    name: definition.name,
    tool: definition.tool,
    status: 'not run',
    ms: 0,
    costUsd: null,
    calls: [],
    checks: [],
    differences: [],
  }));

  const deadline = started.getTime() + config.timeoutMin * 60_000;
  const api = new Backend(origin, options.token);
  const state: RunState = {
    projectName,
    journeys: [],
    recordingSecrets,
    flowIds: new Map(),
    scenarioIds: [],
    calls: [],
    describe: { paths: [], ended: false },
  };
  let stop: AbortController = new AbortController();
  const session: Session = {
    client,
    api,
    config,
    workspace,
    state,
    signal: stop.signal,
    now,
    watched,
  };
  let costUsd: number | null = null;
  let stoppedBy: string | undefined;
  let needsHuman: string | undefined;

  const readCost = async (): Promise<void> => {
    const walk = state.walkDeadline;
    if (walk !== undefined && now() > walk.at) {
      stoppedBy = `time limit of the walk reached: ${String(walk.minutes)} min`;
      throw new Interrupt(stoppedBy);
    }
    try {
      costUsd = await options.costs.read();
    } catch (error) {
      stoppedBy = `the cost counter is unavailable (${error instanceof Error ? error.message : String(error)}); the gate does not go on without a limit`;
      throw new Interrupt(stoppedBy);
    }
    if (costUsd > config.costLimitUsd) {
      stoppedBy = `cost limit reached: ${costUsd.toFixed(4)} USD > ${config.costLimitUsd.toFixed(2)} USD`;
      throw new Interrupt(stoppedBy);
    }
    if (now() > deadline) {
      stoppedBy = `time limit reached: ${String(config.timeoutMin)} min`;
      throw new Interrupt(stoppedBy);
    }
  };

  // Ctrl-C and `kill` stop the run the way a limit does: the call in progress is abandoned, the
  // operation is cancelled, the report is written and the project kept. A second signal gives up.
  let interrupted: string | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted !== undefined) {
      process.stderr.write(
        `[gate] ${signal} again: leaving at once; the run may still be loading the target and ` +
          'its project may be left on the backend.\n',
      );
      process.exit(130);
    }
    interrupted = `interrupted by ${signal}`;
    stoppedBy = interrupted;
    stop.abort(new Interrupt(interrupted));
  };
  const signals = ['SIGINT', 'SIGTERM'] as const;
  for (const signal of signals) process.on(signal, onSignal);

  let passed = true;
  for (const [index, definition] of definitions.entries()) {
    const step = records[index];
    if (step === undefined) break;
    const t0 = Date.now();
    say(`[gate] ${String(step.number).padStart(2, '0')} ${definition.tool} — ${definition.name} …`);
    stop = new AbortController();
    session.signal = stop.signal;
    const watcher = setInterval(() => {
      readCost().catch((error: unknown) => {
        if (error instanceof Interrupt) stop.abort(error);
      });
    }, options.pollMs ?? COST_POLL_MS);
    try {
      await readCost();
      await definition.run(session, step);
      step.status = 'passed';
    } catch (error) {
      passed = false;
      const stopped =
        stoppedBy !== undefined && (error instanceof Interrupt || stop.signal.aborted);
      if (error instanceof NeedsHuman && !stopped) {
        step.status = 'needs human';
        needsHuman = error.message;
      } else {
        step.status = 'failed';
      }
      step.failure = stopped
        ? (stoppedBy ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      clearInterval(watcher);
      step.ms = Date.now() - t0;
      step.costUsd = costUsd;
    }
    say(
      `[gate] ${String(step.number).padStart(2, '0')} ${definition.tool} — ${step.status} (${seconds(step.ms)})${step.failure === undefined ? '' : `: ${step.failure}`}`,
    );
    if (!passed) break;
  }

  if (interrupted !== undefined) {
    passed = false;
    needsHuman = undefined;
  }
  if (passed) {
    try {
      costUsd = await options.costs.read();
      if (costUsd > config.costLimitUsd) {
        passed = false;
        stoppedBy = `cost limit reached: ${costUsd.toFixed(4)} USD > ${config.costLimitUsd.toFixed(2)} USD`;
      }
    } catch (error) {
      passed = false;
      stoppedBy = `the cost counter is unavailable at the end (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  // The project the run made: from the binding, else by its name (a run that failed before the
  // binding was written may still have created it).
  if (state.projectId === undefined) {
    try {
      state.projectId = (await listProjects(api)).find(
        (project) => project.name === projectName,
      )?.id;
    } catch {
      state.projectId = undefined;
    }
  }
  // A run that did not pass leaves nothing loading the target: the operation it waited for is
  // cancelled through the plugin, then every run of the gate's project still under way is
  // cancelled by its id on the backend (also one whose start was in flight when the call was cut,
  // before any handle came back). Twice, a few seconds apart, for a start that lands late.
  const stopping: string[] = [];
  if (!passed) {
    if (state.pending !== undefined) {
      try {
        const result = await client.callTool(
          { name: 'process_cancel', arguments: { operation: state.pending } },
          { timeout: 60_000 },
        );
        stopping.push(`cancel ${state.pending} (plugin): ${firstLine(textOf(result))}`);
      } catch (error) {
        stopping.push(
          `cancel ${state.pending} (plugin) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (state.describe.plan === undefined) {
      stopping.push('no operation handle was known when the gate stopped');
    }
    // A plan of a description that is not followed by a handle (it waits for its approval, or its
    // walk began before the gate saw a handle) is stopped by the handle of the plan.
    const plan = state.describe.plan;
    if (
      plan !== undefined &&
      !state.describe.ended &&
      state.pending !== plan &&
      state.pending?.startsWith('record_run:') !== true
    ) {
      try {
        const result = await client.callTool(
          { name: 'process_cancel', arguments: { operation: plan } },
          { timeout: 60_000 },
        );
        stopping.push(`cancel ${plan} (plugin): ${firstLine(textOf(result))}`);
      } catch (error) {
        stopping.push(
          `cancel ${plan} (plugin) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (state.projectId !== undefined) {
      const projectId = state.projectId;
      for (const round of [1, 2]) {
        if (round === 2) await new Promise((done) => setTimeout(done, SWEEP_PAUSE_MS));
        if (described) {
          // The runs of a description the gate started that still hold an agent browser, also
          // one whose start was in flight when the call was cut.
          try {
            const active = (await reads.describeRuns(api, projectId)).filter((row) =>
              DESCRIBE_ACTIVE.has(row.status),
            );
            for (const row of active) {
              const answer = await api.request(
                'POST',
                `/projects/${projectId}/scenario-from-description/runs/${row.id}/cancel`,
              );
              stopping.push(
                `description run ${row.id} was ${row.status}: cancelled on the backend (HTTP ${String(answer.status)})`,
              );
            }
            if (active.length === 0) {
              stopping.push(`sweep ${String(round)}: no run of a description under way`);
            }
          } catch (error) {
            stopping.push(
              `sweep ${String(round)} of the runs of a description failed: ${error instanceof Error ? error.message : String(error)}; check them by hand`,
            );
          }
        }
        try {
          const active = (await reads.executionRows(api, projectId)).filter((row) =>
            ACTIVE_RUN.has(row.status),
          );
          for (const row of active) {
            const answer = await api.request(
              'POST',
              `/projects/${projectId}/gatling/executions/${row.id}/cancel`,
            );
            stopping.push(
              `run ${row.id} was ${row.status}: cancelled on the backend (HTTP ${String(answer.status)})`,
            );
          }
          if (active.length === 0)
            stopping.push(`sweep ${String(round)}: no run of the project under way`);
        } catch (error) {
          stopping.push(
            `sweep ${String(round)} failed: ${error instanceof Error ? error.message : String(error)}; check the runs of project ${projectName} by hand`,
          );
        }
      }
    }
    for (const line of stopping) say(`[gate] ${line}`);
  }

  let cleanup: string;
  const kept = (why: string, id: string): string =>
    `kept (${why}): project ${projectName} (${id}); delete it with: ${deleteCommand(origin, id)}`;
  if (state.projectId === undefined) {
    cleanup = 'no project was created';
  } else if (options.keep) {
    cleanup = kept('--keep', state.projectId);
  } else if (!passed) {
    cleanup = kept('the gate failed or was stopped; inspect it first', state.projectId);
  } else {
    try {
      const removed = await api.request('DELETE', `/projects/${state.projectId}`);
      cleanup =
        removed.status === 200
          ? `project ${projectName} deleted`
          : `deleting project ${projectName} answered HTTP ${String(removed.status)}; ` +
            `delete it with: ${deleteCommand(origin, state.projectId)}`;
    } catch (error) {
      cleanup =
        `deleting project ${projectName} failed (${error instanceof Error ? error.message : String(error)}); ` +
        `delete it with: ${deleteCommand(origin, state.projectId)}`;
    }
  }

  for (const signal of signals) process.off(signal, onSignal);
  await client.close();
  if (partialLine !== '') onLogLine(partialLine);
  const extra = options.after === undefined ? { notes: [] } : await options.after();
  if (extra.failure !== undefined) {
    passed = false;
    needsHuman = undefined;
    stoppedBy = stoppedBy === undefined ? extra.failure : `${stoppedBy}; ${extra.failure}`;
  }
  const notes = [...extra.notes];
  if (watched.length > 0) {
    // The record of the whole run: every answer of a tool and every line of the server log.
    const answers = answersWith(
      state.calls.map((record) => record.text),
      watched,
    );
    notes.push(
      `the password of the account was looked for in ${String(state.calls.length)} answers of tools ` +
        `and ${String(logSeen)} lines of the server log: found in ${String(answers)} answer(s) and ` +
        `${String(logLeaks)} log line(s)`,
    );
    if (answers + logLeaks > 0) {
      passed = false;
      needsHuman = undefined;
      const leak = `the password of the account is in ${String(answers)} answer(s) and ${String(logLeaks)} line(s) of the server log`;
      stoppedBy = stoppedBy === undefined ? leak : `${stoppedBy}; ${leak}`;
    }
  }
  rmSync(workspace, { recursive: true, force: true });

  const report = scrub(
    renderReport({
      mode: options.mode,
      scenarios: options.scenarios,
      started,
      finished: new Date(),
      config,
      projectName,
      serverVersion,
      steps: records,
      costUsd,
      passed,
      ...(needsHuman === undefined ? {} : { needsHuman }),
      ...(stoppedBy === undefined ? {} : { stoppedBy }),
      ...(described
        ? {
            channel: {
              handshake: state.describe.handshake,
              events: channelEvents,
              walkLimitMin: config.describe?.timeoutMin ?? MAX_WALK_TIMEOUT_MIN,
            },
          }
        : {}),
      cleanup,
      stopping,
      notes,
      logTail: passed ? [] : logLines,
    }),
  );
  mkdirSync(options.reportDir, { recursive: true });
  const reportPath = join(
    options.reportDir,
    `${stamp(started)}${options.mode === 'fake' ? '-fake' : ''}.md`,
  );
  writeFileSync(reportPath, report);
  const verdict = passed ? 'PASSED' : needsHuman !== undefined ? 'NEEDS HUMAN' : 'FAILED';
  say(`[gate] ${verdict} · report: ${reportPath}`);
  return { passed, needsHuman: !passed && needsHuman !== undefined, reportPath };
}

// ---- fake mode ------------------------------------------------------------------------------

const FAKE_FAULTS = [
  'self-check-failed',
  'run-over-limit',
  'leftover-project',
  'cost-over-limit',
  'cost-during-run',
  'cost-before-handle',
  'time-over-limit',
  'langfuse-down',
  'har-one-flow',
  'har-no-pauses',
  'describe-one-path',
  'describe-none-saved',
  'describe-no-pauses',
  'describe-help',
  'describe-echo-password',
  'describe-time-over-limit',
  'describe-channel-blocked',
  'probes-ignored',
  'provision-fails',
  'data-no-source',
] as const;
type FakeFault = (typeof FAKE_FAULTS)[number];
/** Faults the fake backend itself plants; the others are in the stand-in for Langfuse or the clock. */
const WORLD_FAULTS = [
  'self-check-failed',
  'run-over-limit',
  'leftover-project',
  'har-one-flow',
  'har-no-pauses',
  'describe-one-path',
  'describe-none-saved',
  'describe-no-pauses',
  'describe-help',
  'describe-echo-password',
  'describe-long-walk',
  'describe-channel-blocked',
  'probes-ignored',
  'provision-fails',
  'data-no-source',
] as const;
type WorldFault = (typeof WORLD_FAULTS)[number];
/** Faults that stop a test under way: the fake's tests then run for hours. */
const LIMIT_FAULTS: readonly FakeFault[] = [
  'cost-during-run',
  'cost-before-handle',
  'time-over-limit',
];
/** How long a test has run before `cost-during-run` passes the limit: its handle is known by then. */
const DURING_RUN_MS = 2_500;
const FAKE_POLL_MS = 250;
/**
 * How many times faster than the real one the clock of the fake runs. The tests of the gate set
 * `LIVE_GATE_FAKE_SPEED` to wait less for the jobs of the fake; a run by hand keeps 60.
 */
const FAKE_SPEED = ((): number => {
  const speed = Number(process.env.LIVE_GATE_FAKE_SPEED);
  return Number.isFinite(speed) && speed >= 1 ? speed : 60;
})();

/** The token of the fake: the sentinel the leak checks look for. */
const FAKE_TOKEN = 'CANARY-SECRET-7f3a';
const FAKE_LANGFUSE = { publicKey: 'pk-lf-fake', secretKey: 'sk-lf-fake-secret' };
const FAKE_TRACING_ENVIRONMENT = 'mcp-live-gate';

interface FakeBackend {
  readonly url: string;
  readonly calls: readonly { readonly method: string; readonly path: string }[];
  close(): Promise<void>;
}

interface GateWorldModule {
  startGateFake(options: {
    port: number;
    speed: number;
    token: string;
    fault?: WorldFault;
    longRuns?: boolean;
  }): Promise<FakeBackend>;
  runsStarted(fake: FakeBackend): number;
  /** What the fake saw of the runs of a description: the starts, the approvals and the stops. */
  describeFacts(fake: FakeBackend): {
    readonly runs: number;
    readonly approvals: readonly (readonly string[])[];
    readonly passwords: readonly string[];
    readonly stops: number;
  };
  gateFiles(): Record<string, string>;
  /** The env file of the target application, with the account of the LoadCraft browser. */
  gateEnvFile(): string;
  /** The env file of the target with the value of its fixed header (the `envFile` of the fake configuration). */
  gateHeaderEnvFile(): string;
  /** A synthetic recording of the shop, with credentials the gate must keep out of its report. */
  gateRecording(): string;
}

/**
 * The fake backend of the tests is TypeScript with `.js` import specifiers and reads its files
 * relative to each module, so it is bundled on the fly with every module's own `import.meta`
 * written in, and with a stand-in for the test runner it never calls here.
 */
async function loadGateWorld(root: string, dir: string): Promise<GateWorldModule> {
  const { build } = await import('esbuild');
  const outfile = join(dir, 'gate-world.mjs');
  await build({
    absWorkingDir: root,
    entryPoints: [join(root, 'test', 'e2e', 'gateWorld.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
    external: ['bufferutil', 'utf-8-validate'],
    define: { __LOADCRAFT_VERSION__: '"0.0.0-gate"' },
    banner: {
      js: "import { createRequire as __lcCreateRequire } from 'node:module';\nconst require = __lcCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'vitest-stand-in',
        setup(b) {
          b.onResolve({ filter: /^vitest$/ }, () => ({ path: 'vitest', namespace: 'stand-in' }));
          b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({
            contents:
              'const none = () => { throw new Error("no test runner in the gate"); };\n' +
              'export const onTestFinished = none; export const expect = none; export const vi = {};',
            loader: 'js',
          }));
        },
      },
      {
        name: 'own-import-meta',
        setup(b) {
          b.onLoad({ filter: /\.ts$/ }, (args) => {
            if (args.path.includes(`${'/'}node_modules${'/'}`)) return undefined;
            const source = readFileSync(args.path, 'utf8')
              .replaceAll('import.meta.dirname', JSON.stringify(dirname(args.path)))
              .replaceAll('import.meta.filename', JSON.stringify(args.path))
              .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(args.path).href));
            return { contents: source, loader: 'ts' };
          });
        },
      },
    ],
  });
  return (await import(pathToFileURL(outfile).href)) as GateWorldModule;
}

/** A stand-in for Langfuse's metrics endpoint: a little more cost at every read. */
async function startFakeLangfuse(
  fault: FakeFault | undefined,
  extraCost: () => number,
): Promise<{ url: string; close(): Promise<void> }> {
  let reads = 0;
  const expected = `Basic ${Buffer.from(`${FAKE_LANGFUSE.publicKey}:${FAKE_LANGFUSE.secretKey}`).toString('base64')}`;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown): void => {
      // No connection is kept: a client reusing a socket the server closes at that moment fails
      // with a reset on a busy machine, and the stand-in has nothing to gain from keeping it.
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(body));
    };
    if (fault === 'langfuse-down') return send(503, { message: 'unavailable' });
    if (req.headers.authorization !== expected) return send(401, { message: 'unauthorized' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/public/v2/metrics' || url.searchParams.get('query') === null) {
      return send(404, { message: 'not found' });
    }
    // The gate counts only its own tracing environment; a query without that filter is refused.
    const query: unknown = JSON.parse(url.searchParams.get('query') ?? '{}');
    const filters = isObject(query) && Array.isArray(query.filters) ? query.filters : [];
    const scoped = filters.some(
      (filter) =>
        isObject(filter) &&
        filter.column === 'environment' &&
        filter.value === FAKE_TRACING_ENVIRONMENT,
    );
    if (!scoped) return send(400, { message: 'the query is not limited to the gate environment' });
    reads += 1;
    const perRead = fault === 'cost-over-limit' ? 0.8 : 0.001;
    return send(200, { data: [{ sum_totalCost: reads * perRead + extraCost() }] });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

/** Names of the fake configuration are not looked up: nothing outside the fake is asked. */
const fakeResolve: Resolve = (host) => {
  const bare = host.replace(/^\[|\]$/gu, '');
  return Promise.resolve([isIP(bare) === 0 ? '192.0.2.1' : bare]);
};

function fakeConfig(
  backendUrl: string,
  langfuseUrl: string,
  maxWaitS: number,
  accountsFile?: string,
): GateConfig {
  return {
    backend: { url: backendUrl },
    workspace: { openapi: 'loadcraft/openapi.json' },
    har: { file: RECORDING_PATH, minFlows: 3 },
    projectPrefix: 'sklep',
    composition: 'checkout',
    environments: {
      main: {
        name: 'perf',
        api: 'https://api.perf.example.com',
        frontend: 'https://perf.example.com',
        headers: [{ name: 'x-api-key', from_env: 'SHOP_API_KEY' }],
        envFile: 'target.env',
      },
      capped: {
        name: 'qa',
        api: 'https://api.qa.example.com',
        frontend: 'https://qa.example.com',
        limit: [5, 5],
      },
    },
    journeys: 3,
    accounts: accountsFile === undefined ? 30 : { file: accountsFile },
    profile: { ...DEFAULTS.profile },
    thresholds: { ...DEFAULTS.thresholds },
    telemetry: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
    costLimitUsd: DEFAULTS.costLimitUsd,
    langfuse: { url: langfuseUrl, api: 'v2', environment: FAKE_TRACING_ENVIRONMENT },
    timeoutMin: 15,
    maxWaitS,
    forbiddenBackends: [],
    describe: {
      description:
        'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą, część z kodem ' +
        'rabatowym. Część klientów przegląda katalog, część sprawdza swoje zamówienia.',
      envFile: '.env',
    },
  };
}

// ---- command line ---------------------------------------------------------------------------

interface Args {
  config?: string;
  scenarios: GateScenario[];
  /** `--fake` only: another build of the server, to see the gate catch a fault of the plugin. */
  fakeServer?: string;
  /** `--fake` only: the accounts come from this CSV file, as `accounts: { file }` of a configuration. */
  fakeAccountsFile?: string;
  fake: boolean;
  fault?: FakeFault;
  keep: boolean;
  reuse: boolean;
  reportDir?: string;
}

const USAGE =
  'usage: npm run gate -- --config <file> [--scenario docs,har,protected] [--keep] [--reuse] [--report-dir <dir>]\n' +
  '       npm run gate -- --fake [--scenario docs,har,protected] [--fake-fault <fault>] [--fake-server <server.mjs>] [--fake-accounts-file <accounts.csv>] [--reuse] [--report-dir <dir>]';

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { fake: false, keep: false, reuse: false, scenarios: [] };
  const named = new Set<GateScenario>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--'))
        throw new Error(`${String(flag)} needs a value\n${USAGE}`);
      i += 1;
      return next;
    };
    if (flag === '--config') args.config = value();
    else if (flag === '--fake') args.fake = true;
    else if (flag === '--keep') args.keep = true;
    else if (flag === '--reuse') args.reuse = true;
    else if (flag === '--report-dir') args.reportDir = value();
    else if (flag === '--fake-server') args.fakeServer = value();
    else if (flag === '--fake-accounts-file') args.fakeAccountsFile = value();
    else if (flag === '--scenario') {
      for (const name of value().split(',')) {
        const scenario = SCENARIOS.find((item) => item === name.trim());
        if (scenario === undefined) {
          throw new Error(`--scenario must be one or more of: ${SCENARIOS.join(', ')}\n${USAGE}`);
        }
        named.add(scenario);
      }
    } else if (flag === '--fake-fault') {
      const fault = value();
      if (!(FAKE_FAULTS as readonly string[]).includes(fault)) {
        throw new Error(`--fake-fault must be one of: ${FAKE_FAULTS.join(', ')}`);
      }
      args.fault = fault as FakeFault;
    } else throw new Error(`unknown argument ${String(flag)}\n${USAGE}`);
  }
  args.scenarios =
    named.size === 0 ? ['docs'] : SCENARIOS.filter((scenario) => named.has(scenario));
  if (args.fake === (args.config !== undefined))
    throw new Error(`give either --config or --fake\n${USAGE}`);
  if (args.fault !== undefined && !args.fake)
    throw new Error('--fake-fault works only with --fake');
  if (args.fakeServer !== undefined && !args.fake)
    throw new Error('--fake-server works only with --fake');
  if (args.fakeAccountsFile !== undefined && !args.fake)
    throw new Error('--fake-accounts-file works only with --fake');
  return args;
}

async function startCost(
  config: GateConfig,
  keys: { publicKey: string; secretKey: string },
  say: (text: string) => void,
): Promise<CostCounter | undefined> {
  const counter = langfuseCounter(config.langfuse, keys, new Date());
  try {
    await counter.read();
    return counter;
  } catch (error) {
    say(
      `[gate] refused: the cost counter (Langfuse) cannot be read: ${error instanceof Error ? error.message : String(error)}. ` +
        'The gate does not run without a cost limit.',
    );
    return undefined;
  }
}

/** A single quote or a control character: what the copy of a value in single quotes cannot hold. */
function cannotQuote(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === "'" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Where the values of the fixed headers lie in the gate's workspace (an env file of its own). */
export const HEADER_VALUES_PATH = '.env.target';

/** The values the fixed headers are sent with, copied for the workspace, and what the gate looks for. */
export interface HeaderCopy {
  /** The env file of the workspace: only the variables the headers name, nothing else of the file. */
  readonly files: Record<string, string>;
  /** Value of every variable copied; looked for in every answer, never written. */
  readonly watched: string[];
  /** Value by the name of its variable, for the comparison with what the backend stored. */
  readonly values: ReadonlyMap<string, string>;
}

/**
 * The fixed headers of the environments from the env file of each: only the variables the headers
 * name are copied (in single quotes, which the plugin reads literally) into `HEADER_VALUES_PATH`.
 * A value must have at least 8 characters (a shorter one is found in ordinary words, so looking
 * for it proves nothing) and no quote, line break or control character. Two environments may name
 * the same variable only when its value is the same. A refusal names the variable, never a value.
 */
export function headerCopy(
  config: GateConfig,
  read: (file: string) => string,
): HeaderCopy | { readonly refusals: string[] } {
  const refusals: string[] = [];
  const values = new Map<string, string>();
  const parsed = new Map<string, Map<string, string>>();
  for (const key of ['main', 'capped'] as const) {
    const environment = config.environments[key];
    const headers = environment.headers ?? [];
    if (headers.length === 0 || environment.envFile === undefined) continue;
    const file = environment.envFile;
    let table = parsed.get(file);
    if (table === undefined) {
      try {
        table = envValues(read(file));
      } catch (error) {
        refusals.push(
          `environments.${key}.envFile cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      parsed.set(file, table);
    }
    for (const header of headers) {
      const value = table.get(header.from_env);
      const where = `environments.${key}.headers ${header.name}: ${header.from_env}`;
      if (value === undefined) {
        refusals.push(`${where} is not in the env file`);
      } else if (value === '') {
        refusals.push(`${where} is empty in the env file`);
      } else if (cannotQuote(value)) {
        refusals.push(
          `${where} holds a single quote, a line break or another control character, which the ` +
            'copy cannot quote; give the header a value without them',
        );
      } else if (value.length < MIN_LEAK_LENGTH) {
        refusals.push(
          `${where} must have at least ${String(MIN_LEAK_LENGTH)} characters: a shorter value is ` +
            'found in ordinary words of the answers, so the search for it proves nothing',
        );
      } else if (values.has(header.from_env) && values.get(header.from_env) !== value) {
        refusals.push(`${where} has another value in another environment's env file`);
      } else {
        values.set(header.from_env, value);
      }
    }
  }
  if (refusals.length > 0) return { refusals };
  if (values.size === 0) return { files: {}, watched: [], values };
  const lines = [...values].map(([name, value]) => `${name}='${value}'`);
  return {
    files: {
      [HEADER_VALUES_PATH]: `# Header values copied by the live gate (only the variables the headers name).\n${lines.join('\n')}\n`,
    },
    watched: [...new Set(values.values())],
    values,
  };
}

/**
 * The account of the scenario `describe` for the gate's workspace, read from the target's env file:
 * the file of the workspace and the password to look for, or why the gate does not start.
 */
function describeAccount(
  config: GateConfig,
  scenarios: readonly GateScenario[],
  read: () => string,
): { files: Record<string, string>; watched: string[] } | { refusal: string } {
  const described = config.describe;
  if (!scenarios.includes('describe') || described === undefined) return { files: {}, watched: [] };
  let text: string;
  try {
    text = read();
  } catch (error) {
    return {
      refusal: `describe.envFile cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const copy = accountFile(text, described);
  if ('refusals' in copy) {
    return {
      refusal:
        `the account of the LoadCraft browser in describe.envFile cannot be used:
` + copy.refusals.map((item) => `  - ${item}`).join('\n'),
    };
  }
  return { files: { [ACCOUNT_PATH]: copy.content }, watched: [copy.password] };
}

/**
 * The accounts file of the configuration copied for the workspace: nothing when the accounts are
 * made by number, otherwise the copy and the passwords to look for, or why the gate does not start.
 */
function accountsFromFile(
  config: GateConfig,
  read: (file: string) => string,
): { files: Record<string, string>; watched: string[]; rows: number } | { refusal: string } {
  const file = accountsFileOf(config.accounts);
  if (file === undefined) return { files: {}, watched: [], rows: 0 };
  let text: string;
  try {
    text = read(file);
  } catch (error) {
    return {
      refusal: `accounts.file cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const copy = accountsFileCopy(text);
  return 'refusal' in copy ? { refusal: `accounts.file cannot be used: ${copy.refusal}` } : copy;
}

function exitCode(result: { passed: boolean; needsHuman: boolean }): number {
  if (result.passed) return 0;
  return result.needsHuman ? 2 : 1;
}

async function main(argv: readonly string[]): Promise<number> {
  const root = resolve(import.meta.dirname, '..');
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const reportDir = resolve(args.reportDir ?? join(root, 'gate-reports'));
  const serverPath =
    args.fakeServer === undefined ? join(root, 'dist', 'server.mjs') : resolve(args.fakeServer);

  if (!args.fake) {
    const env = process.env;
    let config: GateConfig;
    try {
      config = readConfig(args.config ?? '');
    } catch (error) {
      process.stderr.write(
        `[gate] refused: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
    const token = env.LIVE_GATE_API_TOKEN ?? '';
    const keys = {
      publicKey: env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: env.LANGFUSE_SECRET_KEY ?? '',
    };
    const scrub = scrubber([token, keys.publicKey, keys.secretKey]);
    const say = (text: string): void => {
      process.stderr.write(`${scrub(text)}\n`);
    };
    const refusals = checkLaunch(config, env, { scenarios: args.scenarios });
    if (refusals.length === 0) refusals.push(...(await checkTarget(config, env)));
    if (refusals.length > 0) {
      say(`[gate] refused:\n${refusals.map((item) => `  - ${item}`).join('\n')}`);
      return 2;
    }
    let files: Record<string, string>;
    try {
      files = {
        'loadcraft/openapi.json': readFileSync(config.workspace.openapi, 'utf8'),
        ...(config.workspace.overview === undefined
          ? {}
          : { 'loadcraft/overview.md': readFileSync(config.workspace.overview, 'utf8') }),
        ...(args.scenarios.includes('har') && config.har !== undefined
          ? { [RECORDING_PATH]: readFileSync(config.har.file, 'utf8') }
          : {}),
      };
    } catch (error) {
      say(`[gate] refused: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
    const account = describeAccount(config, args.scenarios, () =>
      readFileSync(config.describe?.envFile ?? '', 'utf8'),
    );
    if ('refusal' in account) {
      say(`[gate] refused: ${account.refusal}`);
      return 2;
    }
    Object.assign(files, account.files);
    const accounts = accountsFromFile(config, (file) => readFileSync(file, 'utf8'));
    if ('refusal' in accounts) {
      say(`[gate] refused: ${accounts.refusal}`);
      return 2;
    }
    Object.assign(files, accounts.files);
    const headers = headerCopy(config, (file) => readFileSync(file, 'utf8'));
    if ('refusals' in headers) {
      say(
        `[gate] refused: the fixed headers cannot be used:\n${headers.refusals.map((item) => `  - ${item}`).join('\n')}`,
      );
      return 2;
    }
    Object.assign(files, headers.files);
    const origin = originOf(config.backend.url) ?? '';
    const me = await new Backend(origin, token)
      .request('GET', '/auth/me')
      .catch((error: unknown) => ({
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      }));
    if (me.status !== 200) {
      say(
        `[gate] refused: the backend ${origin} does not accept the token (GET /api/v1/auth/me → ${String(me.status)}).`,
      );
      return 2;
    }
    const costs = await startCost(config, keys, say);
    if (costs === undefined) return 2;
    if (!args.reuse) {
      const leftovers = await leftoverRefusal(
        new Backend(origin, token),
        origin,
        config.projectPrefix,
      );
      if (leftovers !== undefined) {
        say(`[gate] refused: ${leftovers}`);
        return 2;
      }
    }
    const result = await runGate({
      mode: 'live',
      scenarios: args.scenarios,
      config,
      token,
      costs,
      secrets: [token, keys.publicKey, keys.secretKey],
      watched: [...account.watched, ...accounts.watched, ...headers.watched],
      headerValues: headers.values,
      reportDir,
      keep: args.keep,
      files,
      serverPath,
    });
    process.stdout.write(`${result.reportPath}\n`);
    return exitCode(result);
  }

  // --fake: the fake backend of the tests, a stand-in for Langfuse, and the same run.
  const say = (text: string): void => {
    process.stderr.write(`${scrubber([FAKE_TOKEN, FAKE_LANGFUSE.secretKey])(text)}\n`);
  };
  const bundleDir = mkdtempSync(join(tmpdir(), 'loadcraft-gate-fake-'));
  let world: GateWorldModule;
  try {
    world = await loadGateWorld(root, bundleDir);
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
  const { fault } = args;
  // The time limit of the walk needs a walk long enough to be under way when the clock passes it.
  const worldFault =
    fault === 'describe-time-over-limit'
      ? 'describe-long-walk'
      : WORLD_FAULTS.find((item) => item === fault);
  const fake = await world.startGateFake({
    port: 0,
    speed: FAKE_SPEED,
    token: FAKE_TOKEN,
    ...(worldFault === undefined ? {} : { fault: worldFault }),
    longRuns: fault !== undefined && LIMIT_FAULTS.includes(fault),
  });
  // The limit faults wait for the first test to start: from then on the cost is over the limit
  // (at once, or once the test has run long enough to have a handle), or the clock is past the
  // time limit.
  let firstRun: number | undefined;
  const sinceFirstRun = (): number | undefined => {
    if (firstRun === undefined && world.runsStarted(fake) > 0) firstRun = Date.now();
    return firstRun === undefined ? undefined : Date.now() - firstRun;
  };
  const extraCost = (): number => {
    const since = sinceFirstRun();
    if (since === undefined) return 0;
    if (fault === 'cost-before-handle') return 100;
    if (fault === 'cost-during-run' && since > DURING_RUN_MS) return 100;
    return 0;
  };
  // `describe-time-over-limit`: once the walk was approved, the clock is past its time limit.
  const now = (): number =>
    Date.now() +
    (fault === 'time-over-limit' && sinceFirstRun() !== undefined ? 86_400_000 : 0) +
    (fault === 'describe-time-over-limit' && world.describeFacts(fake).approvals.length > 0
      ? (MAX_WALK_TIMEOUT_MIN + 1) * 60_000
      : 0);
  const langfuse = await startFakeLangfuse(fault, extraCost);
  try {
    // A long wait keeps the first call of run_start open: the limit cuts it before any handle.
    const config = fakeConfig(
      fake.url,
      langfuse.url,
      fault === 'cost-before-handle' ? 60 : 1,
      args.fakeAccountsFile,
    );
    const fakeEnv = {
      LIVE_GATE_API_TOKEN: FAKE_TOKEN,
      LANGFUSE_PUBLIC_KEY: FAKE_LANGFUSE.publicKey,
      LANGFUSE_SECRET_KEY: FAKE_LANGFUSE.secretKey,
    };
    const refusals = [
      ...checkLaunch(config, fakeEnv, { fake: true, scenarios: args.scenarios }),
      ...(await checkTarget(config, fakeEnv, fakeResolve)),
    ];
    if (refusals.length > 0) {
      say(`[gate] refused:\n${refusals.map((item) => `  - ${item}`).join('\n')}`);
      return 2;
    }
    const account = describeAccount(config, args.scenarios, () => world.gateEnvFile());
    if ('refusal' in account) {
      say(`[gate] refused: ${account.refusal}`);
      await fake.close().catch(() => undefined);
      return 2;
    }
    const accounts = accountsFromFile(config, (file) => readFileSync(file, 'utf8'));
    if ('refusal' in accounts) {
      say(`[gate] refused: ${accounts.refusal}`);
      await fake.close().catch(() => undefined);
      return 2;
    }
    const headers = headerCopy(config, () => world.gateHeaderEnvFile());
    if ('refusals' in headers) {
      say(
        `[gate] refused: the fixed headers cannot be used:\n${headers.refusals.map((item) => `  - ${item}`).join('\n')}`,
      );
      await fake.close().catch(() => undefined);
      return 2;
    }
    const costs = await startCost(config, FAKE_LANGFUSE, say);
    if (costs === undefined) return 2;
    if (!args.reuse) {
      const leftovers = await leftoverRefusal(
        new Backend(fake.url, FAKE_TOKEN),
        fake.url,
        config.projectPrefix,
      );
      if (leftovers !== undefined) {
        say(`[gate] refused: ${leftovers}`);
        await fake.close().catch(() => undefined);
        return 2;
      }
    }
    let closed = false;
    const result = await runGate({
      mode: 'fake',
      scenarios: args.scenarios,
      config,
      token: FAKE_TOKEN,
      costs,
      secrets: [FAKE_TOKEN, FAKE_LANGFUSE.secretKey],
      watched: [...account.watched, ...accounts.watched, ...headers.watched],
      headerValues: headers.values,
      reportDir,
      keep: false,
      files: {
        ...world.gateFiles(),
        ...(args.scenarios.includes('har') ? { [RECORDING_PATH]: world.gateRecording() } : {}),
        ...account.files,
        ...accounts.files,
        ...headers.files,
      },
      serverPath,
      pollMs: FAKE_POLL_MS,
      now,
      after: async () => {
        closed = true;
        const cancels = fake.calls.filter(
          (call) => call.method === 'POST' && call.path.endsWith('/cancel'),
        );
        const notes = [
          `fake backend: ${String(cancels.length)} cancel request(s) received` +
            (cancels.length === 0 ? '' : `: ${cancels.map((call) => call.path).join(', ')}`),
        ];
        const problems: string[] = [];
        if (args.scenarios.includes('describe')) {
          const seen = world.describeFacts(fake);
          const carried =
            seen.passwords.length > 0 &&
            seen.passwords.every((item) => account.watched.includes(item));
          notes.push(
            `fake backend: ${String(seen.runs)} description run(s), ${String(seen.approvals.length)} approval(s)` +
              `${seen.approvals.length === 0 ? '' : ` (${seen.approvals.map((names) => names.join(', ')).join('; ')})`}, ` +
              `the start ${carried ? 'carried' : 'did not carry'} the password of the account, ` +
              `stop message(s) ${String(seen.stops)}`,
          );
          // The search for the password proves something only when the backend got it.
          if (seen.runs > 0 && !carried) {
            problems.push(
              'the start of the run did not carry the password of the account, so the search for it proves nothing',
            );
          }
          if (seen.approvals.length > 1) {
            problems.push(
              `the paths were approved ${String(seen.approvals.length)} times; only flows_record_journeys approves, once`,
            );
          }
        }
        try {
          await fake.close();
        } catch (error) {
          problems.push(
            `the fake backend reports contract violations or handler errors: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return problems.length === 0 ? { notes } : { notes, failure: problems.join('; ') };
      },
    });
    if (!closed) await fake.close().catch(() => undefined);
    process.stdout.write(`${result.reportPath}\n`);
    return exitCode(result);
  } finally {
    await langfuse.close();
  }
}

if (process.argv[1] !== undefined && basename(process.argv[1]) === 'live-gate.ts') {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `[gate] crashed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
