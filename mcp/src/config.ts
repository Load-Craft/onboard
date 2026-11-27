import { resolve } from 'node:path';
import { Secret } from './secret.js';

export type Locale = 'en' | 'pl';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  readonly appUrl: string;
  readonly apiUrl: string;
  readonly token: Secret;
  readonly locale: Locale;
  readonly workspaceRoot: string;
  /**
   * Where `loadcraft/project.json` and `loadcraft/.cache` live. The project folder itself
   * (`workspaceRoot`) except in demonstration mode, which keeps them out of the user's repository.
   */
  readonly stateRoot: string;
  readonly demo: boolean;
  /** Demonstration mode only: how many times faster than real time the sample backend's clock runs. */
  readonly demoSpeed: number;
  readonly logLevel: LogLevel;
  /** Defects found while reading the environment; reported on the first tool call. */
  readonly problems: readonly string[];
}

const DEFAULT_DEMO_SPEED = 30;
const MAX_DEMO_SPEED = 10_000;
const DEFAULT_APP_URL = 'https://app.loadcraft.io';
const API_PATH = '/api/v1';
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
// Claude Code may pass an unset option through as a literal placeholder.
const UNEXPANDED = /^\$\{[^}]*\}$/;

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '' || UNEXPANDED.test(raw)) {
    return undefined;
  }
  return raw;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function readUrl(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = read(env, key);
  if (raw === undefined) {
    return undefined;
  }
  const url = stripTrailingSlashes(raw);
  if (!isHttpUrl(url)) {
    problems.push(`${key} must be an http(s) URL; the default is used instead.`);
    return undefined;
  }
  return url;
}

/**
 * The demonstration switch: exactly `1` (set by hand) or `true` (a boolean plugin option reaches
 * the server as `true` or `false`). Nothing is trimmed or case-folded: `" 1 "`, `True` and `yes` are off.
 */
function isDemoSwitch(env: NodeJS.ProcessEnv): boolean {
  return env['LOADCRAFT_DEMO'] === '1' || env['LOADCRAFT_DEMO'] === 'true';
}

/**
 * Options that point at a real LoadCraft. Demonstration mode talks only to its own backend, so
 * setting either of these next to `LOADCRAFT_DEMO=1` is a mistake and the server refuses to start.
 * The token is not listed: a token set for real use is ignored by the mode and never sent.
 */
export function demoConflicts(env: NodeJS.ProcessEnv): string[] {
  // The plugin always passes `loadcraft_url`, with its default as the value, so the default address
  // is what "not set" looks like from the plugin. Any other address is a choice of the user.
  const isSet = (key: string): boolean => {
    const value = read(env, key);
    return (
      value !== undefined &&
      !(key === 'LOADCRAFT_URL' && stripTrailingSlashes(value) === DEFAULT_APP_URL)
    );
  };
  return ['LOADCRAFT_URL', 'LOADCRAFT_API_URL'].filter(isSet);
}

/**
 * What the user is told when the mode is switched on beside an address of a real LoadCraft: the
 * cause and the settings to change. Shown as a configuration problem; the server keeps running.
 */
export function demoRefusal(conflicts: readonly string[]): string {
  const names = conflicts.join(' and ');
  return `LOADCRAFT_DEMO=1 runs against a sample backend of its own, but ${names} point${conflicts.length === 1 ? 's' : ''} at a real LoadCraft. In /plugin turn off the demo option, or reset the LoadCraft URL (loadcraft_url) to its default and clear the API URL (api_url).`;
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd: string): Config {
  const problems: string[] = [];

  const appUrl = readUrl(env, 'LOADCRAFT_URL', problems) ?? DEFAULT_APP_URL;
  const apiUrl = readUrl(env, 'LOADCRAFT_API_URL', problems) ?? `${appUrl}${API_PATH}`;

  const tokenValue = read(env, 'LOADCRAFT_API_TOKEN');
  const demoRequested = isDemoSwitch(env);
  const conflicts = demoRequested ? demoConflicts(env) : [];
  // A refused mode is off: nothing in the process may start a sample backend or reach a real one,
  // every tool answers with the problem instead.
  const demo = demoRequested && conflicts.length === 0;
  if (conflicts.length > 0) {
    problems.push(demoRefusal(conflicts));
  } else if (tokenValue === undefined && !demo) {
    problems.push('LOADCRAFT_API_TOKEN is not set; create an API token in LoadCraft settings.');
  }

  const speedValue = demo ? read(env, 'LOADCRAFT_DEMO_SPEED') : undefined;
  let demoSpeed = DEFAULT_DEMO_SPEED;
  if (speedValue !== undefined) {
    const speed = Number(speedValue);
    if (Number.isFinite(speed) && speed > 0 && speed <= MAX_DEMO_SPEED) {
      demoSpeed = speed;
    } else {
      problems.push(
        `LOADCRAFT_DEMO_SPEED must be a number above 0 and at most ${String(MAX_DEMO_SPEED)}; ${String(DEFAULT_DEMO_SPEED)} is used instead.`,
      );
    }
  }

  const localeValue = read(env, 'LOADCRAFT_LOCALE');
  const locale: Locale = localeValue === 'pl' ? 'pl' : 'en';

  const levelValue = read(env, 'LOADCRAFT_LOG_LEVEL');
  const logLevel = LOG_LEVELS.find((level) => level === levelValue) ?? 'info';

  const workspaceValue = read(env, 'LOADCRAFT_WORKSPACE');
  const workspaceRoot = resolve(cwd, workspaceValue ?? '.');

  return Object.freeze({
    appUrl,
    apiUrl,
    token: new Secret(tokenValue ?? ''),
    locale,
    workspaceRoot,
    stateRoot: workspaceRoot,
    demo,
    demoSpeed,
    logLevel,
    problems: Object.freeze(problems),
  });
}
