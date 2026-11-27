// `flows_get` (module flows): the outline of one flow by id or name, read from the fake backend over
// HTTP. The wording of the outline and of the open questions is pinned by test/tools.getFlow.test.ts
// and test/tools.flowsNeedInput.test.ts; this file holds what the contract of the tool adds
// (docs/tools/flows/get.md): the argument, the default from the state, the log, the masks.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import type { components } from '../../../src/http/generated/api.js';
import { flowsGet } from '../../../src/tools/flows/get.js';
import { defineTool } from '../../../src/registry.js';
import { FLOW_COLLECTIONS, registerFlowRoutes } from '../../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../../fake-backend/routes/lookup.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

type FlowDetail = components['schemas']['FlowDetail'];

const PROJECT = SKLEP_IDS.project;
const ZAKUPY = SKLEP_IDS.flowZakupy;

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

/**
 * Puts flows in `ids.flow_ids` of the state, as the tools that build flows do. The stub takes the name
 * of one of them: the registry applies the update of a tool of the catalog only.
 */
const remember = (ids: readonly string[]) =>
  defineTool({
    name: 'flows_generate_from_har',
    title: 'remember',
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: () =>
      Promise.resolve({
        status: 'done' as const,
        data: {},
        update: { add: { flow_ids: [...ids] } },
      }),
    render: () => 'ok',
  });

async function rig(ids: readonly string[] = [], seed?: (fake: Fake) => void): Promise<ToolRig> {
  return toolRig({
    tools: [flowsGet, remember(ids)],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      seedSklep(fake.store, { stage: 'flows' });
      seed?.(fake);
    },
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
}

const flowCalls = (r: ToolRig) =>
  r.fake.calls.filter((call) => /\/flows\/[0-9a-f-]{36}$/u.test(call.path));

interface LogRead {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}
const reads = (r: ToolRig): LogRead[] => {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as { process: Record<string, { reads: LogRead[] }> };
  return Object.values(state.process).flatMap((process) => process.reads);
};

describe('flows_get', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(flowsGet);
    expect(flowsGet.implemented).toBe(true);
  });

  it('the flow is the only flow of the workspace when none is named', async () => {
    const r = await rig([ZAKUPY]);
    await r.call('flows_generate_from_har', {});
    const result = await r.call('flows_get', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('zakupy · 7 steps');
    expect(flowCalls(r).map((call) => call.path)).toEqual([
      `/api/v1/projects/${PROJECT}/flows/${ZAKUPY}`,
    ]);
  });

  it('asks for flow_id when the workspace knows no flow or several', async () => {
    const none = await rig();
    expect((await none.call('flows_get', {})).text).toMatch(/^\[missing_argument\] /u);
    const several = await rig([ZAKUPY, SKLEP_IDS.flowZakupy.replace(/.$/u, '0')]);
    await several.call('flows_generate_from_har', {});
    expect((await several.call('flows_get', {})).text).toMatch(/^\[missing_argument\] /u);
    expect(flowCalls(none)).toEqual([]);
  });

  it('a flow is found by its id too, without a lookup of the list', async () => {
    const r = await rig();
    const result = await r.call('flows_get', { flow_id: ZAKUPY });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('zakupy · 7 steps');
  });

  it('refuses an argument the catalog does not give it, and the old project argument', async () => {
    const r = await rig();
    for (const args of [
      { flow: 'zakupy' },
      { flow_id: 'zakupy', project: 'sklep' },
      { flow_id: '' },
    ]) {
      expect((await r.call('flows_get', args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(flowCalls(r)).toEqual([]);
  });

  it('logs the call with the templates of the catalog', async () => {
    const r = await rig();
    await r.call('flows_get', { flow_id: 'zakupy' });
    expect(
      reads(r)
        .filter((entry) => entry.tool === 'flows_get')
        .map((entry) => [entry.args, entry.result]),
    ).toEqual([['zakupy', 'zakupy v1: 7 steps; needs input: 0 (0 definite)']]);
  });

  it('a step name and a path with a credential are masked, and so is a question', async () => {
    const r = await rig([], (fake) => {
      const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
      const zakupy = flows.get(ZAKUPY) as FlowDetail;
      flows.update(ZAKUPY, {
        blocks: zakupy.blocks.map((block, index) =>
          index === 0
            ? {
                ...block,
                name: `Log in Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`,
              }
            : block,
        ),
        needs_input: [
          {
            kind: 'auth',
            field: 'auth.token',
            definite: false,
            question: `Which account? password: ${BACKEND_CANARY}`,
            why: 'The login replays a value.',
          },
        ] as unknown as NonNullable<FlowDetail['needs_input']>,
      });
    });
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError, result.text).toBe(false);
    for (const leak of [SHAPE_CANARY, BACKEND_CANARY]) expect(result.text).not.toContain(leak);
    r.forgetResults();
    r.forgetLogs();
  });
});
