/**
 * The self-check in the Run tab (pane/selfCheck.ts reads it): for each scenario where it stands (a run
 * in progress, a step that failed, an AI repair round of the limit, the next attempt from step 1, the
 * end), the steps of the run under way or last on the common list component (view/list.ts), each
 * earlier attempt as one row that opens like a group of the list, and the repair rounds. Pure: a
 * function of the stored panel, returning panel nodes; colors are theme keys only.
 *
 * The backend starts every attempt again from step 1 (a repair writes a new version, which runs the
 * whole journey), and the head says so; it never claims to go on from the step that failed. The texts of
 * the steps are the tested system's, drawn as text only (`inline` in the list and here).
 */

import type { Translator } from '../../../mcp/src/context.js';
import { inline } from '../../../mcp/src/render/primitives.js';
import { isStepQuestion } from '../pane/choice.js';
import {
  checkEntryKeys,
  checkListId,
  checkState,
  currentKey,
  currentRun,
  earlierKey,
  earlierRuns,
  groupKey,
  isInFlight,
  runResults,
  type CheckResultFact,
  type CheckRunFact,
  type ScenarioCheckFact,
  type SelfCheckFacts,
  type StepResult,
} from '../pane/selfCheck.js';
import type { ListView } from './list.js';
import {
  EMPTY_VIEW,
  listParts,
  type ListAction,
  type ListEntry,
  type ListGroup,
  type ListInput,
  type ListNode,
} from './list.js';
import { listTexts } from './paneLists.js';
import { text, type TextProps, type TreeText } from './tree.js';

/** The question to Claude about one step: the run handle and the number of the step, nothing else. */
export interface CheckAction {
  readonly kind: 'check.ask';
  readonly run: string;
  readonly step: number;
}

export interface CheckButton {
  readonly type: 'Button';
  readonly key: string;
  readonly label: string;
  readonly action: ListAction | CheckAction;
  readonly hotkey?: string;
  readonly plain?: true;
  readonly dimColor?: true;
}

export interface CheckBox {
  readonly type: 'Box';
  readonly props: { readonly flexDirection: 'row' | 'column'; readonly columnGap?: number };
  readonly children: readonly CheckNode[];
}

export type CheckNode = TreeText | CheckButton | CheckBox | ListInput | ListNode;

/** The filter of a list of steps is drawn from this many entries on (or while it holds a query). */
const FILTER_FROM = 13;
/** Below this many columns the method and the path of a step are left to its preview. */
const WIDE = 60;
const REASON = 300;

const dim: TextProps = { dimColor: true };
const blank = text(' ');
const row = (children: readonly CheckNode[], columnGap = 2): CheckBox => ({
  type: 'Box',
  props: { flexDirection: 'row', columnGap },
  children,
});

const MARKS: Readonly<Record<StepResult, string>> = { ok: '✓', failed: '✕', skipped: '·' };
const mark = (result: StepResult | undefined): string =>
  result === undefined ? '○' : MARKS[result];
const httpText = (http: number | undefined): string =>
  http === undefined ? '' : ` (${String(http)})`;

/** `attempt 2 · version 2`, or `attempt 2` for a run whose version the view does not name. */
function attempt(t: Translator, run: number, version: number | undefined): string {
  const head = t('pane.check.history', { run });
  return version === undefined ? head : `${head} · ${t('pane.check.version', { version })}`;
}

function verdictMark(verdict: string | undefined): string {
  if (verdict === undefined) return '';
  return verdict === 'passed' || verdict === 'passed_after_repair' ? ' ✓' : ' ✕';
}

/** One line of an earlier attempt: its number, version, verdict and the step that failed in it. */
function historyLabel(scenario: ScenarioCheckFact, item: CheckRunFact, t: Translator): string {
  const results = runResults(scenario, item);
  const at = results.findIndex((result) => result?.result === 'failed');
  const failed = at < 0 ? undefined : results[at];
  const name = scenario.steps[at]?.name ?? '';
  const step =
    failed === undefined
      ? ''
      : ` · ${t('pane.check.historyStep', { step: at + 1, name })}${httpText(failed.http)}`;
  return `${attempt(t, item.run, item.version)}${verdictMark(item.verdict)}${step}`;
}

interface Located {
  readonly at: number;
  readonly run: CheckRunFact | undefined;
  readonly result: CheckResultFact | undefined;
}

/** The step an entry key names: its place in the plan, the run it belongs to and its result there. */
function locate(scenario: ScenarioCheckFact, key: string): Located | undefined {
  const current = /^c(\d+)$/u.exec(key);
  if (current !== null) {
    const at = Number(current[1]);
    const run = currentRun(scenario);
    return { at, run, result: run === undefined ? undefined : runResults(scenario, run)[at] };
  }
  const earlier = /^r(\d+)-(\d+)$/u.exec(key);
  if (earlier === null) return undefined;
  const run = scenario.runs.find((item) => item.run === Number(earlier[1]));
  const at = Number(earlier[2]);
  return { at, run, result: run === undefined ? undefined : runResults(scenario, run)[at] };
}

function entriesOf(scenario: ScenarioCheckFact, t: Translator, wide: boolean): ListEntry[] {
  const run = currentRun(scenario);
  const results = run === undefined ? [] : runResults(scenario, run);
  const current = scenario.steps.map((step, at): ListEntry => {
    const request = [step.method, step.path].filter(Boolean).join(' ');
    const reason =
      step.result === 'failed' ? (results[at]?.reason ?? scenario.failure?.message) : undefined;
    return {
      key: currentKey(at),
      label: `${mark(step.result)} ${String(at + 1)} ${step.name}`,
      notes: [
        ...(wide && request !== '' ? [request] : []),
        ...(step.http === undefined ? [] : [String(step.http)]),
        ...(step.result === 'skipped' ? [t('pane.check.notRun')] : []),
      ],
      ...(step.result === 'failed' ? { bright: true as const } : {}),
      ...(reason === undefined || reason === '' ? {} : { summary: reason }),
      search: request,
    };
  });
  const earlier = earlierRuns(scenario).flatMap((item) =>
    runResults(scenario, item).map((result, at): ListEntry => ({
      key: earlierKey(item.run, at),
      label: `${mark(result?.result)} ${String(at + 1)} ${scenario.steps[at]?.name ?? ''}`,
      notes: result?.http === undefined ? [] : [String(result.http)],
      search: '',
      group: groupKey(item.run),
    })),
  );
  return [...current, ...earlier];
}

function previewOf(scenario: ScenarioCheckFact, t: Translator) {
  return (entry: ListEntry): ListNode[] => {
    const found = locate(scenario, entry.key);
    if (found === undefined) return [];
    const step = scenario.steps[found.at];
    const request = [step?.method, step?.path].filter(Boolean).join(' ');
    const reason = found.result?.reason;
    return [
      ...(request === '' ? [] : [text(request)]),
      ...scenario.runs.map((item) => {
        const result = runResults(scenario, item)[found.at];
        return text(
          `${attempt(t, item.run, item.version)}: ${mark(result?.result)}${httpText(result?.http)}`,
          dim,
        );
      }),
      ...(reason === undefined ? [] : [text(inline(reason, REASON))]),
    ];
  };
}

/** The question about the step of `entry`, under its preview, when the step has a run it can name. */
function askButton(
  scenario: ScenarioCheckFact,
  entry: ListEntry,
  t: Translator,
  hotkeys: boolean,
): CheckNode[] {
  const found = locate(scenario, entry.key);
  const handle = found?.run?.handle;
  const number = (found?.at ?? -1) + 1;
  if (handle === undefined || !isStepQuestion(handle, number)) return [];
  return [
    blank,
    {
      type: 'Button',
      key: 'check-ask',
      label: t('pane.check.ask'),
      action: { kind: 'check.ask', run: handle, step: number },
      ...(hotkeys ? { hotkey: 'a' } : {}),
    },
  ];
}

function scenarioBlock(
  scenario: ScenarioCheckFact,
  index: number,
  view: ListView,
  t: Translator,
  ctx: { readonly width: number; readonly hotkeys: boolean },
): CheckNode[] {
  const state = checkState(scenario);
  const lines: CheckNode[] = [
    row([
      text(scenario.name, { bold: true }),
      ...(scenario.run > 0 ? [text(attempt(t, scenario.run, scenario.version), dim)] : []),
    ]),
    text(
      t(state.key, state.params),
      state.tone === undefined ? { bold: true } : { color: state.tone },
    ),
  ];
  const message = scenario.failure?.message ?? '';
  if (message !== '' && (scenario.status === 'repairing' || scenario.status === 'failed')) {
    lines.push(text(inline(message, REASON)));
  }
  if (scenario.status === 'repairing') lines.push(text(t('pane.check.next'), dim));
  const entries = entriesOf(scenario, t, ctx.width >= WIDE);
  const groups: ListGroup[] = earlierRuns(scenario).map((item) => ({
    key: groupKey(item.run),
    label: historyLabel(scenario, item, t),
  }));
  if (scenario.steps.length === 0) {
    lines.push(
      text(t(isInFlight(scenario.status) ? 'pane.check.noSteps' : 'pane.check.none'), dim),
    );
  } else {
    const parts = listParts({
      id: checkListId(index),
      entries,
      groups,
      view,
      hotkeys: ctx.hotkeys,
      preview: previewOf(scenario, t),
      texts: listTexts(t, t('pane.check.filterPlaceholder'), t('pane.check.noSteps'), false),
    });
    if (parts.open !== undefined) {
      return [...lines, ...parts.head, ...askButton(scenario, parts.open, t, ctx.hotkeys)];
    }
    const filtered = entries.length >= FILTER_FROM || view.query !== '';
    lines.push(...(filtered ? parts.head : []), ...parts.rows);
  }
  if (scenario.moreSteps > 0)
    lines.push(text(t.plural('pane.check.more', scenario.moreSteps), dim));
  for (const repair of scenario.repairs) {
    const params = {
      round: repair.round,
      limit: scenario.repairLimit,
      text: repair.text,
      version: repair.version ?? '?',
    };
    lines.push(
      text(
        t(
          repair.outcome === 'repaired' ? 'pane.check.repaired' : 'pane.check.refusedRound',
          params,
        ),
        dim,
      ),
    );
  }
  return lines;
}

/**
 * The self-check of the panel: its title and count, then each scenario. A scenario whose preview of a
 * step is open shows that preview alone, as the other lists of the panel do.
 */
export function selfCheckBlock(
  facts: SelfCheckFacts,
  views: Readonly<Record<string, ListView>>,
  t: Translator,
  ctx: { readonly width: number; readonly hotkeys: boolean },
): CheckNode[] {
  const done = facts.scenarios.filter((item) => !isInFlight(item.status)).length;
  const title =
    facts.environment === undefined
      ? t('pane.check.titleBare')
      : t('pane.check.title', { environment: facts.environment });
  // A preview shows its scenario alone; an open key the view no longer holds draws the list.
  const open = facts.scenarios.findIndex((_, index) => {
    const key = views[checkListId(index)]?.open;
    return key !== undefined && checkEntryKeys(facts, index).includes(key);
  });
  const shown = facts.scenarios.flatMap((item, index) =>
    open < 0 || open === index ? [[item, index] as const] : [],
  );
  return [
    row([
      text(title, { bold: true }),
      text(t('pane.check.count', { done, total: facts.scenarios.length }), dim),
    ]),
    ...shown.flatMap(([item, index]) => [
      blank,
      ...scenarioBlock(item, index, views[checkListId(index)] ?? EMPTY_VIEW, t, ctx),
    ]),
  ];
}
