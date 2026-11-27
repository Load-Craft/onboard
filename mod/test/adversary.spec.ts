// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
//
// The adversary review of the mod: every drawing, line, question and refusal the mod makes from
// data it does not control (the server's data blocks, names a customer chose, the model's
// arguments) is fed hostile values, one field at a time and all at once: control characters and
// escape sequences, bidi and zero-width marks, a `javascript:` link, very long text, absurd numbers.
// Whatever comes out must stay one clean piece of text per element, within Claude Code's limits for
// a tree, and a link must stay an `https` address.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { consentPlan, decide, readFacts } from '../src/consent/decide.js';
import { EMPTY_LEDGER } from '../src/consent/ledger.js';
import { cancelQuestion } from '../src/pane/cancel.js';
import {
  EMPTY_PANEL,
  TABS,
  runLink,
  safeHref,
  withPreview,
  withProject,
  withReport,
  withSnapshot,
  type PanelData,
} from '../src/pane/tabs.js';
import { reduce } from '../src/state/reduce.js';
import { toolSignal } from '../src/state/signal.js';
import { INITIAL_STATE, type ModState } from '../src/state/types.js';
import { bandTree, statusLine as bandStatus, type Tree } from '../src/view/band.js';
import { paneTree, type PaneNode } from '../src/view/pane.js';
import { progressRow, progressTree } from '../src/view/progress.js';
import { MAX_ROWS } from '../src/view/outline.js';
import { drawResult } from '../src/view/results.js';
import {
  endedText,
  notice,
  parseSnapshot,
  statusLine,
  type OperationSnapshot,
} from '../src/view/status.js';
import { type TreeNode, type TreeSize } from '../src/view/tree.js';

const GOLDEN = join(import.meta.dirname, '..', '..', 'mcp', 'test', 'golden');
const parsed = new Map<string, unknown>();
/** A view of the golden corpus, read once (a copy is never changed: `mutants` copies what it changes). */
function json(path: string): unknown {
  if (!parsed.has(path)) {
    parsed.set(
      path,
      JSON.parse(readFileSync(join(GOLDEN, `${path}.view.json`), 'utf8')) as unknown,
    );
  }
  return parsed.get(path);
}
// The hostile cases are many drawings each; on a busy machine they need more than the default.
vi.setConfig({ testTimeout: 60_000 });

const LOCALES = ['en', 'pl'] as const;
const NOW = 1_700_000_000_000;
const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;

/** Controls (C0, C1), format characters (bidi, zero-width), lone surrogates, tag characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\u{E0000}-\u{E007F}]/u;

/** Claude Code's limits for one drawing (reference, Limits). */
const MAX_ELEMENTS = 20_000;
const MAX_CHARACTERS = 100_000;
const MAX_DEPTH = 32;
/** No single piece of text the mod draws, asks or answers with is longer than this. */
const MAX_PIECE = 2_000;

/** Hostile strings: each replaces one string of the data in turn, then all of them at once. */
const HOSTILE: readonly string[] = [
  // An OSC 8 hyperlink to javascript:, a colour, a bell, line breaks, a fake link line, bidi, zero width.
  'x\u001b]8;;javascript:alert(1)\u0007click\u001b]8;;\u0007\u001b[31m\n↗ javascript:alert(1)\r\u0085 ‮evil​⁦\u0000\u009b2J\u{E0041}',
  // Short, so that no cut removes them: bidi override, zero width, isolate, a tag character, an escape.
  'a\u202Eb\u200Bc\u2066d\u{E0041}e\u001b[2Jf',
  'javascript:alert(document.cookie)',
  // One very long word, and very long text of short words.
  'W'.repeat(20_000),
  'słowo '.repeat(4_000),
];

/** Hostile numbers: each replaces one number of the data in turn. */
const NUMBERS: readonly number[] = [-1, 0.5, 1e308, -1e308, Number.MAX_SAFE_INTEGER];

type Json = unknown;

/** Every copy of `data` with one string (or number) leaf replaced by `value`, then all of them. */
function* mutants(data: Json): Generator<Json> {
  const paths: (string | number)[][] = [];
  const visit = (node: Json, path: (string | number)[]): void => {
    if (typeof node === 'string' || typeof node === 'number') paths.push(path);
    else if (Array.isArray(node)) node.forEach((item, index) => visit(item, [...path, index]));
    else if (typeof node === 'object' && node !== null) {
      for (const [key, item] of Object.entries(node)) visit(item, [...path, key]);
    }
  };
  visit(data, []);
  const replace = (node: Json, path: readonly (string | number)[], value: Json): Json => {
    if (path.length === 0) return value;
    const [head, ...rest] = path;
    if (Array.isArray(node)) {
      return (node as readonly Json[]).map((item, index) =>
        index === head ? replace(item, rest, value) : item,
      );
    }
    const record = node as Record<string, Json>;
    return { ...record, [head as string]: replace(record[head as string], rest, value) };
  };
  const leafOf = (path: readonly (string | number)[]): Json =>
    path.reduce<Json>((node, key) => (node as Record<string | number, Json>)[key], data);
  for (const path of paths) {
    const leaf = leafOf(path);
    const values: readonly Json[] = typeof leaf === 'string' ? HOSTILE : NUMBERS;
    for (const value of values) yield replace(data, path, value);
  }
  for (const value of HOSTILE) {
    yield paths.reduce<Json>(
      (node, path) => (typeof leafOf(path) === 'string' ? replace(node, path, value) : node),
      data,
    );
  }
}

/** Every piece of text in a drawing (Text children, button and link labels) and every link. */
function pieces(node: TreeNode | PaneNode | Tree | string): { texts: string[]; hrefs: string[] } {
  if (typeof node === 'string') return { texts: [node], hrefs: [] };
  if (node.type === 'Button') return { texts: [node.label], hrefs: [] };
  if (node.type === 'Link') return { texts: [node.label], hrefs: [node.href] };
  if (node.type === 'Input')
    return { texts: [node.label, node.placeholder, node.value], hrefs: [] };
  const children = (node.children ?? []) as readonly (TreeNode | PaneNode | Tree | string)[];
  const parts = children.map(pieces);
  return {
    texts: parts.flatMap((part) => part.texts),
    hrefs: parts.flatMap((part) => part.hrefs),
  };
}

const graphemes = (text: string): number =>
  [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;

function expectCleanText(text: string, where: string): void {
  expect(
    INVISIBLE.test(text),
    `${where}: invisible or control character in ${JSON.stringify(text.slice(0, 120))}`,
  ).toBe(false);
  // A text of at most MAX_PIECE code units has at most that many clusters.
  if (text.length <= MAX_PIECE) return;
  const count = graphemes(text);
  expect(count, `${where}: a piece of ${count} characters`).toBeLessThanOrEqual(MAX_PIECE);
}

function expectClean(node: TreeNode | PaneNode | Tree | undefined, where: string): void {
  if (node === undefined) return;
  const { texts, hrefs } = pieces(node);
  for (const text of texts) expectCleanText(text, where);
  for (const href of hrefs)
    expect(safeHref(href), `${where}: link ${href.slice(0, 80)}`).toBe(href);
  const size = measure(node);
  expect(size.elements, `${where}: elements`).toBeLessThanOrEqual(MAX_ELEMENTS);
  expect(size.characters, `${where}: characters`).toBeLessThanOrEqual(MAX_CHARACTERS);
  expect(size.depth, `${where}: depth`).toBeLessThanOrEqual(MAX_DEPTH);
}

/** Elements, characters and depth of any drawing, as `sizeOf` (tree.ts) counts a result tree. */
function measure(node: TreeNode | PaneNode | Tree | string): TreeSize {
  if (typeof node === 'string') return { elements: 1, characters: node.length, depth: 0 };
  if (node.type === 'Button' || node.type === 'Link') {
    return { elements: 2, characters: node.label.length, depth: 1 };
  }
  if (node.type === 'Input') {
    const characters = node.label.length + node.placeholder.length + node.value.length;
    return { elements: 1, characters, depth: 1 };
  }
  const children = (node.children ?? []) as readonly (TreeNode | PaneNode | Tree | string)[];
  const sizes = children.map(measure);
  return {
    elements: 1 + sizes.reduce((sum, size) => sum + size.elements, 0),
    characters: sizes.reduce((sum, size) => sum + size.characters, 0),
    depth: 1 + Math.max(0, ...sizes.map((size) => size.depth)),
  };
}

// ---- data the mod draws from ---------------------------------------------------------------------

const RESULTS: readonly { readonly tool: string; readonly data: () => Json }[] = [
  {
    tool: 'flows_generate_from_suggestions',
    data: () => json('run1/04-flows_generate_from_suggestions'),
  },
  {
    tool: 'flows_generate_from_endpoints',
    data: () => json('run2/03-flows_generate_from_endpoints'),
  },
  { tool: 'scenario_suggest_split', data: () => json('run1/05-scenario_suggest_split-propozycja') },
  { tool: 'scenario_generate', data: () => json('run1/06-scenario_generate-generowanie') },
  { tool: 'results_get_report', data: () => json('run1/11-results_get_report') },
  { tool: 'results_get_report', data: () => json('run5/12-results_get_report-qa') },
  { tool: 'results_analyze_run', data: () => json('run1/12-results_analyze_run') },
];

const STATUS = {
  identity: { userId: 'u-1' },
  project: { id: SKLEP_IDS.project, name: 'sklep' },
  setup: { complete: true, missing: [] },
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: true, caps: {} },
    { name: 'qa', isDefault: false, protected: true, active: false, caps: { maxVu: 100 } },
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

const SNAPSHOT = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
  needs_user: 'sign in to the tested system',
};

const PREFLIGHT = {
  dry_run: true,
  target: { kind: 'composition', name: 'checkout' },
  environment: { name: 'qa', protected: true, limit: { max_vu: 100, max_rps: 20 } },
  profile_label: 'Ramp load (closed)',
  profile_requested: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
  profile_effective: { type: 'ramp_concurrency', vusers: 100, ramp: 600 },
  capped: true,
  consent_required: true,
  data: { needed: 1200, available: 2000, ready: true, slots: [], refusal: null },
  planned_s: 600,
  busy: null,
};

const LIVE = `https://app.loadcraft.io/projects/${SKLEP_IDS.project}/gatling/executions/${SKLEP_IDS.executionPerf}/live`;

// ---- the review ----------------------------------------------------------------------------------

describe('hostile data in a result block', () => {
  for (const { tool, data } of RESULTS) {
    it(`${tool}: every drawing stays clean and within the limits`, () => {
      let drawn = 0;
      for (const mutant of mutants(data())) {
        for (const locale of LOCALES) {
          const tree = drawResult(tool, mutant, { locale, width: 77, surface: 'terminal' });
          if (tree !== undefined) drawn += 1;
          expectClean(tree, `${tool} ${locale}`);
        }
      }
      // The review means something only when hostile data are drawn, not refused wholesale.
      expect(drawn).toBeGreaterThan(0);
    });
  }
});

describe('hostile data in the band, the status line and the live line', () => {
  it('the band and the VS Code status line stay one clean line', () => {
    let drawn = 0;
    for (const mutant of mutants(STATUS)) {
      const state = reduce(INITIAL_STATE, { kind: 'status', data: mutant }, NOW);
      for (const locale of LOCALES) {
        for (const width of [20, 80, 400]) {
          const tree = bandTree(state, locale, width);
          if (tree !== undefined) drawn += 1;
          expectClean(tree, 'band');
        }
        const line = bandStatus(state, locale);
        if (line !== undefined) expectCleanText(line, 'band status');
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('the status line, its notices and the live line stay clean', () => {
    for (const mutant of mutants(SNAPSHOT)) {
      const snapshot = parseSnapshot(mutant);
      if (snapshot === undefined) continue;
      for (const locale of LOCALES) {
        expectCleanText(statusLine(snapshot, locale), 'status line');
        expectCleanText(endedText(snapshot, locale), 'ended');
        const told = notice(undefined, snapshot, locale);
        if (told !== undefined) expectCleanText(told.text, 'notice');
        const line = progressTree(snapshot, [1, 2, 3], locale, 120);
        expectClean(line, 'progress');
        if (line !== undefined) {
          for (const hint of HOSTILE) expectClean(progressRow(line, hint), 'progress hint');
        }
      }
    }
  });
});

describe('hostile data in the side panel', () => {
  const panelOf = (
    status: Json,
    snapshot: OperationSnapshot | undefined,
    href: string,
  ): PanelData =>
    withReport(
      withPreview(withProject(withSnapshot(EMPTY_PANEL, snapshot), status), HANDLE, href),
      json('run1/11-results_get_report'),
      href,
    );

  it('every tab stays clean, and a link that is not https is not drawn', () => {
    const snapshot = parseSnapshot(SNAPSHOT);
    for (const mutant of [STATUS, ...mutants(STATUS)]) {
      const state: ModState = reduce(
        reduce(INITIAL_STATE, { kind: 'status', data: mutant }, NOW),
        { kind: 'operation', data: SNAPSHOT },
        NOW,
      );
      // Every hostile status with the real link; every hostile link with the real status.
      const hrefs =
        mutant === STATUS ? [LIVE, ...HOSTILE, `${LIVE}\u001b[31m`, `${LIVE}\u202E`] : [LIVE];
      for (const href of hrefs) {
        const panel = panelOf(mutant, snapshot, href);
        for (const tab of TABS) {
          for (const locale of LOCALES) {
            const tree = paneTree(state, panel, tab, {
              locale,
              surface: 'terminal',
              width: 60,
              samples: [1, 2, 3],
              autoOpen: true,
            });
            expectClean(tree, `pane ${tab}`);
          }
        }
      }
    }
  });

  it('the report of the Results tab stays clean with hostile data', () => {
    const state = reduce(INITIAL_STATE, { kind: 'status', data: STATUS }, NOW);
    for (const mutant of mutants(json('run1/11-results_get_report'))) {
      const panel = withReport(EMPTY_PANEL, mutant, LIVE);
      const tree = paneTree(state, panel, 'results', {
        locale: 'en',
        surface: 'desktop',
        width: 60,
        samples: [],
        autoOpen: true,
      });
      expectClean(tree, 'pane results');
    }
  });

  it('a run link in a result is taken only from one link line of a run, never a script', () => {
    for (const hostile of HOSTILE) {
      expect(runLink(`↗ ${hostile}`)).toBeUndefined();
      expect(runLink(`text\n↗ ${LIVE}\n↗ ${hostile}`)).toBeUndefined();
    }
    expect(runLink(`↗ ${LIVE}\u001b]8;;javascript:alert(1)\u0007`)).toBeUndefined();
  });
});

describe('hostile data in a consent question and in the refusal the model reads', () => {
  const CALLS: readonly { readonly tool: string; readonly call: Json; readonly data: Json }[] = [
    {
      tool: 'run_start',
      call: {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type: 'ramp_concurrency', vusers: 2000 },
      },
      data: PREFLIGHT,
    },
    {
      tool: 'data_create_accounts',
      call: {
        scenario: 'checkout',
        environment: 'qa',
        slot: 'accounts',
        count: 1200,
      },
      data: STATUS,
    },
    {
      tool: 'flows_describe_journeys',
      call: { environment: 'qa', account: { from_env: '.env.perf', email_key: 'EMAIL' } },
      data: undefined,
    },
    { tool: 'process_cancel', call: { operation: HANDLE }, data: SNAPSHOT },
  ];

  for (const { tool, call, data } of CALLS) {
    it(`${tool}: the question and the refusal stay one clean, short line`, () => {
      let asked = 0;
      const variants: { call: Json; data: Json }[] = [
        ...[...mutants(call)].map((mutant) => ({ call: mutant, data })),
        ...(data === undefined ? [] : [...mutants(data)].map((mutant) => ({ call, data: mutant }))),
      ];
      for (const variant of variants) {
        const args = variant.call as Readonly<Record<string, unknown>>;
        const plan = consentPlan(tool, args);
        if (plan === undefined) continue;
        // A cancel names the operation its snapshot is about.
        const facts = readFacts(plan, variant.data);
        if (facts === undefined) continue;
        for (const locale of LOCALES) {
          const decision = decide(facts, EMPTY_LEDGER, NOW, locale);
          if (!('ask' in decision)) continue;
          asked += 1;
          expectCleanText(decision.ask.text, `${tool} question`);
          expect(decision.ask.text.endsWith('?'), `${tool}: the question ends in ?`).toBe(true);
          expect(graphemes(decision.ask.text)).toBeLessThanOrEqual(1_000);
          for (const label of decision.ask.options) expectCleanText(label, `${tool} option`);
          expectCleanText(decision.ask.denial, `${tool} refusal`);
          expect(graphemes(decision.ask.denial)).toBeLessThanOrEqual(1_000);
          expect(decision.ask.denial.startsWith('[user_declined] ')).toBe(true);
        }
      }
      expect(asked).toBeGreaterThan(0);
    });
  }

  it('the question behind "Stop test" stays clean', () => {
    for (const mutant of mutants(SNAPSHOT)) {
      const snapshot = parseSnapshot(mutant);
      if (snapshot === undefined) continue;
      for (const locale of LOCALES) {
        const question = cancelQuestion(snapshot, locale);
        if (question === undefined) continue;
        expectCleanText(question.text, 'stop question');
        expectCleanText(question.denial, 'stop refusal');
      }
    }
  });
});

describe('hostile text in what the model read', () => {
  it('a handle that only a name in the text spells lasts until the status read answers', () => {
    // A flow, scenario or composition is named by the customer, and a result can carry such a name
    // before the server's own handle. The mod takes the first handle it reads; the status read that
    // follows every call replaces it with what the server lists (here: nothing in progress).
    const text = 'Flow "test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42" saved.';
    const signal = toolSignal('mcp__plugin_loadcraft_lc__flows_get', { text });
    expect(signal).toBeDefined();
    const fooled = reduce(INITIAL_STATE, signal as NonNullable<typeof signal>, NOW);
    expect(fooled.operation?.handle).toBe('test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42');
    const status = { ...STATUS, operations: [] };
    expect(reduce(fooled, { kind: 'status', data: status }, NOW + 1).operation).toBeUndefined();
  });
});

describe('the longest drawing stays inside the limits of a tree', () => {
  it('a flow of very many steps reads only the steps it can draw', () => {
    let reads = 0;
    const steps = Array.from({ length: 50_000 }, (_, index) => {
      const step = { num: String(index + 1), depth: 0, method: 'GET', path: '/api/orders' };
      // Counts the steps the drawing looks at.
      Object.defineProperty(step, 'kind', {
        enumerable: true,
        get: () => {
          reads += 1;
          return 'request';
        },
      });
      return step;
    });
    const flow = {
      name: 'checkout',
      stepCount: 50_000,
      requestCount: 50_000,
      pauseCount: 0,
      steps,
    };
    const tree = drawResult(
      'flows_get',
      { project: {}, outline: flow, questions: [] },
      {
        locale: 'en',
        width: 77,
        surface: 'terminal',
      },
    );
    expect(tree).toBeDefined();
    expect(reads).toBeLessThanOrEqual(MAX_ROWS);
  });

  it('a build of very many flows draws a bounded number of them and counts the rest', () => {
    const flows = Array.from({ length: 12_000 }, (_, index) => ({
      name: `flow ${index}`,
      stepCount: 1,
      requestCount: 1,
      pauseCount: 0,
      steps: [{ num: '1', kind: 'request', depth: 0, method: 'GET', path: '/api/orders' }],
    }));
    const tree = drawResult(
      'flows_generate_from_suggestions',
      { built: flows },
      { locale: 'en', width: 77, surface: 'terminal' },
    );
    expect(tree).toBeDefined();
    expectClean(tree, 'many flows');
    expect(pieces(tree as TreeNode).texts.join('\n')).toContain('11,960');
  });

  it('a flow of many steps with long paths and names draws within the characters of a tree', () => {
    const long = (prefix: string): string => `${prefix}${'x'.repeat(5_000)}`;
    const steps = Array.from({ length: 400 }, (_, index) => ({
      num: long(String(index)),
      kind: 'request',
      depth: 0,
      method: long('POST'),
      path: long('/api/orders/'),
      uses: Array.from({ length: 40 }, (_unused, n) => long(`token${n}`)),
      produces: Array.from({ length: 40 }, (_unused, n) => long(`id${n}`)),
      expectedStatuses: [long('200'), 201],
    }));
    const flow = {
      name: long('checkout'),
      stepCount: 400,
      requestCount: 400,
      pauseCount: 0,
      steps,
    };
    for (const locale of LOCALES) {
      const tree = drawResult(
        'flows_get',
        { project: {}, outline: flow, questions: [] },
        {
          locale,
          width: 200,
          surface: 'terminal',
        },
      );
      expect(tree).toBeDefined();
      expectClean(tree, 'long flow');
    }
  });
});
