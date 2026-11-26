// `process_get_status` data for the Path tab of the mod: which flow methods the project can use
// (documentation, a recording, a frontend address) and the journeys `flows_suggest_journeys` saved.
// Read from what the status read anyway (the setup gate, the environments, the workspace state):
// no extra request. Text of the status is unchanged.

import { describe, expect, it } from 'vitest';

import { processGetStatus } from '../src/tools/processGetStatus.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, type SklepStage } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: SKLEP_IDS.project, name: 'sklep' },
});

interface PathData {
  readonly path?: {
    readonly docs: boolean;
    readonly recording: boolean;
    readonly frontend: boolean;
    readonly journeys: readonly {
      readonly name: string;
      readonly pattern: string;
      readonly steps?: readonly string[];
      readonly built?: boolean;
    }[];
  };
}

const savedState = (baskets: unknown): string =>
  JSON.stringify({
    schema: 1,
    suggestions: {
      [SKLEP_IDS.project]: { savedAt: NOW, value: { specHash: 'abc', baskets } },
    },
  });

function sklep(stage: SklepStage) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerFlowRoutes(fake);
    registerStatusRoutes(fake);
    seedSklep(fake.store, { stage });
  };
}

async function rig(stage: SklepStage, files: Record<string, string> = {}): Promise<ToolRig> {
  return toolRig({
    tools: [processGetStatus],
    world: sklep(stage),
    clock: createTestClock(NOW),
    files: { 'loadcraft/project.json': BOUND, ...files },
  });
}

async function read(r: ToolRig): Promise<{ text: string; data: PathData }> {
  const result = await r.call('process_get_status', {});
  expect(result.isError, result.text).toBe(false);
  return { text: result.text, data: (result.outcome as { data: PathData }).data };
}

describe('process_get_status path facts', () => {
  it('says the documentation and the frontend address are known, and no journeys yet', async () => {
    const { data } = await read(await rig('flows'));
    expect(data.path).toEqual({ docs: true, recording: false, frontend: true, journeys: [] });
  });

  it('says no frontend when no environment has an address, and no documentation without a spec', async () => {
    const r = await rig('flows');
    const environments = r.fake.store.collection<{ id: string; frontend_url?: string | null }>(
      SKLEP_COLLECTIONS.environments,
    );
    for (const environment of environments.list(() => true)) {
      environments.update(environment.id, { frontend_url: null });
    }
    const projects = r.fake.store.collection<{ id: string; openapi_spec_id?: string | null }>(
      SKLEP_COLLECTIONS.projects,
    );
    for (const project of projects.list(() => true)) {
      projects.update(project.id, { openapi_spec_id: null });
    }
    const { data } = await read(r);
    expect(data.path).toMatchObject({ docs: false, frontend: false });
  });

  it('lists the journeys saved by flows_suggest_journeys, by name and pattern', async () => {
    const files = {
      'loadcraft/.cache/state.json': savedState([
        {
          name: 'Checkout',
          description: 'd',
          endpoint_ids: ['a'],
          pattern_type: 'happy_path',
          tags: [],
        },
        {
          name: 'Wrong token',
          description: 'd',
          endpoint_ids: ['b'],
          pattern_type: 'negative',
          tags: [],
        },
      ]),
    };
    const { data } = await read(await rig('flows', files));
    expect(data.path?.journeys).toEqual([
      { name: 'Checkout', pattern: 'happy_path' },
      { name: 'Wrong token', pattern: 'negative' },
    ]);
  });

  it('carries the step labels saved with the proposals, and marks a journey whose flow exists', async () => {
    const probe = await rig('flows');
    const listed = await probe.call('process_get_status', { detail: 'flows' });
    const section = (listed.outcome as { data: { section: { items: { name: string }[] } } }).data
      .section;
    const existing = section.items[0]?.name ?? '';
    expect(existing).not.toBe('');
    const files = {
      'loadcraft/.cache/state.json': savedState([
        {
          name: existing,
          description: 'd',
          endpoint_ids: ['a'],
          pattern_type: 'semantic',
          tags: [],
          step_labels: ['Log in', 'Add to cart'],
        },
        { name: 'New one', description: 'd', endpoint_ids: [], pattern_type: 'crud', tags: [] },
      ]),
    };
    const { data } = await read(await rig('flows', files));
    expect(data.path?.journeys).toEqual([
      { name: existing, pattern: 'semantic', steps: ['Log in', 'Add to cart'], built: true },
      { name: 'New one', pattern: 'crud' },
    ]);
  });

  it('keeps at most 200 journeys (the panel filters them) and skips entries that are not journeys', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({
      name: `J${String(i)}`,
      description: 'd',
      endpoint_ids: [],
      pattern_type: 'happy_path',
      tags: [],
    }));
    const files = { 'loadcraft/.cache/state.json': savedState([...many, { nope: 1 }, 7]) };
    const { data } = await read(await rig('flows', files));
    expect(data.path?.journeys).toHaveLength(200);
  });

  it('does not add a line to the text of the status', async () => {
    const files = {
      'loadcraft/.cache/state.json': savedState([
        { name: 'Checkout', description: 'd', endpoint_ids: [], pattern_type: 'x', tags: [] },
      ]),
    };
    const plain = await read(await rig('flows'));
    const withJourneys = await read(await rig('flows', files));
    expect(withJourneys.text).toBe(plain.text);
  });
});
