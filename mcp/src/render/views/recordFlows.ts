// View of `flows_record_journeys`: the walk of the approved paths by LoadCraft's browser. While it runs,
// one line per path says where it stands (`zakupy   3/5 · klika: koszyk…`); when the agent asks for
// help, a few lines say what for and where the user steps in. At the end: the browser and the
// address it walked, the live preview, the state of every path, warnings about steps a load test
// cannot pass, and the saved flows with the first one in full. Flows are saved once, at the end,
// so no line calls a path ready before that. Every text that came from LoadCraft or a model (path
// names, labels of the agent's steps, reasons) is made one plain line first.

import type { FlowQuestion } from '../../api/flows.js';
import type { Translator } from '../../context.js';
import type { FlowOutline } from '../../flow/outline.js';
import { inline, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import { renderDescribeFlows, type DescribeFlowsData } from './describeFlows.js';
import { renderFlowOutline } from './flowOutline.js';

// ---- while the walk runs ----------------------------------------------------------------

export type WalkLineState =
  'queued' | 'driving' | 'building' | 'built' | 'retrying' | 'failed' | 'stopped' | 'help';

export interface WalkLine {
  readonly name: string;
  readonly state: WalkLineState;
  /** Step of the plan the agent works on, from 1, with the number of steps of the plan. */
  readonly step?: number;
  readonly steps?: number;
  /** What the agent does now, as LoadCraft wrote it. */
  readonly label?: string;
  /** The attempt that failed and is tried again. */
  readonly attempt?: number;
  /** For `help`: why the agent asks (`captcha`, `second_factor`, `unknown_blocker`). */
  readonly help?: string;
}

export interface WalkProgressData {
  readonly lines: readonly WalkLine[];
  /** The shared sign-in runs before the first path. */
  readonly setup: boolean;
  /** The run still waits for the approval that was sent. */
  readonly awaiting: boolean;
  /** A stop was accepted: the path in progress ends, built paths are saved. */
  readonly stopping: boolean;
}

/** A name longer than this does not fit the column. */
const NAME_COLUMN_MAX = 30;
/** Between the name column and the state. */
const GAP = 3;
const INDENT = '  ';
/** The shortest label kept when the line is tight. */
const MIN_LABEL = 12;

function nameColumn(names: readonly string[]): { names: string[]; width: number } {
  const shown = names.map((name) => inline(name, NAME_COLUMN_MAX));
  return { names: shown, width: Math.max(0, ...shown.map((name) => visibleWidth(name))) };
}

/** `name   text`, the text wrapped under itself when it does not fit. */
function row(name: string, width: number, text: string): string[] {
  const pad = ' '.repeat(width - visibleWidth(name) + GAP);
  const hang = ' '.repeat(width + GAP);
  const [first = '', ...rest] = wrap(text, VIEW_WIDTH - width - GAP);
  return [`${name}${pad}${first}`, ...rest.map((line) => hang + line)];
}

function lineText(line: WalkLine, room: number, t: Translator): string {
  switch (line.state) {
    case 'driving': {
      if (line.label === undefined) return t('record.progress.driving');
      if (line.step !== undefined && line.steps !== undefined && line.steps > 0) {
        const step = Math.min(line.step, line.steps);
        const prefix = visibleWidth(
          t('record.progress.step', { step, steps: line.steps, label: '' }),
        );
        return t('record.progress.step', {
          step,
          steps: line.steps,
          label: inline(line.label, Math.max(MIN_LABEL, room - prefix)),
        });
      }
      const prefix = visibleWidth(t('record.progress.label', { label: '' }));
      return t('record.progress.label', {
        label: inline(line.label, Math.max(MIN_LABEL, room - prefix)),
      });
    }
    case 'retrying':
      return t('record.progress.retrying', { attempt: line.attempt ?? 1 });
    case 'help':
      return t('record.progress.help', { reason: t(helpReasonKey(line.help)) });
    default:
      return t(`record.progress.${line.state}`);
  }
}

const HELP_REASONS: ReadonlySet<string> = new Set(['captcha', 'second_factor', 'unknown_blocker']);

function helpReasonKey(reason: string | undefined): string {
  return `record.help.reason.${reason !== undefined && HELP_REASONS.has(reason) ? reason : 'unknown_blocker'}`;
}

/** Lines of the walk in progress: what the progress notification and an unfinished result show. */
export function renderWalkProgress(data: WalkProgressData, t: Translator): string {
  const lines: string[] = [];
  if (data.lines.length === 0) {
    lines.push(t(data.awaiting ? 'record.progress.awaiting' : 'record.progress.start'));
  } else {
    if (data.setup) lines.push(t('record.progress.setup'));
    const column = nameColumn(data.lines.map((line) => line.name));
    const room = VIEW_WIDTH - column.width - GAP;
    data.lines.forEach((line, index) => {
      lines.push(...row(column.names[index] ?? '', column.width, lineText(line, room, t)));
    });
  }
  if (data.stopping) lines.push(...wrap(t('record.progress.stopping')));
  return lines.join('\n');
}

export interface HelpRequestData {
  /** The path whose agent asks. */
  readonly name: string;
  /** `captcha` | `second_factor` | `unknown_blocker`. */
  readonly reason: string;
  /** The agent's own sentence. */
  readonly agentSays: string | null;
}

/** What the agent asks for and where the user steps in: the text of a `needs_user` result. */
export function renderHelpRequest(data: HelpRequestData, t: Translator): string {
  return [
    ...wrap(
      t('record.help.ask', {
        name: inline(data.name, NAME_COLUMN_MAX),
        reason: t(helpReasonKey(data.reason)),
      }),
    ),
    ...(data.agentSays === null || inline(data.agentSays) === ''
      ? []
      : wrap(
          t('record.help.says', { text: inline(data.agentSays, 200) }),
          VIEW_WIDTH,
          INDENT.length,
        )),
    ...wrap(t('record.help.how')),
  ].join('\n');
}

/** Path names an unapproved plan lists. */
const PENDING_NAMES = 10;

export interface ApprovalPendingData {
  /** The plan handle (`r-xxxxxxxx`). */
  readonly plan: string;
  /** Names of the paths of the plan, in its order. */
  readonly names: readonly string[];
}

/** A plan nobody approved yet, with its paths: the text of a `needs_user` result. */
export function renderApprovalPending(data: ApprovalPendingData, t: Translator): string {
  const shown = data.names.slice(0, PENDING_NAMES).map((name) => inline(name, NAME_COLUMN_MAX));
  const more = data.names.length - shown.length;
  const names =
    more > 0
      ? t('record.unknownPaths.more', { names: shown.join(', '), count: more })
      : shown.join(', ');
  return [
    ...wrap(t('record.approvalPending', { plan: inline(data.plan, 20) })),
    ...(shown.length === 0 ? [] : wrap(t('record.approvalPending.paths', { names }))),
  ].join('\n');
}

/** The next step of an unapproved plan: `flows_record_journeys` approves it, `process_wait` would say the same. */
export function approvalPendingNext(plan: string, t: Translator): string {
  return t('record.approvalPending.next', { plan: inline(plan, 20) });
}

// ---- the end of the walk ----------------------------------------------------------------

/** A step a load test cannot pass: the agent met it on the path. */
export type ObstacleKind = 'captcha' | 'second_factor' | 'one_time_code' | 'payment';

export interface WalkedPath {
  readonly name: string;
  /**
   * `saved`: a flow of the path exists; `partial`: it exists and stops short of the end of the
   * journey; `failed`, `not_driven` (an earlier path it continues never reached its goal),
   * `stopped` (a stop ended it), `unfinished` (the run ended before the path).
   */
  readonly status: 'saved' | 'partial' | 'failed' | 'not_driven' | 'stopped' | 'unfinished';
  /** Steps of the saved flow. */
  readonly steps?: number;
  /** Why it failed, or what the walk did not carry out, as LoadCraft wrote it. */
  readonly reason: string | null;
  /** Attempts the path took. */
  readonly attempts: number;
  readonly obstacles: readonly ObstacleKind[];
}

export interface RecordFlowsData {
  /** The run walked its paths: tells this data from the plan of `flows_describe_journeys`. */
  readonly walked: true;
  /** Host of the address the browser opened. */
  readonly host: string | null;
  /** The run in LoadCraft: live preview and taking over the browser. */
  readonly link: string;
  readonly paths: readonly WalkedPath[];
  /** Outlines of the saved flows, in the order of the paths. */
  readonly saved: readonly FlowOutline[];
  /** Gaps the generator left on the first saved flow. */
  readonly questions: readonly FlowQuestion[];
  /** The run ended badly after saving some flows: its status and LoadCraft's reason. */
  readonly ended?: { readonly status: string; readonly detail: string | null };
}

/** Longest reason taken into a line. */
const MAX_REASON = 160;

function reasonOf(path: WalkedPath): string | undefined {
  const text = path.reason === null ? '' : inline(path.reason, MAX_REASON);
  return text === '' ? undefined : text;
}

function statusText(path: WalkedPath, t: Translator): string {
  const reason = reasonOf(path);
  const steps = t.plural('common.steps', path.steps ?? 0);
  switch (path.status) {
    case 'saved':
      return t('record.path.saved', { steps });
    case 'partial':
      return reason === undefined
        ? t('record.path.partial', { reason: steps })
        : t('record.path.partial', { reason });
    case 'failed': {
      if (path.attempts === 0) {
        return reason === undefined
          ? t('record.path.failedPlain')
          : t('record.path.failedPlainReason', { reason });
      }
      const attempts = t.plural('record.attempts', path.attempts);
      return reason === undefined
        ? t('record.path.failed', { attempts })
        : t('record.path.failedReason', { attempts, reason });
    }
    case 'not_driven':
      return reason === undefined
        ? t('record.path.notDriven')
        : t('record.path.notDrivenReason', { reason });
    case 'stopped':
      return reason === undefined
        ? t('record.path.stopped')
        : t('record.path.stoppedReason', { reason });
    case 'unfinished':
      return t('record.path.unfinished');
  }
}

function obstacleLines(data: RecordFlowsData, t: Translator): string[] {
  return data.paths.flatMap((path) =>
    path.obstacles.length === 0
      ? []
      : wrap(
          t('record.obstacle', {
            name: inline(path.name, NAME_COLUMN_MAX),
            obstacles: path.obstacles.map((kind) => t(`record.obstacle.${kind}`)).join(', '),
          }),
          VIEW_WIDTH,
          INDENT.length,
        ),
  );
}

function savedLines(data: RecordFlowsData, t: Translator): string[] {
  const [first] = data.saved;
  if (first === undefined) return [t('record.savedNone')];
  return [
    t.plural('record.saved', data.saved.length),
    ...renderFlowOutline(first, t, { mode: 'full', questions: data.questions }).split('\n'),
  ];
}

export function renderRecordFlows(data: RecordFlowsData, t: Translator): string {
  const host = data.host === null ? '' : inline(data.host, 60);
  const lines = [
    host === '' ? t('record.browser.noHost') : t('record.browser', { host }),
    `↗ ${t('link.describeRun')}: ${inline(data.link)}`,
    `${INDENT}${t('record.takeOver')}`,
  ];
  const column = nameColumn(data.paths.map((path) => path.name));
  data.paths.forEach((path, index) => {
    lines.push(...row(column.names[index] ?? '', column.width, statusText(path, t)));
  });
  lines.push(...obstacleLines(data, t));
  if (data.paths.some((path) => path.status === 'partial')) {
    lines.push(...wrap(t('record.partialHelp'), VIEW_WIDTH, INDENT.length));
  }
  if (data.ended !== undefined) {
    const detail = data.ended.detail === null ? '' : inline(data.ended.detail, MAX_REASON);
    lines.push(
      ...wrap(
        t('record.ended', {
          status: inline(data.ended.status),
          detail: detail === '' ? t('describe.failed.noDetail') : detail,
        }),
        VIEW_WIDTH,
        INDENT.length,
      ),
    );
  }
  lines.push(...savedLines(data, t));
  return lines.join('\n');
}

/** Data of a `record_run` operation: the plan, or the walk once it was approved. */
export type RecordRunData = DescribeFlowsData | RecordFlowsData;

function isWalked(data: RecordRunData): data is RecordFlowsData {
  return 'walked' in data;
}

/** The view of a `record_run` operation: the plan (`flows_describe_journeys`) or the walk (`flows_record_journeys`). */
export function renderRecordRun(data: RecordRunData, t: Translator): string {
  return isWalked(data) ? renderRecordFlows(data, t) : renderDescribeFlows(data, t);
}
