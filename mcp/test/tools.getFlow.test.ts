import { describe, expect, it } from 'vitest';

import type { FlowOutline } from '../src/flow/outline.js';
import type { components } from '../src/http/generated/api.js';
import { flowsGet } from '../src/tools/flows/get.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import { FLOW_COLLECTIONS, registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

type FlowDetail = components['schemas']['FlowDetail'];

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

function world(fake: Fake): void {
  registerLookupRoutes(fake);
  registerFlowRoutes(fake);
  seedSklep(fake.store, { stage: 'flows' });
}

async function rig(options: { bound?: boolean; locale?: 'en' | 'pl' } = {}): Promise<ToolRig> {
  return toolRig({
    tools: [flowsGet],
    world,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: options.bound === false ? {} : BOUND,
  });
}

interface FlowData {
  readonly project: { readonly id: string };
  readonly outline: FlowOutline;
  readonly questions: readonly { field: string; question: string }[];
}

async function read(
  r: ToolRig,
  args: Record<string, unknown>,
): Promise<{ text: string; data: FlowData; links: readonly { url: string }[] }> {
  const result = await r.call('flows_get', args);
  if (result.isError) throw new Error(`flows_get failed: ${result.text}`);
  const structured = result.outcome as {
    status: string;
    data: FlowData;
    links?: readonly { url: string }[];
  };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data, links: structured.links ?? [] };
}

describe('flows_get', () => {
  it('shows the outline of a flow by name, as the golden text, with its version and link', async () => {
    const r = await rig();
    const { text, data, links } = await read(r, { flow_id: 'zakupy' });
    const golden = goldenText('run1', '04-flows_generate_from_suggestions').split('\n');
    const rows = golden.slice(1, 9);
    expect(text.split('\n').slice(0, 8)).toEqual(rows);
    expect(text).toContain('wersja 1');
    expect(text).toContain(
      `↗ https://app.loadcraft.io/projects/${SKLEP_IDS.project}/flows/${SKLEP_IDS.flowZakupy}`,
    );
    expect(links).toHaveLength(1);
    expect(data.project).toEqual({ id: SKLEP_IDS.project });
    expect(data.outline).toMatchObject({
      flowId: SKLEP_IDS.flowZakupy,
      stepCount: 7,
      requestCount: 4,
      pauseCount: 3,
    });
  });

  it('draws the same outline in English', async () => {
    const r = await rig({ locale: 'en' });
    const { text } = await read(r, { flow_id: 'zakupy' });
    expect(text).toContain('zakupy · 7 steps (4 requests · 3 pauses)');
    expect(text).toContain('assumed · form');
    expect(text).toContain('version 1');
  });

  it('puts the questions the generator left under the outline', async () => {
    const r = await rig();
    r.fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(SKLEP_IDS.flowZakupy, {
      needs_input: [
        { field: 'auth.token', question: 'Które konto loguje?', why: 'brak danych', kind: 'auth' },
      ] as unknown as NonNullable<FlowDetail['needs_input']>,
    });
    const { text, data } = await read(r, { flow_id: 'zakupy' });
    expect(data.questions).toEqual([
      expect.objectContaining({ field: 'auth.token', question: 'Które konto loguje?' }),
    ]);
    const lines = text.split('\n');
    expect(lines[lines.indexOf('pytanie · auth.token: Które konto loguje?') - 1]).toMatch(
      /✓ 201 · 409$/,
    );
  });

  it('shows a credential warning with its steps and the next step under the outline', async () => {
    const r = await rig();
    r.fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(SKLEP_IDS.flowZakupy, {
      needs_input: [
        {
          kind: 'credential_scheme',
          field: 'Checkout',
          steps: ['Checkout'],
          definite: true,
          question: 'Which token?',
          why: 'Add a step calling POST /auth/staff-login.',
        },
        { kind: 'static_credential', field: 'x-api-key', question: 'Which value?', why: '' },
      ] as unknown as NonNullable<FlowDetail['needs_input']>,
    });
    const { text } = await read(r, { flow_id: 'zakupy' });
    const flat = text.replace(/\s+/gu, ' ');
    expect(flat).toMatch(/"Checkout" (will get 401|dostan)/u);
    expect(flat).toContain('POST /auth/staff-login');
    expect(flat).toMatch(/→ [^→]*flows_generate_from_endpoints/u);
    expect(flat).toMatch(/→ [^→]*project_save_env/u);
  });

  it('counts the steps of the outline, not the blocks of the list: a disabled block is no step', async () => {
    const r = await rig();
    const flows = r.fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
    const zakupy = flows.get(SKLEP_IDS.flowZakupy);
    if (zakupy === undefined) throw new Error('no flow zakupy');
    const blocks = zakupy.blocks.map((block) =>
      block['id'] === 'zakupy-5' ? { ...block, enabled: false } : block,
    );
    flows.update(SKLEP_IDS.flowZakupy, { ...zakupy, blocks });
    const listed = r.fake.store
      .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
      .get(SKLEP_IDS.flowZakupy);
    expect(listed?.blocks).toHaveLength(7);
    const { text, data } = await read(r, { flow_id: 'zakupy' });
    expect(data.outline.stepCount).toBe(6);
    expect(text).toContain('zakupy · 6 kroków (3 żądania · 3 pauzy)');
  });

  it('names the flows of the project when the name matches none', async () => {
    const r = await rig();
    const result = await r.call('flows_get', { flow_id: 'platnosci' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('platnosci');
    for (const name of ['zakupy', 'przeglądanie', 'konto']) expect(result.text).toContain(name);
  });

  it('asks for a project when the repository is bound to none and none is named', async () => {
    const r = await rig({ bound: false });
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('project_create');
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig();
    r.fake.faults.next('GET', `/api/v1/projects/${SKLEP_WORLD_IDS.project}/flows`, {
      status: 401,
      body: { detail: 'Invalid token' },
    });
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft nie przyjął tokenu API');
  });

  it('refuses a backend without /meta as too old, before it reads the flow', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('starszy');
    expect(r.fake.calls.some((call) => /\/flows\/[0-9a-f-]{36}$/u.test(call.path))).toBe(false);
  });

  it('is read-only and sends nothing but reads', async () => {
    const r = await rig();
    await read(r, { flow_id: 'zakupy' });
    expect(r.fake.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(flowsGet.annotations.readOnlyHint).toBe(true);
  });
});
