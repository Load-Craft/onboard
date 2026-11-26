import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderBuildScenarioResult,
  type GeneratedData,
} from '../src/render/views/buildScenario.js';
import { scenarioGenerate } from '../src/tools/scenarioGenerate.js';
import { scenarioSuggestSplit } from '../src/tools/scenarioSuggestSplit.js';
import { processWait } from '../src/tools/processWait.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import { registerCompositionRoutes } from './fake-backend/routes/compositions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  registerScenarioBuilderRoutes,
  scriptBuilderModel,
} from './fake-backend/routes/scenarioBuilder.js';
import {
  registerScenarioRoutes,
  type GenerationScript,
  type ScenarioGenerationFake,
} from './fake-backend/routes/scenarios.js';
import {
  registerSelfCheckRoutes,
  selfCheckDocument,
  type SelfCheckFake,
} from './fake-backend/routes/selfCheck.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { createIdSource, createStore } from './fake-backend/store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepComposition,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionResult,
  type SklepStage,
} from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const tPl = createTranslator('pl');
const tEn = createTranslator('en');

const NOW = Date.parse('2026-11-22T10:06:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const IDS = SKLEP_WORLD_IDS;
const THREE = ['przeglądanie', 'zakupy', 'konto'];
const FLOW_IDS: Record<string, string> = {
  przeglądanie: IDS.flowPrzegladanie,
  zakupy: IDS.flowZakupy,
  konto: IDS.flowKonto,
};
const SPLIT = { przeglądanie: 40, zakupy: 50, konto: 10 };
const GENERATE = '/api/v1/projects/{project_id}/gatling/scenarios/generate-async';
const COMPOSITIONS = '/api/v1/projects/{project_id}/gatling/compositions';
const REALISTIC = { happy_path: 95, invalid_input: 4, boundary_values: 1 };

function goldenView(): GeneratedData {
  return JSON.parse(
    readFileSync(goldenUrl('run1/06-scenario_generate-generowanie.view.json'), 'utf8'),
  ) as GeneratedData;
}

// ---- the rig --------------------------------------------------------------------------------

interface Rig extends ToolRig {
  readonly generation: ScenarioGenerationFake;
  readonly checks: SelfCheckFake;
}

/** The self-check run of `przeglądanie` with its rows named as the mock-up names the steps. */
function nameBrowsingSteps(fake: Fake): void {
  const scratch = createStore(createIdSource(1));
  seedSklep(scratch, { stage: 'scenario' });
  const runId = SKLEP_IDS.selfCheckExecution;
  const execution = scratch.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).require(runId);
  const result = scratch.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).require(runId);
  // Step label and mean time of each request, as the mock-up's chain shows them.
  const steps: Record<string, readonly [string, number]> = {
    'GET /categories': ['kategorie', 100],
    'GET /products': ['produkt', 200],
  };
  const endpoints: SklepEndpointRow[] = result.endpoints.map((row) => {
    const [name, mean] = steps[row.name] ?? [row.name, row.mean_response_time];
    return { ...row, name, count: 1, ok_count: 1, ko_count: 0, mean_response_time: mean };
  });
  const executions = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const results = fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
  if (executions.get(runId) === undefined) executions.insert(execution);
  if (results.get(runId) === undefined) results.insert({ ...result, endpoints });
  else results.update(runId, { endpoints });
}

async function rig(
  options: { stage?: SklepStage; locale?: 'en' | 'pl'; setup?: (fake: Fake) => void } = {},
): Promise<Rig> {
  let generation: ScenarioGenerationFake | undefined;
  let checks: SelfCheckFake | undefined;
  const r = await toolRig({
    tools: [scenarioSuggestSplit, scenarioGenerate, processWait],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerScenarioBuilderRoutes(fake);
      checks = registerSelfCheckRoutes(fake);
      generation = registerScenarioRoutes(fake);
      registerCompositionRoutes(fake);
      seedSklep(fake.store, { stage: options.stage ?? 'flows' });
      nameBrowsingSteps(fake);
      options.setup?.(fake);
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: BOUND,
  });
  if (generation === undefined || checks === undefined) throw new Error('no world');
  return Object.assign(r, { generation, checks });
}

/** Lets the call wait on the test clock until it ends: a second of test time per real tick. */
async function settle<T>(
  r: ToolRig,
  call: Promise<T>,
  options: { steps?: number; stepMs?: number; at?: (elapsedMs: number) => void } = {},
): Promise<T> {
  let done = false;
  void call.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  const start = r.clock.now();
  for (let i = 0; i < (options.steps ?? 400) && !done; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await r.clock.advance(options.stepMs ?? 1000);
    options.at?.(r.clock.now() - start);
  }
  return call;
}

interface Called {
  readonly text: string;
  readonly isError: boolean;
  readonly outcome: { status: string; operation?: string; data: GeneratedData };
  readonly progress: readonly { message?: string; progress: number }[];
}

async function generate(
  r: ToolRig,
  args: Record<string, unknown> = {},
  options: Parameters<typeof settle>[2] = {},
): Promise<Called> {
  const call = r.call('scenario_generate', {
    name: 'checkout',
    flows: THREE,
    proportions: SPLIT,
    data_mix: 'realistic',
    ...args,
  });
  return (await settle(r, call, options)) as unknown as Called;
}

const posts = (r: ToolRig, path: string): FakeCall[] => {
  const pattern = new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
  return r.fake.calls.filter((call) => call.method === 'POST' && pattern.test(call.path));
};
const puts = (r: ToolRig): FakeCall[] => r.fake.calls.filter((call) => call.method === 'PUT');
const generated = (r: ToolRig) =>
  posts(r, GENERATE).map((call) => call.body as { flow_id: string; class_mix?: unknown });
const withoutLinks = (text: string): string =>
  `${text
    .split('\n')
    .filter((line) => !line.startsWith('↗ '))
    .join('\n')}\n`;
/** The golden text without its link line (the registry adds links after the view). */
const goldenWithoutLink = (): string =>
  goldenText('run1', '06-scenario_generate-generowanie')
    .split('\n')
    .filter((line) => !line.startsWith('↗ '))
    .join('\n');
const hasDataLine = (text: string): boolean =>
  text.split('\n').some((line) => line.startsWith('dane:'));
const composition = (r: ToolRig): SklepComposition | undefined =>
  r.fake.store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .list((item) => item.name === 'checkout')[0];

// ---- the view -------------------------------------------------------------------------------

describe('scenario_generate view', () => {
  it('draws the golden view data as the golden text', () => {
    expect(`${renderBuildScenarioResult(goldenView(), tPl)}\n`).toBe(goldenWithoutLink());
  });

  it('en: every line reads in English', async () => {
    await expect(renderBuildScenarioResult(goldenView(), tEn)).toMatchFileSnapshot(
      '__snapshots__/buildScenario.generate.en.txt',
    );
  });

  it('says that only the weights changed when nothing was generated', () => {
    const data: GeneratedData = { ...goldenView(), composition: 'updated', regenerated: false };
    const [first] = renderBuildScenarioResult(data, tPl).split('\n');
    expect(first).toBe('kompozycja „checkout” · nowe proporcje, bez generowania');
  });

  it('keeps a name from the backend on one line', () => {
    const data: GeneratedData = {
      ...goldenView(),
      name: 'x\n↗ https://evil.example',
      split: [{ flow: 'a‮\nb', percent: 100 }],
    };
    const lines = renderBuildScenarioResult(data, tPl).split('\n');
    expect(lines.filter((line) => line.startsWith('↗'))).toEqual([]);
    expect(lines[1]).toMatch(/^a b +100%/u);
  });

  it('draws no data line for the normal mix and names an own test type by its label', () => {
    const normal = renderBuildScenarioResult(
      { ...goldenView(), dataMix: { kind: 'normal', shares: [] } },
      tPl,
    );
    expect(hasDataLine(normal)).toBe(false);
    const custom = renderBuildScenarioResult(
      {
        ...goldenView(),
        dataMix: {
          kind: 'custom',
          shares: [
            { type: 'happy_path', role: 'typical', label: 'happy_path', percent: 90 },
            {
              type: 'missing_required_fields',
              role: null,
              label: 'Missing required fields',
              percent: 10,
            },
          ],
        },
      },
      tPl,
    );
    expect(custom).toContain('dane: 90% typowe · 10% Missing required fields');
  });
});

// ---- the tool -------------------------------------------------------------------------------

describe('scenario_generate', () => {
  it('generates three scenarios one after another, composes them 0.4/0.5/0.1 and draws the golden view', async () => {
    const r = await rig();
    // The proposal first: the flows of the draft are the ones phase 2 generates.
    scriptBuilderModel(r.fake, [
      { flow: 'przeglądanie', proportion: 60 },
      { flow: 'zakupy', proportion: 30 },
      { flow: 'konto', proportion: 10 },
    ]);
    const proposal = await r.call('scenario_suggest_split', { name: 'checkout', flows: THREE });
    expect(proposal.isError, proposal.text).toBe(false);

    const result = await generate(r, { flows: undefined });
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome.status).toBe('done');
    expect(withoutLinks(result.text)).toBe(goldenWithoutLink());
    expect(result.text.split('\n').at(-1)).toBe(
      `↗ https://app.loadcraft.io/projects/${SKLEP_IDS.project}/gatling/executions/${SKLEP_IDS.selfCheckExecution}?tab=Requests`,
    );
    expect(result.outcome.data).toEqual(goldenView());

    // One generation per flow, in the order of the flows, each started after the previous ended.
    const runs = r.generation.runs();
    expect(runs.map((run) => run.flowId)).toEqual(THREE.map((name) => FLOW_IDS[name]));
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i]?.startedAt ?? 0).toBeGreaterThanOrEqual(runs[i - 1]?.endsAt ?? Infinity);
    }
    // One composition with the shares as fractions.
    const created = posts(r, COMPOSITIONS);
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({
      name: 'checkout',
      scenarios: [
        { scenario_id: IDS.scenarios.przegladanie, proportion: 0.4 },
        { scenario_id: IDS.scenarios.zakupy, proportion: 0.5 },
        { scenario_id: IDS.scenarios.konto, proportion: 0.1 },
      ],
    });
    expect(composition(r)?.scenarios.map((link) => link.proportion)).toEqual([0.4, 0.5, 0.1]);
    // Progress names the flow being generated and the step the backend reported.
    const messages = result.progress.map((entry) => entry.message ?? '');
    expect(messages.some((message) => message.includes('zakupy'))).toBe(true);
    expect(messages.some((message) => message.includes('2/3'))).toBe(true);
    r.assertClean();
  });

  it('realistic data: the class mix uses the effective names of the project test types', async () => {
    const r = await rig();
    await generate(r);
    expect(generated(r).map((body) => body.class_mix)).toEqual([REALISTIC, REALISTIC, REALISTIC]);
    expect(r.fake.calls.some((call) => call.path.endsWith('/test-types'))).toBe(true);
  });

  it('a mix by type name is sent as given; an unknown type is refused with the list', async () => {
    const r = await rig();
    const result = await generate(r, { data_mix: { happy_path: 90, missing_required_fields: 10 } });
    expect(result.isError, result.text).toBe(false);
    expect(generated(r)[0]?.class_mix).toEqual({ happy_path: 90, missing_required_fields: 10 });
    expect(result.text).toContain('dane: 90% typowe · 10% Missing required fields');

    const wrong = await generate(r, { data_mix: { happy_path: 90, sql_injection: 10 } });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('sql_injection');
    expect(wrong.text).toContain('invalid_input');
  });

  it('realistic data without a negative or edge type names what the project has', async () => {
    const r = await rig({
      setup: (fake) => {
        const types = fake.store.collection<{ id: string; base_type_name?: string | null }>(
          SKLEP_COLLECTIONS.testTypes,
        );
        for (const type of types.list()) types.update(type.id, { base_type_name: null });
      },
    });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('invalid_input');
    expect(posts(r, GENERATE)).toEqual([]);
  });

  it('normal data sends no class mix', async () => {
    const r = await rig();
    const result = await generate(r, { data_mix: 'normal' });
    expect(result.isError, result.text).toBe(false);
    for (const body of generated(r)) expect(body.class_mix ?? null).toBeNull();
    expect(hasDataLine(result.text)).toBe(false);
  });

  it('one flow fails: no composition, the reason; the next call generates only that flow', async () => {
    const r = await rig();
    const failure: GenerationScript = {
      outcome: {
        error: 'Scenario plan refused: the flow has no request steps',
        recoverable: false,
      },
    };
    r.generation.script(IDS.flowZakupy, failure);
    const first = await generate(r);
    expect(first.isError).toBe(true);
    expect(first.text).toContain('zakupy');
    // A failure frame without a 4xx status is server-side: its text is not shown.
    expect(first.text).not.toContain('Scenario plan refused');
    // not recoverable: the same input ends the same way
    expect(first.text).toContain('[scenario_generation_refused]');
    expect(first.text).toContain('przeglądanie');
    expect(posts(r, COMPOSITIONS)).toEqual([]);
    expect(composition(r)).toBeUndefined();
    // konto was still generated after zakupy failed.
    expect(generated(r).map((body) => body.flow_id)).toEqual([
      IDS.flowPrzegladanie,
      IDS.flowZakupy,
      IDS.flowKonto,
    ]);

    const second = await generate(r);
    expect(second.isError, second.text).toBe(false);
    expect(
      generated(r)
        .slice(3)
        .map((body) => body.flow_id),
    ).toEqual([IDS.flowZakupy]);
    expect(posts(r, COMPOSITIONS)).toHaveLength(1);
    r.assertClean();
  });

  it.each([
    [404, true],
    [422, true],
    [500, false],
    [401, false],
  ])('an error frame with status_code %i: its text is shown: %s', async (status_code, shown) => {
    const r = await rig();
    r.generation.script(IDS.flowZakupy, {
      outcome: { error: 'Plan refused: no request steps', recoverable: false, status_code },
    });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text.includes('Plan refused: no request steps')).toBe(shown);
  });

  it('retries a recoverable failure once and goes on', async () => {
    const r = await rig();
    r.generation.script(IDS.flowZakupy, {
      outcome: { error: 'Gradle compilation infrastructure failed', recoverable: true },
    });
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    expect(generated(r).map((body) => body.flow_id)).toEqual([
      IDS.flowPrzegladanie,
      IDS.flowZakupy,
      IDS.flowZakupy,
      IDS.flowKonto,
    ]);
    expect(posts(r, COMPOSITIONS)).toHaveLength(1);
  });

  it('gives up on a recoverable failure that comes back after the retry', async () => {
    const r = await rig();
    const failing: GenerationScript = {
      outcome: { error: 'Gradle compilation infrastructure failed', recoverable: true },
    };
    r.generation.script(IDS.flowZakupy, failing, failing);
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(generated(r).filter((body) => body.flow_id === IDS.flowZakupy)).toHaveLength(2);
    expect(result.text).not.toContain('Gradle compilation infrastructure failed');
    // the same cause after the retry: a refusal of the input, not a passing failure
    expect(result.text).toContain('[scenario_generation_refused]');
    expect(posts(r, COMPOSITIONS)).toEqual([]);
  });

  it('a refusal (not recoverable): its own code, and a hint to change the input, not to call again', async () => {
    const r = await rig();
    r.generation.script(IDS.flowZakupy, {
      outcome: { error: 'Plan refused: no request steps', recoverable: false, status_code: 422 },
    });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[scenario_generation_refused]');
    expect(result.text).toContain('Plan refused: no request steps');
    expect(result.text).not.toContain('tymi samymi argumentami');
    expect(result.text).toContain('zmień');
    // the hint to call again after the change names the tool of the generation
    expect(result.text).toContain('scenario_generate');
    expect(generated(r).filter((body) => body.flow_id === IDS.flowZakupy)).toHaveLength(1);
  });

  it('a recoverable failure that comes back with the same cause: no hint to call again', async () => {
    const r = await rig();
    const failing: GenerationScript = {
      outcome: { error: 'Address region code refused for this locale', recoverable: true },
    };
    r.generation.script(IDS.flowZakupy, failing, failing);
    const result = await generate(r);
    expect(result.text).toContain('[scenario_generation_refused]');
    expect(result.text.replace(/\s+/gu, ' ')).toContain('także po jednym ponowieniu');
    expect(result.text).not.toContain('tymi samymi argumentami');
  });

  it('does not retry a flow whose failure has the cause an earlier flow of the call failed with', async () => {
    const r = await rig();
    const failing: GenerationScript = {
      outcome: { error: 'Address region code refused for this locale', recoverable: true },
    };
    r.generation.script(IDS.flowZakupy, failing, failing);
    r.generation.script(IDS.flowKonto, failing, failing);
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(generated(r).map((body) => body.flow_id)).toEqual([
      IDS.flowPrzegladanie,
      IDS.flowZakupy,
      IDS.flowZakupy,
      IDS.flowKonto,
    ]);
    expect(result.text).toContain('[scenario_generation_refused]');
    expect(result.text.replace(/\s+/gu, ' ')).toContain('ta sama przyczyna');
  });

  it('retries every flow whose failure went away on its retry, even with the text an earlier flow had', async () => {
    const r = await rig();
    const passing: GenerationScript = {
      outcome: { error: 'Gradle compilation infrastructure failed', recoverable: true },
    };
    // one failure each, then the default: the retry stores the scenario
    r.generation.script(IDS.flowZakupy, passing);
    r.generation.script(IDS.flowKonto, passing);
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    expect(generated(r).map((body) => body.flow_id)).toEqual([
      IDS.flowPrzegladanie,
      IDS.flowZakupy,
      IDS.flowZakupy,
      IDS.flowKonto,
      IDS.flowKonto,
    ]);
  });

  it('a refusal of the flow data, as the backend sends it, names the step and what to change', async () => {
    const r = await rig();
    const reason = "the locale of country 'xx' writes no region code like 'QQ'";
    const suggestion = 'change this value in the flow step, or remove the field from the step';
    r.generation.script(IDS.flowZakupy, {
      outcome: {
        error: `In the flow step POST /orders (body.region): ${reason}; ${suggestion}`,
        recoverable: false,
        status_code: 422,
        refusal: {
          step: 'POST /orders (body.region)',
          column: 'region',
          value: 'QQ',
          reason,
          suggestion,
        },
      },
    });
    const result = await generate(r);
    const text = result.text.replace(/\s+/gu, ' ');
    expect(text).toContain('[scenario_generation_refused]');
    expect(text).toContain('In the flow step POST /orders (body.region)');
    expect(text).toContain('remove the field from the step');
    expect(generated(r).filter((body) => body.flow_id === IDS.flowZakupy)).toHaveLength(1);
  });

  it('a recoverable failure whose cause changed after the retry still says to call again', async () => {
    const r = await rig();
    r.generation.script(
      IDS.flowZakupy,
      { outcome: { error: 'Gradle compilation infrastructure failed', recoverable: true } },
      { outcome: { error: 'Gradle daemon disappeared unexpectedly', recoverable: true } },
    );
    const result = await generate(r);
    expect(result.text).toContain('[scenario_generation_failed]');
    expect(result.text).toContain('tymi samymi argumentami');
  });

  it('the text of a refusal is shown with the secrets of the call masked', async () => {
    const r = await rig();
    r.generation.script(IDS.flowZakupy, {
      outcome: {
        error: `Refused: token ${CANARY} in the body`,
        recoverable: false,
        status_code: 422,
      },
    });
    const result = await generate(r);
    expect(result.text).toContain('Refused: token');
    expect(result.text).not.toContain(CANARY);
  });

  it('an existing composition with the same flows and mix: only a PUT with every member', async () => {
    const r = await rig({ stage: 'scenario' });
    const result = await generate(r, { proportions: { przeglądanie: 30, zakupy: 60, konto: 10 } });
    expect(result.isError, result.text).toBe(false);
    expect(posts(r, GENERATE)).toEqual([]);
    expect(posts(r, COMPOSITIONS)).toEqual([]);
    const updates = puts(r);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.path).toContain(`/gatling/compositions/${IDS.composition}`);
    expect(updates[0]?.body).toEqual({
      scenarios: [
        {
          scenario_id: IDS.scenarios.przegladanie,
          variant_label: '',
          proportion: 0.3,
          enabled: true,
        },
        { scenario_id: IDS.scenarios.zakupy, variant_label: '', proportion: 0.6, enabled: true },
        { scenario_id: IDS.scenarios.konto, variant_label: '', proportion: 0.1, enabled: true },
      ],
    });
    expect(result.outcome.data.regenerated).toBe(false);
    expect(result.outcome.data.composition).toBe('updated');
    expect(result.text.split('\n')[0]).toBe(
      'kompozycja „checkout” · nowe proporcje, bez generowania',
    );
  });

  it('keeps a member the user switched off switched off', async () => {
    const r = await rig({
      stage: 'scenario',
      setup: (fake) => {
        const compositions = fake.store.collection<SklepComposition>(
          SKLEP_COLLECTIONS.compositions,
        );
        const saved = compositions.require(IDS.composition);
        compositions.update(saved.id, {
          scenarios: saved.scenarios.map((link) =>
            link.scenario_id === IDS.scenarios.konto ? { ...link, enabled: false } : link,
          ),
        });
      },
    });
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    const members = (puts(r)[0]?.body as { scenarios: { scenario_id: string; enabled: boolean }[] })
      .scenarios;
    expect(members.map((member) => [member.scenario_id, member.enabled])).toEqual([
      [IDS.scenarios.przegladanie, true],
      [IDS.scenarios.zakupy, true],
      [IDS.scenarios.konto, false],
    ]);
    expect(
      composition(r)?.scenarios.find((link) => link.scenario_id === IDS.scenarios.konto)?.enabled,
    ).toBe(false);
  });

  it('a member generated again stays switched off when its flow was', async () => {
    const r = await rig({
      stage: 'scenario',
      setup: (fake) => {
        const compositions = fake.store.collection<SklepComposition>(
          SKLEP_COLLECTIONS.compositions,
        );
        const saved = compositions.require(IDS.composition);
        compositions.update(saved.id, {
          scenarios: saved.scenarios.map((link) =>
            link.scenario_id === IDS.scenarios.konto ? { ...link, enabled: false } : link,
          ),
        });
      },
    });
    const result = await generate(r, { data_mix: 'normal' });
    expect(result.isError, result.text).toBe(false);
    const members = (puts(r)[0]?.body as { scenarios: { enabled: boolean }[] }).scenarios;
    expect(members.map((member) => member.enabled)).toEqual([true, true, false]);
  });

  it('an existing composition with another data mix: the scenarios are generated again', async () => {
    const r = await rig({ stage: 'scenario' });
    const result = await generate(r, { data_mix: 'normal' });
    expect(result.isError, result.text).toBe(false);
    expect(posts(r, GENERATE)).toHaveLength(3);
    const members = (puts(r)[0]?.body as { scenarios: { scenario_id: string }[] }).scenarios;
    expect(members.map((member) => member.scenario_id)).not.toContain(IDS.scenarios.zakupy);
    expect(members).toHaveLength(3);
    expect(result.outcome.data.regenerated).toBe(true);
  });

  it('an existing composition with other flows is refused, nothing changes', async () => {
    const r = await rig({ stage: 'scenario' });
    const result = await generate(r, {
      flows: ['przeglądanie', 'zakupy'],
      proportions: { przeglądanie: 50, zakupy: 50 },
    });
    expect(result.isError).toBe(true);
    // Both lists of flows, and what to do next.
    expect(result.text).toContain('przeglądanie, zakupy, konto');
    expect(result.text).toContain('Prośba: przeglądanie, zakupy');
    expect(result.text).toContain('zapytaj użytkownika');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it.each([
    ['a sum of 90', { przeglądanie: 40, zakupy: 40, konto: 10 }, '90'],
    ['a zero share', { przeglądanie: 0, zakupy: 90, konto: 10 }, 'przeglądanie'],
    ['a missing flow', { przeglądanie: 50, zakupy: 50 }, 'konto'],
    ['an extra key', { przeglądanie: 40, zakupy: 50, konto: 5, koszyk: 5 }, 'koszyk'],
  ])('refuses proportions with %s and sends nothing', async (_name, proportions, named) => {
    const r = await rig();
    const result = await generate(r, { proportions });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(named);
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('accepts a sum within half a percent', async () => {
    const r = await rig();
    const result = await generate(r, {
      proportions: { przeglądanie: 33.3, zakupy: 33.3, konto: 33.3 },
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('33,3%');
  });

  it('waits for a self-check in progress and shows how it ended', async () => {
    const r = await rig();
    r.checks.set(IDS.scenarios.konto, selfCheckDocument({ status: 'running' }));
    const started = r.clock.now();
    let passedAt = 0;
    const result = await generate(
      r,
      {},
      {
        at: (elapsed) => {
          if (elapsed === 40_000) {
            passedAt = r.clock.now();
            r.checks.set(
              IDS.scenarios.konto,
              selfCheckDocument({ status: 'passed', execution_ids: [IDS.selfCheckKonto] }),
            );
          }
        },
      },
    );
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('zakupy        czeka na dane: User accounts');
    expect(result.text).toContain('konto         ✓ przeszedł');
    expect(passedAt).toBeGreaterThan(started);
    expect(r.clock.now() - started).toBeLessThan(120_000);
  });

  it('stops waiting for the self-check after 100 s and shows where it stands', async () => {
    const r = await rig();
    r.checks.set(IDS.scenarios.konto, selfCheckDocument({ status: 'running' }));
    const started = r.clock.now();
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome.status).toBe('done');
    expect(result.text).toContain('konto         sprawdzanie');
    const elapsed = r.clock.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(100_000);
    expect(elapsed).toBeLessThan(140_000);
  });

  it('takes the result from the replayed final frame when the run ended before the channel opened', async () => {
    const r = await rig();
    for (const id of Object.values(FLOW_IDS)) r.generation.script(id, { endedBeforeAnswer: true });
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    // The scenario list is read once, before the first generation: no REST recovery was needed.
    expect(
      r.fake.calls.filter(
        (call) => call.method === 'GET' && call.path.endsWith('/gatling/scenarios'),
      ),
    ).toHaveLength(1);
    for (const run of r.generation.runs()) {
      expect(r.fake.channel('scenario', { run_id: run.runId }).opened).toBeGreaterThanOrEqual(1);
    }
  });

  it('finishes correctly when the channel drops in the middle', async () => {
    const r = await rig();
    const call = r.call('scenario_generate', {
      name: 'checkout',
      flows: THREE,
      proportions: SPLIT,
      data_mix: 'realistic',
    });
    for (let i = 0; i < 4; i += 1) {
      await r.clock.advance(500);
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
    }
    r.fake.faults.dropChannel('scenario');
    const result = (await settle(r, call)) as unknown as Called;
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome.data.scenarios).toBe(3);
    expect(posts(r, GENERATE)).toHaveLength(3);
    expect(posts(r, COMPOSITIONS)).toHaveLength(1);
  });

  it('finishes through REST when the channel is blocked, and says the channel is gone', async () => {
    const r = await rig();
    r.fake.faults.blockWebSocket();
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome.data).toEqual(goldenView());
    expect(posts(r, GENERATE)).toHaveLength(3);
    expect(result.progress.some((entry) => (entry.message ?? '').includes('5 s'))).toBe(true);
  });

  it('through REST, an older scenario of the flow is not taken for the result of the run', async () => {
    const r = await rig({ stage: 'scenario' });
    r.fake.faults.blockWebSocket();
    const result = await generate(r, { data_mix: 'normal' });
    expect(result.isError, result.text).toBe(false);
    const members = (puts(r)[0]?.body as { scenarios: { scenario_id: string }[] }).scenarios;
    const fresh = r.generation.runs().map((run) => run.scenarioId);
    expect(members.map((member) => member.scenario_id)).toEqual(fresh);
    expect(fresh).not.toContain(IDS.scenarios.przegladanie);
  });

  it('a blocked channel and no scenario for 10 minutes: the cause is unknown, retry later', async () => {
    const r = await rig();
    r.generation.script(IDS.flowPrzegladanie, {
      outcome: { error: 'never seen', recoverable: false },
    });
    r.fake.faults.blockWebSocket();
    const started = r.clock.now();
    // One call waits 100 s at most; the rest of the wait goes through the handle.
    let result = await generate(
      r,
      { flows: ['przeglądanie'], proportions: { przeglądanie: 100 } },
      { stepMs: 5000 },
    );
    expect(result.outcome?.status).toBe('running');
    while (result.outcome?.status === 'running') {
      result = (await settle(
        r,
        r.call('process_wait', { operation: result.outcome.operation ?? '' }),
        {
          stepMs: 5000,
        },
      )) as unknown as Called;
    }
    // `process_wait` draws the end of the generation itself, so the failure is a result here, not an error.
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('przyczyna nieznana');
    expect(result.text).not.toContain('never seen');
    expect(r.clock.now() - started).toBeGreaterThanOrEqual(600_000);
  });

  it('called straight with proportions, warns at the start of the generation about flows on older docs', async () => {
    const r = await rig({
      locale: 'en',
      setup: (fake) => {
        fake.store.collection<{ id: string }>('projects').update(SKLEP_IDS.project, {
          openapi_spec_id: '5f0e9c2b-7a41-4d36-8b19-e2c4a7d0f358',
        });
      },
    });
    r.generation.script(IDS.flowPrzegladanie, { endAfterMs: 30_000 });
    const first = await generate(r, { max_wait_s: 5 });
    expect(first.outcome.status).toBe('running');
    expect(first.text).toMatch(
      /are on an older docs version: the scenarios will\s+read that version/u,
    );
    expect(first.text).toMatch(/→ flows_migrate_docs preview: true/u);
  });

  it('returns a handle when the wait ends before a generation does; the next call goes on', async () => {
    const r = await rig();
    r.generation.script(IDS.flowPrzegladanie, { endAfterMs: 30_000 });
    const first = await generate(r, { max_wait_s: 5 });
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome.status).toBe('running');
    expect(first.outcome.operation).toMatch(/^scenario_generation:/u);
    // The model sees only the text: the handle has to be in it.
    expect(first.text).toContain(first.outcome.operation ?? 'no handle');
    expect(composition(r)).toBeUndefined();
    await r.clock.advance(60_000);
    const second = await generate(r);
    expect(second.isError, second.text).toBe(false);
    // przeglądanie was not generated a second time.
    expect(generated(r).filter((body) => body.flow_id === IDS.flowPrzegladanie)).toHaveLength(1);
    expect(posts(r, COMPOSITIONS)).toHaveLength(1);
  });

  it('a second call while a generation runs joins it: no second POST, the same handle', async () => {
    const r = await rig();
    r.generation.script(IDS.flowPrzegladanie, { endAfterMs: 30_000 });
    const first = await generate(r, { max_wait_s: 5 });
    expect(first.outcome?.status).toBe('running');
    const again = await generate(r, { max_wait_s: 5 });
    expect(again.outcome?.status).toBe('running');
    expect(again.outcome?.operation).toBe(first.outcome?.operation);
    expect(again.text).toContain(first.outcome?.operation ?? 'no handle');
    expect(generated(r).filter((body) => body.flow_id === IDS.flowPrzegladanie)).toHaveLength(1);
  });

  it('another data mix is other work: it starts its own generation beside the running one', async () => {
    const r = await rig();
    r.generation.script(IDS.flowPrzegladanie, { endAfterMs: 30_000 });
    const first = await generate(r, { max_wait_s: 5 });
    const other = await generate(r, { max_wait_s: 5, data_mix: 'normal' });
    expect(other.outcome?.status).toBe('running');
    expect(other.outcome?.operation).not.toBe(first.outcome?.operation);
    expect(generated(r).filter((body) => body.flow_id === IDS.flowPrzegladanie)).toHaveLength(2);
    // The first operation is untouched.
    const again = await generate(r, { max_wait_s: 5 });
    expect(again.outcome?.operation).toBe(first.outcome?.operation);
  });

  it('a named backend refusal gives its message and a hint', async () => {
    const r = await rig();
    r.fake.faults.next('POST', COMPOSITIONS, {
      status: 409,
      body: { detail: 'Composition name already exists in this project: checkout' },
    });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Composition name already exists');
    expect(result.text).toContain('→');
    r.assertClean();
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig({ locale: 'en' });
    r.fake.faults.next('POST', GENERATE, { status: 401, body: { detail: 'Invalid token' } });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig({ locale: 'en' });
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await generate(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('refuses the fields of the proposal instead of dropping them, and a call without proportions', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    const extra = await r.call('scenario_generate', {
      name: 'checkout',
      flows: THREE,
      proportions: SPLIT,
      suggestion: 'x',
    });
    expect(extra.isError).toBe(true);
    const without = await r.call('scenario_generate', { name: 'checkout', flows: THREE });
    expect(without.isError).toBe(true);
    expect(without.text).toContain('proportions');
    expect(r.fake.calls.length).toBe(before);
    expect(posts(r, GENERATE)).toEqual([]);
  });

  it('says it sends real requests and is not read-only', () => {
    expect(scenarioGenerate.annotations.openWorldHint).toBe(true);
    expect(scenarioGenerate.annotations.readOnlyHint).not.toBe(true);
    expect(scenarioGenerate.description).toContain('default environment');
  });

  it('en view of the whole call', async () => {
    const r = await rig({ locale: 'en' });
    const result = await generate(r);
    expect(result.isError, result.text).toBe(false);
    await expect(withoutLinks(result.text)).toMatchFileSnapshot(
      '__snapshots__/buildScenario.generate.call.en.txt',
    );
  });
});
