// The walk of a plan: the second part of a run "from a description" (`flows_record_journeys`). LoadCraft's
// browser walks the approved paths one after another, builds a flow of each, and saves the flows
// once, at the end. The approval itself is a message on the run's channel (`split_resume`); the
// channel sends the proposal again to every new socket while the run waits for it, so the answer
// goes on the socket that hears the question, and a socket that connects to a walk already under
// way is told where it stands (`drive_snapshot`) and asked nothing.
//
// The state comes from the channel's frames, and through REST when the channel fails: the state of
// the run and its paths (`GET …/runs/{id}`), and the help the agent asked for (`GET …/timeline`).
// Nothing here writes when it only reads: the approval is sent only to a run that asks for it, and
// only by the call that carries it (`flows_record_journeys`); the saved data says the walk was approved once
// the socket took the approval or the walk was seen under way, and a `process_wait` never sends it.
//
// The agent asks the user for help (a one-time code, a CAPTCHA) only while the creator of the run
// watches the live preview in the app; this server never connects to that preview.

import * as z from 'zod';

import {
  cancelDescribeRun,
  getDescribeRun,
  getRunTimeline,
  stopRun,
  type DescribeRun,
  type RunEvent,
  type RunPath,
} from '../api/describe.js';
import type { FlowQuestion } from '../api/flows.js';
import type { ToolContext, Translator } from '../context.js';
import { ToolError } from '../errors.js';
import { withheldJobText } from '../http/errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import type { NeedsUser, OperationContext } from '../ops/operation.js';
import { pollUntil } from '../ops/poll.js';
import type { DoneOutcome, OperationProgress } from '../outcome.js';
import { inline } from '../render/primitives.js';
import {
  approvalPendingNext,
  renderApprovalPending,
  renderHelpRequest,
  renderWalkProgress,
  type ObstacleKind,
  type RecordFlowsData,
  type WalkedPath,
  type WalkLine,
} from '../render/views/recordFlows.js';
import type { ClientMessage } from '../ws/channel.js';
import { ChannelLost, ChannelUnavailable } from '../ws/channel.js';
import type { ParsedFrame } from '../ws/frames.js';
import { readBuilt } from './flows/fromSuggestions.js';
import { content } from './moduleCall.js';

/**
 * What `flows_record_journeys` saves with the run: the paths it follows and the plan it shows progress by.
 * The approval itself (the paths to send) is never saved: only the call that carries it sends it.
 */
export const walkSavedSchema = z.object({
  /** Names of the approved paths, in the order of the plan. */
  names: z.array(z.string()),
  /** Steps of the plan of every proposed path, by name: the `3/5` of the progress. */
  steps: z.record(z.string(), z.number().int().min(0)),
  /**
   * The socket took the approval, or the walk was seen under way. Until then the entry of the run
   * keeps no walk at all (`walkStored`), so a later call reads the plan, never the walk.
   */
  approved: z.boolean().optional(),
});
export type WalkSaved = z.infer<typeof walkSavedSchema>;

/** The approved paths exactly as the planner wrote them: the body of `split_resume`. */
export type WalkApproval = readonly Readonly<Record<string, unknown>>[];

type PathState = 'queued' | 'driving' | 'building' | 'built' | 'retrying' | 'failed' | 'stopped';

interface LivePath {
  readonly index: number;
  readonly name: string;
  readonly state: PathState;
  /** Step of the plan the agent works on, from 0. */
  readonly planStep?: number;
  readonly label?: string;
  readonly attempt?: number;
}

interface Help {
  readonly pathIndex: number;
  /** `captcha` | `second_factor` | `unknown_blocker`. */
  readonly reason: string;
  readonly agentSays: string | null;
}

type End =
  | { readonly kind: 'complete' }
  | { readonly kind: 'error' | 'interrupted' | 'cancelled'; readonly detail: string | null };

type Refusal = { readonly kind: 'busy' } | { readonly kind: 'denied'; readonly code: string };

export interface WalkState {
  readonly phase: 'walk';
  readonly paths: readonly LivePath[];
  /** The shared sign-in runs before the first path. */
  readonly setup: boolean;
  /** The run waits for the approval of its split (a REST read says so). */
  readonly awaiting: boolean;
  /** The approval went out: on the socket of this call, or of an earlier one (`WalkSaved.approved`). */
  readonly answered: boolean;
  /** The walk was seen under way: a path, a snapshot or a request for help. */
  readonly walking: boolean;
  /** LoadCraft accepted a stop. */
  readonly stopping: boolean;
  /** Steps of the plan of every path, by name (`WalkSaved.steps`). */
  readonly steps: Readonly<Record<string, number>>;
  readonly help?: Help;
  readonly end?: End;
  readonly refusal?: Refusal;
}

/** How long a stop on the channel may take to be answered. */
const STOP_ANSWER_MS = 15_000;
/** The run's row is updated just after its last frame: how long the final read waits for it. */
const SETTLE_MS = 10_000;
const SETTLE_POLL_MS = 1000;
const ENDED: ReadonlySet<string> = new Set([
  'completed',
  'needs_input',
  'failed',
  'cancelled',
  'interrupted',
]);
const FAILED: ReadonlySet<string> = new Set(['failed', 'cancelled', 'interrupted']);

export function walkInitial(walk: WalkSaved): WalkState {
  return {
    phase: 'walk',
    paths: walk.names.map((name, index) => ({ index, name, state: 'queued' })),
    setup: false,
    awaiting: false,
    answered: walk.approved === true,
    walking: false,
    stopping: false,
    steps: walk.steps,
  };
}

// ---- the channel ------------------------------------------------------------------------

/** States of a path in `drive_snapshot`. */
const SNAPSHOT_STATES: Readonly<Record<string, PathState>> = {
  done: 'built',
  driving: 'driving',
  queued: 'queued',
  failed: 'failed',
  stopped: 'stopped',
};

function withPath(
  state: WalkState,
  index: number,
  change: (path: LivePath) => LivePath,
  name?: string,
): WalkState {
  const paths = [...state.paths];
  for (let at = paths.length; at <= index; at += 1) {
    paths.push({ index: at, name: '', state: 'queued' });
  }
  const current = paths[index] ?? { index, name: '', state: 'queued' };
  paths[index] = change(name === undefined || name === '' ? current : { ...current, name });
  // A path past the shared sign-in means the sign-in is done, and the run no longer waits.
  return { ...state, paths, setup: false, awaiting: false, walking: true };
}

/** The browser went back to the agent: it no longer waits for the user. */
function withoutHelp(state: WalkState): WalkState {
  return {
    phase: state.phase,
    paths: state.paths,
    setup: state.setup,
    awaiting: state.awaiting,
    answered: state.answered,
    walking: true,
    stopping: state.stopping,
    steps: state.steps,
    ...(state.end === undefined ? {} : { end: state.end }),
    ...(state.refusal === undefined ? {} : { refusal: state.refusal }),
  };
}

/** Folds one frame of the run's channel into the state of the walk. */
export function reduceWalk(state: WalkState, frame: ParsedFrame<'describe'>): WalkState {
  switch (frame.type) {
    case 'split_proposal':
      // The run waits for the approval: the call that carries it answers on this socket
      // (`respondWalk`), and `sentWalk` notes that the socket took it.
      return state;
    case 'drive_snapshot':
      return {
        ...state,
        awaiting: false,
        walking: true,
        setup: frame.data.setup === 'running',
        paths: frame.data.paths.map((path): LivePath => {
          const before = state.paths[path.path_index];
          const next = SNAPSHOT_STATES[path.state] ?? 'queued';
          return {
            index: path.path_index,
            name: path.name ?? before?.name ?? '',
            state: next,
            ...(next === 'driving' && before?.state === 'driving'
              ? {
                  ...(before.planStep === undefined ? {} : { planStep: before.planStep }),
                  ...(before.label === undefined ? {} : { label: before.label }),
                }
              : {}),
          };
        }),
      };
    case 'path_stage':
      return withPath(state, frame.data.path_index, (path) => ({
        index: path.index,
        name: path.name,
        state: 'building',
        ...(frame.data.attempt === undefined ? {} : { attempt: frame.data.attempt }),
      }));
    case 'agent_step': {
      const { step } = frame.data;
      return withPath(state, step.path_index, (path) => ({
        index: path.index,
        name: path.name,
        state: 'driving',
        label: step.label,
        ...(step.plan_step_index == null ? {} : { planStep: step.plan_step_index }),
        ...(step.attempt == null ? {} : { attempt: step.attempt }),
      }));
    }
    case 'path_done':
      return withPath(
        state,
        frame.data.path_index,
        (path) => ({ index: path.index, name: path.name, state: 'built' }),
        frame.data.path_name,
      );
    case 'path_failed': {
      const { data } = frame;
      return withPath(
        state,
        data.path_index,
        (path) => ({
          index: path.index,
          name: path.name,
          state: data.will_retry ? 'retrying' : 'failed',
          ...(data.attempt === undefined ? {} : { attempt: data.attempt }),
        }),
        data.path_name,
      );
    }
    case 'help_requested':
      return {
        ...state,
        walking: true,
        help: {
          pathIndex: frame.data.path_index,
          reason: frame.data.reason,
          agentSays: frame.data.agent_says ?? null,
        },
      };
    case 'control_returned':
      return withoutHelp(state);
    case 'stop_accepted':
      return { ...state, stopping: true };
    case 'stop_refused':
      return state;
    case 'split_resume_refused':
      return { ...state, refusal: { kind: 'busy' } };
    case 'message_denied':
      return { ...state, refusal: { kind: 'denied', code: frame.data.code } };
    case 'complete':
      return { ...state, end: { kind: 'complete' } };
    case 'error':
      return { ...state, end: { kind: 'error', detail: frame.data.error } };
    case 'cancelled':
      return { ...state, end: { kind: 'cancelled', detail: null } };
    case 'interrupted':
      return { ...state, end: { kind: 'interrupted', detail: frame.data.error ?? null } };
  }
}

/** A name, a label or a sentence of the walk, as it enters the state of the call: masked (FIX-77). */
const shownText = (ctx: ToolContext, text: string): string => content(ctx, text, 200);

/**
 * A frame of the walk with the texts of the planner and the browser agent masked: the names of the
 * paths, the label of a step, the reason and the words of a request for help. The names of the paths
 * of the saved walk are masked the same way (`flows_record_journeys`), so a name still finds its count
 * of steps.
 */
export function acceptWalkFrame(
  ctx: ToolContext,
  frame: ParsedFrame<'describe'>,
): ParsedFrame<'describe'> {
  switch (frame.type) {
    case 'drive_snapshot':
      return {
        ...frame,
        data: {
          ...frame.data,
          paths: frame.data.paths.map((path) =>
            path.name == null ? path : { ...path, name: shownText(ctx, path.name) },
          ),
        },
      };
    case 'agent_step':
      return {
        ...frame,
        data: {
          ...frame.data,
          step: { ...frame.data.step, label: shownText(ctx, frame.data.step.label) },
        },
      };
    case 'path_done':
      return frame.data.path_name === undefined
        ? frame
        : { ...frame, data: { ...frame.data, path_name: shownText(ctx, frame.data.path_name) } };
    case 'path_failed':
      return frame.data.path_name === undefined
        ? frame
        : { ...frame, data: { ...frame.data, path_name: shownText(ctx, frame.data.path_name) } };
    case 'help_requested':
      return {
        ...frame,
        data: {
          ...frame.data,
          reason: shownText(ctx, frame.data.reason),
          ...(frame.data.agent_says == null
            ? {}
            : { agent_says: shownText(ctx, frame.data.agent_says) }),
        },
      };
    default:
      return frame;
  }
}

/**
 * The approval, sent to a run that asks for it: the chosen paths exactly as the planner proposed
 * them. A run that walks already asks nothing, so nothing is sent to it.
 */
export function respondWalk(
  frame: ParsedFrame<'describe'>,
  approval: WalkApproval,
): ClientMessage | undefined {
  if (frame.type !== 'split_proposal' || approval.length === 0) return undefined;
  return { type: 'split_resume', paths: approval.map((path) => ({ ...path })) };
}

/** The socket took the approval. */
export function sentWalk(state: WalkState, message: ClientMessage): WalkState {
  return message.type === 'split_resume' ? { ...state, answered: true } : state;
}

/** The saved data once the walk is known to be approved: from then on it is the walk's entry. */
export function walkAdvance(state: WalkState, walk: WalkSaved): WalkSaved {
  if (walk.approved === true || !(state.answered || state.walking)) return walk;
  return { ...walk, approved: true };
}

// ---- REST -------------------------------------------------------------------------------

const REST_STATES: Readonly<Record<string, PathState>> = {
  queued: 'queued',
  driving: 'driving',
  built: 'built',
  saved: 'built',
  failed: 'failed',
  stopped: 'stopped',
};

function endOf(run: DescribeRun): End | undefined {
  switch (run.status) {
    case 'completed':
    case 'needs_input':
      return { kind: 'complete' };
    case 'failed':
      return { kind: 'error', detail: run.error };
    case 'cancelled':
      return { kind: 'cancelled', detail: run.error };
    case 'interrupted':
      return { kind: 'interrupted', detail: run.error };
    default:
      return undefined;
  }
}

/** The help the agent still waits for: asked, not handed back, and not past its time. */
function pendingHelp(events: readonly RunEvent[], now: number): Help | undefined {
  let help: Help | undefined;
  let expires: number | undefined;
  for (const event of events) {
    if (event.type === 'help_requested') {
      help = { pathIndex: event.pathIndex, reason: event.reason, agentSays: event.agentSays };
      expires = event.expiresAt === null ? undefined : Date.parse(event.expiresAt);
    } else if (event.type === 'control_returned' && event.pathIndex === help?.pathIndex) {
      help = undefined;
    }
  }
  if (help !== undefined && expires !== undefined && Number.isFinite(expires) && expires <= now) {
    return undefined;
  }
  return help;
}

/** The walk rebuilt from REST: when the channel failed, and at the time limit of a call. */
export async function recoverWalk(
  ctx: OperationContext,
  id: string,
  projectId: string,
  walk: WalkSaved,
): Promise<WalkState> {
  const run = await getDescribeRun(ctx, projectId, id);
  const end = endOf(run);
  const events = end === undefined ? await getRunTimeline(ctx, projectId, id) : [];
  const asked = end === undefined ? pendingHelp(events, ctx.clock.now()) : undefined;
  const paths =
    run.paths.length > 0
      ? run.paths.map((path): LivePath => ({
          index: path.index,
          name: path.name,
          state: REST_STATES[path.status] ?? 'queued',
        }))
      : walkInitial(walk).paths;
  // A path that moved on (built, failed, stopped) no longer waits for anybody.
  const help =
    asked !== undefined && paths[asked.pathIndex]?.state === 'driving' ? asked : undefined;
  return {
    phase: 'walk',
    paths,
    setup: run.currentStep === 'setup',
    awaiting: run.awaitingApproval,
    answered: walk.approved === true,
    walking: !run.awaitingApproval,
    stopping: false,
    steps: walk.steps,
    ...(help === undefined ? {} : { help }),
    ...(end === undefined ? {} : { end }),
  };
}

// ---- what the operation shows -----------------------------------------------------------

export function walkIsTerminal(state: WalkState): boolean {
  return state.end !== undefined || state.refusal !== undefined;
}

function lineOf(path: LivePath, state: WalkState): WalkLine {
  const { help } = state;
  if (help !== undefined && help.pathIndex === path.index) {
    return { name: path.name, state: 'help', help: help.reason };
  }
  const steps = state.steps[path.name];
  return {
    name: path.name,
    state: path.state,
    ...(path.label === undefined ? {} : { label: path.label }),
    ...(path.planStep === undefined ? {} : { step: path.planStep + 1 }),
    ...(steps === undefined || steps === 0 ? {} : { steps }),
    ...(path.attempt === undefined ? {} : { attempt: path.attempt }),
  };
}

const SETTLED: ReadonlySet<PathState> = new Set(['built', 'failed', 'stopped']);

export function describeWalk(state: WalkState, t: Translator): OperationProgress {
  const total = state.paths.length;
  const settled = state.paths.filter((path) => SETTLED.has(path.state)).length;
  return {
    message: renderWalkProgress(
      {
        lines: state.paths.map((path) => lineOf(path, state)),
        setup: state.setup,
        awaiting: state.awaiting && total === 0,
        stopping: state.stopping,
      },
      t,
    ),
    ...(total === 0 ? {} : { fraction: settled / total }),
  };
}

/**
 * A plan that waits for an approval this call can no longer send: `flows_record_journeys` sends it again,
 * or the user approves the paths in the app.
 */
export function approvalPending(
  ctx: OperationContext,
  id: string,
  projectId: string,
  plan: { readonly handle: string; readonly names: readonly string[] },
): NeedsUser {
  return {
    message: renderApprovalPending({ plan: plan.handle, names: plan.names }, ctx.t),
    links: [ctx.services.links.describeRun(projectId, id)],
    // `process_wait` would only say the same: the approval goes with `flows_record_journeys`.
    next: approvalPendingNext(plan.handle, ctx.t),
  };
}

export function walkNeedsUser(
  ctx: OperationContext,
  id: string,
  state: WalkState,
  projectId: string,
  plan: { readonly handle: string; readonly names: readonly string[] },
): NeedsUser | undefined {
  if (walkIsTerminal(state)) return undefined;
  const { help } = state;
  if (help === undefined) {
    // Only a REST read says the run waits; the approval of this call did not go out before it.
    return state.awaiting && !state.answered
      ? approvalPending(ctx, id, projectId, plan)
      : undefined;
  }
  const name = state.paths[help.pathIndex]?.name ?? '';
  return {
    message: renderHelpRequest({ name, reason: help.reason, agentSays: help.agentSays }, ctx.t),
    links: [ctx.services.links.describeRun(projectId, id)],
  };
}

/**
 * The channel failed before the approval was answered: REST cannot send it, so a run that still
 * waits for it would be waited for in vain. The user approves the paths in the app instead.
 */
export async function walkChannelLost(
  ctx: OperationContext,
  id: string,
  state: WalkState,
  projectId: string,
): Promise<void> {
  if (state.answered || walkIsTerminal(state)) return;
  const run = await getDescribeRun(ctx, projectId, id);
  if (!run.awaitingApproval) return;
  throw new ToolError('describe_channel_unavailable', {
    params: { link: ctx.services.links.describeRun(projectId, id).url },
  });
}

// ---- the end ----------------------------------------------------------------------------

/** Steps a load test cannot pass, as the help and the user's part on the path named them. */
function obstaclesOf(events: readonly RunEvent[], pathIndex: number): ObstacleKind[] {
  const found = new Set<ObstacleKind>();
  for (const event of events) {
    if (event.pathIndex !== pathIndex) continue;
    if (event.type === 'help_requested') {
      if (event.reason === 'captcha') found.add('captcha');
      if (event.reason === 'second_factor') found.add('second_factor');
    } else if (event.type === 'control_returned' && event.choice === 'obstacle') {
      const kind = event.obstacleKind;
      if (kind === 'captcha' || kind === 'one_time_code' || kind === 'payment') found.add(kind);
    }
  }
  return [...found];
}

function walkedStatus(path: RunPath, saved: boolean): WalkedPath['status'] {
  if (saved) return path.partial ? 'partial' : 'saved';
  switch (path.status) {
    case 'failed':
      return path.notDriven ? 'not_driven' : 'failed';
    case 'stopped':
      return 'stopped';
    default:
      return 'unfinished';
  }
}

/** The run's row once it ended; it is written just after the last frame of the channel. */
async function settledRun(ctx: ToolContext, projectId: string, id: string): Promise<DescribeRun> {
  const run = await getDescribeRun(ctx, projectId, id);
  if (ENDED.has(run.status)) return run;
  const polled = await pollUntil(() => getDescribeRun(ctx, projectId, id), {
    isTerminal: (read) => ENDED.has(read.status),
    intervalMs: SETTLE_POLL_MS,
    deadlineMs: SETTLE_MS,
    signal: ctx.signal,
    clock: ctx.clock,
  });
  return polled.state;
}

/** How a run that failed after saving flows is reported: its text only to the log. */
function endedOf(
  ctx: ToolContext,
  status: string,
  error: string | null,
): { status: string; detail: string | null } {
  const detail = withheldJobText(ctx, 'flows_record_journeys', error);
  return { status, detail: detail ?? null };
}

export async function finishWalk(
  ctx: ToolContext,
  id: string,
  state: WalkState,
  projectId: string,
): Promise<DoneOutcome<RecordFlowsData>> {
  const link = ctx.services.links.describeRun(projectId, id);
  if (state.refusal?.kind === 'busy') throw new ToolError('agent_browsers_busy');
  if (state.refusal?.kind === 'denied') {
    throw new ToolError('record_approval_denied', {
      params: { code: inline(state.refusal.code, 60), link: link.url },
    });
  }
  const run = await settledRun(ctx, projectId, id);
  const events = await getRunTimeline(ctx, projectId, id);
  const notes = new Map(
    run.flowsSaved.flatMap((flow) => (flow.pathIndex === null ? [] : [[flow.pathIndex, flow]])),
  );

  const saved: RecordFlowsData['saved'][number][] = [];
  let questions: FlowQuestion[] = [];
  const paths: WalkedPath[] = [];
  for (const path of run.paths) {
    const flowId = path.flowId ?? notes.get(path.index)?.flowId ?? null;
    const built =
      path.status === 'saved' && flowId !== null
        ? await readBuilt(ctx, projectId, flowId)
        : undefined;
    if (built !== undefined) {
      if (saved.length === 0) {
        questions = built.questions.map((item) => ({
          field: item.field,
          question: item.question,
          why: '',
          kind: '',
        }));
      }
      saved.push(built.outline);
    }
    const status = walkedStatus(path, built !== undefined);
    const reason =
      status === 'partial' ? (notes.get(path.index)?.note ?? null) : path.failureReason;
    paths.push({
      name: path.name,
      status,
      ...(built === undefined ? {} : { steps: built.outline.stepCount }),
      reason,
      attempts: path.attempts,
      obstacles: obstaclesOf(events, path.index),
    });
  }

  if (saved.length === 0 && FAILED.has(run.status)) {
    throw new ToolError('record_run_failed', {
      params: {
        status: run.status,
        detail:
          withheldJobText(ctx, 'flows_record_journeys', run.error) ??
          ctx.t('describe.failed.noDetail'),
      },
    });
  }
  return {
    status: 'done',
    data: {
      walked: true,
      host: run.targetHost,
      link: link.url,
      paths,
      saved,
      questions,
      ...(FAILED.has(run.status) ? { ended: endedOf(ctx, run.status, run.error) } : {}),
    },
    // Every saved flow is named in the text by its link: the model sees nothing else.
    links: saved.map((outline) => ctx.services.links.flow(projectId, outline.flowId)),
  };
}

// ---- stopping ---------------------------------------------------------------------------

/**
 * `process_cancel` of a run. A walk is stopped gently on the channel (the path in progress ends, built
 * paths are saved), or through REST when the channel cannot be used. A run that waits for the
 * approval has nothing to stop gently: it is cancelled through REST.
 */
export async function cancelRecordRun(
  ctx: OperationContext,
  id: string,
  projectId: string,
  walking: boolean,
): Promise<boolean | 'stopping'> {
  if (!walking) return cancelDescribeRun(ctx, projectId, id);
  let answer;
  try {
    answer = await stopRun(
      { config: ctx.config, log: ctx.log, signal: ctx.signal, clock: ctx.clock },
      projectId,
      id,
      STOP_ANSWER_MS,
    );
  } catch (error) {
    if (
      error instanceof ChannelUnavailable ||
      error instanceof ChannelLost ||
      error instanceof LoadcraftApiError
    ) {
      ctx.log.info('stop of the walk not sent on the channel, cancelling through REST', { error });
      return cancelDescribeRun(ctx, projectId, id);
    }
    throw error;
  }
  switch (answer.kind) {
    case 'accepted':
      return 'stopping';
    case 'ended':
      return false;
    case 'refused':
      if (answer.code === 'stop_already_stopping') return 'stopping';
      if (answer.code === 'stop_control_taken') {
        throw new ToolError('record_stop_refused', {
          params: {
            code: inline(answer.code, 60),
            link: ctx.services.links.describeRun(projectId, id).url,
          },
        });
      }
      // Nothing is driven (the run waits for the approval, or between two parts): cancelled.
      return cancelDescribeRun(ctx, projectId, id);
    case 'none':
      return cancelDescribeRun(ctx, projectId, id);
  }
}
