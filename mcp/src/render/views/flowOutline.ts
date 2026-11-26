// View of a flow outline: the numbered steps of the LoadCraft Outline screen as text. One renderer
// for `flows_get`, the `flows_generate_*` tools and `flows_record_journeys`. A pause names where its
// value came from and, for a person's pause, the class of the action that follows it: the backend
// does not record what the person does there, so the view never says it.

import type { Translator } from '../../context.js';
import type { FlowQuestion } from '../../api/flows.js';
import type { ActionClass, FlowOutline, OutlineStep } from '../../flow/outline.js';
import { itemLines, nextStepLines, type FlowQuestionView } from './flowQuestions.js';
import { columns, decimal, inline, VIEW_WIDTH, visibleWidth } from '../primitives.js';

export interface OutlineViewOptions {
  /** `full`: header and every step; `line`: name and step count only. */
  readonly mode: 'full' | 'line';
  /** Gaps the generator left on the flow; listed under a full outline. */
  readonly questions?: readonly FlowQuestion[];
}

/** The step column is at least this wide, so short outlines look the same as long ones. */
const WHERE_WIDTH = 21;
/** Nesting indent per level, in the step column. */
const INDENT = '  ';
/** Between two one-line flows on one line. */
const LINE_GAP = '     ';

/** Names that came from the backend, each on one line, joined. */
const joined = (names: readonly string[]): string => names.map((name) => inline(name)).join(', ');

function secondsOf(milliseconds: number, t: Translator): string {
  const value = milliseconds / 1000;
  return decimal(value, Number.isInteger(value) ? 0 : 1, t.locale);
}

function pauseWhere(step: OutlineStep, t: Translator): string {
  const { minMs = 0, maxMs = 0 } = step.pause ?? {};
  return minMs === maxMs
    ? t('flow.outline.exact', { value: secondsOf(minMs, t) })
    : t('flow.outline.range', { min: secondsOf(minMs, t), max: secondsOf(maxMs, t) });
}

/** The action class of the next request, as a word; an API call is no action of a person. */
function classWord(actionClass: ActionClass | undefined, t: Translator): string | undefined {
  return actionClass === undefined || actionClass === 'api_call'
    ? undefined
    : t(`flow.outline.class.${actionClass}`);
}

function pauseNotes(step: OutlineStep, t: Translator): string {
  const { source = 'unknown', actionClass } = step.pause ?? {};
  const sourceWord = t(`flow.outline.source.${source}`);
  const person = source === 'machine_wait' ? undefined : classWord(actionClass, t);
  return person === undefined
    ? sourceWord
    : t('flow.outline.sourceClass', { source: sourceWord, class: person });
}

function requestNotes(step: OutlineStep, t: Translator): string {
  const notes: string[] = [];
  if (step.uses.length > 0) notes.push(t('flow.outline.uses', { names: joined(step.uses) }));
  if (step.produces.length > 0) {
    notes.push(t('flow.outline.produces', { names: joined(step.produces) }));
  }
  if (step.expectedStatuses.length > 0) {
    notes.push(t('flow.outline.statuses', { statuses: step.expectedStatuses.join(' · ') }));
  }
  return notes.join(' · ');
}

function row(step: OutlineStep, t: Translator): string[] {
  const indent = INDENT.repeat(step.depth);
  if (step.kind === 'pause') {
    return [step.num, 'PAUSE', indent + pauseWhere(step, t), pauseNotes(step, t)];
  }
  const method = inline(
    step.kind === 'request' ? (step.method ?? '') : step.blockType.toUpperCase(),
  );
  const where = inline(step.kind === 'request' ? (step.path ?? '') : step.name);
  return [step.num, method, indent + where, requestNotes(step, t)];
}

function header(outline: FlowOutline, t: Translator): string {
  return t('flow.outline.header', {
    name: inline(outline.name),
    steps: t.plural('common.steps', outline.stepCount),
    requests: t.plural('common.requests', outline.requestCount),
    pauses: t.plural('common.pauses', outline.pauseCount),
  });
}

function stepLines(outline: FlowOutline, t: Translator): string[] {
  const rows = outline.steps.map((step) => {
    const [num = '', method = '', where = '', notes = ''] = row(step, t);
    const padded = where + ' '.repeat(Math.max(0, WHERE_WIDTH - visibleWidth(where)));
    return [num, method, padded, notes];
  });
  return columns(rows, { align: ['right'] }).map((line) => `  ${line}`);
}

export function renderFlowOutline(
  outline: FlowOutline,
  t: Translator,
  options: OutlineViewOptions,
): string {
  if (options.mode === 'line') {
    return t('flow.outline.line', {
      name: inline(outline.name),
      steps: t.plural('common.steps', outline.stepCount),
    });
  }
  const lines = [header(outline, t), ...stepLines(outline, t)];
  if (outline.truncated) {
    lines.push(
      t('flow.outline.truncated', { shown: outline.steps.length, total: outline.stepCount }),
    );
  }
  const questions = (options.questions ?? []).map((item): FlowQuestionView => ({
    flow: outline.name,
    field: item.field,
    question: item.question,
    kind: item.kind,
    why: item.why,
    ...(item.steps === undefined ? {} : { steps: item.steps }),
    ...(item.definite === true ? { definite: true } : {}),
  }));
  for (const item of questions) {
    if (item.kind === 'credential_scheme' || item.kind === 'static_credential') {
      lines.push(...itemLines(item, t));
    } else {
      lines.push(
        t('flow.outline.question', { field: inline(item.field), question: inline(item.question) }),
      );
    }
  }
  lines.push(...nextStepLines(questions, t));
  return lines.join('\n');
}

/** Packs the items into lines of at most `VIEW_WIDTH` columns, `LINE_GAP` between neighbours. */
function packed(items: readonly string[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const item of items) {
    const next = current === '' ? item : current + LINE_GAP + item;
    if (current !== '' && visibleWidth(next) > VIEW_WIDTH) {
      lines.push(current);
      current = item;
    } else {
      current = next;
    }
  }
  return current === '' ? lines : [...lines, current];
}

/** Several flows: how many, the first in full, the rest as one-line items. */
export function renderFlowList(outlines: readonly FlowOutline[], t: Translator): string {
  const [first, ...rest] = outlines;
  if (first === undefined) return t.plural('flow.list.ready', 0);
  return [
    t.plural('flow.list.ready', outlines.length),
    renderFlowOutline(first, t, { mode: 'full' }),
    ...packed(rest.map((outline) => renderFlowOutline(outline, t, { mode: 'line' }))),
  ].join('\n');
}
