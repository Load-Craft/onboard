// The step of the process and the `blocked` status of a step, on the real server with the real tools against
// the fake backend: the reducer computes both in the write of every call, from the checks the calls set and
// from the open blockers in problems[]. No tool writes either of them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as z from 'zod';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '../src/http/generated/api.js';
import { createLogger } from '../src/log.js';
import { defineTool } from '../src/registry.js';
import { flowsGenerateFromEndpoints } from '../src/tools/flowsGenerateFromEndpoints.js';
import { createProcessStore, type ProcessUpdateInput } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerFlowGenerationRoutes } from './fake-backend/routes/flowGeneration.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { SETUP_TOOLS, setUpProject } from './helpers/projectSetup.js';
import { BOUND } from './helpers/runStartWait.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

type FlowDetail = components['schemas']['FlowDetail'];

const PROJECT: string = SKLEP_IDS.project;

interface ProcessFile {
  rev: number;
  step: string;
  steps: Record<
    'project' | 'flows',
    { status: string; checks: Record<string, { ok: boolean | null }> }
  >;
  problems: { code: string; severity: string; module: string }[];
}

function processOf(r: ToolRig, key = PROJECT): ProcessFile {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, ProcessFile> };
  const found = state.process[key];
  if (found === undefined) throw new Error(`no process under ${key}`);
  return found;
}

/** A tool under its catalog name that returns a fixed update (no tool of today writes these). */
const stub = (name: string, update: () => ProcessUpdateInput | undefined) =>
  defineTool({
    name,
    title: name,
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: () => {
      const u = update();
      return Promise.resolve({
        status: 'done' as const,
        data: {},
        ...(u === undefined ? {} : { update: u }),
      });
    },
    render: () => 'ok',
  });

/** The project setup (the five tools in the order of the skill) on an empty backend; its process. */
async function initOnce(args: { description?: string }): Promise<ProcessFile> {
  const r = await toolRig({
    tools: SETUP_TOOLS,
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerSetupRoutes(fake);
      registerOpenapiReadRoute(fake);
      registerApiMapRoute(fake);
      registerConformanceRoute(fake);
      seedSklep(fake.store, { stage: 'empty' });
    },
  });
  const calls = await setUpProject(r, {
    name: 'sklep',
    environments: [{ name: 'perf', api: 'api.perf.example.com', default: true }],
    ...args,
  });
  expect(calls.apply?.isError, calls.apply?.text).toBe(false);
  const id = (
    JSON.parse(readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8')) as {
      project: { id: string };
    }
  ).project.id;
  return processOf(r, id);
}

describe('the step after the project setup', () => {
  it('a complete setup closes the project step: the step moves to flows in the same write', async () => {
    const p = await initOnce({ description: 'Shop: catalog, cart, orders.' });
    expect(p.steps.project.checks.setup_applied?.ok).toBe(true);
    expect(p.steps.project.status).toBe('done');
    expect(p.step).toBe('flows');
  });

  it('a setup that is not complete leaves the step at project: setup_applied is required', async () => {
    const p = await initOnce({});
    expect(p.steps.project.checks.setup_applied?.ok).toBe(false);
    expect(p.steps.project.status).toBe('active');
    expect(p.step).toBe('project');
  });
});

// ---- flows ----------------------------------------------------------------------------------

const MANUAL = {
  name: 'zakupy',
  description: 'Log in, search the shop, put an item in the cart and pay for it',
  endpoints: [
    'POST /auth/login',
    'GET /products',
    'POST /cart/items',
    'GET /cart',
    'POST /checkout',
  ],
};

/** What a blocker in the project looks like when a tool reports one. */
const BLOCKER = {
  module: 'project' as const,
  tool: 'project_check_env',
  code: 'env_unreachable',
  severity: 'blocker' as const,
  message: 'The environment does not answer.',
};

let next: ProcessUpdateInput | undefined;
const FLOWS_GET = stub('flows_get', () => ({
  checks: { flows: { questions_answered: { ok: true } } },
}));
const PROJECT_SAVE_ENV = stub('project_save_env', () => undefined);
const PROJECT_CHECK_ENV = stub('project_check_env', () => next);

function flowsRig(): Promise<ToolRig> {
  const clock = createTestClock(Date.parse('2026-11-22T09:00:00Z'));
  return toolRig({
    tools: [flowsGenerateFromEndpoints, FLOWS_GET, PROJECT_SAVE_ENV, PROJECT_CHECK_ENV],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerOpenapiReadRoute(fake);
      const url = new URL('./fixtures/flows/zakupy-run2-reczne.json', import.meta.url);
      const flow = {
        ...(JSON.parse(readFileSync(url, 'utf8')) as FlowDetail),
        id: SKLEP_IDS.flowZakupy,
      };
      registerFlowGenerationRoutes(fake, { flow }, clock);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock,
    files: BOUND,
  });
}

/** The project step done, as the project setup leaves it in a project created earlier. */
async function seedProject(r: ToolRig): Promise<void> {
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const store = createProcessStore(r.workspace, { secrets, clock: { now: () => r.clock.now() } });
  await store.applyUpdate(
    PROJECT,
    {
      checks: {
        project: {
          created: { ok: true },
          env_saved: { ok: true },
          env_checked: { ok: true },
          setup_applied: { ok: true },
        },
      },
    },
    { tool: 'project_create' },
  );
}

describe('the step after a build of flows', () => {
  it('flows stays the step until its questions are answered, then scenario; an invalidation takes it back', async () => {
    const r = await flowsRig();
    await seedProject(r);
    expect(processOf(r).step).toBe('flows');

    const built = await settleClock(r, r.call(flowsGenerateFromEndpoints.name, MANUAL), {
      limitMs: 60_000,
    });
    expect(built.isError, built.text).toBe(false);
    const after = processOf(r);
    // flows_built is ok, questions_answered (required) is not recorded yet
    expect(after.steps.flows.status).toBe('active');
    expect(after.step).toBe('flows');

    await r.call('flows_get', {});
    expect(processOf(r).steps.flows.status).toBe('done');
    expect(processOf(r).step).toBe('scenario');

    // a new environment invalidates the check that it answers: the project step is open again
    await r.call('project_save_env', {});
    const back = processOf(r);
    expect(back.steps.project.checks.env_checked?.ok).toBeNull();
    expect(back.steps.project.status).toBe('active');
    expect(back.step).toBe('project');
  });

  it('a blocker of the project blocks its step; closing it with the check gives the step back', async () => {
    const r = await flowsRig();
    await seedProject(r);

    next = { problems: { open: [BLOCKER] } };
    await r.call('project_check_env', {});
    const blocked = processOf(r);
    expect(blocked.steps.project.status).toBe('blocked');
    expect(blocked.step).toBe('project');
    expect(blocked.problems).toEqual([
      expect.objectContaining({ code: 'env_unreachable', severity: 'blocker', module: 'project' }),
    ]);

    next = {
      problems: { close: [{ code: 'env_unreachable' }] },
      checks: { project: { env_checked: { ok: true } } },
    };
    await r.call('project_check_env', {});
    const open = processOf(r);
    expect(open.steps.project.status).toBe('done');
    expect(open.step).toBe('flows');
    expect(open.problems).toEqual([]);
  });
});
