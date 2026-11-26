// Common starting kit of tool tests: fake backend + server with the tools under test + MCP client
// from the harness + test clock + temporary workspace + canary check. The backend's world (its
// records and routes) comes in as a parameter, so this file never imports a world itself.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { onTestFinished } from 'vitest';

import { loadConfig, type Config } from '../../src/config.js';
import { createLogger, type LogLevel } from '../../src/log.js';
import type { ToolOutcome } from '../../src/outcome.js';
import type { Translator } from '../../src/context.js';
import type { Tool } from '../../src/registry.js';
import { createServer, createServices } from '../../src/server.js';
import { startFake, type Fake, type StartFakeOptions } from '../fake-backend/server.js';
import { assertNoCanary, CANARY } from './canary.js';
import { createTestClock, type SteppedClock } from './clock.js';
import {
  connect,
  type CallOptions,
  type CallResult,
  type Elicitor,
  type Era,
  type McpSession,
} from './mcp.js';

export interface ToolRigOptions {
  /** Tools registered on the server under test. */
  tools: readonly Tool[];
  /** Fills the fake backend (records, routes, faults) before the client connects. */
  world?: (fake: Fake) => void | Promise<void>;
  /** Passed to `startFake` (meta, seed, token, ...); the clock is the rig's. */
  fake?: Omit<StartFakeOptions, 'clock' | 'scope'>;
  /** Environment of the server, on top of the API url and the canary token. */
  env?: NodeJS.ProcessEnv;
  /** Shared by the fake and the server; default: a new test clock at 0. */
  clock?: SteppedClock;
  era?: Era;
  /** The person behind the client answers the server's questions with this (see `connect`). */
  elicit?: Elicitor;
  /** Files created in the workspace before the server starts (relative path -> content). */
  files?: Readonly<Record<string, string>>;
  /**
   * One set of services for every request, as the real process has (`main` in `src/server.ts`):
   * for work a tool leaves running in the process between calls. Default: a set per request.
   */
  processServices?: boolean;
}

/**
 * What a tool returned before the registry drew it: the server sends text only, so a test that
 * checks data (not wording) reads it here. `links` carry the label already translated.
 */
export interface SeenOutcome {
  readonly status: 'done' | 'running' | 'needs_user';
  readonly data: unknown;
  readonly operation?: string;
  readonly links?: readonly { readonly url: string; readonly label: string }[];
}

/** A call result plus the outcome of the tool behind it (absent when the call failed). */
export interface RigCallResult extends CallResult {
  readonly outcome: SeenOutcome | undefined;
}

export interface LogRecord {
  readonly level: LogLevel;
  readonly msg: string;
  readonly [field: string]: unknown;
}

export interface ToolRig {
  readonly session: McpSession;
  readonly fake: Fake;
  readonly clock: SteppedClock;
  readonly config: Config;
  /** Real path of the temporary workspace (the server's workspace root). */
  readonly workspace: string;
  /** Raw log lines, in order. */
  readonly lines: readonly string[];
  /** Results of every `call`, in order (what the leak check reads). */
  readonly results: readonly RigCallResult[];
  /** Calls a tool and remembers the result for the canary check. */
  call(name: string, args: Record<string, unknown>, opts?: CallOptions): Promise<RigCallResult>;
  /** Parsed log records, optionally only of one level (useful to see why a call failed). */
  logRecords(level?: LogLevel): LogRecord[];
  /** Throws when the canary is in any result so far, in the log or in a file under `loadcraft/`. */
  assertClean(): void;
  /** Drops remembered results, for a test that leaked on purpose. */
  forgetResults(): void;
  /** Drops remembered log lines, for a test that logged the canary on purpose. */
  forgetLogs(): void;
}

function describeOutcome(outcome: ToolOutcome<unknown>, t: Translator): SeenOutcome {
  const links = (outcome.links ?? []).map((link) => ({ url: link.url, label: t(link.labelKey) }));
  return {
    status: outcome.status,
    data: outcome.data,
    ...(outcome.status === 'done' ? {} : { operation: outcome.operation }),
    ...(links.length === 0 ? {} : { links }),
  };
}

function filesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Starts the whole kit; everything is torn down when the test ends. At that point the rig also
 * checks that the canary is not in any result, log line or file under the workspace's `loadcraft/`
 * folder, and the fake fails the test on contract violations and handler errors left unread.
 * Must be called inside a test or `beforeEach`.
 */
export async function toolRig(options: ToolRigOptions): Promise<ToolRig> {
  const clock = options.clock ?? createTestClock();
  const fake = await startFake({ ...options.fake, clock });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-rig-')));
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  await options.world?.(fake);

  const lines: string[] = [];
  const results: RigCallResult[] = [];
  const real = loadConfig(
    {
      LOADCRAFT_API_URL: `${fake.url}/api/v1`,
      LOADCRAFT_API_TOKEN: fake.token,
      ...options.env,
    },
    workspace,
  );
  // Demonstration mode refuses an address of a real backend, so the rig points a mode that was
  // asked for at the fake the way the mode itself points at its sample backend.
  const config: Config =
    options.env?.LOADCRAFT_DEMO === undefined
      ? real
      : Object.freeze({
          ...loadConfig({ LOADCRAFT_API_TOKEN: fake.token, ...options.env }, workspace),
          apiUrl: `${fake.url}/api/v1`,
        });
  // The tools are wrapped to note what each call returned; the call that is running is found by
  // its async context, so calls in flight together do not mix their outcomes.
  const seen = new AsyncLocalStorage<{ outcome?: SeenOutcome }>();
  const tools = options.tools.map((tool): Tool => ({
    ...tool,
    async invoke(ctx, args) {
      const result = await tool.invoke(ctx, args);
      const slot = seen.getStore();
      if (slot !== undefined) slot.outcome = describeOutcome(result.outcome, ctx.t);
      return result;
    },
  }));
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  if (config.token.reveal() !== CANARY) {
    throw new Error(
      'toolRig: the API token must be the canary (fake.token and LOADCRAFT_API_TOKEN), or the leak check proves nothing',
    );
  }
  log.registerSecret(config.token.reveal());
  const services =
    options.processServices === true ? createServices(config, log, clock) : undefined;
  const session = await connect(
    () =>
      createServer({ config, log, tools, clock, ...(services === undefined ? {} : { services }) }),
    {
      ...(options.era === undefined ? {} : { era: options.era }),
      ...(options.elicit === undefined ? {} : { elicit: options.elicit }),
    },
  );

  const rig: ToolRig = {
    session,
    fake,
    clock,
    config,
    workspace,
    lines,
    results,
    async call(name, args, opts) {
      const slot: { outcome?: SeenOutcome } = {};
      const result = await seen.run(slot, () => session.call(name, args, opts));
      const full: RigCallResult = { ...result, outcome: slot.outcome };
      results.push(full);
      return full;
    },
    logRecords(level) {
      const records = lines.map((line) => JSON.parse(line) as LogRecord);
      return level === undefined ? records : records.filter((record) => record.level === level);
    },
    assertClean() {
      const files = filesUnder(join(workspace, 'loadcraft')).map((path) => readFileSync(path));
      // The outcome is the tool's own data before the registry scrubbed the text: only what the
      // model receives is checked.
      assertNoCanary(
        results.map((result) =>
          Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'outcome')),
        ),
        lines,
        files,
      );
    },
    forgetResults() {
      results.splice(0);
    },
    forgetLogs() {
      lines.splice(0);
    },
  };

  onTestFinished(async () => {
    try {
      await session.close();
      rig.assertClean();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
  return rig;
}

export { CANARY };
