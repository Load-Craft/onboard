/**
 * The side panel: four tabs (Run, Project, Results, Path) as plain data, a pure function of the session
 * state and of what the panel keeps (pane/tabs.ts). No `$`, no clock, no exception.
 * `register.ts` reads both, calls `paneTree`, and `paneElements` turns the tree into the elements
 * `$.ui.resolve(e)` hands out; a press runs the `action` the button names.
 *
 * The drawings of the results are not made again: the Results tab draws the summary with the
 * report drawing of the results (`view/report.ts`).
 */

import { sparkline } from '../series.js';
import type { Translator } from '../../../mcp/src/context.js';
import type { Locale } from '../i18n.js';
import { cancelQuestion } from '../pane/cancel.js';
import {
  safeHref,
  FLOW_METHODS,
  TABS,
  markedJourneys,
  listView,
  MAX_MARKED_JOURNEYS,
  type FlowMethod,
  type JourneyFact,
  type PathFacts,
  type EnvironmentFact,
  type PaneTab,
  type PanelData,
  type RunFact,
  type TestFailure,
} from '../pane/tabs.js';
import { paneTexts } from '../pane/texts.js';
import type { ModBars, ModState } from '../state/types.js';
import type { Card } from '../card/queue.js';
import { barsBlock } from './bars.js';
import { noticesBlock, type CardCloseAction } from './card.js';
import { report, verdictColor } from './report.js';
import { flowsBlock, noStatusNote, runsBlock, type ListsAction } from './paneLists.js';
import { selfCheckBlock, type CheckAction } from './selfCheck.js';
import { MAX_REASON, progressParts } from './status.js';
import { cardTexts } from '../card/texts.js';
import { inline } from '../../../mcp/src/render/primitives.js';
import {
  listParts,
  visibleEntries,
  type ListAction,
  type ListEntry,
  type ListGroup,
  type ListInput,
  type ListNode,
} from './list.js';
import {
  text,
  type BoxProps,
  type Elements,
  type TextProps,
  type TreeNode,
  type TreeText,
} from './tree.js';

/** What a press of a button does. */
export type PaneAction =
  | { readonly kind: 'tab'; readonly tab: PaneTab }
  | { readonly kind: 'cancel' }
  /** A way to build flows picked in the Path tab. */
  | { readonly kind: 'method'; readonly method: FlowMethod }
  /** The marked journeys sent to the agent. */
  | { readonly kind: 'build' }
  /** No journey marked. */
  | { readonly kind: 'none' }
  | { readonly kind: 'auto' }
  /** A filter, a preview, a mark or a group of a list (view/list.ts). */
  | ListAction
  /** The marked flows or runs sent to the agent (view/paneLists.ts). */
  | ListsAction
  /** The close of a card listed in the notices block. */
  | CardCloseAction
  /** The question to Claude about one step of a self-check (view/selfCheck.ts). */
  | CheckAction;

export interface PaneButton {
  readonly type: 'Button';
  /** Unique in the pane: a test and a surface find the button by it. */
  readonly key: string;
  readonly label: string;
  readonly action: PaneAction;
  readonly hotkey?: string;
  readonly plain?: true;
  readonly dimColor?: true;
}

export interface PaneLink {
  readonly type: 'Link';
  readonly href: string;
  readonly label: string;
}

export interface PaneBox {
  readonly type: 'Box';
  readonly props: BoxProps;
  readonly children: readonly PaneNode[];
}

/** A node of the panel: the nodes of the result drawings, and those only a panel has. */
export type PaneNode = TreeText | PaneBox | PaneButton | PaneLink | ListInput;

export interface PaneContext {
  readonly locale: Locale;
  /** `terminal`, `desktop` or `vscode`; VS Code draws no hotkeys. */
  readonly surface: string;
  /** Columns of the pane's body. */
  readonly width: number;
  /** Requests per second of the test, oldest first: the series of the live line (series.ts). */
  readonly samples: readonly number[];
  /** Whether the pane opens by itself when a test starts (the stored preference). */
  readonly autoOpen: boolean;
  /** The bars of the long operations in progress (bars.ts), drawn above the tab; none when absent. */
  readonly bars?: ModBars;
  /** Epoch milliseconds now, for the time of a bar; required for `bars` to show. */
  readonly now?: number;
  /** The cards waiting above the prompt: the panel lists them too (see view/card.ts). */
  readonly cards?: readonly Card[];
}

const MAX_CHART = 60;
/** A project name is a label, not the place to read it. */
const NAME_LIMIT = 80;
const GAP = 2;
const blank: TreeText = text(' ');
const dim: TextProps = { dimColor: true };

const box = (children: readonly PaneNode[], columnGap = GAP): PaneBox => ({
  type: 'Box',
  props: { flexDirection: 'row', columnGap },
  children,
});

const stack = (children: readonly PaneNode[]): PaneBox => ({
  type: 'Box',
  props: { flexDirection: 'column' },
  children,
});

function tabBar(active: PaneTab, t: Translator, surface: string): PaneNode {
  return box(
    TABS.map((tab, index): PaneButton => {
      const base: PaneButton = {
        type: 'Button',
        key: `tab-${tab}`,
        label: t(`pane.tab.${tab}`),
        action: { kind: 'tab', tab },
        plain: true,
      };
      return {
        ...base,
        ...(surface === 'vscode' ? {} : { hotkey: String(index + 1) }),
        ...(tab === active ? {} : { dimColor: true as const }),
      };
    }),
    3,
  );
}

function autoToggle(ctx: PaneContext, t: Translator): PaneNode {
  return {
    type: 'Button',
    key: 'auto-open',
    label: t(ctx.autoOpen ? 'pane.run.auto.on' : 'pane.run.auto.off'),
    action: { kind: 'auto' },
    dimColor: true,
  };
}

/** What the card of a failed test announced: that it failed and why, as far as the server said. */
function failedRun(failure: TestFailure, ctx: PaneContext, t: Translator): PaneNode[] {
  const reason =
    failure.reason === undefined
      ? cardTexts(ctx.locale)('card.end.noReason')
      : inline(failure.reason, MAX_REASON);
  return [
    text(t('pane.run.failed'), { bold: true, color: 'error' }),
    text(reason),
    blank,
    autoToggle(ctx, t),
  ];
}

/**
 * The self-check of the Run tab: the last view the server wrote, or that it is awaited while a check
 * runs, and a read that failed; nothing when no check is known.
 */
function checkBlock(
  panel: PanelData,
  checking: boolean,
  ctx: PaneContext,
  t: Translator,
): PaneNode[] {
  const failed =
    panel.selfCheckFailed === true ? [text(t('pane.check.failedRead'), { color: 'warning' })] : [];
  if (panel.selfCheck === undefined) {
    return checking ? [text(t('pane.check.loading'), dim), ...failed] : [];
  }
  return [
    ...selfCheckBlock(panel.selfCheck, panel.lists ?? {}, t, {
      width: ctx.width,
      hotkeys: ctx.surface !== 'vscode',
    }),
    ...failed,
  ];
}

function runTab(state: ModState, panel: PanelData, ctx: PaneContext, t: Translator): PaneNode[] {
  const operation = state.operation;
  // A test keeps the tab; any other operation leaves it to the self-check when one is known or awaited.
  const check =
    operation?.kind === 'test_run'
      ? []
      : checkBlock(panel, operation?.kind === 'self_check', ctx, t);
  if (check.length > 0) {
    // A test that failed is still said first: the view may be older than the test.
    const failed =
      operation === undefined && panel.failure !== undefined
        ? failedRun(panel.failure, ctx, t).slice(0, -1)
        : [];
    return [...failed, ...check, blank, autoToggle(ctx, t)];
  }
  if (operation === undefined) {
    if (panel.failure !== undefined) return failedRun(panel.failure, ctx, t);
    return [text(t('pane.run.none'), dim), blank, autoToggle(ctx, t)];
  }
  const { snapshot } = panel;
  if (snapshot === undefined || snapshot.operation !== operation.handle) {
    return [text(t('pane.run.waiting'), dim), blank, autoToggle(ctx, t)];
  }
  const [head = '', ...numbers] = progressParts(snapshot, ctx.locale);
  const lines: PaneNode[] = [text(head, { bold: true })];
  if (numbers.length > 0) lines.push(text(numbers.join(' · ')));
  if (ctx.samples.length > 1) {
    lines.push(text(sparkline(ctx.samples, Math.min(MAX_CHART, Math.max(8, ctx.width - 4)))));
  } else if (snapshot.kind === 'test_run') {
    lines.push(text(t('pane.run.chartHint'), dim));
  }
  if (snapshot.needs_user !== undefined) {
    const what = inline(snapshot.needs_user, 120);
    lines.push(text(t('pane.run.needsUser', { what }), { color: 'warning' }));
  }
  const actions: PaneNode[] = [];
  if (cancelQuestion(snapshot, ctx.locale) !== undefined) {
    actions.push({
      type: 'Button',
      key: 'cancel',
      label: t('pane.run.cancel'),
      action: { kind: 'cancel' },
    });
  }
  const href =
    panel.preview?.handle === operation.handle ? safeHref(panel.preview.href) : undefined;
  if (href !== undefined) {
    actions.push({ type: 'Link', href, label: `${t('pane.run.preview')} ↗` });
  }
  if (actions.length > 0) lines.push(blank, box(actions));
  lines.push(blank, autoToggle(ctx, t));
  return lines;
}

function limits(environment: EnvironmentFact, t: Translator): string {
  const caps = [
    ...(environment.maxVu === undefined ? [] : [t.plural('pane.env.users', environment.maxVu)]),
    ...(environment.maxRps === undefined ? [] : [t.plural('pane.env.rps', environment.maxRps)]),
  ];
  return caps.length === 0 ? t('pane.env.noLimit') : caps.join(', ');
}

function environmentRow(environment: EnvironmentFact, t: Translator): PaneNode {
  const tags = [
    ...(environment.active ? [t('pane.env.active')] : []),
    ...(environment.isDefault ? [t('pane.env.default')] : []),
  ];
  const cells: PaneNode[] = [text(environment.name, environment.active ? { bold: true } : {})];
  if (environment.protected) {
    cells.push(text(`⚠ ${t('pane.env.protected')}`, { color: 'warning' }));
  }
  cells.push(text([...tags, limits(environment, t)].join(' · '), dim));
  return box(cells, 1);
}

function runRow(run: RunFact, t: Translator): PaneNode {
  const verdictKey = run.verdict === undefined ? undefined : `report.verdict.${run.verdict}`;
  const cells: PaneNode[] = [text(run.handle, dim), text(run.target)];
  if (run.verdict !== undefined && verdictKey !== undefined && t.has(verdictKey)) {
    cells.push(text(t(verdictKey), { color: verdictColor(run.verdict), bold: true }));
  }
  return box(cells, 1);
}

function projectTab(state: ModState, panel: PanelData, t: Translator, surface: string): PaneNode[] {
  const project = panel.project;
  if (state.project === undefined && project === undefined) {
    return [text(t('pane.project.none'), dim)];
  }
  const lines: PaneNode[] = [];
  if (state.project !== undefined) {
    const setup =
      project?.setupComplete === undefined
        ? []
        : [
            text(
              t(project.setupComplete ? 'pane.project.setupDone' : 'pane.project.setupOpen'),
              dim,
            ),
          ];
    lines.push(
      box([
        text(
          t('pane.project.title', {
            name: inline(state.project.name, NAME_LIMIT),
          }),
          {
            bold: true,
          },
        ),
        ...setup,
      ]),
    );
  }
  if (project === undefined) return [...lines, ...noStatusNote(t)];
  if (project.uncertainFields !== undefined) {
    lines.push(
      blank,
      text(t('pane.project.uncertain', { names: project.uncertainFields.join(', ') }), {
        color: 'warning',
      }),
    );
  }
  lines.push(blank, text(t('pane.project.environments'), dim));
  lines.push(
    ...(project.environments.length === 0
      ? [text(t('pane.project.noEnvironments'))]
      : project.environments.map((environment) => environmentRow(environment, t))),
  );
  lines.push(blank, text(t('pane.project.counts', project.counts)));
  lines.push(blank, text(t('pane.project.runs'), dim));
  lines.push(
    ...(project.runs.length === 0
      ? [text(t('pane.project.noRuns'))]
      : project.runs.map((run) => runRow(run, t))),
  );
  lines.push(...flowsBlock(panel, t, surface !== 'vscode'));
  return lines;
}

function resultsTab(
  state: ModState,
  panel: PanelData,
  ctx: PaneContext,
  t: Translator,
): PaneNode[] {
  const runs =
    panel.project === undefined
      ? state.project === undefined
        ? []
        : noStatusNote(t)
      : runsBlock(panel, t, ctx.surface !== 'vscode');
  const known = panel.report;
  if (known === undefined) return [...runs, text(t('pane.results.none'), dim)];
  const drawn: TreeNode | undefined = report(known.data, {
    locale: ctx.locale,
    width: ctx.width,
    surface: ctx.surface,
  });
  if (drawn === undefined) return [...runs, text(t('pane.results.unavailable'), dim)];
  const href = safeHref(known.href);
  return [
    ...runs,
    drawn,
    ...(href === undefined
      ? []
      : [blank, { type: 'Link', href, label: `${t('pane.results.open')} ↗` } as const]),
  ];
}

/** Why a method cannot be used in this project, or `undefined` when it can. */
function missing(method: FlowMethod, path: PathFacts, t: Translator): string | undefined {
  if ((method === 'docs' || method === 'manual') && !path.docs) return t('pane.path.missing.docs');
  if (method === 'describe' && !path.frontend) return t('pane.path.missing.frontend');
  return undefined;
}

function methodRow(
  method: FlowMethod,
  path: PathFacts,
  chosen: FlowMethod | undefined,
  t: Translator,
): PaneNode {
  const label = t(`pane.path.method.${method}`);
  const reason = missing(method, path, t);
  if (reason !== undefined) return box([text(label, dim), text(`— ${reason}`, dim)], 1);
  const note =
    method === 'har' ? t(path.recording ? 'pane.path.note.harHave' : 'pane.path.note.har') : '';
  const mark = chosen === method ? '✓ ' : '';
  return box(
    [
      {
        type: 'Button',
        key: `method-${method}`,
        label: `${mark}${label}`,
        action: { kind: 'method', method },
      },
      ...(note === '' && chosen !== method
        ? []
        : [
            text(
              [note, chosen === method ? t('pane.path.chosen') : ''].filter(Boolean).join(' · '),
              dim,
            ),
          ]),
    ],
    1,
  );
}

const SHOWN_STEPS = 4;
const JOURNEY_TYPES: readonly string[] = [
  'semantic',
  'crud',
  'auth_rejection',
  'async_polling',
  'tag_group',
  'journey_slice',
];

/** Kinds whose steps are a set: the generator, not the proposal, orders them when it builds. */
const UNORDERED_TYPES: readonly string[] = ['semantic', 'tag_group'];

/** The type of a journey as the frontend names it; an unknown type reads as a user journey. */
const typeKey = (pattern: string): string =>
  `pane.path.type.${JOURNEY_TYPES.includes(pattern) ? pattern : 'semantic'}`;

/** The id of the journey list: the prefix of its element keys (`journey-0`, `journey-open-0`, …). */
export const JOURNEY_LIST = 'journey';
/** The ladder of journey slices is one group of the list when it has at least two rungs. */
const LADDER = 'journey_slice';
const LADDER_GROUP = 'ladder';

function stepsLine(journey: JourneyFact, t: Translator): string | undefined {
  const shown = journey.steps.slice(0, SHOWN_STEPS);
  if (shown.length === 0) return undefined;
  const rest = journey.steps.length - shown.length;
  const separator = UNORDERED_TYPES.includes(journey.pattern) ? ' · ' : ' → ';
  return t.plural('pane.path.steps', journey.steps.length, {
    list:
      shown.join(separator) +
      (rest > 0 ? `${separator}${t('pane.path.stepsMore', { count: rest })}` : ''),
  });
}

/** The journeys as entries of the list; the rungs of a ladder of two or more share one group. */
export function journeyEntries(path: PathFacts, t: Translator): ListEntry[] {
  const laddered = path.journeys.filter((journey) => journey.pattern === LADDER).length >= 2;
  return path.journeys.map((journey) => {
    const kind = t(typeKey(journey.pattern));
    const summary = stepsLine(journey, t);
    return {
      key: journey.name,
      label: journey.name,
      notes: [kind, ...(journey.built ? [`✓ ${t('pane.path.built')}`] : [])],
      ...(journey.pattern === 'auth_rejection' ? { bright: true as const } : {}),
      ...(summary === undefined ? {} : { summary }),
      search: [kind, ...journey.steps].join(' '),
      ...(laddered && journey.pattern === LADDER ? { group: LADDER_GROUP } : {}),
    };
  });
}

function ladderGroups(path: PathFacts, t: Translator): ListGroup[] {
  const rungs = path.journeys.filter((journey) => journey.pattern === LADDER);
  if (rungs.length < 2) return [];
  const sizes = rungs.map((rung) => rung.steps.length);
  return [
    {
      key: LADDER_GROUP,
      label: t.plural('pane.path.ladder', rungs.length),
      ...(Math.max(...sizes) > 0
        ? {
            summary: t('pane.path.ladderRange', {
              first: Math.min(...sizes),
              last: Math.max(...sizes),
            }),
          }
        : {}),
    },
  ];
}

/** The preview of a journey: every step, numbered where the order is the plan. */
function journeyPreview(path: PathFacts, t: Translator) {
  return (entry: ListEntry): ListNode[] => {
    const journey = path.journeys.find((item) => item.name === entry.key);
    if (journey === undefined || journey.steps.length === 0) {
      return [text(t('pane.path.noSteps'), dim)];
    }
    const ordered = !UNORDERED_TYPES.includes(journey.pattern);
    return [
      text(t(ordered ? 'pane.path.stepsOrdered' : 'pane.path.stepsSet'), dim),
      ...journey.steps.map((step, index) =>
        text(`  ${ordered ? `${String(index + 1)}.` : '·'} ${step}`),
      ),
    ];
  };
}

function journeyRows(
  panel: PanelData,
  path: PathFacts,
  t: Translator,
  surface: string,
): PaneNode[] {
  if (path.journeys.length === 0) return [text(t('pane.path.noJourneys'), dim)];
  const marked = new Set(markedJourneys(panel));
  const view = listView(panel, JOURNEY_LIST);
  const entries = journeyEntries(path, t);
  const hotkeys = surface !== 'vscode';
  const parts = listParts({
    id: JOURNEY_LIST,
    entries,
    groups: ladderGroups(path, t),
    marks: { marked, limit: MAX_MARKED_JOURNEYS },
    view,
    hotkeys,
    preview: journeyPreview(path, t),
    texts: {
      filter: t('list.filter'),
      placeholder: t('pane.path.filterPlaceholder'),
      counter: (count, visible, limit) =>
        limit === undefined
          ? t('list.counter', { marked: count, visible })
          : t('list.counterLimit', { marked: count, limit, visible }),
      empty: t('pane.path.noJourneys'),
      noMatch: t('list.noMatch'),
      more: (count) => t('list.more', { count }),
      back: t('list.back'),
      mark: t('list.mark'),
      unmark: t('list.unmark'),
      markCurrent: t('list.markCurrent'),
    },
  });
  if (parts.open !== undefined) return [...parts.head];
  // "Mark all": the journeys the filter shows that have no flow yet, up to the limit.
  const built = new Set(path.journeys.flatMap((item) => (item.built ? [item.name] : [])));
  const shown = visibleEntries(entries, view).flatMap((entry) =>
    built.has(entry.key) ? [] : [entry.key],
  );
  const build: PaneNode =
    marked.size === 0
      ? text(t('pane.path.pick'), dim)
      : {
          type: 'Button',
          key: 'build',
          label: t('pane.path.build', { count: marked.size }),
          action: { kind: 'build' },
          ...(hotkeys ? { hotkey: 'g' } : {}),
        };
  const bar: PaneNode = box([
    build,
    {
      type: 'Button',
      key: 'select-all',
      label: t('pane.path.selectAll'),
      action: { kind: 'list.markAll', list: JOURNEY_LIST, keys: shown },
      dimColor: true,
    },
    {
      type: 'Button',
      key: 'select-none',
      label: t('pane.path.selectNone'),
      action: { kind: 'none' },
      dimColor: true,
    },
  ]);
  const full = marked.size >= MAX_MARKED_JOURNEYS;
  return [
    ...parts.head,
    bar,
    ...(full
      ? [text(t('pane.path.limit', { limit: MAX_MARKED_JOURNEYS }), { color: 'warning' })]
      : []),
    ...parts.rows,
  ];
}

function pathTab(panel: PanelData, t: Translator, surface: string): PaneNode[] {
  const path = panel.project?.path;
  if (path === undefined) return [text(t('pane.path.none'), dim)];
  return [
    text(t('pane.path.methods'), dim),
    ...FLOW_METHODS.map((method) => methodRow(method, path, panel.choice?.method, t)),
    blank,
    text(t('pane.path.journeys'), dim),
    ...journeyRows(panel, path, t, surface),
    blank,
    ...(surface === 'vscode' ? [] : [text(t('pane.path.hintKeys'), dim)]),
    text(t('pane.path.hint'), dim),
  ];
}

/** The panel for `tab`: the row of tabs, a blank line and the body of the tab. */
export function paneTree(
  state: ModState,
  panel: PanelData,
  tab: PaneTab,
  ctx: PaneContext,
): PaneNode {
  const t = paneTexts(ctx.locale);
  const body =
    tab === 'run'
      ? runTab(state, panel, ctx, t)
      : tab === 'project'
        ? projectTab(state, panel, t, ctx.surface)
        : tab === 'path'
          ? pathTab(panel, t, ctx.surface)
          : resultsTab(state, panel, ctx, t);
  const bars =
    ctx.bars === undefined || ctx.now === undefined
      ? []
      : barsBlock(ctx.bars, { locale: ctx.locale, now: ctx.now, width: ctx.width });
  return stack([
    tabBar(tab, t, ctx.surface),
    blank,
    ...bars,
    ...(bars.length > 0 ? [blank] : []),
    ...noticesBlock(ctx.cards ?? [], ctx.locale),
    ...body,
  ]);
}

// ---- elements -----------------------------------------------------------------------------------

/** The element functions of a pane's table, as far as the panel uses them. */
export interface PaneElements extends Elements {
  Button(props: Record<string, unknown>): unknown;
  Link(props: Record<string, unknown>): unknown;
  Input(props: Record<string, unknown>): unknown;
}

/** Builds the elements of a tree; a press of a button hands its action to `press`. */
export function paneElements(
  elements: PaneElements,
  node: PaneNode,
  press: (action: PaneAction) => unknown,
): unknown {
  switch (node.type) {
    case 'Text':
      return elements.Text({ ...node.props, children: [...node.children] });
    case 'Box':
      return elements.Box({
        ...node.props,
        children: node.children.map((child) => paneElements(elements, child, press)),
      });
    case 'Button':
      return elements.Button({
        key: node.key,
        label: node.label,
        ...(node.hotkey === undefined ? {} : { hotkey: node.hotkey }),
        ...(node.plain === undefined ? {} : { plain: node.plain }),
        ...(node.dimColor === undefined ? {} : { dimColor: node.dimColor }),
        onPress: () => press(node.action),
      });
    case 'Input': {
      const filter = (query: string): unknown =>
        press({ kind: 'list.filter', list: node.list, query });
      return elements.Input({
        key: node.key,
        label: node.label,
        placeholder: node.placeholder,
        value: node.value,
        onInput: filter,
        onSubmit: filter,
      });
    }
    case 'Link':
      // A link is inline: it goes inside a Text.
      return elements.Text({
        children: [elements.Link({ href: node.href, label: node.label })],
      });
  }
}
