/**
 * The three lists of the panel that the status channel feeds (pane/lists.ts), drawn on the common list
 * component (view/list.ts): the flows of the project with the steps of a flow in the preview (Project
 * tab), the test runs (Results tab). Pure: a function of the stored panel, returning panel nodes.
 *
 * Each list has a view for loading, for a read that failed (with "Try again") and for no entries of
 * its own. A press names a topic or a list action, never a text: what the actions say to the agent
 * is fixed in pane/choice.ts. Colors are theme keys only.
 */

import {
  FLOW_LIST,
  markedOldDocs,
  MAX_MARKED_FLOWS,
  MAX_MARKED_RUNS,
  READ_FIELD,
  RUN_LIST,
  STEP_LIST,
  comparePair,
  isMarkableFlow,
  markedKeys,
} from '../pane/lists.js';
import {
  listView,
  type FlowFact,
  type OutlineFacts,
  type PanelData,
  type RunRow,
  type StepFact,
} from '../pane/tabs.js';
import type { Translator } from '../../../mcp/src/context.js';
import {
  listParts,
  visibleEntries,
  type ListAction,
  type ListButton,
  type ListEntry,
  type ListInput,
  type ListNode,
  type ListSpec,
  type ListTexts,
} from './list.js';
import { text, type TextProps, type TreeText } from './tree.js';

/** What a press of the lists asks for besides the list actions. */
export type ListsAction =
  /** Send the fixed message of a topic with the marked entries to the agent. */
  { readonly kind: 'send'; readonly topic: 'scenario' | 'migrate' | 'compare' };

export interface ListsButton {
  readonly type: 'Button';
  readonly key: string;
  readonly label: string;
  readonly action: ListAction | ListsAction;
  readonly hotkey?: string;
  readonly plain?: true;
  readonly dimColor?: true;
}

export interface ListsBox {
  readonly type: 'Box';
  readonly props: { readonly flexDirection: 'row' | 'column'; readonly columnGap?: number };
  readonly children: readonly ListsNode[];
}

/** A node of the lists; every one is also a node of the panel. */
export type ListsNode = TreeText | ListsButton | ListsBox | ListInput;

const dim: TextProps = { dimColor: true };
const blank: TreeText = text(' ');
const row = (children: readonly ListsNode[], columnGap = 2): ListsBox => ({
  type: 'Box',
  props: { flexDirection: 'row', columnGap },
  children,
});

const PLAIN_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

/**
 * The sentence of a failed read with its reason in one word or a code (`Loaded.why`): never any text
 * of the answer. Without a reason, the sentence alone.
 */
function failedText(
  t: Translator,
  key: string,
  what: keyof typeof READ_FIELD,
  why: string | undefined,
): TreeText {
  const sentence = t(key);
  if (why === undefined) return text(sentence, { color: 'error' });
  const code = why.startsWith('code:') ? why.slice(5) : undefined;
  const reason =
    code !== undefined
      ? `[${PLAIN_CODE.test(code) ? code : 'error'}]`
      : why === 'missing'
        ? t('pane.read.missing', { field: READ_FIELD[what] })
        : t(
            `pane.read.${why === 'busy' || why === 'exception' || why === 'bad_answer' ? why : 'exception'}`,
          );
  const full = t('pane.read.failed', { sentence: sentence.replace(/\.$/u, ''), reason });
  return text(full, { color: 'error' });
}

function retry(key: string, list: string, t: Translator): ListButton {
  return {
    type: 'Button',
    key,
    label: t('pane.list.retry'),
    action: { kind: 'list.reload', list },
    dimColor: true,
  };
}

/** The date of a run as `2026-11-22 10:00`, with `UTC` when the time says so. */
function whenOf(when: string): string {
  const day = when.slice(0, 10);
  const time = when.slice(11, 16);
  return `${day} ${time}${when.endsWith('Z') ? ' UTC' : ''}`;
}

/** The texts of a list of the panel; `counted`: the counter says how many are marked. */
export function listTexts(
  t: Translator,
  placeholder: string,
  empty: string,
  counted: boolean,
): ListTexts {
  return {
    filter: t('list.filter'),
    placeholder,
    counter: (marked, visible, limit) =>
      !counted
        ? t('pane.list.shown', { visible })
        : limit === undefined
          ? t('list.counter', { marked, visible })
          : t('list.counterLimit', { marked, limit, visible }),
    empty,
    noMatch: t('list.noMatch'),
    more: (count) => t('list.more', { count }),
    back: t('list.back'),
    mark: t('list.mark'),
    unmark: t('list.unmark'),
    markCurrent: t('list.markCurrent'),
    unmarkable: t('pane.flows.unmarkable'),
  };
}

// ---- the steps of a flow --------------------------------------------------------------------------

function stepEntries(steps: readonly StepFact[], t: Translator): ListEntry[] {
  return steps.map((step) => {
    const request = step.kind === 'request' && step.method !== undefined && step.path !== undefined;
    const label = request
      ? `${step.num} ${step.method ?? ''} ${step.path ?? ''}`
      : `${step.num} ${step.name}`;
    const kind =
      step.kind === 'pause'
        ? [t('pane.steps.pause')]
        : step.kind === 'other'
          ? [t('pane.steps.other')]
          : step.name === ''
            ? []
            : [step.name];
    return {
      key: step.num,
      label,
      notes: kind,
      search: [step.name, step.method ?? '', step.path ?? '', ...step.uses, ...step.produces].join(
        ' ',
      ),
    };
  });
}

function stepPreview(steps: readonly StepFact[], t: Translator) {
  return (entry: ListEntry): ListNode[] => {
    const step = steps.find((item) => item.num === entry.key);
    if (step === undefined) return [];
    const lines: ListNode[] = [];
    if (step.description !== undefined) lines.push(text(step.description));
    if (step.uses.length > 0)
      lines.push(text(t('pane.steps.uses', { names: step.uses.join(', ') })));
    if (step.produces.length > 0) {
      lines.push(text(t('pane.steps.creates', { names: step.produces.join(', ') })));
    }
    if (step.feeder.length > 0) {
      lines.push(text(t('pane.steps.feeder', { names: step.feeder.join(', ') })));
    }
    if (step.statuses.length > 0) {
      lines.push(text(t('pane.steps.statuses', { codes: step.statuses.join(', ') })));
    }
    if (step.validators.length > 0) {
      lines.push(text(t('pane.steps.validators', { names: step.validators.join(', ') })));
    }
    return lines;
  };
}

/** The steps of the flow `flow`, drawn in the preview of the flows list. */
function stepsNodes(panel: PanelData, flow: string, t: Translator, hotkeys: boolean): ListNode[] {
  const outline: OutlineFacts | undefined =
    panel.outline?.flow === flow ? panel.outline : undefined;
  if (outline === undefined) return [text(t('pane.steps.loading'), dim)];
  if (outline.failed === true) {
    return [
      failedText(t, 'pane.steps.failed', 'outline', outline.why),
      retry('steps-retry', STEP_LIST, t),
    ];
  }
  if (outline.steps.length === 0) return [text(t('pane.steps.none'), dim)];
  const spec: ListSpec = {
    id: STEP_LIST,
    entries: stepEntries(outline.steps, t),
    groups: [],
    view: listView(panel, STEP_LIST),
    hotkeys,
    preview: stepPreview(outline.steps, t),
    texts: listTexts(t, t('pane.steps.filterPlaceholder'), t('pane.steps.none'), false),
  };
  const parts = listParts(spec);
  if (parts.open !== undefined) return [...parts.head];
  const unlisted = outline.total - outline.steps.length;
  return [
    text(t('pane.steps.title'), dim),
    ...parts.head,
    ...parts.rows,
    ...(unlisted > 0 ? [text(t.plural('pane.steps.more', unlisted), dim)] : []),
  ];
}

// ---- the flows of the project ---------------------------------------------------------------------

function flowEntries(items: readonly FlowFact[], t: Translator): ListEntry[] {
  return items.map((flow) => ({
    key: flow.name,
    label: flow.name,
    notes: [
      t.plural('pane.flows.steps', flow.steps),
      ...(flow.oldDocs ? [t('pane.flows.oldDocs')] : []),
    ],
    search: flow.oldDocs ? t('pane.flows.oldDocs') : '',
    ...(isMarkableFlow(flow) ? {} : { unmarkable: true as const }),
  }));
}

/** The flows of the project: the list with its actions, or the view of loading, of a failed read, of none. */
export function flowsBlock(panel: PanelData, t: Translator, hotkeys: boolean): ListsNode[] {
  const title = text(t('pane.flows.title'), dim);
  const flows = panel.flows;
  if (flows === undefined) return [blank, title, text(t('pane.flows.loading'), dim)];
  if (flows.failed === true && flows.items.length === 0) {
    return [
      blank,
      title,
      failedText(t, 'pane.flows.failed', 'flows', flows.why),
      retry('flows-retry', FLOW_LIST, t),
    ];
  }
  const entries = flowEntries(flows.items, t);
  const marked = markedKeys(panel, FLOW_LIST);
  const view = listView(panel, FLOW_LIST);
  const parts = listParts({
    id: FLOW_LIST,
    entries,
    groups: [],
    marks: { marked: new Set(marked), limit: MAX_MARKED_FLOWS },
    view,
    hotkeys,
    preview: (entry) => stepsNodes(panel, entry.key, t, hotkeys),
    texts: listTexts(t, t('pane.flows.filterPlaceholder'), t('pane.flows.none'), true),
  });
  if (parts.open !== undefined) return [blank, title, ...parts.head];
  if (flows.items.length === 0) return [blank, title, ...parts.head];
  const shown = visibleEntries(entries, view).flatMap((entry) =>
    entry.unmarkable === true ? [] : [entry.key],
  );
  const oldMarked = markedOldDocs(panel).length;
  const actions: ListsNode =
    marked.length === 0
      ? text(t('pane.flows.hint'), dim)
      : row(
          [
            {
              type: 'Button',
              key: 'flows-scenario',
              label: t('pane.flows.scenario', { count: marked.length }),
              action: { kind: 'send', topic: 'scenario' },
              ...(hotkeys ? { hotkey: 'g' } : {}),
            },
            oldMarked === 0
              ? text(t('pane.flows.migrateNone'), dim)
              : {
                  type: 'Button',
                  key: 'flows-migrate',
                  label: t('pane.flows.migrate', { count: oldMarked }),
                  action: { kind: 'send', topic: 'migrate' },
                  ...(hotkeys ? { hotkey: 'm' } : {}),
                },
          ],
          2,
        );
  const bar = row([
    {
      type: 'Button',
      key: 'flows-select-all',
      label: t('pane.path.selectAll'),
      action: { kind: 'list.markAll', list: FLOW_LIST, keys: shown },
      dimColor: true,
    },
    {
      type: 'Button',
      key: 'flows-select-none',
      label: t('pane.path.selectNone'),
      action: { kind: 'list.clear', list: FLOW_LIST },
      dimColor: true,
    },
  ]);
  return [
    blank,
    title,
    ...parts.head,
    actions,
    bar,
    ...parts.rows,
    ...(flows.more > 0 ? [text(t.plural('pane.flows.more', flows.more), dim)] : []),
    ...(hotkeys ? [text(t('pane.flows.hintKeys'), dim)] : []),
  ];
}

// ---- the test runs --------------------------------------------------------------------------------

function runEntries(items: readonly RunRow[], t: Translator): ListEntry[] {
  return items.map((run) => {
    const verdictKey = run.verdict === undefined ? undefined : `report.verdict.${run.verdict}`;
    const verdict = verdictKey !== undefined && t.has(verdictKey) ? [t(verdictKey)] : [];
    return {
      key: run.handle,
      label: run.target === '' ? run.handle : run.target,
      notes: [...verdict, ...(run.when === undefined ? [] : [whenOf(run.when)]), run.handle],
      ...(verdict.length > 0 ? { bright: true as const } : {}),
      search: [run.handle, ...verdict, run.when ?? ''].join(' '),
    };
  });
}

function runPreview(items: readonly RunRow[]) {
  return (entry: ListEntry): ListNode[] => {
    const run = items.find((item) => item.handle === entry.key);
    return run === undefined
      ? []
      : [text(run.handle), ...(run.when === undefined ? [] : [text(whenOf(run.when), dim)])];
  };
}

/** The test runs: the list with "Compare" for exactly two marked, or the view of loading, failure, none. */
export function runsBlock(panel: PanelData, t: Translator, hotkeys: boolean): ListsNode[] {
  const title = text(t('pane.runs.title'), dim);
  const runs = panel.runs;
  if (runs === undefined) return [title, text(t('pane.runs.loading'), dim), blank];
  if (runs.failed === true && runs.items.length === 0) {
    return [
      title,
      failedText(t, 'pane.runs.failed', 'runs', runs.why),
      retry('runs-retry', RUN_LIST, t),
      blank,
    ];
  }
  const marked = markedKeys(panel, RUN_LIST);
  const parts = listParts({
    id: RUN_LIST,
    entries: runEntries(runs.items, t),
    groups: [],
    marks: { marked: new Set(marked), limit: MAX_MARKED_RUNS },
    view: listView(panel, RUN_LIST),
    hotkeys,
    preview: runPreview(runs.items),
    texts: listTexts(t, t('pane.runs.filterPlaceholder'), t('pane.runs.none'), true),
  });
  if (parts.open !== undefined || runs.items.length === 0) return [title, ...parts.head, blank];
  const pair = comparePair(panel);
  const actions: ListsNode =
    pair === undefined
      ? text(t('pane.runs.hint'), dim)
      : {
          type: 'Button',
          key: 'runs-compare',
          label: t('pane.runs.compare'),
          action: { kind: 'send', topic: 'compare' },
          ...(hotkeys ? { hotkey: 'c' } : {}),
        };
  return [
    title,
    ...parts.head,
    actions,
    ...(marked.length > 0
      ? [
          {
            type: 'Button',
            key: 'runs-select-none',
            label: t('pane.path.selectNone'),
            action: { kind: 'list.clear', list: RUN_LIST },
            dimColor: true,
          } as const,
        ]
      : []),
    ...parts.rows,
    ...(runs.more > 0 ? [text(t.plural('pane.runs.more', runs.more), dim)] : []),
    blank,
  ];
}

/** What a list says when the project is known to the session but its status was not read into the panel yet. */
export function noStatusNote(t: Translator): ListsNode[] {
  return [blank, text(t('pane.list.noStatus'), dim)];
}
