// `flows_generate_from_har`: flows from a recording (HAR). The recording is sent first when LoadCraft
// holds no session for it (the steps of `flows_import_har`). Both ways are long operations with a
// handle: the server process holds the work, the call returns the handle after `max_wait_s`, and
// `process_wait` joins it.
//
// - one flow (`split: false`): `POST …/har/{id}/generate` answers after about two minutes; the
//   request goes on in the server process. In a new process the flow is found by its name.
// - a split (`split: true`): only the HAR channel can split a recording. LoadCraft proposes the
//   journeys and waits for an answer on the same connection, and drops the run when that
//   connection goes away. So the server process holds one connection per split, never reconnects,
//   and answers the proposal at once (the user agreed to the split before the call). A process
//   that ended took its connection with it: a later read finds the flows by their names or reports
//   the split as abandoned. Nothing is ever started again by a read.

import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { listFlows } from '../../api/flows.js';
import {
  cancelHarSession,
  generateHarFlow,
  harFlowsOf,
  SANITIZED_MARKER,
  type HarFlow,
} from '../../api/har.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { requireCapability } from '../../http/compat.js';
import {
  defineOperationKind,
  encodeHandle,
  recordOperation,
  startOrJoin,
  type OperationOutcome,
} from '../../ops/operation.js';
import { createWriteChain } from '../../ops/writeChain.js';
import type { DoneOutcome } from '../../outcome.js';
import { inline } from '../../render/primitives.js';
import { content } from '../moduleCall.js';
import { renderBuildFlows, type BuildFlowsData } from '../../render/views/buildFlows.js';
import { ChannelLost, ChannelUnavailable, openChannel } from '../../ws/channel.js';
import { FrameParseError } from '../../ws/frames.js';
import type { ChannelHandle } from '../../ws/channel.js';
import { importRecording, type ImportedRecording } from '../flowsImportHar.js';
import { flowsUpdate, readBuilt } from './fromSuggestions.js';
import { shownNameOf } from '../../flow/maskOutline.js';

/** The longest a split may take: generation (about 2 min) plus the flows of every journey. */
export const SPLIT_LIMIT_MS = 600_000;
/** A one-flow generation without an answer this long after its start is given up on. */
const LOST_AFTER_MS = 310_000;
/** Longest name taken into a line. */
const MAX_NAME = 80;
/** The tool of this way, named in the errors that tell the model to call it again. */
const TOOL = 'flows_generate_from_har';
/** Journey names listed in an error. */
const SHOWN_NAMES = 10;
/** Start of the backend's answer for a session it does not hold. */
const SESSION_LOST = 'HAR session not found';
/** `flows_import_har` reports the same refusal condition as this warning. */
const SANITIZED_WARNING = 'sanitized_export';

/** A name of a journey (the generator's) or one the model gave, masked (FIX-76). */
const quoted = (ctx: ToolContext, name: string): string => `"${content(ctx, name, MAX_NAME)}"`;

export interface FromHarArgs {
  readonly project?: string;
  readonly har: string;
  readonly split?: boolean;
  readonly name?: string;
  readonly paths?: readonly string[];
  readonly maxWaitS: number;
}

// ---- shared ------------------------------------------------------------------------------------

function sanitizedRefusal(): ToolError {
  return new ToolError('har_recording_incomplete');
}

/** Outlines of the flows LoadCraft saved, in its order; a flow it cannot return is a failure. */
async function builtData(
  ctx: ToolContext,
  projectId: string,
  flows: readonly HarFlow[],
  options: { readonly flowsBefore: number; readonly singleJourney?: boolean },
): Promise<DoneOutcome<BuildFlowsData>> {
  const built = [];
  const failed = [];
  for (const flow of flows) {
    const read = await readBuilt(ctx, projectId, flow.flowId);
    if (read === undefined) {
      failed.push({ name: content(ctx, flow.name, MAX_NAME), reason: 'unreadable' as const });
    } else built.push(read);
  }
  const outlines = built.map((item) => item.outline);
  if (outlines.length === 0) {
    throw new ToolError('har_generation_failed', {
      params: {
        where: ctx.t('build.flows.reason.unreadable'),
        advice: ctx.t('build.har.advice.fix'),
      },
    });
  }
  const lead = outlines.length === 1 ? 'single' : options.flowsBefore === 0 ? 'full' : 'lines';
  return {
    status: 'done',
    data: {
      built: outlines,
      questions: built.flatMap((item) => item.questions),
      failed,
      lead,
      ...(options.singleJourney === true ? { note: 'single_journey' as const } : {}),
    },
    // Every flow is named in the text by its link: the model sees nothing else.
    links: outlines.map((outline) => ctx.services.links.flow(projectId, outline.flowId)),
    update: flowsUpdate(built, ctx.state.process(), TOOL),
  };
}

/** LoadCraft no longer holds the session: the remembered one is dropped, the next call sends the file. */
async function sessionExpired(
  ctx: ToolContext,
  recordingKey: string,
  cause: unknown,
): Promise<ToolError> {
  await ctx.state.delete('harSessions', recordingKey);
  return new ToolError('har_session_expired', { cause });
}

/**
 * A failed generation, by where it failed (`HTTP 500`, the channel) and whether a retry can help.
 * The text of the backend is never taken: it can quote the recording, cookies and tokens included.
 */
function generationFailed(
  ctx: ToolContext,
  status: number | undefined,
  retryable: boolean,
): ToolError {
  return new ToolError('har_generation_failed', {
    params: {
      where:
        status === undefined
          ? ctx.t('build.har.where.channel')
          : ctx.t('build.har.where.http', { status }),
      advice: ctx.t(retryable ? 'build.har.advice.retry' : 'build.har.advice.fix'),
    },
  });
}

// ---- one flow (REST) ---------------------------------------------------------------------------

const savedSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  /** Key of the remembered session, dropped when LoadCraft no longer holds it. */
  recordingKey: z.string(),
  name: z.string(),
  /** Clock time of the start: the elapsed time is the progress, and the loss limit counts from it. */
  startedAtMs: z.number(),
  flowsBefore: z.number().int().min(0),
});

type Saved = z.infer<typeof savedSchema>;

type Request = (
  | { readonly status: 'running'; readonly stop: AbortController }
  | { readonly status: 'done'; readonly flows: readonly HarFlow[] }
  | { readonly status: 'failed'; readonly error: unknown }
) & {
  /** Credentials of the recording, registered in every call that reads this request. */
  readonly secrets: readonly string[];
};

/** Registers the credentials of a recording this process holds in the scope of the call. */
function registerSecrets(ctx: ToolContext, secrets: readonly string[] | undefined): void {
  for (const value of secrets ?? []) ctx.secrets.add(value);
}

/**
 * Requests still running or settled in this server process, per process (the services object):
 * the request outlives the call that started it, and `process_wait` reads it from here.
 */
const requestsOf = new WeakMap<object, Map<string, Request>>();

function requests(ctx: ToolContext): Map<string, Request> {
  let found = requestsOf.get(ctx.services);
  if (found === undefined) {
    found = new Map();
    requestsOf.set(ctx.services, found);
  }
  return found;
}

interface GenerationState {
  readonly phase: 'running' | 'completed' | 'failed' | 'lost';
  readonly elapsedS: number;
  readonly flows?: readonly HarFlow[];
  readonly error?: unknown;
}

export const harGenerationOperation = defineOperationKind({
  kind: 'har_generation',
  saved: savedSchema,
  initial: (): GenerationState => ({ phase: 'running', elapsedS: 0 }),
  recoverIsRead: true,
  // The request of this process, or else the flow found by its name: the backend keeps no state
  // of a one-flow generation that could be read.
  async recover(ctx, id, saved): Promise<GenerationState> {
    const elapsedMs = Math.max(0, ctx.clock.now() - saved.startedAtMs);
    const elapsedS = Math.floor(elapsedMs / 1000);
    const request = requests(ctx).get(id);
    registerSecrets(ctx, request?.secrets);
    if (request?.status === 'running') return { phase: 'running', elapsedS };
    if (request?.status === 'done') return { phase: 'completed', elapsedS, flows: request.flows };
    if (request?.status === 'failed') return { phase: 'failed', elapsedS, error: request.error };
    const wanted = saved.name.trim().toLowerCase();
    const found = (await listFlows(ctx, saved.projectId)).find(
      (flow) => flow.name.trim().toLowerCase() === wanted,
    );
    if (found !== undefined) {
      return { phase: 'completed', elapsedS, flows: [{ flowId: found.id, name: found.name }] };
    }
    return { phase: elapsedMs >= LOST_AFTER_MS ? 'lost' : 'running', elapsedS };
  },
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) => (state.phase === 'failed' || state.phase === 'lost' ? state.phase : undefined),
  describe: (state, t) => ({ message: t('build.har.generating', { seconds: state.elapsedS }) }),
  async finish(ctx, id, state, saved): Promise<DoneOutcome<BuildFlowsData>> {
    requests(ctx).delete(id);
    if (state.phase === 'completed' && state.flows !== undefined) {
      return builtData(ctx, saved.projectId, state.flows, { flowsBefore: saved.flowsBefore });
    }
    if (state.phase === 'lost') {
      throw new ToolError('flow_generation_failed', {
        params: {
          name: content(ctx, saved.name, MAX_NAME),
          detail: ctx.t('build.flows.reason.not_created'),
          tool: TOOL,
        },
      });
    }
    throw await failureOf(ctx, state.error, saved);
  },
  view: renderBuildFlows,
  // `cancel` only: LoadCraft stops the generation of the session; the request of this process,
  // if it holds one, is dropped too.
  async cancel(ctx, id, saved): Promise<boolean> {
    const request = requests(ctx).get(id);
    const stopped = await cancelHarSession(ctx, saved.projectId, saved.sessionId);
    if (request?.status === 'running') {
      request.stop.abort();
      requests(ctx).set(id, {
        status: 'failed',
        error: cancelledGeneration(saved.name),
        secrets: request.secrets,
      });
      return true;
    }
    return stopped;
  },
});

function cancelledGeneration(name: string): ToolError {
  return new ToolError('flow_generation_cancelled', {
    params: { name: inline(name, MAX_NAME), tool: TOOL },
  });
}

async function failureOf(ctx: ToolContext, error: unknown, saved: Saved): Promise<Error> {
  // The channel reported the loss (a frame callback cannot wait for the file): the session is dropped here.
  if (error instanceof ToolError && error.code === 'har_session_expired') {
    return sessionExpired(ctx, saved.recordingKey, error.cause);
  }
  if (error instanceof LoadcraftApiError) {
    // LoadCraft lost the session (a restart or an evicted session).
    if (error.status === 404) return sessionExpired(ctx, saved.recordingKey, error);
    // Any other refusal is described by its status: its text would quote the backend.
    if (!SHOWN_CODES.has(error.code)) {
      return generationFailed(ctx, error.status, error.retryable);
    }
  }
  if (error instanceof Error) return error;
  return generationFailed(ctx, undefined, false);
}

/** Refusals whose text is the plugin's own (`http/errors.ts`): shown as they are. */
const SHOWN_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'forbidden',
  'llm_not_configured',
  'llm_generation_failed',
  'timeout',
  'network_error',
  'bad_gateway',
  'unexpected_redirect',
  'response_too_large',
]);

/** A context of the server process: the request goes on after the call that started it ends. */
function detached(
  ctx: ToolContext,
  signal: AbortSignal = new AbortController().signal,
): Pick<ToolContext, 'services' | 'signal' | 'secrets'> {
  // The secret scope of the call that started the work: what the answers carry is registered there.
  return { services: ctx.services, signal, secrets: ctx.secrets };
}

async function generateOne(
  ctx: ToolContext,
  recording: ImportedRecording,
  name: string,
  maxWaitS: number,
): Promise<OperationOutcome<BuildFlowsData>> {
  const { projectId, sessionId } = recording;
  const wanted = name.trim().toLowerCase();
  // The same flow from the same session still being generated is joined: it is not paid twice.
  return startOrJoin(ctx, harGenerationOperation, {
    maxWaitS,
    matches: (run) =>
      run.projectId === projectId &&
      run.sessionId === sessionId &&
      run.name.trim().toLowerCase() === wanted,
    async start() {
      const listed = await listFlows(ctx, projectId);
      const existing = listed.find((flow) => flow.name.trim().toLowerCase() === wanted);
      if (existing !== undefined) {
        throw new ToolError('flow_exists', {
          params: { name: content(ctx, existing.name, MAX_NAME), tool: TOOL },
        });
      }
      const id = randomUUID();
      const table = requests(ctx);
      const stop = new AbortController();
      const { secrets } = recording;
      table.set(id, { status: 'running', stop, secrets });
      generateHarFlow(detached(ctx, stop.signal), projectId, sessionId, name.trim()).then(
        (flows) => table.set(id, { status: 'done', flows, secrets }),
        (error: unknown) => table.set(id, { status: 'failed', error, secrets }),
      );
      return {
        id,
        saved: {
          projectId,
          sessionId,
          recordingKey: recording.key,
          name: name.trim(),
          startedAtMs: ctx.clock.now(),
          flowsBefore: listed.length,
        },
      };
    },
  });
}

// ---- a split (HAR channel) ---------------------------------------------------------------------

interface Journey {
  readonly name: string;
  readonly steps: readonly unknown[];
  readonly depends_on_prior?: boolean | undefined;
  readonly rationale?: string | undefined;
}

/** The journeys of the proposal the call asked for, in the order of the proposal. */
function chooseJourneys(
  ctx: ToolContext,
  proposed: readonly Journey[],
  wanted: readonly string[] | undefined,
): Journey[] | ToolError {
  if (wanted === undefined) return [...proposed];
  const key = (name: string): string => name.trim().toLowerCase();
  // a journey is chosen by its raw name or by the name the views showed masked (FIX-76)
  const keys = (name: string): string[] => [key(name), key(shownNameOf(name))];
  const unknown = wanted.filter(
    (name) =>
      !proposed.some((journey) => journey.name === name || keys(journey.name).includes(key(name))),
  );
  if (unknown.length > 0) {
    const shown = proposed.slice(0, SHOWN_NAMES).map((journey) => quoted(ctx, journey.name));
    const more = proposed.length - shown.length;
    return new ToolError('har_split_unknown_paths', {
      params: {
        names: unknown.map((name) => quoted(ctx, name)).join(', '),
        available:
          more > 0
            ? ctx.t('resolve.more', { names: shown.join(', '), count: more })
            : shown.join(', '),
      },
    });
  }
  const picked = new Set(wanted.map(key));
  return proposed.filter((journey) => keys(journey.name).some((one) => picked.has(one)));
}

/** The message that answers the proposal: the journeys exactly as LoadCraft proposed them. */
function resumeMessage(journeys: readonly Journey[]) {
  return {
    type: 'split_resume',
    paths: journeys.map((journey) => ({
      name: journey.name,
      steps: [...journey.steps],
      ...(journey.depends_on_prior === undefined
        ? {}
        : { depends_on_prior: journey.depends_on_prior }),
      ...(journey.rationale === undefined ? {} : { rationale: journey.rationale }),
    })),
  };
}

const splitSavedSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  recordingKey: z.string(),
  flowName: z.string(),
  /** Journeys the call asked for, as given; absent: all of them. */
  paths: z.array(z.string()).optional(),
  /** Flows of the project before the split: a flow found by name later must be a new one. */
  before: z.array(z.string()),
  /** Clock time of the start: the limit of the split counts from it. */
  startedAtMs: z.number(),
  /** Names of the journeys sent in `split_resume`, saved once LoadCraft proposed them. */
  journeys: z.array(z.string()).optional(),
});

type SplitSaved = z.infer<typeof splitSavedSchema>;

type SplitPhase = 'running' | 'completed' | 'failed' | 'abandoned';

interface SplitState {
  readonly phase: SplitPhase;
  /** The text of the last `har:progress`, and its share 0..100. */
  readonly step?: string;
  readonly progress?: number;
  /** Journeys accepted; absent before the proposal. */
  readonly accepted?: number;
  readonly flows?: readonly HarFlow[];
  /** Set when the split ended without a proposal: the recording holds one journey. */
  readonly singleJourney?: boolean;
  readonly error?: Error;
}

/** A split this server process started: its state while it holds the connection. */
interface SplitJob {
  state: SplitState;
  /** False once the connection broke after the answer: the split is read by journey names. */
  connected: boolean;
  /** Sends `har:cancel` on the connection and closes it (the `process_cancel` tool). */
  stop?: () => void;
  /** Names of the journeys sent in `split_resume`. */
  journeys?: readonly string[];
  /** Credentials of the recording, registered in every call that reads this split. */
  readonly secrets: readonly string[];
}

const splitsOf = new WeakMap<object, Map<string, SplitJob>>();

function splits(ctx: ToolContext): Map<string, SplitJob> {
  let found = splitsOf.get(ctx.services);
  if (found === undefined) {
    found = new Map();
    splitsOf.set(ctx.services, found);
  }
  return found;
}

const SPLIT_HANDLE_KIND = 'har_split';

export const harSplitOperation = defineOperationKind({
  kind: SPLIT_HANDLE_KIND,
  saved: splitSavedSchema,
  initial: (): SplitState => ({ phase: 'running' }),
  recoverIsRead: true,
  pollIntervalMs: 1000,
  // The connection of this process, or else the flows found by their names; LoadCraft keeps no
  // state of a split that could be read, and a split whose connection is gone is not running.
  async recover(ctx, id, saved): Promise<SplitState> {
    const job = splits(ctx).get(id);
    registerSecrets(ctx, job?.secrets);
    if (job?.connected === true) return job.state;
    const journeys = saved.journeys ?? job?.journeys;
    const names = new Set((journeys ?? [saved.flowName]).map(nameKey));
    const before = new Set(saved.before);
    const flows = (await listFlows(ctx, saved.projectId))
      .filter((flow) => !before.has(flow.id) && names.has(nameKey(flow.name)))
      .map((flow) => ({ flowId: flow.id, name: flow.name }));
    if (flows.length > 0) {
      return {
        phase: 'completed',
        flows,
        ...(journeys === undefined ? { singleJourney: true } : {}),
      };
    }
    // A split whose journeys were accepted goes on without the connection until its limit; one
    // that was not answered was dropped with its connection.
    const accepted = journeys?.length;
    return accepted !== undefined && ctx.clock.now() - saved.startedAtMs < SPLIT_LIMIT_MS
      ? { phase: 'running', accepted }
      : { phase: 'abandoned' };
  },
  isTerminal: (state) => state.phase !== 'running',
  // a split whose job this process no longer holds is followed by nobody
  ended: (state) =>
    state.phase === 'failed' ? 'failed' : state.phase === 'abandoned' ? 'lost' : undefined,
  describe(state, t) {
    const fraction =
      state.progress === undefined
        ? {}
        : { fraction: Math.min(1, Math.max(0, state.progress / 100)) };
    if (state.accepted !== undefined) {
      return {
        message:
          state.step === undefined
            ? t.plural('build.har.accepted', state.accepted)
            : t('build.har.building', { step: inline(state.step, 60) }),
        ...fraction,
      };
    }
    return {
      message:
        state.step === undefined
          ? t('build.har.splitting')
          : t('build.har.progress', { step: inline(state.step, 60) }),
      ...fraction,
    };
  },
  async finish(ctx, id, state, saved): Promise<DoneOutcome<BuildFlowsData>> {
    splits(ctx).delete(id);
    if (state.phase === 'completed' && state.flows !== undefined) {
      return builtData(ctx, saved.projectId, state.flows, {
        flowsBefore: saved.before.length,
        ...(state.singleJourney === true ? { singleJourney: true } : {}),
      });
    }
    if (state.phase === 'abandoned') throw new ToolError('har_split_abandoned');
    throw state.error ?? new ToolError('har_split_abandoned');
  },
  view: renderBuildFlows,
  // `cancel` only: the connection this process holds gets `har:cancel`; a split held by no
  // connection here is stopped through REST.
  async cancel(ctx, id, saved): Promise<boolean> {
    const job = splits(ctx).get(id);
    if (job?.connected === true && job.state.phase === 'running' && job.stop !== undefined) {
      job.stop();
      return true;
    }
    if (job !== undefined && job.state.phase !== 'running') return false;
    return cancelHarSession(ctx, saved.projectId, saved.sessionId);
  },
});

const nameKey = (name: string): string => name.trim().toLowerCase();

/** Holds the connection of one split until LoadCraft ends it, the limit passes or it breaks. */
async function followSplit(
  ctx: ToolContext,
  id: string,
  saved: SplitSaved,
  handle: ChannelHandle<'har'>,
  job: SplitJob,
): Promise<void> {
  const set = (change: Partial<SplitState>): void => {
    job.state = { ...job.state, ...change };
  };
  const fail = (error: Error): void => set({ phase: 'failed', error });
  // The entry is saved from a frame callback, which cannot wait: the writes queue up and are awaited at the end.
  const writes = createWriteChain();
  let timedOut = false;
  let cancelled = false;
  let stoppedByUser = false;
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    try {
      handle.send({ type: 'har:cancel' });
    } catch (error) {
      ctx.log.debug('har:cancel could not be sent', { error });
    }
    handle.close();
  };
  job.stop = () => {
    stoppedByUser = true;
    cancel();
  };
  const timer = new AbortController();
  ctx.clock.sleep(SPLIT_LIMIT_MS, timer.signal).then(
    () => {
      timedOut = true;
      cancel();
    },
    () => undefined,
  );

  let lost = false;
  try {
    for await (const frame of handle.frames) {
      switch (frame.type) {
        case 'har:progress':
          set({
            ...((frame.data.step_label ?? frame.data.current_step)
              ? { step: frame.data.step_label ?? frame.data.current_step ?? '' }
              : {}),
            progress: frame.data.progress,
          });
          break;
        case 'split_proposal': {
          const chosen = chooseJourneys(ctx, frame.data.proposed_paths, saved.paths);
          if (chosen instanceof ToolError) {
            cancel();
            fail(chosen);
            return;
          }
          // At once: LoadCraft waits for this answer on this connection only.
          handle.send(resumeMessage(chosen));
          job.state = { phase: job.state.phase, accepted: chosen.length, progress: 0 };
          job.journeys = chosen.map((journey) => journey.name);
          const names = job.journeys;
          void writes.run(() => rememberJourneys(ctx, id, saved, names));
          break;
        }
        case 'har:complete':
          set({
            phase: 'completed',
            flows: harFlowsOf(frame.data),
            ...(job.state.accepted === undefined ? { singleJourney: true } : {}),
          });
          return;
        case 'har:error':
          // The session is gone: the remembered one is dropped, so the next call sends the file.
          if (frame.data.error.startsWith(SESSION_LOST)) {
            void writes.run(() => ctx.state.delete('harSessions', saved.recordingKey));
          }
          fail(
            frame.data.error.startsWith(SESSION_LOST)
              ? new ToolError('har_session_expired')
              : frame.data.error.includes(SANITIZED_MARKER)
                ? sanitizedRefusal()
                : generationFailed(ctx, undefined, frame.data.recoverable === true),
          );
          return;
        case 'har:cancelled':
          if (!cancelled) {
            fail(new ToolError('har_split_cancelled'));
            return;
          }
          break;
      }
    }
    // The connection closed without a final frame.
    if (timedOut) fail(timeoutError());
    else if (stoppedByUser) fail(new ToolError('har_split_cancelled'));
    else if (!cancelled) lost = true;
  } catch (error) {
    if (timedOut) {
      fail(timeoutError());
    } else if (
      error instanceof ChannelLost ||
      error instanceof ChannelUnavailable ||
      error instanceof FrameParseError
    ) {
      lost = true;
    } else {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    timer.abort();
    handle.close();
    await writes.flush().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
    if (lost && job.state.accepted !== undefined) {
      // LoadCraft has the answer and builds the flows without the connection: from here on the
      // operation is read like one of another process, by the names of the journeys.
      lost = false;
      job.connected = false;
    } else if (lost) {
      fail(new ToolError('har_split_interrupted'));
    } else if (job.state.phase === 'running') {
      fail(new ToolError('har_split_interrupted'));
    }
    if (lost) {
      // The connection went away on its own: whatever the session still generates is stopped, so
      // the next call starts a run of its own instead of being ignored next to an orphan.
      await stopOrphan(ctx, saved.projectId, saved.sessionId);
    }
  }
}

function timeoutError(): ToolError {
  return new ToolError('har_split_timeout', { params: { minutes: SPLIT_LIMIT_MS / 60_000 } });
}

/**
 * The names of the accepted journeys go to the operation's entry, so that a process that did not
 * hold the connection can still find the flows. The entry is only updated while it exists.
 */
async function rememberJourneys(
  ctx: ToolContext,
  id: string,
  saved: SplitSaved,
  journeys: readonly string[],
): Promise<void> {
  const handle = encodeHandle(SPLIT_HANDLE_KIND, id);
  const entry = ctx.state.get('operations', handle)?.value as { startedAt?: unknown } | undefined;
  if (entry === undefined || typeof entry.startedAt !== 'number') return;
  await recordOperation(ctx.state, {
    kind: SPLIT_HANDLE_KIND,
    id,
    startedAt: entry.startedAt,
    saved: { ...saved, journeys: [...journeys] } satisfies SplitSaved,
  });
}

async function splitRecording(
  ctx: ToolContext,
  recording: ImportedRecording,
  args: FromHarArgs,
): Promise<OperationOutcome<BuildFlowsData>> {
  const { projectId, sessionId } = recording;
  const flowName = (args.name ?? recording.name).trim();
  const pathsKey = args.paths?.map(nameKey).sort().join('\n');
  // The same split of the same session still running is joined: one connection, one run.
  return startOrJoin(ctx, harSplitOperation, {
    maxWaitS: args.maxWaitS,
    matches: (run) =>
      run.projectId === projectId &&
      run.sessionId === sessionId &&
      nameKey(run.flowName) === nameKey(flowName) &&
      run.paths?.map(nameKey).sort().join('\n') === pathsKey,
    async start() {
      const before = (await listFlows(ctx, projectId)).map((flow) => flow.id);
      let handle: ChannelHandle<'har'>;
      try {
        // No signal of the call: the connection belongs to the server process, not to the call.
        handle = await openChannel(
          { config: ctx.config, log: ctx.log },
          {
            channel: 'har',
            params: { project_id: projectId, session_id: sessionId },
            clock: ctx.clock,
          },
        );
      } catch (error) {
        if (error instanceof ChannelUnavailable) {
          throw new ToolError('har_split_unavailable', { cause: error });
        }
        throw error;
      }
      const id = randomUUID();
      const saved: SplitSaved = {
        projectId,
        sessionId,
        recordingKey: recording.key,
        flowName,
        ...(args.paths === undefined ? {} : { paths: [...args.paths] }),
        before,
        startedAtMs: ctx.clock.now(),
      };
      const job: SplitJob = {
        state: { phase: 'running' },
        connected: true,
        secrets: recording.secrets,
      };
      splits(ctx).set(id, job);
      handle.send({ type: 'har:generate', flow_name: flowName });
      void followSplit(ctx, id, saved, handle, job).catch((error: unknown) => {
        ctx.log.warn('the split of a recording ended with an unexpected error', { error });
      });
      return { id, saved };
    },
  });
}

async function stopOrphan(ctx: ToolContext, projectId: string, sessionId: string): Promise<void> {
  try {
    await cancelHarSession(detached(ctx), projectId, sessionId);
  } catch (error) {
    ctx.log.info('the HAR session could not be stopped after the connection was lost', {
      ...(error instanceof LoadcraftApiError ? { status: error.status, code: error.code } : {}),
    });
  }
}

// ---- the way -----------------------------------------------------------------------------------

export async function buildFromHar(
  ctx: ToolContext,
  args: FromHarArgs,
): Promise<OperationOutcome<BuildFlowsData>> {
  if (args.split === undefined) throw new ToolError('har_split_missing');
  if (!args.split && args.paths !== undefined) throw new ToolError('har_paths_without_split');
  const name = args.name?.trim();
  if (!args.split && (name === undefined || name === '')) throw new ToolError('har_name_required');
  if (args.split) {
    await requireCapability(
      ctx.services.http,
      'api_token_sockets',
      ctx.t('build.har.advice.noSplit'),
    );
  }
  const recording = await importRecording(ctx, {
    file: args.har,
    ...(args.project === undefined ? {} : { project: args.project }),
  });
  // LoadCraft refuses such a recording at generation time; nothing is paid for it here.
  if (recording.data.warnings.some((warning) => warning.kind === SANITIZED_WARNING)) {
    throw sanitizedRefusal();
  }
  return args.split
    ? splitRecording(ctx, recording, args)
    : generateOne(ctx, recording, name ?? '', args.maxWaitS);
}
