// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
//
// The lists of the panel as data: the flows of the project and the steps of a flow (Project tab), the
// test runs (Results tab). Each has a view for loading, for an error and for no entries of its own,
// marks bound to a key, and actions that name a fixed topic, never a text.
import { describe, expect, it } from 'vitest';

import {
  FLOW_LIST,
  RUN_LIST,
  STEP_LIST,
  flowsLoaded,
  outlineLoaded,
  runsLoaded,
  withFailed,
  withFlows,
  withMarksAdded,
  withOutline,
  withRuns,
} from '../src/pane/lists.js';
import { EMPTY_PANEL, projectFacts, type PanelData } from '../src/pane/tabs.js';
import { INITIAL_STATE } from '../src/state/types.js';
import { paneTree, type PaneNode } from '../src/view/pane.js';
import { textOf } from '../src/view/tree.js';

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  environments: [],
  counts: { flows: 3, scenarios: 0, compositions: 0 },
  recentRuns: [
    {
      handle: 'e-3f9a12c4',
      target: 'checkout',
      verdict: 'sla_failed',
      when: '2026-11-22T10:00:00Z',
    },
    { handle: 'e-11111111', target: 'browse', verdict: 'sla_passed', when: '2026-11-21T09:30:00Z' },
    { handle: 'e-22222222', target: 'search', when: '2026-11-20T09:30:00Z' },
  ],
  oldDocs: { flows: ['Checkout'], more: 0 },
};
const facts = projectFacts(STATUS);
const FLOWS = flowsLoaded(
  {
    section: {
      kind: 'flows',
      items: [
        { name: 'Checkout', steps: 6 },
        { name: 'Browse', steps: 1 },
        { name: 'Say "hi"', steps: 2 },
      ],
      more: 4,
    },
  },
  facts,
);
const RUNS = runsLoaded(STATUS, facts);
const STEP = {
  num: '1',
  kind: 'request',
  blockType: 'request',
  depth: 0,
  name: 'List orders',
  method: 'GET',
  path: '/orders?page=#{page}',
  uses: ['page'],
  produces: ['orderId'],
  feederVars: ['user'],
  expectedStatuses: [200, 204],
  validators: ['json'],
};
const OUTLINE = outlineLoaded(
  {
    outline: {
      name: 'Checkout',
      stepCount: 2,
      steps: [
        STEP,
        { ...STEP, num: '2', name: 'Pay', method: 'POST', path: '/pay', uses: [], produces: [] },
      ],
      truncated: false,
    },
  },
  'Checkout',
);

const base = (): PanelData => ({
  ...EMPTY_PANEL,
  ...(facts === undefined ? {} : { project: facts }),
});
const flows = (): PanelData => withFlows(base(), FLOWS);
const runs = (): PanelData => withRuns(base(), RUNS);

const ctx = (locale: 'en' | 'pl' = 'en', surface = 'terminal', width = 80) => ({
  locale,
  surface,
  width,
  autoOpen: true,
  samples: [] as readonly number[],
});

function walk(node: PaneNode): PaneNode[] {
  return node.type === 'Box' ? [node, ...node.children.flatMap(walk)] : [node];
}
const buttons = (node: PaneNode) =>
  walk(node).flatMap((item) => (item.type === 'Button' ? [item] : []));
const text = (node: PaneNode): string =>
  walk(node)
    .flatMap((item) =>
      item.type === 'Text' ? [textOf(item)] : item.type === 'Button' ? [item.label] : [],
    )
    .join('\n');
const project = (panel: PanelData, locale: 'en' | 'pl' = 'en', surface = 'terminal') =>
  paneTree(INITIAL_STATE, panel, 'project', ctx(locale, surface));
const results = (panel: PanelData, locale: 'en' | 'pl' = 'en') =>
  paneTree(INITIAL_STATE, panel, 'results', ctx(locale));
const button = (tree: PaneNode, key: string) => buttons(tree).find((item) => item.key === key);

describe('the flows list', () => {
  it('says it is loading while nothing was read, says it failed with a retry, says there are none', () => {
    expect(text(project(base()))).toContain('Loading the flows…');
    const failed = project(withFailed(base(), 'flows'));
    expect(text(failed)).toContain('The flows could not be read.');
    expect(button(failed, 'flows-retry')?.action).toEqual({ kind: 'list.reload', list: FLOW_LIST });
    const none = withFlows(base(), { stamp: 's', items: [], more: 0 });
    expect(text(project(none))).toContain('The project has no flows yet.');
    expect(buttons(project(none)).map((item) => item.key)).not.toContain('flows-retry');
  });

  it('draws a row per flow: the name, the number of steps and the old docs', () => {
    const tree = project(flows());
    const shown = text(tree);
    expect(shown).toContain('Checkout');
    expect(shown).toContain('6 steps');
    expect(shown).toContain('1 step');
    expect(shown).toContain('on older docs');
    expect(shown.match(/on older docs/gu)).toHaveLength(1);
    expect(button(tree, `${FLOW_LIST}-open-0`)?.action).toEqual({
      kind: 'list.open',
      list: FLOW_LIST,
      key: 'Checkout',
    });
    expect(shown).toContain('+4 flows are not listed here');
  });

  it('a mark is a button of its own; a name the conversation cannot carry has none', () => {
    const tree = project(flows());
    expect(button(tree, `${FLOW_LIST}-0`)?.action).toEqual({
      kind: 'list.mark',
      list: FLOW_LIST,
      keys: ['Checkout'],
    });
    expect(button(tree, `${FLOW_LIST}-2`)).toBeUndefined();
    expect(button(tree, `${FLOW_LIST}-open-2`)).toBeDefined();
  });

  it('with no flow marked there are no actions, only the hint; marked, there are two', () => {
    const idle = project(flows());
    expect(buttons(idle).map((item) => item.key)).not.toContain('flows-scenario');
    expect(text(idle)).toContain(
      'Mark flows to build a scenario or to preview the docs migration.',
    );
    const marked = project(withMarksAdded(flows(), FLOW_LIST, ['Checkout', 'Browse']));
    expect(button(marked, 'flows-scenario')?.action).toEqual({ kind: 'send', topic: 'scenario' });
    expect(button(marked, 'flows-migrate')?.action).toEqual({ kind: 'send', topic: 'migrate' });
    expect(button(marked, 'flows-scenario')?.label).toContain('(2)');
    expect(text(marked)).toContain('marked: 2 of 20');
    expect(button(marked, 'flows-scenario')?.hotkey).toBe('g');
    expect(button(marked, 'flows-migrate')?.hotkey).toBe('m');
  });

  it('a flow that cannot be marked says how to name it; a migration needs a marked flow on older docs', () => {
    expect(text(project(flows()))).toContain('cannot be marked here — name it in the chat');
    const onlyNew = project(withMarksAdded(flows(), FLOW_LIST, ['Browse']));
    expect(button(onlyNew, 'flows-scenario')).toBeDefined();
    expect(button(onlyNew, 'flows-migrate')).toBeUndefined();
    expect(text(onlyNew)).toContain('needs a marked flow on older docs');
    const both = project(withMarksAdded(flows(), FLOW_LIST, ['Browse', 'Checkout']));
    expect(button(both, 'flows-migrate')?.label).toContain('(1)');
  });

  it('a project known to the session whose status is not in the panel says so, not "Loading"', () => {
    const state = { ...INITIAL_STATE, project: { name: 'shop', id: 'p-1' } };
    const shown = text(paneTree(state, EMPTY_PANEL, 'project', ctx()));
    expect(shown).toContain('The project status has not been read yet');
    expect(shown).not.toContain('Loading the flows');
    expect(text(paneTree(state, EMPTY_PANEL, 'results', ctx()))).toContain('has not been read yet');
  });

  it('VS Code draws no hotkeys', () => {
    const tree = project(withMarksAdded(flows(), FLOW_LIST, ['Checkout']), 'en', 'vscode');
    expect(button(tree, 'flows-scenario')).toBeDefined();
    expect(buttons(tree).flatMap((item) => (item.hotkey === undefined ? [] : [item.key]))).toEqual(
      [],
    );
  });

  it('a name from the data is cut to one line', () => {
    const odd = withFlows(base(), {
      stamp: 's',
      items: [{ name: 'Line one\nforged\u001b[31m line', steps: 1, oldDocs: false }],
      more: 0,
    });
    const shown = text(project(odd));
    expect(shown).toContain('Line one forged line');
    expect(shown).not.toContain('\u001b');
  });

  it('says the same in Polish', () => {
    const tree = project(withMarksAdded(flows(), FLOW_LIST, ['Checkout']), 'pl');
    const shown = text(tree);
    expect(shown).toContain('6 kroków');
    expect(shown).toContain('na starszej dokumentacji');
    expect(shown).toContain('+4 flowy nie ma na liście');
    expect(button(tree, 'flows-scenario')?.label).toContain('(1)');
    expect(text(project(base(), 'pl'))).toContain('Wczytuję flowy…');
  });

  it('the list is drawn for a project only', () => {
    expect(text(paneTree(INITIAL_STATE, EMPTY_PANEL, 'project', ctx()))).not.toContain(
      'Loading the flows',
    );
  });
});

describe('the steps of a flow', () => {
  const open = (extra: PanelData['lists'] = {}): PanelData => ({
    ...withOutline(flows(), OUTLINE),
    lists: { [FLOW_LIST]: { query: '', open: 'Checkout', expanded: [] }, ...extra },
  });

  it('the preview of the flow lists its steps: number, method, path and name', () => {
    const tree = project(open());
    const shown = text(tree);
    expect(shown).toContain('1 GET /orders?page=#{page}');
    expect(shown).toContain('List orders');
    expect(shown).toContain('2 POST /pay');
    expect(button(tree, `${STEP_LIST}-open-1`)?.action).toEqual({
      kind: 'list.open',
      list: STEP_LIST,
      key: '2',
    });
    // The steps have no marks.
    expect(buttons(tree).map((item) => item.key)).not.toContain(`${STEP_LIST}-0`);
  });

  it('Enter on a step shows the request: the variables it uses and makes, the statuses', () => {
    const tree = project(open({ [STEP_LIST]: { query: '', open: '1', expanded: [] } }));
    const shown = text(tree);
    expect(shown).toContain('GET /orders?page=#{page}');
    expect(shown).toContain('Uses: page');
    expect(shown).toContain('Creates: orderId');
    expect(shown).toContain('Test data: user');
    expect(shown).toContain('Expected status: 200, 204');
    expect(shown).toContain('Validators: json');
    expect(button(tree, `${STEP_LIST}-back`)?.action).toEqual({
      kind: 'list.back',
      list: STEP_LIST,
    });
    expect(shown).not.toContain('2 POST /pay');
  });

  it('while the steps are read, when they could not be, and for a flow with none', () => {
    const waiting = project({
      ...flows(),
      lists: { [FLOW_LIST]: { query: '', open: 'Checkout', expanded: [] } },
    });
    expect(text(waiting)).toContain('Loading the steps…');
    const failed = project(
      withFailed(
        { ...flows(), lists: { [FLOW_LIST]: { query: '', open: 'Checkout', expanded: [] } } },
        'outline',
        'Checkout',
      ),
    );
    expect(text(failed)).toContain('The steps could not be read.');
    expect(button(failed, 'steps-retry')?.action).toEqual({ kind: 'list.reload', list: STEP_LIST });
    const empty = withOutline(open(), { flow: 'Checkout', steps: [], total: 0, truncated: false });
    expect(text(project(empty))).toContain('The flow has no steps.');
  });

  it('a long flow says how many steps are not listed', () => {
    const cut = withOutline(open(), {
      flow: 'Checkout',
      steps: OUTLINE?.steps ?? [],
      total: 400,
      truncated: true,
    });
    expect(text(project(cut))).toContain('+398 steps are not listed here');
  });

  it('says the same in Polish', () => {
    const tree = project(open({ [STEP_LIST]: { query: '', open: '1', expanded: [] } }), 'pl');
    const shown = text(tree);
    expect(shown).toContain('Używa: page');
    expect(shown).toContain('Tworzy: orderId');
    expect(shown).toContain('Oczekiwany status: 200, 204');
  });
});

describe('the reason of a failed read', () => {
  it.each([
    ['busy', 'reason: the panel reads were busy', 'powód: odczyty panelu zajęte'],
    ['exception', 'reason: exception', 'powód: wyjątek'],
    ['missing', 'reason: no recentRuns in the data', 'powód: brak recentRuns w danych'],
    ['bad_answer', 'reason: the answer held no data', 'powód: odpowiedź bez danych'],
    ['code:backend_unavailable', 'reason: [backend_unavailable]', 'powód: [backend_unavailable]'],
  ])('%s', (why, en, pl) => {
    const failed = withFailed(base(), 'runs', undefined, why);
    expect(text(results(failed))).toContain(`The runs could not be read (${en}).`);
    expect(text(results(failed, 'pl'))).toContain(`Nie udało się wczytać przebiegów (${pl}).`);
  });

  it('names the field each list reads, for the flows and the steps too', () => {
    expect(text(project(withFailed(base(), 'flows', undefined, 'missing')))).toContain(
      'The flows could not be read (reason: no section in the data).',
    );
  });

  it('a code that is not a plain code is not drawn', () => {
    const failed = withFailed(base(), 'runs', undefined, 'code:<b>x</b> CANARY');
    expect(text(results(failed))).not.toContain('CANARY');
    expect(text(results(failed))).toContain('reason: [error]');
  });

  it('without a reason the sentence stays as it was', () => {
    expect(text(results(withFailed(base(), 'runs')))).toContain('The runs could not be read.');
  });
});

describe('the runs list', () => {
  it('says it is loading, that it failed with a retry, that there are none', () => {
    expect(text(results(base()))).toContain('Loading the runs…');
    const failed = results(withFailed(base(), 'runs'));
    expect(text(failed)).toContain('The runs could not be read.');
    expect(button(failed, 'runs-retry')?.action).toEqual({ kind: 'list.reload', list: RUN_LIST });
    expect(text(results(withRuns(base(), { stamp: 's', items: [], more: 0 })))).toContain(
      'No test run yet.',
    );
  });

  it('a row: the scenario, the result and the date; the report below stays', () => {
    const tree = results(runs());
    const shown = text(tree);
    expect(shown).toContain('checkout');
    expect(shown).toContain('SLA FAILED');
    expect(shown).toContain('2026-11-22 10:00 UTC');
    expect(shown).toContain('e-3f9a12c4');
    expect(shown).toContain('No report yet');
    expect(button(tree, `${RUN_LIST}-open-0`)?.action).toEqual({
      kind: 'list.open',
      list: RUN_LIST,
      key: 'e-3f9a12c4',
    });
  });

  it('exactly two marked make "compare"; one, or none, make a hint', () => {
    expect(text(results(runs()))).toContain('Mark two runs to compare them.');
    const one = results(withMarksAdded(runs(), RUN_LIST, ['e-3f9a12c4']));
    expect(buttons(one).map((item) => item.key)).not.toContain('runs-compare');
    expect(text(one)).toContain('Mark two runs to compare them.');
    const two = results(withMarksAdded(runs(), RUN_LIST, ['e-3f9a12c4', 'e-11111111']));
    expect(button(two, 'runs-compare')?.action).toEqual({ kind: 'send', topic: 'compare' });
    expect(text(two)).toContain('marked: 2 of 2');
  });

  it('a third mark does not fit', () => {
    const three = withMarksAdded(runs(), RUN_LIST, ['e-3f9a12c4', 'e-11111111', 'e-22222222']);
    expect(text(results(three))).toContain('marked: 2 of 2');
  });

  it('the preview of a run names its handle, scenario, result and date', () => {
    const open: PanelData = {
      ...runs(),
      lists: { [RUN_LIST]: { query: '', open: 'e-11111111', expanded: [] } },
    };
    const shown = text(results(open));
    expect(shown).toContain('browse');
    expect(shown).toContain('e-11111111');
    expect(shown).toContain('2026-11-21 09:30 UTC');
  });

  it('says the same in Polish', () => {
    const two = results(withMarksAdded(runs(), RUN_LIST, ['e-3f9a12c4', 'e-11111111']), 'pl');
    expect(button(two, 'runs-compare')?.label).toBe('Porównaj zaznaczone przebiegi');
    expect(text(results(base(), 'pl'))).toContain('Wczytuję przebiegi…');
  });
});

describe('a narrow terminal and both themes', () => {
  it('draws the same tree for 30 columns (the terminal wraps) and only theme colors', () => {
    const marked = withMarksAdded(flows(), FLOW_LIST, ['Checkout']);
    const narrow = paneTree(INITIAL_STATE, marked, 'project', ctx('en', 'terminal', 30));
    expect(text(narrow)).toContain('Checkout');
    const colors = new Set(
      walk(narrow).flatMap((item) => (item.type === 'Text' ? [item.props.color ?? 'none'] : [])),
    );
    for (const color of colors) {
      expect(['none', 'success', 'error', 'warning', 'suggestion', 'inactive', 'claude']).toContain(
        color,
      );
    }
  });
});
