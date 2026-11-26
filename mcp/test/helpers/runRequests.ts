// The requests a load run asks LoadCraft for, for every way through the planning and the start,
// as the fake backend saw them. `tools.run.requests.test.ts` compares them with a recording of the
// single tools these two replaced; the same routes can record any pair of tool names.

import type { ToolName } from '../../src/catalog.generated.js';
import type { Tool } from '../../src/registry.js';
import { processWait } from '../../src/tools/processWait.js';
import { SKLEP_IDS } from '../golden/index.js';
import { registerDataRoutes } from '../fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from '../fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import type { FakeCall } from '../fake-backend/server.js';
import { seedSklep } from '../fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './clock.js';
import { PERF, BOUND, RAMP_2000 } from './runStartWait.js';
import { toolRig, type RigCallResult, type ToolRig } from './rig.js';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Consecutive identical requests (the polls of a run), when there is more than one. */
  readonly times?: number;
}

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export function normalizedRequest(call: FakeCall): RecordedRequest {
  const query = Object.keys(call.query).length === 0 ? {} : { query: call.query };
  const hasBody =
    call.method !== 'GET' &&
    call.body !== undefined &&
    call.body !== null &&
    !(typeof call.body === 'object' && Object.keys(call.body).length === 0);
  return {
    method: call.method,
    path: call.path.replace(ID, ':id'),
    ...query,
    ...(hasBody
      ? { body: JSON.parse(JSON.stringify(call.body).replace(ID, ':id')) as unknown }
      : {}),
  };
}

export interface RunToolNames {
  readonly plan: string;
  readonly start: string;
}

type Args = Readonly<Record<string, unknown>>;

async function rig(tools: readonly Tool[], script: RunScript): Promise<ToolRig> {
  const clock = createTestClock(Date.parse('2026-11-22T11:00:00Z'));
  return toolRig({
    tools: [...tools, processWait],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, script);
      planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
}

const PLAN_ARGS = { scenario: 'checkout', environment: 'perf' } as const;
const PERF_ARGS = { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 };

/** Every call, then `process_wait` on the handle until the run is over. */
async function untilEnd(r: ToolRig, name: string, args: Args): Promise<RigCallResult> {
  let result = await settleClock(r, r.call(name, args));
  for (let again = 0; again < 12; again += 1) {
    const structured = result.outcome as { status?: string; operation?: string } | undefined;
    if (result.isError || structured?.status !== 'running' || structured.operation === undefined) {
      break;
    }
    const wait: ToolName = 'process_wait';
    result = await settleClock(r, r.call(wait, { operation: structured.operation }));
  }
  return result;
}

interface Path {
  readonly script?: RunScript;
  readonly calls: (r: ToolRig, names: RunToolNames) => Promise<void>;
}

const once =
  (pick: (names: RunToolNames) => string, args: Args, finish = false): Path['calls'] =>
  async (r, names) => {
    if (finish) await untilEnd(r, pick(names), args);
    else await settleClock(r, r.call(pick(names), args));
  };

const plan = (names: RunToolNames): string => names.plan;
const start = (names: RunToolNames): string => names.start;

export const RUN_PATHS: Readonly<Record<string, Path>> = {
  'plan-composition': {
    calls: once(plan, { ...PLAN_ARGS, target_users: 2000 }),
  },
  'plan-scenario': {
    calls: once(plan, { scenario: 'przeglądanie', environment: 'perf', target_users: 50 }),
  },
  'plan-with-data': {
    calls: once(plan, { ...PLAN_ARGS, target_users: 2000, include_data: true }),
  },
  'plan-with-data-scenario': {
    calls: once(plan, {
      scenario: 'przeglądanie',
      environment: 'perf',
      target_users: 50,
      include_data: true,
    }),
  },
  'plan-protected-clamped': {
    calls: once(plan, { ...PLAN_ARGS, environment: 'qa', target_users: 2000 }),
  },
  'start-composition-thresholds': {
    script: PERF,
    calls: once(start, { ...PERF_ARGS, thresholds: { p95_ms: 1500, error_rate_pct: 1 } }, true),
  },
  'start-scenario': {
    script: PERF,
    calls: once(
      start,
      {
        scenario: 'przeglądanie',
        environment: 'perf',
        profile: { type: 'constant', vusers: 4, hold: 900 },
      },
      true,
    ),
  },
  'start-default-profile': {
    script: PERF,
    calls: once(start, { ...PERF_ARGS, profile: { type: 'smoke', vusers: 1 } }, true),
  },
  'start-left-running': {
    script: { ...PERF, loadS: 3600 },
    calls: once(start, { ...PERF_ARGS, max_wait_s: 1 }),
  },
  'start-protected-asks-consent': {
    script: PERF,
    calls: once(start, { ...PERF_ARGS, environment: 'qa' }),
  },
  'start-protected-confirmed': {
    script: PERF,
    calls: once(start, { ...PERF_ARGS, environment: 'qa', confirm_capped: true }, true),
  },
  'start-data-short': {
    script: PERF,
    calls: once(start, {
      ...PERF_ARGS,
      profile: { type: 'ramp_concurrency', vusers: 5000, ramp: 600 },
    }),
  },
  'start-same-load-joins': {
    script: { ...PERF, loadS: 3600 },
    calls: async (r, names) => {
      await settleClock(r, r.call(start(names), { ...PERF_ARGS, max_wait_s: 1 }));
      await settleClock(r, r.call(start(names), { ...PERF_ARGS, max_wait_s: 1 }));
    },
  },
  'start-other-load-refused': {
    script: { ...PERF, loadS: 3600 },
    calls: async (r, names) => {
      await settleClock(r, r.call(start(names), { ...PERF_ARGS, max_wait_s: 1 }));
      await settleClock(
        r,
        r.call(start(names), {
          ...PERF_ARGS,
          profile: { type: 'smoke', vusers: 1 },
          max_wait_s: 1,
        }),
      );
    },
  },
};

/** Consecutive identical requests become one entry with `times`. */
function collapsed(requests: readonly RecordedRequest[]): RecordedRequest[] {
  const out: RecordedRequest[] = [];
  for (const request of requests) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      JSON.stringify({ ...last, times: undefined }) === JSON.stringify(request)
    ) {
      out[out.length - 1] = { ...last, times: (last.times ?? 1) + 1 };
    } else {
      out.push(request);
    }
  }
  return out;
}

/** Runs every path on its own fake backend with the given tools and names; the requests of each. */
export async function recordRunPaths(
  tools: readonly Tool[],
  names: RunToolNames,
): Promise<Record<string, RecordedRequest[]>> {
  const recorded: Record<string, RecordedRequest[]> = {};
  for (const [name, path] of Object.entries(RUN_PATHS)) {
    const r = await rig(tools, path.script ?? PERF);
    await path.calls(r, names);
    recorded[name] = collapsed(r.fake.calls.map(normalizedRequest));
  }
  return recorded;
}
