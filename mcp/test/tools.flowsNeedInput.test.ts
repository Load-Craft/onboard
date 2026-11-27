// The warning `flows_need_input`: flows the generator left open items on (`needs_input`). The list
// of flows counts them per flow (`needs_input_count`, `needs_input_definite_count`) and the detail
// lists them. The status records one warning with the flows and the definite items and shows it;
// `flows_get` reads the items from the flow itself; `run_start` shows the open warning before it
// starts. It is a warning: nothing is blocked, also when items are definite.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { components } from '../src/http/generated/api.js';
import { flowsGet } from '../src/tools/flows/get.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { projectSaveEnv } from '../src/tools/projectSaveEnv.js';
import { runStart } from '../src/tools/runStart.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerAnalysisReadRoute } from './fake-backend/routes/analysis.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
} from './fake-backend/routes/executions.js';
import { FLOW_COLLECTIONS, registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

type FlowDetail = components['schemas']['FlowDetail'];

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const DEFINITE = {
  kind: 'credential_scheme',
  field: 'Checkout',
  steps: ['Checkout'],
  definite: true,
  question: 'Which token should "Checkout" carry?',
  why: 'Step "Checkout" requires another security scheme.',
};
const DOUBT = {
  kind: 'auth',
  field: 'auth.token',
  question: 'Which account logs in?',
  why: 'The login replays a captured value.',
};

async function rig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [processGetStatus, flowsGet, runStart, projectSaveEnv],
    world: (fake) => {
      scriptRuns(fake, clock, {
        startsAtS: 0,
        loadS: 0,
        end: 'completed',
        live: () => ({ rps: 0, p95: 0, errorRate: 0 }),
        final: { rps: 690, p95: 1120, errorRate: 0.006 },
        series: [10, 20, 30],
      });
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerFlowRoutes(fake);
      registerStatusRoutes(fake);
      registerAnalysisReadRoute(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: locale },
    files: { ...BOUND, '.env': 'SHOP_API_KEY=pk-example\n' },
  });
}

/** The generator left `items` on the flow `id`. */
function leave(r: ToolRig, id: string, items: readonly Record<string, unknown>[]): void {
  r.fake.store
    .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
    .update(id, { needs_input: items as unknown as NonNullable<FlowDetail['needs_input']> });
}

interface StateProblem {
  readonly code: string;
  readonly severity: string;
  readonly flow_ids?: readonly string[];
  readonly definite_count?: number;
}

function problems(r: ToolRig): StateProblem[] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { problems: StateProblem[] }> };
  return (state.process[SKLEP_IDS.project]?.problems ?? []).filter(
    (problem) => problem.code === 'flows_need_input',
  );
}

const flat = (text: string): string => text.replace(/\s+/gu, ' ');

describe('flows_need_input', () => {
  it('the status records one warning from the counts of the list and shows it', async () => {
    const r = await rig();
    leave(r, SKLEP_IDS.flowZakupy, [DEFINITE, DOUBT]);
    leave(r, SKLEP_WORLD_IDS.flowKonto, [DOUBT]);
    const result = await r.call('process_get_status', {});
    expect(result.isError, result.text).toBe(false);
    expect(flat(result.text)).toMatch(
      /2 flows with open generator questions \(1 definite: its steps get 401\): konto, zakupy/u,
    );
    expect(flat(result.text)).toMatch(/→ [^\n]*flows_get/u);
    const [warning, ...more] = problems(r);
    expect(more).toEqual([]);
    expect(warning).toMatchObject({ severity: 'warning', definite_count: 1 });
    expect([...(warning?.flow_ids ?? [])].sort()).toEqual(
      [SKLEP_IDS.flowZakupy, SKLEP_WORLD_IDS.flowKonto].sort(),
    );
    // the same reading again changes nothing; answered items close the warning
    await r.call('process_get_status', {});
    expect(problems(r)).toEqual([warning]);
    leave(r, SKLEP_IDS.flowZakupy, []);
    leave(r, SKLEP_WORLD_IDS.flowKonto, []);
    const clean = await r.call('process_get_status', {});
    expect(clean.text).not.toContain('open generator questions');
    expect(problems(r)).toEqual([]);
  });

  it('flows_get reads the items from the flow itself, not from a version snapshot', async () => {
    const r = await rig();
    leave(r, SKLEP_IDS.flowZakupy, [DEFINITE]);
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError, result.text).toBe(false);
    expect(flat(result.text)).toMatch(/"Checkout" will get 401/u);
    expect(r.fake.calls.some((call) => call.path.includes('/versions/'))).toBe(false);
    expect(problems(r)).toMatchObject([
      { flow_ids: [SKLEP_IDS.flowZakupy], definite_count: 1, severity: 'warning' },
    ]);
  });

  it('run_start warns about the open warning and still starts the run', async () => {
    const r = await rig();
    leave(r, SKLEP_IDS.flowZakupy, [DEFINITE]);
    await r.call('process_get_status', {});
    const result = await settleClock(
      r,
      r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
      }),
    );
    expect(result.isError, result.text).toBe(false);
    expect(flat(result.text)).toMatch(
      /⚠ 1 flow of the project has open generator questions \(1 definite: its steps get 401\)/u,
    );
    expect(r.fake.calls.some((call) => call.path.endsWith('/execute'))).toBe(true);
  });

  it('saving fixed headers closes the warning; the next reading opens it for items still open', async () => {
    const r = await rig();
    leave(r, SKLEP_IDS.flowZakupy, [
      { kind: 'static_credential', field: 'x-api-key', question: 'Which key?', why: '' },
    ]);
    await r.call('process_get_status', {});
    expect(problems(r)).toHaveLength(1);
    const saved = await settleClock(
      r,
      r.call('project_save_env', {
        environments: [
          {
            name: 'perf',
            api: 'api.perf.example.com',
            frontend: 'perf.example.com',
            default: true,
            headers: [{ name: 'x-api-key', from_env: 'SHOP_API_KEY' }],
          },
        ],
      }),
    );
    expect(saved.isError, saved.text).toBe(false);
    expect(problems(r)).toEqual([]);
    // LoadCraft still keeps the item on the flow: the status reads it again
    await r.call('process_get_status', {});
    expect(problems(r)).toHaveLength(1);
  });
});
