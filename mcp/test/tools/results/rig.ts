// The rig of the tools of module results: the sklep world after its runs, the workspace bound to
// its project, the routes of every set (the resolver lists the runs of a project), and the state
// file of the workspace written as the plugin writes it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Tool } from '../../../src/registry.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { State } from '../../../src/workspace/processState.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake, FakeCall } from '../../fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepExecution,
} from '../../fake-backend/worlds/sklep.js';
import { createTestClock } from '../../helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { OTHER, PROJECT, RUN } from './fixtures.js';

export const NOW = '2026-11-26T12:00:00.000Z';

export const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

export const STATE_PATH = 'loadcraft/.cache/state.json';

/** What the process of the project holds: ids and choices, merged into an empty process. */
export interface ProcessSeed {
  readonly ids?: Readonly<Record<string, unknown>>;
  readonly choices?: { readonly run?: Readonly<Record<string, unknown>> };
}

/**
 * The state file with the process of the project. `checked: false` writes it without the check of
 * the schema: a file the person edited by hand.
 */
export function stateFile(seed: ProcessSeed, checked = true): string {
  const empty = newProcess(PROJECT, NOW);
  const process = {
    ...empty,
    ids: { ...empty.ids, ...seed.ids },
    choices: { ...empty.choices, run: { ...empty.choices.run, ...seed.choices?.run } },
  };
  const state = { schema: 3, process: { [PROJECT]: process } };
  if (checked) State.parse(state);
  return JSON.stringify(state);
}

/**
 * OTHER, the run RUN is compared with: a copy of RUN a day earlier, so the resolver finds its
 * handle among the runs of the project.
 */
function seedOtherRun(fake: Fake): void {
  const executions = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  if (executions.get(OTHER) !== undefined) return;
  const run = executions.require(RUN);
  executions.insert({
    ...run,
    id: OTHER,
    created_at: '2026-11-21T09:00:00Z',
  });
}

export interface ResultsRigOptions {
  readonly tools: readonly Tool[];
  /** Seeds the answers of the routes of module results (after the world is in place). */
  readonly seed?: (fake: Fake) => void;
  readonly locale?: 'en' | 'pl';
  /** Files of the workspace; default: the binding to the project. */
  readonly files?: Readonly<Record<string, string>>;
}

export async function resultsRig(options: ResultsRigOptions): Promise<ToolRig> {
  return toolRig({
    tools: options.tools,
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      seedOtherRun(fake);
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? { 'loadcraft/project.json': BOUND },
  });
}

/** The requests about one run (`…/executions/{id}…`), the compare request included, in order. */
export function runCalls(r: ToolRig): FakeCall[] {
  return r.fake.calls.filter((call) =>
    /^\/api\/v1\/projects\/[^/]+\/gatling\/executions\/./u.test(call.path),
  );
}

/** The path and query of a request as one string (`…/logs?limit=50`). */
export function target(call: FakeCall): string {
  const query = new URLSearchParams(call.query as Record<string, string>).toString();
  return query === '' ? call.path : `${call.path}?${query}`;
}

interface StoredLog {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}

interface StoredProcess {
  readonly reads: readonly StoredLog[];
  readonly log: readonly StoredLog[];
  readonly steps: Readonly<Record<string, { readonly checks: Readonly<Record<string, unknown>> }>>;
}

/** The process of the project in the state file, as the registry left it. */
export function processOf(r: ToolRig): StoredProcess | undefined {
  const state = JSON.parse(readFileSync(join(r.workspace, STATE_PATH), 'utf8')) as {
    process: Record<string, StoredProcess>;
  };
  return state.process[PROJECT];
}

/** The successful reads of the conversation, as `[tool, args, result]`. */
export function readsOf(r: ToolRig): [string, string, string][] {
  return (processOf(r)?.reads ?? []).map((entry) => [entry.tool, entry.args, entry.result]);
}

/** The data of a call made with `format: "data"`. */
export function dataOf<T>(result: RigCallResult): T {
  if (result.isError) throw new Error(`the call failed: ${result.text}`);
  return JSON.parse(result.text) as T;
}

/** Characters a terminal acts on: ESC, BEL and the other C0 controls but tab. */
export const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}${String.fromCharCode(155)}]`,
  'u',
);

/** The code of an error result (`[not_found] …` → `not_found`). */
export function errorCode(result: RigCallResult): string | undefined {
  return result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
}
