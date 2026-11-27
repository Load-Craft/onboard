// Shared rig, scripted runs and call helpers of the `run_start` wait tests (tools.runStart.wait.*.test.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTranslator } from '../../src/render/i18n/index.js';
import { runStart } from '../../src/tools/runStart.js';
import { processWait } from '../../src/tools/processWait.js';
import { goldenText, goldenUrl, SKLEP_IDS } from '../golden/index.js';
import { registerDataRoutes } from '../fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from '../fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { seedSklep } from '../fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './clock.js';
import { toolRig, type RigCallResult, type ToolRig } from './rig.js';

export const NOW = Date.parse('2026-11-22T11:00:00Z');
export const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
export const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;
export const tPl = createTranslator('pl');

// ---- the scripted run ------------------------------------------------------------------------

/** The columns of the golden chart as requests per second; the last two share the top. */
export const PERF_LEVELS = [0, 0, 150, 150, 150, 290, 290, 290, 430, 570, 710, 860, 1000, 1000];

/** `values` spread over `length` points the way `shapeChart` takes them back into columns. */
export function spread(values: readonly number[], length: number): number[] {
  const points = Array<number>(length).fill(0);
  values.forEach((value, index) => {
    const from = Math.floor((index * length) / values.length);
    const to = Math.floor(((index + 1) * length) / values.length);
    for (let at = from; at < to; at += 1) points[at] = value;
  });
  return points;
}

export const BUILD_S = 18;

/** Perf: 600 s of load after 18 s of build; 690 requests/s and p95≈ 910 ms at 6:40, p95≈ 1\u202f120 ms at the end. */
export const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: BUILD_S - 2,
  loadS: 600,
  end: 'completed',
  live: (elapsed) =>
    elapsed >= 390
      ? { rps: 690, p95: 910, errorRate: 0.006 }
      : { rps: elapsed * 1.7, p95: 500, errorRate: 0.006 },
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: spread(PERF_LEVELS, 60),
};

/** Qa after clamping: flat 18 requests/s. */
export const QA: RunScript = {
  ...PERF,
  live: () => ({ rps: 18, p95: 205, errorRate: 0 }),
  final: { rps: 18, p95: 210, errorRate: 0 },
  series: Array<number>(60).fill(18),
};

export interface RigOptions {
  readonly script: RunScript;
  readonly ids?: readonly string[];
  readonly locale?: 'en' | 'pl';
  /** Files in the workspace besides the project binding. */
  readonly files?: Readonly<Record<string, string>>;
}

export async function rig(options: RigOptions): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [runStart, processWait],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, options.script);
      planExecutionIds(fake, options.ids ?? [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: { ...BOUND, ...options.files },
  });
}

export interface Structured {
  readonly status: string;
  readonly operation?: string;
}

export interface Whole {
  readonly last: RigCallResult;
  readonly calls: readonly RigCallResult[];
}

export const PERF_ARGS = { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 };
export const QA_ARGS = { ...PERF_ARGS, environment: 'qa', confirm_capped: true };

/** `run_start`, then `process_wait` until the run is over; every call's result, in order. */
export async function untilEnd(r: ToolRig, args: Record<string, unknown>): Promise<Whole> {
  const calls: RigCallResult[] = [];
  let result = await settleClock(r, r.call('run_start', args));
  calls.push(result);
  for (let again = 0; again < 12; again += 1) {
    const structured = result.outcome as Structured | undefined;
    if (result.isError || structured?.status !== 'running' || structured.operation === undefined) {
      break;
    }
    result = await settleClock(r, r.call('process_wait', { operation: structured.operation }));
    calls.push(result);
  }
  return { last: result, calls };
}

/**
 * A progress line from the last third of the run, with its time set to 6:40: the time a poll lands
 * on depends on how the test clock was stepped, the numbers and the layout of the line do not.
 */
export function at640(messages: readonly string[]): string | undefined {
  const near = messages.find((message) => /^6:(4\d|5\d) \/ 10:00 · (690|18) /u.test(message));
  return near?.replace(/^\d+:\d{2}/u, '6:40');
}

export const golden = (run: 'run1' | 'run5', name: string): string => goldenText(run, name);

export function goldenData<T>(file: string): T {
  return JSON.parse(readFileSync(goldenUrl(file), 'utf8')) as T;
}

export const gets = (r: ToolRig, suffix = ''): number =>
  r.fake.calls.filter(
    (call) =>
      call.method === 'GET' &&
      call.path.endsWith(`/gatling/executions/${SKLEP_IDS.executionPerf}${suffix}`),
  ).length;

// ---- the views ---------------------------------------------------------------------------------

export function operations(r: ToolRig): Record<string, unknown> {
  try {
    const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      opPayloads?: Record<string, unknown>;
    };
    return state.opPayloads ?? {};
  } catch {
    return {};
  }
}
