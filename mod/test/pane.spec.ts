// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
//
// The side panel as data: the three tabs on the data of the golden corpus, in both languages, the
// keys of the buttons, the links, what the panel keeps and the question behind "Stop test".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { PluginState } from 'claude-code';

import { paneEn, panePl } from '../../mcp/src/render/i18n/pane.js';
import { processGetStatus } from '../../mcp/src/tools/processGetStatus.js';
import { registerAnalysisReadRoute } from '../../mcp/test/fake-backend/routes/analysis.js';
import { registerDataRoutes } from '../../mcp/test/fake-backend/routes/data.js';
import { registerExecutionRoutes } from '../../mcp/test/fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../../mcp/test/fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../../mcp/test/fake-backend/routes/lookup.js';
import { registerStatusRoutes } from '../../mcp/test/fake-backend/routes/status.js';
import { seedSklep } from '../../mcp/test/fake-backend/worlds/sklep.js';
import { CANARY, toolRig } from '../../mcp/test/helpers/rig.js';
import { parseDataBlock } from '../src/state/signal.js';
import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { cancelQuestion } from '../src/pane/cancel.js';
import {
  EMPTY_PANEL,
  PANE_COMMAND,
  TABS,
  projectFacts,
  reportFacts,
  runLink,
  safeHref,
  withPreview,
  withProject,
  withReport,
  withSnapshot,
  type PanelData,
} from '../src/pane/tabs.js';
import { reduce } from '../src/state/reduce.js';
import { INITIAL_STATE, type ModState } from '../src/state/types.js';
import { paneElements, paneTree, type PaneNode } from '../src/view/pane.js';
import { parseSnapshot, type OperationSnapshot } from '../src/view/status.js';
import { textOf } from '../src/view/tree.js';

// The declaration the manifest points at and `PanelData` must describe the same value, both ways.
type Declared = PluginState['loadcraft']['panel'];
const declaredFromPanel: Declared = EMPTY_PANEL;
const panelFromDeclared: PanelData = declaredFromPanel;

const GOLDEN = join(import.meta.dirname, '..', '..', 'mcp', 'test', 'golden');
const json = (path: string): unknown =>
  JSON.parse(readFileSync(join(GOLDEN, `${path}.view.json`), 'utf8')) as unknown;

const NOW = 1_700_000_000_000;
const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;
const LIVE = `https://app.loadcraft.io/projects/${SKLEP_IDS.project}/gatling/executions/${SKLEP_IDS.executionPerf}/live`;
const RESULT = `https://app.loadcraft.io/projects/${SKLEP_IDS.project}/gatling/executions/${SKLEP_IDS.executionPerf}?tab=Overview`;

/** The reading of the golden test in progress (`mod/status-operation-test_run`): 6:40 of 10:00. */
const SNAPSHOT: OperationSnapshot = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};

/** The data block of `process_get_status`, as far as the project tab reads it. */
const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  project: { id: SKLEP_IDS.project, name: 'sklep' },
  setup: { complete: true, missing: [] },
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: true, caps: {} },
    {
      name: 'qa',
      isDefault: false,
      protected: true,
      active: false,
      caps: { maxVu: 100, maxRps: 20 },
    },
  ],
  counts: { flows: 3, scenarios: 2, compositions: 1 },
  recentRuns: [
    {
      handle: 'e-3f9a12c4',
      id: SKLEP_IDS.executionPerf,
      target: 'checkout',
      status: 'completed',
      verdict: 'sla_failed',
      when: '2026-11-22T10:00:00Z',
    },
  ],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

const running = (): ModState =>
  reduce(
    reduce(INITIAL_STATE, { kind: 'status', data: STATUS }, NOW),
    { kind: 'operation', data: SNAPSHOT },
    NOW,
  );
const idle = (): ModState =>
  reduce(INITIAL_STATE, { kind: 'status', data: { ...STATUS, operations: [] } }, NOW);

const full = (): PanelData =>
  withReport(
    withPreview(
      withProject(withSnapshot(withSnapshot(EMPTY_PANEL, SNAPSHOT), SNAPSHOT), STATUS),
      HANDLE,
      LIVE,
    ),
    json('run1/11-results_get_report'),
    RESULT,
  );

const ctx = (locale: 'en' | 'pl' = 'en', surface = 'terminal') => ({
  locale,
  surface,
  width: 60,
  autoOpen: true,
  samples: [] as readonly number[],
});

function walk(node: PaneNode): PaneNode[] {
  return node.type === 'Box' ? [node, ...node.children.flatMap(walk)] : [node];
}
const depth = (node: PaneNode): number =>
  node.type === 'Box' ? 1 + Math.max(0, ...node.children.map(depth)) : 1;
const buttons = (node: PaneNode) =>
  walk(node).flatMap((item) => (item.type === 'Button' ? [item] : []));
const links = (node: PaneNode) =>
  walk(node).flatMap((item) => (item.type === 'Link' ? [item] : []));
const textOfPane = (node: PaneNode): string =>
  node.type === 'Link'
    ? node.label
    : node.type === 'Button'
      ? node.label
      : node.type === 'Text'
        ? textOf(node)
        : node.type === 'Input'
          ? `${node.label} ${node.value}`
          : node.children.map(textOfPane).join(node.props.flexDirection === 'row' ? '  ' : '\n');

describe('the Run tab', () => {
  it('shows the numbers of the test in progress, the chart, the stop button and the preview (en)', () => {
    const text = textOfPane(paneTree(running(), full(), 'run', ctx('en')));
    expect(text).toContain('test 6:40 / 10:00');
    expect(text).toContain('690 requests/s');
    expect(text).toContain('p95≈ 910 ms');
    expect(text).toContain('errors 0.6%');
    expect(text).toContain('Stop test');
    expect(text).toContain('Live preview ↗');
  });

  it('a test with no chart yet says when the chart is available (en, pl)', () => {
    expect(textOfPane(paneTree(running(), full(), 'run', ctx('en')))).toContain(
      'The chart is available while a run_start call holds the test.',
    );
    expect(textOfPane(paneTree(running(), full(), 'run', ctx('pl')))).toContain(
      'Wykres jest dostępny, gdy test trzyma wywołanie run_start.',
    );
    const drawn = paneTree(running(), full(), 'run', { ...ctx(), samples: [1, 2, 3] });
    expect(textOfPane(drawn)).not.toContain('The chart is available');
  });

  it('says the same in Polish', () => {
    const tree = paneTree(running(), full(), 'run', ctx('pl'));
    const text = textOfPane(tree);
    expect(text).toContain('test 6:40 / 10:00');
    expect(text).toContain('690 żądań/s');
    expect(text).toContain('Przerwij test');
    expect(text).toContain('Podgląd na żywo ↗');
    expect(links(tree)[0]?.href).toBe(LIVE);
  });

  it('draws the series of the live line (series.ts) as a chart, as it is given', () => {
    const tree = paneTree(running(), full(), 'run', { ...ctx(), samples: [100, 200, 400, 800] });
    expect(textOfPane(tree)).toContain('▂▃▅█');
    expect(textOfPane(paneTree(running(), full(), 'run', ctx()))).not.toMatch(/[▁-█]/u);
  });

  it('without a test in progress says so, and has no stop button', () => {
    for (const locale of ['en', 'pl'] as const) {
      const tree = paneTree(idle(), full(), 'run', ctx(locale));
      expect(textOfPane(tree)).toContain(
        locale === 'en' ? 'No test in progress' : 'Brak testu w toku',
      );
      expect(buttons(tree).map((b) => b.key)).not.toContain('cancel');
      expect(links(tree)).toEqual([]);
    }
  });

  it('with a test but no reading yet waits, and has no stop button (no numbers to ask with)', () => {
    const tree = paneTree(running(), EMPTY_PANEL, 'run', ctx());
    expect(textOfPane(tree)).toContain('Waiting for the first reading');
    expect(buttons(tree).map((b) => b.key)).not.toContain('cancel');
  });

  it('a reading of another operation is not the numbers of this one', () => {
    const other = withSnapshot(EMPTY_PANEL, { ...SNAPSHOT, operation: 'test_run:other-1' });
    const tree = paneTree(running(), other, 'run', ctx());
    expect(textOfPane(tree)).not.toContain('690');
    expect(buttons(tree).map((b) => b.key)).not.toContain('cancel');
  });

  it('an operation that is not a test has no stop button', () => {
    const generating: OperationSnapshot = {
      operation: 'scenario_generation:s-1',
      kind: 'scenario_generation',
      elapsed_s: 42,
    };
    const state = reduce(running(), { kind: 'operation', data: generating }, NOW);
    const tree = paneTree(state, withSnapshot(EMPTY_PANEL, generating), 'run', ctx());
    expect(textOfPane(tree)).toContain('scenario generation 0:42');
    expect(buttons(tree).map((b) => b.key)).not.toContain('cancel');
  });

  it('shows what the operation waits for the user to do', () => {
    const waiting = { ...SNAPSHOT, needs_user: 'log in to the shop' };
    const text = textOfPane(paneTree(running(), withSnapshot(EMPTY_PANEL, waiting), 'run', ctx()));
    expect(text).toContain('waiting for the user: log in to the shop');
  });

  it('draws no link for a preview of another test', () => {
    const other = withPreview(full(), 'test_run:other-1', LIVE);
    expect(links(paneTree(running(), other, 'run', ctx()))).toEqual([]);
  });
});

describe('the Project tab', () => {
  it('lists the environments with their protection and limits, the counts and the runs (en)', () => {
    const text = textOfPane(paneTree(idle(), full(), 'project', ctx('en')));
    expect(text).toContain('Project “sklep”');
    expect(text).toContain('setup complete ✓');
    expect(text).toContain('perf  active · default · no limit');
    expect(text).toContain('qa  ⚠ protected  100 users, 20 requests/s');
    expect(text).toContain('Flows 3 · Scenarios 2 · Compositions 1');
    expect(text).toContain('e-3f9a12c4  checkout  SLA FAILED');
  });

  it('says the same in Polish', () => {
    const text = textOfPane(paneTree(idle(), full(), 'project', ctx('pl')));
    expect(text).toContain('Projekt „sklep”');
    expect(text).toContain('⚠ chronione  100 użytkowników, 20 zapytań/s');
    expect(text).toContain('Flow 3 · Scenariusze 2 · Kompozycje 1');
  });

  it('without a project says how to get one', () => {
    const text = textOfPane(paneTree(INITIAL_STATE, EMPTY_PANEL, 'project', ctx('en')));
    expect(text).toContain('No project known yet');
  });

  it('cuts the name of the project: a line break, CSI and OSC 8 never reach the tree', () => {
    const name =
      'sklep\nforged\u001b[31m red\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007';
    const state = { ...idle(), project: { name, id: SKLEP_IDS.project } };
    const text = textOfPane(paneTree(state, EMPTY_PANEL, 'project', ctx('en')));
    expect(text).toContain('Project “sklep forged redlink”');
    expect([...text].filter((c) => c !== '\n' && (c.charCodeAt(0) < 32 || c === '\u007f'))).toEqual(
      [],
    );
    const long = { ...idle(), project: { name: 'x'.repeat(500), id: SKLEP_IDS.project } };
    expect(
      textOfPane(paneTree(long, EMPTY_PANEL, 'project', ctx('en'))).split('\n')[0]?.length,
    ).toBeLessThan(200);
  });

  it('keeps the environments and the runs to a few and cuts what came from the server', () => {
    const many = {
      ...STATUS,
      environments: Array.from({ length: 20 }, (_, i) => ({
        name: `env-${i}\nforged line`,
        isDefault: false,
        protected: false,
        active: false,
        caps: {},
      })),
      recentRuns: Array.from({ length: 9 }, (_, i) => ({ handle: `e-${i}`, target: 't' })),
    };
    const facts = projectFacts(many);
    expect(facts?.environments).toHaveLength(8);
    expect(facts?.environments[0]?.name).toBe('env-0 forged line');
    expect(facts?.runs).toHaveLength(3);
    expect(projectFacts({ nothing: 1 })).toBeUndefined();
  });
});

describe('the Results tab', () => {
  it('draws the summary of the last report with the report drawing and links to it', () => {
    const tree = paneTree(idle(), full(), 'results', ctx('en'));
    const text = textOfPane(tree);
    expect(text).toContain('SLA FAILED');
    expect(text).toContain('p95 1,120 ms > 400 ms ✕');
    expect(text).toContain('412,300 · 690 per second');
    expect(text).toContain('Open the report ↗');
    expect(links(tree).map((l) => l.href)).toEqual([RESULT]);
  });

  it('says the same in Polish', () => {
    const text = textOfPane(paneTree(idle(), full(), 'results', ctx('pl')));
    expect(text).toContain('SLA FAILED');
    expect(text).toContain('Otwórz raport ↗');
    expect(text).toMatch(/412\s300 · 690 na sekundę/u);
  });

  it('without a report says so', () => {
    const text = textOfPane(paneTree(idle(), EMPTY_PANEL, 'results', ctx('en')));
    expect(text).toContain('No report yet');
  });

  it('keeps of a report only what the summary draws', () => {
    const facts = reportFacts(json('run1/11-results_get_report'), RESULT);
    expect(Object.keys(facts?.data ?? {}).sort()).toEqual([
      'latency',
      'requests',
      'run',
      'thresholds',
      'verdict',
    ]);
    expect(reportFacts({ requests: {} }, RESULT)).toBeUndefined();
    expect(
      reportFacts(json('run1/11-results_get_report'), 'http://app.loadcraft.io/x')?.href,
    ).toBeUndefined();
  });

  it('a link of another shape is no link', () => {
    const tree = paneTree(
      idle(),
      withReport(EMPTY_PANEL, json('run1/11-results_get_report'), 'http://app.loadcraft.io/x'),
      'results',
      ctx(),
    );
    expect(links(tree)).toEqual([]);
  });
});

describe('every tab, every surface', () => {
  const states: [string, ModState, PanelData][] = [
    ['test in progress', running(), full()],
    ['no project', INITIAL_STATE, EMPTY_PANEL],
    ['after a report', idle(), full()],
  ];

  for (const [name, state, panel] of states) {
    for (const tab of TABS) {
      for (const surface of ['terminal', 'desktop', 'vscode']) {
        it(`${name} · ${tab} · ${surface}: unique keys, bounded tree, hotkeys only off VS Code`, () => {
          for (const locale of ['en', 'pl'] as const) {
            const tree = paneTree(state, panel, tab, ctx(locale, surface));
            const keys = buttons(tree).map((b) => b.key);
            expect(new Set(keys).size).toBe(keys.length);
            expect(keys).toEqual(expect.arrayContaining(['tab-run', 'tab-project', 'tab-results']));
            for (const link of links(tree)) {
              expect(link.href.startsWith('https://')).toBe(true);
              expect(link.href.length).toBeLessThanOrEqual(2048);
            }
            const hotkeys = buttons(tree).flatMap((b) =>
              b.hotkey === undefined ? [] : [b.hotkey],
            );
            expect(hotkeys.length > 0).toBe(surface !== 'vscode');
            expect(walk(tree).length).toBeLessThan(20_000);
            expect(depth(tree)).toBeLessThanOrEqual(32);
          }
        });
      }
    }
  }

  it('the active tab is not dimmed, the others are', () => {
    const tree = paneTree(idle(), EMPTY_PANEL, 'project', ctx());
    const dimmed = Object.fromEntries(buttons(tree).map((b) => [b.key, b.dimColor === true]));
    expect(dimmed['tab-project']).toBe(false);
    expect(dimmed['tab-run']).toBe(true);
    expect(dimmed['tab-results']).toBe(true);
  });

  it('a press names its action', () => {
    const tree = paneTree(running(), full(), 'run', ctx());
    const pressed: unknown[] = [];
    const make = (type: string) => (props: Record<string, unknown>) => ({ type, props });
    const built = paneElements(
      {
        Box: make('Box'),
        Text: make('Text'),
        Button: make('Button'),
        Link: make('Link'),
        Input: make('Input'),
      },
      tree,
      (action) => pressed.push(action),
    ) as { props: { children: { props: { children: unknown } }[] } };
    expect(JSON.stringify(built)).toContain('"key":"cancel"');
    const cancel = buttons(tree).find((b) => b.key === 'cancel');
    expect(cancel?.action).toEqual({ kind: 'cancel' });
    expect(pressed).toEqual([]);
  });
});

describe('what the panel keeps', () => {
  it('a reading of an operation that is over clears the numbers', () => {
    const panel = withSnapshot(EMPTY_PANEL, SNAPSHOT);
    expect(panel.snapshot).toEqual(SNAPSHOT);
    expect(withSnapshot(panel, SNAPSHOT)).toBe(panel);
    const over = parseSnapshot({
      operation: HANDLE,
      kind: 'test_run',
      phase: 'completed',
      elapsed_s: 600,
    });
    expect(withSnapshot(panel, over)).toEqual({});
    expect(withSnapshot(panel, undefined)).toEqual({});
    expect(withSnapshot(EMPTY_PANEL, undefined)).toBe(EMPTY_PANEL);
  });

  it('keeps no series of its own: the live line has one (series.ts)', () => {
    expect(Object.keys(withSnapshot(EMPTY_PANEL, SNAPSHOT))).toEqual(['snapshot']);
  });

  it('writes nothing when the data did not change', () => {
    const panel = full();
    expect(withProject(panel, STATUS)).toBe(panel);
    expect(withReport(panel, json('run1/11-results_get_report'), RESULT)).toBe(panel);
    expect(withPreview(panel, HANDLE, LIVE)).toBe(panel);
    expect(withProject(panel, { nothing: 1 })).toBe(panel);
  });

  it('the data of the panel stay JSON the state can hold', () => {
    const panel = full();
    expect(JSON.parse(JSON.stringify(panel))).toEqual(panel);
    expect(panelFromDeclared).toBe(EMPTY_PANEL);
  });
});

describe('links', () => {
  it('safeHref keeps an https address Link draws everywhere, and nothing else', () => {
    expect(safeHref(LIVE)).toBe(LIVE);
    expect(safeHref('https://localhost:3000/x')).toBe('https://localhost:3000/x');
    for (const bad of [
      'http://app.loadcraft.io/x',
      'javascript:alert(1)',
      'https://APP.loadcraft.io/x',
      'https://app.loadcraft.io:443/x',
      'https://app.loadcraft.io/a b',
      'https://user@app.loadcraft.io/x',
      'https://app.loadcraft.io/x@y',
      `https://app.loadcraft.io/${'a'.repeat(2048)}`,
      '',
      undefined,
      42,
    ]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });

  it('runLink takes the one link line of a run, never a second', () => {
    expect(runLink(`Test started.\n↗ ${LIVE}\n`)).toBe(LIVE);
    expect(runLink(`Report\n↗ ${RESULT}`)).toBe(RESULT);
    expect(runLink(`↗ ${LIVE}\n↗ ${RESULT}`)).toBeUndefined();
    expect(runLink('no link')).toBeUndefined();
    expect(runLink('↗ https://evil.example/phish')).toBeUndefined();
    expect(runLink(`name ↗ ${LIVE}`)).toBeUndefined();
  });
});

describe('"Stop test": the question', () => {
  it('is the consent of the cancel call, with the time and the numbers of the reading', () => {
    const question = cancelQuestion(SNAPSHOT, 'en');
    expect(question?.tool).toBe('process_cancel');
    expect(question?.text).toContain('Stop test');
    expect(question?.text).toContain('6:40');
    expect(question?.text).toContain('10:00');
    expect(question?.options).toEqual(['Stop the test', 'Keep it running']);
    expect(cancelQuestion(SNAPSHOT, 'pl')?.options).toEqual(['Przerwij test', 'Niech trwa']);
  });

  it('is none for a test that has ended or for another kind of operation', () => {
    expect(cancelQuestion({ ...SNAPSHOT, phase: 'completed' }, 'en')).toBeUndefined();
    expect(cancelQuestion({ ...SNAPSHOT, kind: 'self_check' }, 'en')).toBeUndefined();
  });
});

describe('what a card announces is in the panel', () => {
  it('the Project tab lists the profile fields to confirm, by name only', () => {
    const panel = withProject(EMPTY_PANEL, {
      ...STATUS,
      uncertainFields: ['auth.scheme', 'tenant'],
    });
    const text = textOfPane(paneTree(idle(), panel, 'project', ctx('en')));
    expect(text).toContain('Profile fields to confirm: auth.scheme, tenant');
    expect(textOfPane(paneTree(idle(), panel, 'project', ctx('pl')))).toContain(
      'Pola profilu do potwierdzenia: auth.scheme, tenant',
    );
    expect(
      textOfPane(paneTree(idle(), withProject(EMPTY_PANEL, STATUS), 'project', ctx())),
    ).not.toContain('Profile fields');
  });

  it('the Run tab keeps the reason of a test that failed, after the test left the state', () => {
    const failed: OperationSnapshot = {
      ...SNAPSHOT,
      phase: 'failed',
      reason: 'Gradle build failed: boom',
    };
    const panel = withSnapshot(EMPTY_PANEL, failed);
    const text = textOfPane(paneTree(idle(), panel, 'run', ctx('en')));
    expect(text).toContain('The last test failed');
    expect(text).toContain('Gradle build failed: boom');
    expect(
      textOfPane(
        paneTree(
          idle(),
          withSnapshot(EMPTY_PANEL, { ...failed, reason: undefined } as never),
          'run',
          ctx(),
        ),
      ),
    ).toContain('No reason given');
    // A test that went well, or another kind of operation, leaves the plain "no test" line.
    expect(
      textOfPane(
        paneTree(
          idle(),
          withSnapshot(EMPTY_PANEL, { ...SNAPSHOT, phase: 'completed' }),
          'run',
          ctx(),
        ),
      ),
    ).toContain('No test in progress');
  });

  it('the notices block is on every tab, with a close button for each card', () => {
    const card = {
      key: 'end:record_run:1',
      kind: 'end',
      priority: 1,
      title: 'Failed: data check',
      lines: ['No reason given.'],
      actions: [],
    } as const;
    for (const tab of ['run', 'project', 'results', 'path'] as const) {
      const tree = paneTree(idle(), EMPTY_PANEL, tab, { ...ctx(), cards: [card] });
      expect(textOfPane(tree)).toContain('Failed: data check');
      const close = walk(tree).find(
        (node) => node.type === 'Button' && node.key === 'notice-close-0',
      );
      expect(close).toMatchObject({ action: { kind: 'card.close', key: 'end:record_run:1' } });
    }
  });
});

describe('the texts', () => {
  it('both languages have the same keys, and a plural has the forms the language needs', () => {
    expect(Object.keys(panePl).sort()).toEqual(Object.keys(paneEn).sort());
    expect(PANE_COMMAND).toBe('loadcraft-panel');
  });
});

// The data the real tool sends, not a hand-made copy of it: the test fails when the tool's data
// and the project tab drift apart.
describe('the data the server sends', () => {
  it('process_get_status with format data fills the Project tab', async () => {
    const r = await toolRig({
      tools: [processGetStatus],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerDataRoutes(fake);
        registerExecutionRoutes(fake);
        registerStatusRoutes(fake);
        registerAnalysisReadRoute(fake);
        seedSklep(fake.store, { stage: 'data' });
      },
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const status = await r.call('process_get_status', { format: 'data' });
    const data = parseDataBlock({ content: [{ type: 'text', text: status.text }] });
    const facts = projectFacts(data);
    expect(facts?.environments.length).toBeGreaterThan(0);
    expect(facts?.counts.flows).toBeGreaterThan(0);
    expect(facts?.counts.compositions).toBeGreaterThan(0);
    expect(facts?.setupComplete).toBe(true);
    const state = reduce(INITIAL_STATE, { kind: 'status', data }, NOW);
    const text = textOfPane(paneTree(state, withProject(EMPTY_PANEL, data), 'project', ctx()));
    expect(text).toContain('Project “sklep”');
    expect(text).not.toContain(CANARY);
  });
});

// Every atom has one place that writes it: a second one is a second source of the same data.
describe('the writes of the atoms', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'register.ts'), 'utf8');
  const writes = (atom: string): number =>
    (source.match(new RegExp(`\\bupdate\\(\\$, ${atom}\\b`, 'gu')) ?? []).length;

  it('panel, progress and session are each written in one place', () => {
    expect(writes('panel')).toBe(1);
    expect(writes('progress')).toBe(1);
    expect(writes('session')).toBe(1);
  });
});
