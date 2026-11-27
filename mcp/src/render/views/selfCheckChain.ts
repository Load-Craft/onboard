// The request chain of a self-check, drawn for every scenario that was checked: one block per
// scenario, its name in a column of its own, then `step ✓ → step ✓ → step ✕ request`, the AI repair
// rounds and how it ended. Shared by `scenario_check_self` and `scenario_generate`, which both end with the
// same checks; each adds its own lines around the chain (`renderSelfCheckHeader` is the line that
// says where the requests went).

import type { Translator } from '../../context.js';
import { inline, seconds, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import { slotRef } from '../slotRef.js';
import { quotedBody, unshownBody, type BodyView } from './failures.js';

/** A request of the chain, in the order the run made them. */
export interface CheckStep {
  /** Name of the request as the run recorded it (`logowanie`, or `POST /auth/login`). */
  readonly name: string;
  readonly ok: boolean;
  /** The failing request as the check names it, when the step failed. */
  readonly failedRequest: string | null;
}

/** A step of a run as the backend lists it: in the order the run made it, `not_run` for a plan step it never sent. */
export interface CheckRunStepView {
  readonly name: string;
  readonly group?: string | null;
  readonly planIndex?: number | null;
  readonly isPreflight: boolean;
  readonly method?: string | null;
  readonly path?: string | null;
  readonly result: 'ok' | 'failed' | 'not_run';
  readonly httpStatus: number | null;
  readonly reason: string | null;
}

/** One run of the scenario in a check: the first pass, or the run of a version a repair wrote. */
export interface CheckRunView {
  readonly executionId?: string;
  readonly version: number | null;
  /** The verdict of the run; absent while it runs. */
  readonly status: string | null;
  readonly steps: readonly CheckRunStepView[];
  /** Steps the backend left out of `steps`. */
  readonly stepsOmitted: number;
}

export interface CheckRepairView {
  /** Number of the round, from 1. */
  readonly round?: number | null;
  /** What the AI changed; absent when the round says nothing about it. */
  readonly changes: string | null;
  /** Why the round was refused, in the model's words; the scenario did not change then. */
  readonly refused: string | null;
  /** The refusal as one sentence for a person; the view prefers it to `refused`. */
  readonly refusedMessage?: string | null;
  /** The refusal as a code; it is data for a reader that wants it, not drawn. */
  readonly refusedCode?: string | null;
  /** The scenario version the round saved. */
  readonly version: number | null;
  /** The verdict of the run of that version. */
  readonly verdict?: string | null;
}

/** One scenario's check, as the view draws it; every status LoadCraft knows has its own text. */
export interface ScenarioCheck {
  readonly name: string;
  readonly status: string;
  /**
   * The chain of the run read from the metrics store: the first pass when the AI repaired, the last run
   * otherwise. Drawn only when `runs` is empty (a check stored before the backend listed its runs).
   */
  readonly steps: readonly CheckStep[];
  /** Every run of the check, oldest first, each with its steps in the order they ran. */
  readonly runs?: readonly CheckRunView[];
  /** The limit of repair rounds; absent when the backend does not say. */
  readonly maxRepairRounds?: number | null;
  /** Requests and their total response time in the last run; 0 when the run left no samples. */
  readonly requests: number;
  readonly responseMs: number;
  readonly failure: {
    readonly request: string | null;
    readonly message: string | null;
    readonly httpStatus?: number | null;
    readonly goalUrl: string | null;
  } | null;
  /** Codes LoadCraft attached (`not_admitted` names why here). */
  readonly notes: readonly string[];
  readonly missingSlots: readonly { readonly slot: string; readonly label: string }[];
  readonly repairs: readonly CheckRepairView[];
  /**
   * Every run of a failed check, oldest first: what each attempt got back. Absent in data of an
   * older shape, which is drawn as before.
   */
  readonly attempts?: readonly CheckAttemptView[];
}

/** One run of a failed check: the version it ran, the request that failed and its answer. */
export interface CheckAttemptView {
  /** Short handle of the run (`e-1a2b3c4d`), what `results_get_traces` takes. */
  readonly run: string;
  /** The scenario version the run checked; `null` when LoadCraft does not say. */
  readonly version: number | null;
  /** The failing request as the check names it, or as the trace recorded it. */
  readonly request: string | null;
  /** Why the run failed, in the words of the check. */
  readonly message: string | null;
  /** Whether the trace store held the failed request of the run. */
  readonly recorded: boolean;
  readonly status: number | null;
  /** The answer of the failed request, masked (or hidden whole); `null` when it had none. */
  readonly response: BodyView | null;
}

export interface SelfCheckChainView {
  readonly scenarios: readonly ScenarioCheck[];
}

const GAP = 2;
/** The longest answer an attempt shows; `results_get_traces` gives it whole. */
const RESPONSE_LIMIT = 160;
/** Scenario names longer than this are cut in the name column. */
const NAME_MAX = 24;
const MESSAGE_LIMIT = 200;
const SEPARATOR = ' · ';

/** `POST /auth/login` → `login`: the last segment of the path names the step. */
const REQUEST_NAME = /^[A-Z]+ \/(\S*)$/u;

function stepLabel(name: string): string {
  const path = REQUEST_NAME.exec(name)?.[1]?.split('?')[0] ?? '';
  const last = path
    .split('/')
    .filter((segment) => segment !== '')
    .at(-1);
  return last ?? name;
}

/** Text from the run or a model, on one line and cut to `limit` characters. */
const cut = (text: string, limit: number): string => inline(text, limit);

const shortName = (name: string): string => inline(name, NAME_MAX);

function segmentOf(step: CheckStep): string {
  const label = stepLabel(inline(step.name));
  const failed = step.failedRequest === null ? null : inline(step.failedRequest);
  const suffix = !step.ok && failed !== null && failed !== label ? ` ${failed}` : '';
  return `${label} ${step.ok ? '✓' : '✕'}${suffix}`;
}

/** The segments wrapped to `width`; a line that continues the chain starts with the arrow. */
function segmentLines(segments: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let current = '';
  segments.forEach((segment, index) => {
    const piece = index === 0 ? segment : `→ ${segment}`;
    const joined = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || visibleWidth(joined) <= width) {
      current = joined;
      return;
    }
    lines.push(current);
    current = `→ ${segment}`;
  });
  if (current !== '') lines.push(current);
  // A single step wider than the view still has to fit.
  return lines.flatMap((line) => (visibleWidth(line) <= width ? [line] : wrap(line, width, 2)));
}

/** The chain of a run read from the metrics store, wrapped to `width`. */
function chainLines(steps: readonly CheckStep[], width: number): string[] {
  return segmentLines(steps.map(segmentOf), width);
}

/** `login ✓`, `pay ✕ 422` (the status the step answered), `confirm ○` (a plan step the run never sent). */
function runSegmentOf(step: CheckRunStepView, doubled: ReadonlySet<string>): string {
  const own = stepLabel(inline(step.name));
  // Two steps of one name tell apart by their group.
  const label = doubled.has(own) && step.group ? `${inline(step.group, 40)} / ${own}` : own;
  if (step.result === 'ok') return `${label} ✓`;
  if (step.result === 'failed') {
    return `${label} ✕${step.httpStatus === null ? '' : ` ${String(step.httpStatus)}`}`;
  }
  return `${label} ○`;
}

/** A passing preflight is noise in the chain; a failed one, or one that did not run, is shown. */
const shownStep = (step: CheckRunStepView): boolean => !(step.isPreflight && step.result === 'ok');

/** The first step of the run that failed and says why; `undefined` when none does. */
function failedStepOf(run: CheckRunView): CheckRunStepView | undefined {
  return run.steps.find((step) => step.result === 'failed' && step.reason !== null);
}

function runChainLines(run: CheckRunView, t: Translator, width: number): string[] {
  const shown = run.steps.filter(shownStep);
  const counts = new Map<string, number>();
  for (const step of shown) {
    const label = stepLabel(inline(step.name));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const doubled = new Set([...counts].filter(([, n]) => n > 1).map(([label]) => label));
  const chain = segmentLines(
    shown.map((step) => runSegmentOf(step, doubled)),
    width,
  );
  const omitted =
    run.stepsOmitted > 0 ? wrap(t.plural('selfCheck.stepsOmitted', run.stepsOmitted), width) : [];
  return [...chain, ...omitted];
}

/** `✕ pay 422: <what the run reported>`: the step that failed and why, on a line of its own. */
function stepFailureLines(run: CheckRunView, width: number): string[] {
  const step = failedStepOf(run);
  if (step === undefined) return [];
  const status = step.httpStatus === null ? '' : ` ${String(step.httpStatus)}`;
  const own = stepLabel(inline(step.name));
  const label = step.group ? `${inline(step.group, 40)} / ${own}` : own;
  return wrap(`✕ ${label}${status}: ${cut(step.reason ?? '', MESSAGE_LIMIT)}`, width, 2);
}

/** Appends the totals to the last line of the chain when they fit there, else on a line of their own. */
function withTotals(lines: string[], totals: string, width: number): string[] {
  if (totals === '') return lines;
  const last = lines.at(-1);
  if (last !== undefined && visibleWidth(last) + SEPARATOR.length + visibleWidth(totals) <= width) {
    return [...lines.slice(0, -1), `${last}${SEPARATOR}${totals}`];
  }
  return [...lines, totals];
}

function totalsOf(check: ScenarioCheck, t: Translator): string {
  if (check.requests === 0) return '';
  return [
    t.plural('common.requests', check.requests),
    seconds(check.responseMs / 1000, t.locale),
  ].join(SEPARATOR);
}

/** Why the round was refused: the sentence for a person first, the model's own words only for a state stored before codes. */
const refusalOf = (repair: CheckRepairView): string | null =>
  repair.refusedMessage ?? repair.refused ?? repair.refusedCode ?? null;

/** One round of the AI as the lines under the attempt that led to it. */
function repairBlock(repair: CheckRepairView, t: Translator, width: number): string[] {
  const refusal = refusalOf(repair);
  if (refusal !== null) {
    return wrap(t('selfCheck.repairRefused', { reason: cut(refusal, MESSAGE_LIMIT) }), width);
  }
  const what =
    repair.changes === null
      ? t('selfCheck.repairBare')
      : t('selfCheck.repair', { changes: cut(repair.changes, MESSAGE_LIMIT) });
  const version =
    repair.version === null ? [] : [t('selfCheck.repairVersion', { version: repair.version })];
  return wrap([what, ...version].join(SEPARATOR), width);
}

const roundLines = repairBlock;

function repairLines(check: ScenarioCheck, t: Translator, width: number): string[] {
  return check.repairs.flatMap((repair) => repairBlock(repair, t, width));
}

/** Runs drawn at most: when there are more, the first (what failed) and the last ones (what decided). */
const MAX_RUNS = 4;

/** How a run ended, after its number: `✓`, `✕`, or the verdict as LoadCraft names it. */
function attemptMark(status: string | null): string {
  if (status === null) return '';
  if (status === 'passed' || status === 'passed_after_repair') return ' ✓';
  return status === 'failed' ? ' ✕' : ` ${inline(status)}`;
}

function attemptHeader(
  run: CheckRunView,
  number: number,
  handle: string | undefined,
  t: Translator,
): string {
  const head =
    run.version === null
      ? t('selfCheck.runBare', { n: number })
      : t('selfCheck.run', { n: number, version: run.version });
  const named = handle === undefined ? head : `${head}${SEPARATOR}${inline(handle)}`;
  return `${named}${attemptMark(run.status)}`;
}

/** True when a repair ended in a new version, so a run of that version follows it. */
const wroteVersion = (repair: CheckRepairView): boolean =>
  repair.version !== null && refusalOf(repair) === null;

/**
 * The runs of the check, each one a chain of its steps in the order they ran, with the AI's repair
 * rounds drawn between the run that failed and the run of the version the round wrote. A check with one
 * run draws no header. Runs the backend listed beyond `MAX_RUNS` are named, not drawn, and then the
 * repairs follow the runs.
 */
function runLines(check: ScenarioCheck, t: Translator, width: number): string[] {
  const all = check.runs ?? [];
  const cutRuns = all.length > MAX_RUNS;
  const kept = cutRuns ? [all[0], ...all.slice(all.length - (MAX_RUNS - 1))] : all;
  const out: string[] = [];
  let next = 0;
  kept.forEach((run, index) => {
    if (run === undefined) return;
    if (all.length > 1) {
      const number = cutRuns && index > 0 ? all.length - (kept.length - 1 - index) : index + 1;
      if (cutRuns && index === 1) {
        out.push(...wrap(t.plural('selfCheck.attemptsOmitted', all.length - MAX_RUNS), width));
      }
      out.push(...wrap(attemptHeader(run, number, check.attempts?.[number - 1]?.run, t), width));
    }
    out.push(...runChainLines(run, t, width), ...stepFailureLines(run, width));
    // What the target answered to the failed request, read from the trace of this very run.
    const traced = check.attempts?.[all.indexOf(run)];
    if (traced !== undefined) out.push(...responseLines(traced, t, width));
    if (cutRuns) return;
    const last = index === kept.length - 1;
    while (next < check.repairs.length) {
      const repair = check.repairs[next];
      next += 1;
      if (repair === undefined) break;
      out.push(...repairBlock(repair, t, width));
      if (!last && wroteVersion(repair)) break;
    }
  });
  if (cutRuns) out.push(...repairLines(check, t, width));
  return out;
}

/** The chain of the check and its repair rounds: from the runs when the backend listed them, else from the metrics. */
function chainAndRepairs(check: ScenarioCheck, t: Translator, width: number): string[] {
  return (check.runs ?? []).length > 0
    ? runLines(check, t, width)
    : [...chainLines(check.steps, width), ...repairLines(check, t, width)];
}

function notAdmittedReason(check: ScenarioCheck, t: Translator): string {
  const [code] = check.notes;
  if (code !== undefined && t.has(`selfCheck.reason.${code}`)) return t(`selfCheck.reason.${code}`);
  const message = check.failure?.message ?? null;
  return [
    code === undefined ? null : inline(code),
    message === null ? null : cut(message, MESSAGE_LIMIT),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' — ');
}

function detail(sentence: string, text: string | null, width: number): string[] {
  return wrap(
    text === null || text === '' ? sentence : `${sentence}: ${cut(text, MESSAGE_LIMIT)}`,
    width,
  );
}

/** `próba 2 · wersja 2 · e-1a2b3c4d: POST /checkout ✕ · status.find.is(200), found 400` */
function attemptLine(attempt: CheckAttemptView, index: number, t: Translator): string {
  const label = [
    t('selfCheck.attempt', { n: index + 1 }),
    ...(attempt.version === null
      ? []
      : [t('selfCheck.repairVersion', { version: attempt.version })]),
    inline(attempt.run),
  ].join(SEPARATOR);
  const request =
    attempt.request === null ? t('selfCheck.attempt.noRequest') : inline(attempt.request, 120);
  const message =
    attempt.message === null || attempt.message === ''
      ? ''
      : `${SEPARATOR}${cut(attempt.message, MESSAGE_LIMIT)}`;
  return `${label}: ${request} ✕${message}`;
}

/** `  odpowiedź 400: {"error":"…"}`, under the line it belongs to; nothing when nothing was recorded. */
function responseLines(attempt: CheckAttemptView, t: Translator, width: number): string[] {
  if (!attempt.recorded) return [];
  const status = attempt.status === null ? '?' : String(attempt.status);
  const text =
    attempt.response === null
      ? t('selfCheck.attempt.responseBare', { status })
      : t('selfCheck.attempt.response', {
          status,
          body:
            attempt.response.kind === 'shown'
              ? quotedBody(attempt.response.text, RESPONSE_LIMIT, t)
              : unshownBody(attempt.response, t),
        });
  return wrap(text, width - 2, 2).map((line) => `  ${line}`);
}

/** The attempts in order, each followed by the repair it led to. */
function attemptLines(
  check: ScenarioCheck,
  attempts: readonly CheckAttemptView[],
  t: Translator,
  width: number,
): string[] {
  const drawn = attempts.flatMap((attempt, index) => {
    const repair = check.repairs[index];
    return [
      ...wrap(attemptLine(attempt, index, t), width, 2),
      ...responseLines(attempt, t, width),
      ...(repair === undefined ? [] : roundLines(repair, t, width)),
    ];
  });
  // A round whose run LoadCraft does not list is still a round of the check.
  const rest = check.repairs
    .slice(attempts.length)
    .flatMap((repair) => roundLines(repair, t, width));
  return [...drawn, ...rest];
}

/** Where the requests of the attempts are read in full. */
function detailLines(check: ScenarioCheck, t: Translator, width: number): string[] {
  const last = check.attempts?.at(-1);
  if (check.status !== 'failed' || last === undefined) return [];
  const key = check.repairs.length > 0 ? 'selfCheck.detailsAttempts' : 'selfCheck.details';
  return wrap(t(key, { run: inline(last.run) }), width);
}

function finalFailure(
  check: ScenarioCheck,
  hasChain: boolean,
  t: Translator,
  width: number,
): string[] {
  const failure = check.failure;
  const message = failure?.message ?? null;
  // The last run names the failed step and its reason on its own line; the message would say it again.
  const lastRun = (check.runs ?? []).at(-1);
  const said = lastRun !== undefined && failedStepOf(lastRun) !== undefined;
  // Without a chain the request is the only place the reader learns what failed.
  const reason =
    !hasChain && failure?.request
      ? [failure.request, message].filter((part): part is string => part !== null).join(': ')
      : message;
  if (check.repairs.length > 0) {
    const repairs = t.plural('selfCheck.repairCount', check.repairs.length);
    return detail(`${t('selfCheck.failed')} ${repairs}`, said ? null : reason, width);
  }
  if (!hasChain) return detail(t('selfCheck.failed'), reason, width);
  return said || reason === null || reason === '' ? [] : wrap(cut(reason, MESSAGE_LIMIT), width);
}

/** Statuses whose line names no next move by itself; the hint says what to do about them. */
const HINTED: ReadonlySet<string> = new Set([
  'failed',
  'waiting_for_data',
  'goal_step_missing',
  'target_unreachable',
  'not_admitted',
  'skipped_protected_environment',
]);

function bodyLines(check: ScenarioCheck, t: Translator, width: number): string[] {
  const lines = statusLines(check, t, width);
  return HINTED.has(check.status)
    ? [
        ...lines,
        ...wrap(t(`selfCheck.next.${check.status}`), width),
        ...detailLines(check, t, width),
      ]
    : lines;
}

/** A failed check whose attempts are known: each attempt, its answer and the repair after it. */
function failedLines(
  check: ScenarioCheck,
  chain: readonly string[],
  attempts: readonly CheckAttemptView[],
  t: Translator,
  width: number,
): string[] {
  if (check.repairs.length === 0) {
    return [
      ...chain,
      ...finalFailure(check, chain.length > 0, t, width),
      ...attempts.flatMap((attempt) => responseLines(attempt, t, width)),
    ];
  }
  const repairs = t.plural('selfCheck.repairCount', check.repairs.length);
  return [
    ...chain,
    ...attemptLines(check, attempts, t, width),
    ...wrap(`${t('selfCheck.failed')} ${repairs}`, width),
  ];
}

function statusLines(check: ScenarioCheck, t: Translator, width: number): string[] {
  const listed = (check.runs ?? []).length > 0;
  // With the runs the chain is every run (and the repairs between them); without, the one run of the metrics.
  const chain = listed ? runLines(check, t, width) : chainLines(check.steps, width);
  const totals = totalsOf(check, t);
  switch (check.status) {
    case 'passed':
      return chain.length === 0
        ? wrap(
            [t('selfCheck.passedNoChain'), ...(totals === '' ? [] : [totals])].join(SEPARATOR),
            width,
          )
        : withTotals(chain, totals, width);
    case 'goal_step_missing': {
      const goal = check.failure?.goalUrl ?? null;
      const sentence =
        goal === null
          ? t('selfCheck.goal_step_missing')
          : t('selfCheck.goal_step_missingAt', { goal: inline(goal) });
      return [...withTotals(chain, totals, width), ...wrap(sentence, width)];
    }
    case 'passed_after_repair': {
      const repairs = t.plural('selfCheck.repairCount', check.repairs.length);
      const done = [`✓ ${repairs}`, ...(totals === '' ? [] : [totals])].join(SEPARATOR);
      return [...chainAndRepairs(check, t, width), ...wrap(done, width)];
    }
    case 'failed':
      // A check stored before the backend listed its runs is drawn from its traces; one with runs, from the runs.
      return !listed && check.attempts !== undefined && check.attempts.length > 0
        ? failedLines(check, chain, check.attempts, t, width)
        : [...chainAndRepairs(check, t, width), ...finalFailure(check, chain.length > 0, t, width)];
    case 'waiting_for_data':
      return check.missingSlots.length === 0
        ? [t('selfCheck.waiting_for_dataBare')]
        : wrap(
            t('selfCheck.waiting_for_data', {
              slots: check.missingSlots.map((item) => slotRef(item.label, item.slot, t)).join(', '),
            }),
            width,
          );
    case 'target_unreachable':
      return detail(t('selfCheck.target_unreachable'), check.failure?.message ?? null, width);
    case 'not_admitted':
      return wrap(t('selfCheck.not_admitted', { reason: notAdmittedReason(check, t) }), width);
    case 'interrupted':
    case 'repairing':
      // The steps that ran before it stopped, and the one that failed, are still worth showing.
      return [
        ...(listed ? runLines(check, t, width) : []),
        ...wrap(t(`selfCheck.${check.status}`), width),
      ];
    case 'skipped_protected_environment':
    case 'disabled':
    case 'pending':
    case 'running':
      return wrap(t(`selfCheck.${check.status}`), width);
    default:
      return wrap(t('selfCheck.other', { status: inline(check.status) }), width);
  }
}

/** The line that says where the requests of a self-check went and how many users sent them. */
export function renderSelfCheckHeader(environment: string | null, t: Translator): string {
  return environment === null
    ? t('selfCheck.headerNoEnvironment')
    : t('selfCheck.header', { environment: inline(environment) });
}

/** One block per scenario; the scenario names share one column. */
export function renderSelfCheckChain(view: SelfCheckChainView, t: Translator): string {
  const names = view.scenarios.map((check) => shortName(check.name));
  const column = Math.max(0, ...names.map(visibleWidth)) + GAP;
  const width = VIEW_WIDTH - column;
  const indent = ' '.repeat(column);
  return view.scenarios
    .flatMap((check, index) => {
      const name = names[index] ?? check.name;
      const body = bodyLines(check, t, width);
      return (body.length === 0 ? [''] : body).map(
        (line, row) => (row === 0 ? name + ' '.repeat(column - visibleWidth(name)) : indent) + line,
      );
    })
    .map((line) => line.trimEnd())
    .join('\n');
}
