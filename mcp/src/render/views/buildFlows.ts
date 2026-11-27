// View of the `flows_generate_*` tools: how many flows are ready (the first in full when it is the
// first flow of the project or the only one, the rest on one line), what failed and whether trying again can
// help, and the questions the generator left. Every text that came from LoadCraft or a model (flow
// names, error texts) is made one plain line first, so it cannot add a line of its own to the view.

import type { Translator } from '../../context.js';
import type { FlowOutline } from '../../flow/outline.js';
import { inline, num, VIEW_WIDTH, wrap } from '../primitives.js';
import { renderFlowList, renderFlowOutline } from './flowOutline.js';
import {
  isDefinite,
  itemLines,
  nextStepLines,
  quoteAll,
  type FlowQuestionView,
} from './flowQuestions.js';

export type { FlowQuestionView };

/** Why a proposal has no flow: the text of the backend is never shown (it can quote anything). */
export type FailureReason =
  | 'not_created'
  | 'no_result'
  | 'unreadable'
  /** LoadCraft refused the journey as too large for the model; a second try fails the same way. */
  | 'too_large'
  /** LoadCraft refused the journey for a reason a second try does not change. */
  | 'refused'
  /** The flow LoadCraft generated failed its own checks; `category` says which kind. */
  | 'validation';

/** The kind of check a `validation` failure is about. */
export type FailureCategory = 'auth';

export interface FailedFlow {
  readonly name: string;
  /** What the plugin found out; absent when the run only said that it failed. */
  readonly reason?: FailureReason;
  /** Only with `validation`: the kind of check that failed, when the plugin can tell. */
  readonly category?: FailureCategory;
  /** The failure can go away on a second try. */
  readonly retryable?: boolean;
}

export interface BuildFlowsData {
  /** Outlines of the flows that exist, in the order of the proposals. */
  readonly built: readonly FlowOutline[];
  readonly questions: readonly FlowQuestionView[];
  readonly failed: readonly FailedFlow[];
  /**
   * `full`: the first flow with every step; `lines`: every flow on one line; `single`: the one flow
   * built by hand, with every step under its own header.
   */
  readonly lead: 'full' | 'lines' | 'single';
  /** Flows of the project when the new name was not checked against all of them (`single`). */
  readonly uncheckedFlows?: number;
  /** `single_journey`: a split was asked for, but the recording holds one journey only. */
  readonly note?: 'single_journey';
  /** Present when the flow was regenerated (`flows_regenerate`): the version it had and the one it has. */
  readonly regenerated?: { readonly previous_version: number; readonly version: number };
}

const INDENT = '  ';
const ITEM_SEPARATOR = ' · ';
/** An error text longer than this is cut. */
const MAX_NAME = 80;
const MAX_QUESTIONS = 10;
const MAX_STEPS = 5;

/** What went wrong, as far as the plugin knows. */
function detailOf(failure: FailedFlow, t: Translator): string | undefined {
  if (failure.reason === undefined) return undefined;
  const suffix =
    failure.reason === 'validation' && failure.category !== undefined ? `_${failure.category}` : '';
  return t(`build.flows.reason.${failure.reason}${suffix}`);
}

/** `name: what went wrong`, for a message that lists failures. */
export function failureSummary(failure: FailedFlow, t: Translator): string {
  const detail = detailOf(failure, t);
  const name = inline(failure.name, MAX_NAME);
  return detail === undefined ? name : `${name}: ${detail}`;
}

function failureLines(failure: FailedFlow, t: Translator): string[] {
  const key = failure.retryable === true ? 'build.flows.failedRetry' : 'build.flows.failed';
  const detail = detailOf(failure, t);
  return [
    t(key, { name: inline(failure.name, MAX_NAME) }),
    ...(detail === undefined
      ? []
      : wrap(detail, VIEW_WIDTH - INDENT.length).map((line) => INDENT + line)),
  ];
}

function questionLines(data: BuildFlowsData, t: Translator): string[] {
  const shown = data.questions.slice(0, MAX_QUESTIONS);
  const lines = shown.flatMap((item) => itemLines(item, t));
  const more = data.questions.length - shown.length;
  return [
    ...(more > 0 ? [...lines, INDENT + t('status.more', { count: num(more, t.locale) })] : lines),
    ...nextStepLines(data.questions, t),
  ];
}

/** First line of a result with a flow that gets 401: it says so before the list of flows. */
function warningLines(data: BuildFlowsData, t: Translator): string[] {
  const flows = [...new Set(data.questions.filter(isDefinite).map((item) => item.flow))];
  return flows.length === 0
    ? []
    : wrap(
        t('build.flows.warning', { flows: quoteAll(flows, MAX_STEPS) }),
        VIEW_WIDTH,
        INDENT.length,
      );
}

function builtLines(data: BuildFlowsData, t: Translator): string[] {
  const outlines = data.built.map((outline) => ({
    ...outline,
    name: inline(outline.name, MAX_NAME),
  }));
  const count = outlines.length;
  const [only] = outlines;
  if (data.lead === 'single' && only !== undefined) {
    const [, ...steps] = renderFlowOutline(only, t, { mode: 'full' }).split('\n');
    return [
      t('build.flows.single', {
        name: only.name,
        steps: t.plural('common.steps', only.stepCount),
        requests: t.plural('common.requests', only.requestCount),
        pauses: t.plural('common.pauses', only.pauseCount),
      }),
      ...steps,
    ];
  }
  const ready =
    data.failed.length === 0
      ? t.plural('flow.list.ready', count)
      : t.plural('build.flows.partial', count, { total: count + data.failed.length });
  if (data.lead === 'full') {
    // The list draws its own header; only the lines under it are kept.
    return [ready, ...renderFlowList(outlines, t).split('\n').slice(1)];
  }
  const items = outlines.map((outline) =>
    t('build.flows.item', {
      name: outline.name,
      steps: t.plural('common.steps', outline.stepCount),
    }),
  );
  return wrap([ready, ...items].join(ITEM_SEPARATOR), VIEW_WIDTH, INDENT.length);
}

function retryLines(data: BuildFlowsData, t: Translator): string[] {
  const names = data.failed
    .filter((failure) => failure.retryable === true)
    .map((failure) => `"${inline(failure.name, MAX_NAME)}"`);
  return names.length === 0
    ? []
    : wrap(`→ ${t('build.flows.retry', { names: names.join(', ') })}`, VIEW_WIDTH, INDENT.length);
}

/** The advice the failures call for; absent when only the retry line applies. */
export function adviceKey(
  failed: readonly FailedFlow[],
): 'build.advice.too_large' | 'build.advice.auth' | 'build.advice.fix' | undefined {
  if (failed.some((failure) => failure.reason === 'too_large')) return 'build.advice.too_large';
  if (failed.some((failure) => failure.category === 'auth' && failure.retryable !== true)) {
    return 'build.advice.auth';
  }
  return failed.some((failure) => failure.retryable !== true) ? 'build.advice.fix' : undefined;
}

function adviceLines(data: BuildFlowsData, t: Translator): string[] {
  const key = adviceKey(data.failed);
  return key === undefined ? [] : wrap(`→ ${t(key)}`, VIEW_WIDTH, INDENT.length);
}

/** The first line of a regenerated flow, and the way back. */
function regeneratedLines(data: BuildFlowsData, t: Translator): { head: string[]; tail: string[] } {
  const [only] = data.built;
  if (data.regenerated === undefined || only === undefined) return { head: [], tail: [] };
  const { previous_version: previous, version } = data.regenerated;
  return {
    head: [
      t('flows_regenerate.done', {
        name: inline(only.name, MAX_NAME),
        previous: num(previous, t.locale),
        version: num(version, t.locale),
      }),
    ],
    tail: wrap(
      `→ ${t('flows_regenerate.undo', { previous: num(previous, t.locale) })}`,
      VIEW_WIDTH,
      INDENT.length,
    ),
  };
}

export function renderBuildFlows(data: BuildFlowsData, t: Translator): string {
  const regenerated = regeneratedLines(data, t);
  return [
    ...regenerated.head,
    ...warningLines(data, t),
    ...builtLines(data, t),
    ...data.failed.flatMap((failure) => failureLines(failure, t)),
    ...questionLines(data, t),
    ...regenerated.tail,
    ...retryLines(data, t),
    ...adviceLines(data, t),
    ...(data.note === undefined
      ? []
      : wrap(t(`build.flows.note.${data.note}`), VIEW_WIDTH, INDENT.length)),
    ...(data.uncheckedFlows === undefined
      ? []
      : wrap(
          t('build.flows.unchecked', { total: num(data.uncheckedFlows, t.locale) }),
          VIEW_WIDTH,
          INDENT.length,
        )),
  ].join('\n');
}
