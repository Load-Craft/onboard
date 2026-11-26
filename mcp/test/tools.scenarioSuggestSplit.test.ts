import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { equalShares, roundToHundred, sharesFromProposal } from '../src/tools/scenario/propose.js';
import { scenarioSuggestSplit } from '../src/tools/scenarioSuggestSplit.js';
import { renderBuildScenario, type ProposalData } from '../src/render/views/buildScenario.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  BUILDER_COLLECTIONS,
  registerScenarioBuilderRoutes,
  scriptBuilderModel,
  type BuilderMessage,
} from './fake-backend/routes/scenarioBuilder.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const GOLDEN_PL = new URL(
  './golden/run1/05-scenario_suggest_split-propozycja.pl.txt',
  import.meta.url,
);
const GOLDEN_VIEW = new URL(
  './golden/run1/05-scenario_suggest_split-propozycja.view.json',
  import.meta.url,
);
const THREE = ['przeglądanie', 'zakupy', 'konto'];
type Split = readonly { flow: string; proportion: number }[];
const MODEL_SPLIT: Split = [
  { flow: 'przeglądanie', proportion: 60 },
  { flow: 'zakupy', proportion: 30 },
  { flow: 'konto', proportion: 10 },
];

function world(fake: Fake): void {
  registerLookupRoutes(fake);
  registerFlowRoutes(fake);
  registerScenarioBuilderRoutes(fake);
  seedSklep(fake.store, { stage: 'flows' });
}

async function rig(options: { locale?: 'en' | 'pl'; split?: Split | null } = {}): Promise<ToolRig> {
  const r = await toolRig({
    tools: [scenarioSuggestSplit],
    world,
    clock: createTestClock(Date.parse('2026-11-22T11:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
  if (options.split !== null) scriptBuilderModel(r.fake, options.split ?? MODEL_SPLIT);
  return r;
}

async function propose(
  r: ToolRig,
  args: Record<string, unknown>,
): Promise<{ text: string; data: ProposalData }> {
  const result = await r.call('scenario_suggest_split', {
    name: 'checkout',
    flows: THREE,
    ...args,
  });
  if (result.isError) throw new Error(`scenario_suggest_split failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: ProposalData };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

const builderCalls = (r: ToolRig) =>
  r.fake.calls.filter((call) => call.path.includes('/scenario-builder/'));

describe('scenario_suggest_split', () => {
  it('turns the model proposal 60/30/10 into the golden view', async () => {
    const r = await rig({ locale: 'pl' });
    const { text, data } = await propose(r, {});
    expect(data).toEqual(JSON.parse(readFileSync(GOLDEN_VIEW, 'utf8')));
    expect(text).toBe(readFileSync(GOLDEN_PL, 'utf8').trimEnd());
    r.assertClean();
  });

  it('warns before anything is generated when a flow is on an older docs version', async () => {
    const r = await rig();
    r.fake.store.collection<{ id: string }>('projects').update(SKLEP_IDS.project, {
      openapi_spec_id: '5f0e9c2b-7a41-4d36-8b19-e2c4a7d0f358',
    });
    const flows = r.fake.store.collection<{ id: string }>('flows');
    for (const flow of flows.list()) {
      if (flow.id !== SKLEP_IDS.flowZakupy) {
        flows.update(flow.id, { openapi_spec_id: '5f0e9c2b-7a41-4d36-8b19-e2c4a7d0f358' });
      }
    }
    const { text, data } = await propose(r, {});
    expect(data.oldDocs).toEqual(['zakupy']);
    expect(text).toMatch(/zakupy[^\n]*older docs version/u);
    expect(text).toMatch(/→ [^\n]*flows_migrate_docs[^\n]*preview: true/u);
  });

  it('warns about a chosen flow the generator left open questions on, and still proposes', async () => {
    const r = await rig();
    r.fake.store
      .collection<{ id: string; needs_input?: unknown }>('flows')
      .update(SKLEP_IDS.flowZakupy, {
        needs_input: [
          {
            kind: 'credential_scheme',
            field: 'Checkout',
            steps: ['Checkout'],
            definite: true,
            question: 'Which token?',
            why: 'Another security scheme.',
          },
        ],
      });
    const { text, data } = await propose(r, {});
    expect(data.needsInput).toEqual({ flows: ['zakupy'], definite: 1 });
    expect(text.replace(/\s+/gu, ' ')).toMatch(
      /zakupy[^\n]*open generator questions \(1 definite: its steps get 401\)/u,
    );
    expect(data.proposal.length).toBeGreaterThan(0);
  });

  it('gives no warning while the flows are on the current docs version', async () => {
    const r = await rig();
    const { text, data } = await propose(r, {});
    expect(data.oldDocs).toBeUndefined();
    expect(text).not.toContain('flows_migrate_docs');
  });

  it('draws the golden view data with the view alone', () => {
    const data = JSON.parse(readFileSync(GOLDEN_VIEW, 'utf8')) as ProposalData;
    const text = renderBuildScenario(data, createTranslator('pl'));
    expect(text).toBe(readFileSync(GOLDEN_PL, 'utf8').trimEnd());
  });

  it('asks the model once, for exactly the named flows, and generates nothing', async () => {
    const r = await rig();
    await propose(r, {});
    const calls = builderCalls(r);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(
      r.fake.calls.every(
        (call) => call.method === 'GET' || call.path.includes('/scenario-builder/'),
      ),
    ).toBe(true);
    const [message] = r.fake.store.collection<BuilderMessage>(BUILDER_COLLECTIONS.messages).list();
    expect(message?.selected_flow_ids).toHaveLength(3);
    expect(message?.message).toMatch(/split .*users/i);
  });

  it('falls back to an equal split, marked as such, when the model proposes nothing', async () => {
    const r = await rig({ split: null });
    const { text, data } = await propose(r, {});
    expect(data.source).toBe('equal_fallback');
    expect(data.proposal.map((row) => row.percent)).toEqual([34, 33, 33]);
    expect(text).toContain('divided equally');
  });

  it('falls back to an equal split when the language model is not configured', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/scenario-builder/{draft_id}/messages',
      {
        status: 503,
        body: {
          error: 'llm_not_configured',
          message: 'No language model is configured',
          detail: 'No language model is configured',
          retryable: false,
        },
      },
    );
    const { data } = await propose(r, { flows: ['zakupy', 'konto'] });
    expect(data.source).toBe('equal_fallback');
    expect(data.proposal).toEqual([
      { flow: 'zakupy', percent: 50 },
      { flow: 'konto', percent: 50 },
    ]);
  });

  it('falls back when the proposal leaves a named flow out', async () => {
    const r = await rig({
      split: [{ flow: 'zakupy', proportion: 100 }],
    });
    const { data } = await propose(r, { flows: ['zakupy', 'konto'] });
    expect(data.source).toBe('equal_fallback');
  });

  it('rounds 33.3 / 33.3 / 33.3 to 34 / 33 / 33', async () => {
    const r = await rig({
      split: THREE.map((flow) => ({ flow, proportion: 33.3 })),
    });
    const { data } = await propose(r, {});
    expect(data.source).toBe('model');
    expect(data.proposal.map((row) => row.percent)).toEqual([34, 33, 33]);
  });

  it('adds up the variants the model proposes for one flow', async () => {
    const r = await rig({
      split: [
        { flow: 'zakupy', proportion: 25 },
        { flow: 'zakupy', proportion: 25 },
        { flow: 'konto', proportion: 50 },
      ],
    });
    const { data } = await propose(r, { flows: ['zakupy', 'konto'] });
    expect(data.proposal).toEqual([
      { flow: 'zakupy', percent: 50 },
      { flow: 'konto', percent: 50 },
    ]);
  });

  it('answers a single flow with 100% and does not call the model', async () => {
    const r = await rig();
    const { text, data } = await propose(r, { flows: ['zakupy'] });
    expect(data).toEqual({
      name: 'checkout',
      proposal: [{ flow: 'zakupy', percent: 100 }],
      source: 'single_flow',
    });
    expect(text).toContain('100%');
    expect(builderCalls(r)).toEqual([]);
  });

  it('counts a flow named twice once', async () => {
    const r = await rig();
    const { data } = await propose(r, { flows: ['zakupy', 'ZAKUPY'] });
    expect(data.source).toBe('single_flow');
  });

  it('refuses an unknown flow and lists the flows the project has', async () => {
    const r = await rig();
    const result = await r.call('scenario_suggest_split', {
      name: 'checkout',
      flows: ['zakupy', 'platnosc'],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('platnosc');
    expect(result.text).toContain('konto');
    expect(result.text).toContain('przeglądanie');
    expect(builderCalls(r)).toEqual([]);
  });

  it('remembers the draft in the workspace state for the generating phase', async () => {
    const r = await rig();
    await propose(r, {});
    const state = JSON.parse(
      readFileSync(`${r.workspace}/loadcraft/.cache/state.json`, 'utf8'),
    ) as { drafts: Record<string, { value: Record<string, unknown> }> };
    const draft = state.drafts['checkout']?.value as {
      draftId: string;
      flows: { id: string; name: string }[];
      proposed: Record<string, number>;
    };
    expect(draft.flows.map((flow) => flow.name)).toEqual(THREE);
    expect(draft.proposed).toEqual({ przeglądanie: 60, zakupy: 30, konto: 10 });
    expect(builderCalls(r)[0]?.path).toContain(`/scenario-builder/${draft.draftId}/messages`);
  });

  it('asks for flows when there are none: the schema refuses, nothing is sent', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    for (const args of [{ name: 'checkout' }, { name: 'checkout', flows: [] }]) {
      const result = await r.call('scenario_suggest_split', args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('flows');
    }
    expect(r.fake.calls.length).toBe(before);
  });

  it('refuses the fields of the generation instead of dropping them', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    for (const extra of [{ proportions: { zakupy: 100 } }, { data_mix: 'normal' }]) {
      const result = await r.call('scenario_suggest_split', {
        name: 'checkout',
        flows: THREE,
        ...extra,
      });
      expect(result.isError).toBe(true);
    }
    expect(r.fake.calls.length).toBe(before);
    expect(builderCalls(r)).toEqual([]);
  });

  it('rejects an empty name and more than 20 flows', async () => {
    const r = await rig();
    expect((await r.call('scenario_suggest_split', { name: '', flows: THREE })).isError).toBe(true);
    const many = Array.from({ length: 21 }, (_, i) => `flow-${String(i)}`);
    expect(
      (await r.call('scenario_suggest_split', { name: 'checkout', flows: many })).isError,
    ).toBe(true);
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/scenario-builder/{draft_id}/messages',
      {
        status: 401,
        body: { detail: 'Invalid token' },
      },
    );
    const result = await r.call('scenario_suggest_split', { name: 'checkout', flows: THREE });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
    r.assertClean();
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('scenario_suggest_split', { name: 'checkout', flows: THREE });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('generates nothing and never leaks the canary', async () => {
    const r = await rig();
    await propose(r, {});
    const writes = r.fake.calls.filter(
      (call) => call.method !== 'GET' && !call.path.includes('/scenario-builder/'),
    );
    expect(writes).toEqual([]);
    r.assertClean();
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('proposal (%s)', async (locale) => {
      const r = await rig({ locale });
      const { text } = await propose(r, {});
      await expect(text).toMatchFileSnapshot(`__snapshots__/buildScenario.proposal.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)('equal split (%s)', async (locale) => {
      const r = await rig({ locale, split: null });
      const { text } = await propose(r, {});
      await expect(text).toMatchFileSnapshot(`__snapshots__/buildScenario.equal.${locale}.txt`);
    });
  });
});

describe('proposal arithmetic', () => {
  it.each([
    [
      [33.3, 33.3, 33.3],
      [34, 33, 33],
    ],
    [
      [60, 30, 10],
      [60, 30, 10],
    ],
    [
      [50, 50],
      [50, 50],
    ],
    [
      [1, 1, 1, 97],
      [1, 1, 1, 97],
    ],
    [
      [0.4, 0.4, 99.2],
      [1, 0, 99],
    ],
    [
      [2, 2, 2],
      [34, 33, 33],
    ],
    [
      [99.5, 0.5],
      [100, 0],
    ],
  ] as const)('rounds %j to whole percents that add up to 100: %j', (raw, expected) => {
    const rounded = roundToHundred(raw);
    expect(rounded).toEqual(expected);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('splits evenly with the remainder going to the first flows', () => {
    expect(equalShares(3)).toEqual([34, 33, 33]);
    expect(equalShares(7).reduce((a, b) => a + b, 0)).toBe(100);
    expect(equalShares(1)).toEqual([100]);
  });

  it('reads shares from a proposal only when it covers every flow with a positive share', () => {
    const ids = ['a', 'b'];
    expect(
      sharesFromProposal(ids, [
        { flowId: 'a', proportion: 30 },
        { flowId: 'b', proportion: 70 },
      ]),
    ).toEqual([30, 70]);
    expect(sharesFromProposal(ids, [{ flowId: 'a', proportion: 100 }])).toBeNull();
    expect(sharesFromProposal(ids, [])).toBeNull();
    expect(
      sharesFromProposal(ids, [
        { flowId: 'a', proportion: 0 },
        { flowId: 'b', proportion: 0 },
      ]),
    ).toBeNull();
    expect(
      sharesFromProposal(ids, [
        { flowId: 'a', proportion: 50 },
        { flowId: 'x', proportion: 50 },
      ]),
    ).toBeNull();
  });
});
