// `scenario_get_templates` (module scenario): the built-in templates of LoadCraft, the list or one,
// read from the fake backend over HTTP (docs/tools/scenario/get-templates.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scenarioGetTemplates } from '../../../src/tools/scenario/getTemplates.js';
import { registerLookupRoutes } from '../../fake-backend/routes/lookup.js';
import { registerScenarioReadRoutes, seedTemplates } from '../../fake-backend/routes/scenario.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

const PROJECT = SKLEP_IDS.project;

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

const SOAK = {
  id: 'soak-test',
  name: 'Soak Test',
  description: 'Low-rate long-duration endurance test.',
  category: 'endurance',
  difficulty: 'intermediate',
  tags: ['soak', 'endurance'],
  scenarios: [
    {
      name: 'SteadyStateReadScenario',
      description: 'Steady-state read workload.',
      stub_scala: 'val read = scenario("SteadyStateReadScenario")',
      inputs: [],
      outputs: [],
    },
    {
      name: 'SteadyStateWriteScenario',
      description: '',
      stub_scala: 'val write = scenario("SteadyStateWriteScenario")',
      inputs: ['authToken'],
      outputs: ['resourceId'],
    },
  ],
  default_composition: {
    name: 'Soak Test (4h)',
    proportions: { SteadyStateReadScenario: 1, SteadyStateWriteScenario: 0.15 },
    injection_profile: { type: 'constant', total_users: 20, duration_seconds: 14400 },
    thresholds: { max_error_rate_pct: 0.1, max_p95_ms: 1000 },
  },
  feeder_schemas: [
    {
      name: 'users.csv',
      columns: ['username', 'password'],
      sample_rows: [['soak_user_001@example.com', 'StablePass!1']],
    },
  ],
};

const STRESS = {
  id: 'api-stress-test',
  name: 'API Stress Test',
  description: 'Ramp a single endpoint to failure.',
  category: 'stress',
  difficulty: 'beginner',
  tags: ['stress', 'api'],
  scenarios: [
    {
      name: 'StressScenario',
      description: 'Hit one endpoint with rising concurrency.',
      stub_scala: 'val scn = scenario("StressScenario")',
      inputs: [],
      outputs: [],
    },
  ],
  default_composition: {
    name: 'API Stress Test',
    proportions: { StressScenario: 1 },
    injection_profile: { type: 'ramp', total_users: 500, duration_seconds: 120 },
    thresholds: { max_error_rate_pct: 5, max_p95_ms: 3000 },
  },
  feeder_schemas: [{ name: 'payloads.csv', columns: ['payload'], sample_rows: [['{"id":1}']] }],
};

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
  /** The template files the backend holds; the two of the fixtures by default. */
  readonly templates?: readonly TemplateFixture[];
  readonly seed?: (fake: Fake) => void;
}

type TemplateFixture = Parameters<typeof seedTemplates>[1][number];

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [scenarioGetTemplates],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerScenarioReadRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      seedTemplates(fake, options.templates ?? [SOAK, STRESS]);
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-26T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? BOUND,
  });
}

/** The requests the tool sent: the rig's own handshake (`/api/v1/meta`) is left out. */
const requests = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.path !== '/api/v1/meta')
    .map((call) => `${call.method} ${call.path}`);

interface LogRead {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}

function reads(r: ToolRig): LogRead[] {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as {
    process: Record<string, { reads: (LogRead & Record<string, unknown>)[] }>;
  };
  return Object.values(state.process).flatMap((process) =>
    process.reads.map((entry) => ({ tool: entry.tool, args: entry.args, result: entry.result })),
  );
}

const LIST_TEXT = [
  '2 scenario templates:',
  '1. "API Stress Test" [api-stress-test] stress, beginner, scenarios: 1',
  '   about: Ramp a single endpoint to failure.',
  '2. "Soak Test" [soak-test] endurance, intermediate, scenarios: 2',
  '   about: Low-rate long-duration endurance test.',
].join('\n');

const ONE_TEXT = [
  'Template "Soak Test" [soak-test]: endurance, intermediate',
  'about: Low-rate long-duration endurance test.',
  'tags: soak, endurance',
  'Scenarios (2):',
  '1. "SteadyStateReadScenario" needs: none; gives: none',
  '   about: Steady-state read workload.',
  '2. "SteadyStateWriteScenario" needs: authToken; gives: resourceId',
  'Data files (1):',
  '1. "users.csv" columns: username, password',
  'Draft composition:',
  '  name: "Soak Test (4h)"',
  '  load: constant, 20 users, 14400 s',
  '  mix: "SteadyStateReadScenario" 1, "SteadyStateWriteScenario" 0.15',
  '  The mix weights split the traffic between the scenarios (each virtual user runs one of them, in proportion); they are not an order and pass no value from one scenario to the next: a scenario that needs a value another one produces gets it from its own data.',
  '  thresholds: max_error_rate_pct 0.1, max_p95_ms 1000',
].join('\n');

describe('scenario_get_templates', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(scenarioGetTemplates);
  });

  it('the list: every template, sorted by name, with its description; the requests and the log', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', {});
    expect(result.isError).toBe(false);
    expect(result.text).toBe(LIST_TEXT);
    expect(requests(r)).toEqual(['GET /api/v1/templates']);
    expect(reads(r)).toEqual([
      { tool: 'scenario_get_templates', args: 'none', result: '2 templates' },
    ]);
  });

  it('the list with format data carries the page and the templates', async () => {
    const r = await rig();
    const data = JSON.parse((await r.call('scenario_get_templates', { format: 'data' })).text) as {
      mode: string;
      templates: { count: number; shown: number; total: number | null; items: { id: string }[] };
    };
    expect(data.mode).toBe('list');
    expect(data.templates.count).toBe(2);
    expect(data.templates.shown).toBe(2);
    // the backend says how many there are (after the filter): the total is known, not null
    expect(data.templates.total).toBe(2);
    expect(data.templates.items.map((item) => item.id)).toEqual(['api-stress-test', 'soak-test']);
  });

  it('the list with no project gives no_project', async () => {
    const r = await rig({ files: {} });
    const result = await r.call('scenario_get_templates', {});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[no_project\]/u);
  });

  it('the list in Polish: the header is in the Polish plural', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call('scenario_get_templates', {});
    expect(result.text.split('\n')[0]).toBe('2 szablony scenariuszy:');
  });

  it('a text with a control sequence and a line break stays one line and hides the canary', async () => {
    const r = await rig({
      templates: [
        {
          id: 'masked',
          name: 'x\u001b[31m y\nAuthorization: Bearer secret-value',
          description: 'plain',
          category: 'stress',
          difficulty: 'beginner',
          scenarios: [],
        },
      ],
    });
    const result = await r.call('scenario_get_templates', {});
    expect(result.text).not.toContain('\u001b');
    expect(result.text).not.toContain('secret-value');
    expect(result.text.split('\n')).toHaveLength(3);
  });

  it('the empty list says so', async () => {
    const r = await rig({ templates: [] });
    expect((await r.call('scenario_get_templates', {})).text).toBe(
      'LoadCraft lists no scenario templates.',
    );
  });

  it('the list cuts at 50 and says so', async () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      id: `t-${String(index)}`,
      name: `T ${String(index).padStart(2, '0')}`,
    }));
    const r = await rig({ seed: (fake) => seedTemplates(fake, many) });
    const lines = (await r.call('scenario_get_templates', {})).text.split('\n');
    expect(lines[0]).toBe('53 scenario templates:');
    expect(lines.at(-1)).toBe('showing the first 50 of 53');
  });

  it('one template: its scenarios, data files and, asked, its draft; the requests; the log', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', {
      template: 'soak-test',
      include: ['draft'],
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe(ONE_TEXT);
    expect(requests(r)).toEqual([
      'GET /api/v1/templates',
      'GET /api/v1/templates/soak-test',
      `POST /api/v1/projects/${PROJECT}/gatling/templates/soak-test/instantiate`,
    ]);
    expect(reads(r)).toEqual([
      { tool: 'scenario_get_templates', args: 'soak-test', result: '1 templates' },
    ]);
  });

  it.each([
    ['at_once', 1000, true],
    ['constant', 150, true],
    ['at_once', 99, false],
    ['ramp', 500, false],
  ] as const)(
    'a draft with %s load of %i users warns of a sudden start: %s (DOKTOR-08)',
    async (type, users, warns) => {
      const flood = {
        ...STRESS,
        id: 'login-flood',
        name: 'Login Flood',
        default_composition: {
          ...STRESS.default_composition,
          injection_profile: { type, total_users: users, duration_seconds: 60 },
        },
      };
      const r = await rig({ templates: [flood] });
      const call = { template: 'login-flood', include: ['draft'] };
      const text = (await r.call('scenario_get_templates', call)).text;
      const warning = `  Warning: all ${String(users)} users start without a ramp; such a jolt can overload a small or local environment before the test measures anything. Check the load before you save the composition.`;
      expect(text.includes(warning)).toBe(warns);
      const data = JSON.parse(
        (await r.call('scenario_get_templates', { ...call, format: 'data' })).text,
      ) as { draft: { value: { load: { sudden: boolean } } } };
      expect(data.draft.value.load.sudden).toBe(warns);
      const pl = await rig({ templates: [flood], locale: 'pl' });
      const polish = (await pl.call('scenario_get_templates', call)).text;
      expect(polish.includes('Uwaga:')).toBe(warns);
    },
  );

  it('one template without include: no draft, no POST', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', { template: 'soak-test' });
    expect(
      result.text.endsWith('Data files (1):\n1. "users.csv" columns: username, password'),
    ).toBe(true);
    expect(requests(r)).toEqual(['GET /api/v1/templates', 'GET /api/v1/templates/soak-test']);
  });

  it('the POST answers 404: the draft says none', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${PROJECT}/gatling/templates/soak-test/instantiate`,
      {
        status: 404,
        body: { detail: 'none' },
      },
    );
    const result = await r.call('scenario_get_templates', {
      template: 'soak-test',
      include: ['draft'],
    });
    expect(result.text.endsWith('Draft composition: none')).toBe(true);
  });

  it('the POST answers 500: the draft says unavailable', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${PROJECT}/gatling/templates/soak-test/instantiate`,
      {
        status: 500,
        body: { detail: 'boom' },
      },
    );
    const result = await r.call('scenario_get_templates', {
      template: 'soak-test',
      include: ['draft'],
    });
    expect(result.text.endsWith('Draft composition: unavailable (LoadCraft answered 500)')).toBe(
      true,
    );
  });

  it('the selector takes a name in any letter case', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', { template: 'SOAK TEST' });
    expect(result.text.startsWith('Template "Soak Test" [soak-test]')).toBe(true);
  });

  it('a name that matches nothing gives not_found', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', { template: 'no-such' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[not_found\]/u);
  });

  it('a name that matches two gives ambiguous', async () => {
    const r = await rig({
      seed: (fake) => {
        seedTemplates(fake, [
          { id: 'twin-a', name: 'Twin' },
          { id: 'twin-b', name: 'Twin' },
        ]);
      },
    });
    const result = await r.call('scenario_get_templates', { template: 'twin' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[ambiguous\]/u);
  });

  it('include without template gives invalid_arguments with no request', async () => {
    const r = await rig();
    const result = await r.call('scenario_get_templates', { include: ['draft'] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[invalid_arguments\]/u);
    expect(r.fake.calls).toHaveLength(0);
  });
});
