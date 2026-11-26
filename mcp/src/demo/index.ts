// Demonstration mode (`LOADCRAFT_DEMO=1`): the server starts a sample LoadCraft backend of its own
// on a random port of the loopback interface and talks to it with a token that exists only there.
// The backend lives in `demo-backend.mjs`, a separate file next to the server that is imported
// only here, only when the mode is on; the server bundle itself holds none of it.

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { demoConflicts, demoRefusal, type Config } from '../config.js';
import { Secret } from '../secret.js';

/** What `demo-backend.mjs` hands back once the sample backend listens. */
export interface DemoBackend {
  /** Address on the loopback interface, without a path. */
  readonly url: string;
  /** The only token the sample backend accepts. */
  readonly token: string;
  close(): Promise<void>;
}

/** The module `demo-backend.mjs`. */
export interface DemoBackendModule {
  startDemoBackend(options: { speed: number }): Promise<DemoBackend>;
}

/** The mode cannot start; the message says why and goes to the user. */
export class DemoError extends Error {
  override readonly name = 'DemoError';
}

export interface DemoSession {
  /** The configuration to run with: the sample backend's address and token, the state folder. */
  readonly config: Config;
  /** Stops the sample backend and removes the state folder. */
  close(): Promise<void>;
}

export interface StartDemoOptions {
  /** Imports the backend module; by default the file next to the running server. */
  readonly load?: () => Promise<unknown>;
}

const BACKEND_FILE = 'demo-backend.mjs';
const STATE_PREFIX = 'loadcraft-demo-';
/** State folders of sessions killed without cleaning up are removed once they are this old. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** Appended to a refusal that is not about the settings: the way out the user has. */
const DEMO_FIX = 'In /plugin turn off the demo option, or reinstall the plugin.';

const OWNER_FILE = 'owner.pid';

/** Whether a process with this id exists (signal 0 only checks; EPERM means it exists). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Not `instanceof Error`: the error may come from another realm.
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}

/**
 * Removes the state folders an earlier, killed session left in the temporary folder: older than an
 * hour (the age of the folder itself, which writes below it do not change) and not owned by a
 * process that is still running. A folder with no owner file is judged by age alone.
 */
export async function removeStaleStateFolders(
  dir: string = tmpdir(),
  now: number = Date.now(),
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(STATE_PREFIX))
      .map(async (name) => {
        const path = join(dir, name);
        try {
          if (now - (await stat(path)).mtimeMs <= STALE_AFTER_MS) return;
          const owner = Number(await readFile(join(path, OWNER_FILE), 'utf8').catch(() => ''));
          if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) return;
          await rm(path, { recursive: true, force: true });
        } catch {
          // Another session may be removing it at the same time; a leftover is harmless.
        }
      }),
  );
}

function defaultLoad(): Promise<unknown> {
  return import(new URL(`./${BACKEND_FILE}`, import.meta.url).href);
}

function isBackendModule(value: unknown): value is DemoBackendModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'startDemoBackend' in value &&
    typeof value.startDemoBackend === 'function'
  );
}

async function loadBackend(load: () => Promise<unknown>): Promise<DemoBackendModule> {
  let loaded: unknown;
  try {
    loaded = await load();
  } catch (cause) {
    throw new DemoError(
      `${BACKEND_FILE} could not be loaded: it must sit next to the server file (${cause instanceof Error ? cause.message : String(cause)}). ${DEMO_FIX}`,
      { cause },
    );
  }
  if (!isBackendModule(loaded)) {
    throw new DemoError(`${BACKEND_FILE} does not export startDemoBackend(). ${DEMO_FIX}`);
  }
  return loaded;
}

/**
 * Starts the sample backend and returns the configuration that points at it. Refuses, before
 * anything is loaded or opened, when an address of a real LoadCraft is set: the mode never talks
 * to one. A token set for real use is ignored, never sent to the sample backend.
 */
export async function startDemo(
  config: Config,
  env: NodeJS.ProcessEnv,
  options: StartDemoOptions = {},
): Promise<DemoSession> {
  const conflicts = demoConflicts(env);
  if (conflicts.length > 0) {
    throw new DemoError(demoRefusal(conflicts));
  }
  await removeStaleStateFolders();
  const module = await loadBackend(options.load ?? defaultLoad);
  const backend = await module.startDemoBackend({ speed: config.demoSpeed });
  // The binding and the cache of the sample project must not land in the user's repository.
  // The process outlives a failed start, so nothing started here may be left running or on disk.
  let stateRoot: string | undefined;
  try {
    stateRoot = await mkdtemp(join(tmpdir(), STATE_PREFIX));
    // Tells the sessions that start later that this folder belongs to a process that is running.
    await writeFile(join(stateRoot, OWNER_FILE), `${String(process.pid)}\n`);
  } catch (error) {
    await backend.close().catch(() => undefined);
    if (stateRoot !== undefined) await rm(stateRoot, { recursive: true, force: true });
    throw error;
  }
  const demoConfig: Config = Object.freeze({
    ...config,
    appUrl: backend.url,
    apiUrl: `${backend.url}/api/v1`,
    token: new Secret(backend.token),
    stateRoot,
    demo: true,
    problems: Object.freeze([...config.problems]),
  });
  return {
    config: demoConfig,
    async close() {
      try {
        await backend.close();
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    },
  };
}
