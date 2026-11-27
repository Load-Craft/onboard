// Flows from a description, walked by LoadCraft's agent browser: the address the browser opens
// (the frontend of an environment and how its last connection test ended), starting a run, reading
// its state, and the plan of its paths. The plan exists only as the `split_proposal` frame of the
// run's channel (which sends it again to every new socket while the run waits for the approval),
// so it is read there: one socket, one frame, closed at once.
// The walk is read the same way (the run's state, its timeline of the user's help) and stopped on
// the channel, gently, or else through REST.

import * as z from 'zod';

import { LoadcraftApiError } from '../http/apiError.js';
import type { Clock } from '../ops/clock.js';
import type { Secret } from '../secret.js';
import { openChannel, type ChannelContext } from '../ws/channel.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import { reads, type ResponseOf } from '../contract/reads.js';

/** The address the browser would open, and what the last connection test said about it. */
export interface DescribeTarget {
  readonly id: string;
  readonly name: string;
  readonly frontendUrl: string | null;
  /** Status of the last probe of the frontend address (`blocked`, `ok`…); null when never probed. */
  readonly frontendProbe: string | null;
}

// `last_probe` as `POST …/test-connection` writes it.
const lastProbeSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/environments', 'get'>['items'][number]['last_probe']
>()(
  z
    .object({
      results: z.array(z.looseObject({ kind: z.string(), status: z.string() })),
    })
    .nullish(),
);

function frontendProbe(lastProbe: unknown): string | null {
  const parsed = lastProbeSchema.safeParse(lastProbe);
  if (!parsed.success) return null;
  return parsed.data?.results.find((result) => result.kind === 'frontend_url')?.status ?? null;
}

/** The environment `environmentId` of the project, narrowed to what the browser needs; undefined when absent. */
export async function getDescribeTarget(
  api: SecretApiContext,
  projectId: string,
  environmentId: string,
): Promise<DescribeTarget | undefined> {
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  const found = data.items.find((item) => item.id === environmentId);
  if (found === undefined) return undefined;
  const frontend = found.frontend_url?.trim() ?? '';
  return {
    id: found.id,
    name: found.name,
    frontendUrl: frontend === '' ? null : frontend,
    frontendProbe: frontendProbe(found.last_probe),
  };
}

/** The description of the project (what the frontend sends as `app_context`); null when it has none. */
export async function getProjectDescription(
  api: SecretApiContext,
  projectId: string,
): Promise<string | null> {
  const data = await callOperation(
    api.services.http,
    'get_project_api_v1_projects__project_id__get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return data.description;
}

export interface DescribeRequest {
  readonly description: string;
  readonly targetUrl: string;
  /** Recorded on the saved flows as the environment they come from; the address is `targetUrl`. */
  readonly environmentId: string;
  readonly maxSteps?: number;
  /** What the agent should know about the application; masked and cut by the caller. */
  readonly appContext?: string;
  /** The test account the browser signs in with. */
  readonly account?: { readonly username: string; readonly password: Secret };
}

/** `POST …/scenario-from-description/generate`: starts the run, answers its id at once. */
export async function startDescribeRun(
  api: SecretApiContext,
  projectId: string,
  request: DescribeRequest,
): Promise<string> {
  const { account } = request;
  const data = await callOperation(
    api.services.http,
    'generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post',
    {
      path: { project_id: projectId },
      body: {
        description: request.description,
        target_url: request.targetUrl,
        environment_id: request.environmentId,
        ...(request.maxSteps === undefined ? {} : { max_steps: request.maxSteps }),
        ...(request.appContext === undefined ? {} : { app_context: request.appContext }),
        // The only place the password leaves its `Secret`: the body LoadCraft keeps for the run.
        auth_credentials:
          account === undefined
            ? null
            : { username: account.username, password: account.password.reveal() },
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return data.run_id;
}

/** One path of a run as its review lists it (`SessionPath`). */
export interface RunPath {
  readonly index: number;
  readonly name: string;
  /** `queued` | `driving` | `built` | `saved` | `failed` | `stopped`. */
  readonly status: string;
  /** Attempts the path took. */
  readonly attempts: number;
  /** The flow of the path stopped short of the end of the journey. */
  readonly partial: boolean;
  readonly failureReason: string | null;
  readonly stopCause: string | null;
  readonly flowId: string | null;
  /** The path continues an earlier one, and no path before it reached its goal. */
  readonly notDriven: boolean;
}

/** A flow the run saved (`SavedFlowSummary`); `note` says what the walk did not carry out. */
export interface RunFlow {
  readonly name: string;
  readonly flowId: string | null;
  readonly pathIndex: number | null;
  readonly note: string | null;
}

/** State of a run, as far as the plan and the walk need it. */
export interface DescribeRun {
  /** `queued` | `running` | `completed` | `failed` | `cancelled` | `needs_input` | `interrupted`. */
  readonly status: string;
  readonly currentStep: string | null;
  /** The run pauses for the approval of its split (two paths or more). */
  readonly awaitingApproval: boolean;
  /** Names of the paths being walked: set once the walk started (one path starts at once). */
  readonly walked: readonly string[];
  readonly error: string | null;
  /** Host of the address the browser opens. */
  readonly targetHost: string | null;
  readonly paths: readonly RunPath[];
  readonly flowsSaved: readonly RunFlow[];
}

/** `GET …/scenario-from-description/runs/{run_id}`. */
export async function getDescribeRun(
  api: ApiContext,
  projectId: string,
  runId: string,
): Promise<DescribeRun> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}', {
      params: { path: { project_id: projectId, run_id: runId } },
      signal: api.signal,
    }),
  );
  const approved = data.approved_paths_names ?? [];
  const named = (data.paths ?? []).map((path) => path.name ?? '');
  return {
    status: data.status,
    currentStep: data.current_step ?? null,
    awaitingApproval: data.awaiting_split_approval === true,
    walked: approved.length > 0 ? approved : named,
    error: data.error_message ?? null,
    targetHost: data.target_host ?? null,
    paths: (data.paths ?? []).map((path) => ({
      index: path.path_index,
      name: path.name,
      status: path.status,
      attempts: path.attempts?.length ?? 0,
      partial: path.partial,
      failureReason: path.failure_reason ?? null,
      stopCause: path.stop_cause ?? null,
      flowId: path.flow_id ?? null,
      notDriven: path.not_driven,
    })),
    flowsSaved: (data.flows_saved ?? []).map((flow) => ({
      name: flow.name,
      flowId: flow.flow_id ?? null,
      pathIndex: flow.path_index ?? null,
      note: flow.note ?? null,
    })),
  };
}

/** An event of the run's timeline about the user's help, oldest first. */
export type RunEvent =
  | {
      readonly type: 'help_requested';
      readonly pathIndex: number;
      readonly attempt: number;
      /** `captcha` | `second_factor` | `unknown_blocker`. */
      readonly reason: string;
      readonly agentSays: string | null;
      readonly expiresAt: string | null;
    }
  | { readonly type: 'control_taken'; readonly pathIndex: number; readonly attempt: number }
  | {
      readonly type: 'control_returned';
      readonly pathIndex: number;
      readonly attempt: number;
      /** `handed_back` | `inactivity` | `drive_ended`. */
      readonly reason: string;
      /** `journey` | `obstacle`: what the user's part was. */
      readonly choice: string | null;
      /** `captcha` | `one_time_code` | `payment` | `other`. */
      readonly obstacleKind: string | null;
    };

/** Codes of a review session that ended or never existed: the run keeps no timeline to read. */
const NO_TIMELINE: ReadonlySet<string> = new Set(['review_session_ended', 'review_session_absent']);

/**
 * `GET …/runs/{run_id}/timeline`, narrowed to the help the agent asked for and the user's control
 * of the browser. Empty once the review of the run ended (24 h after the run) or when it has none.
 */
export async function getRunTimeline(
  api: ApiContext,
  projectId: string,
  runId: string,
): Promise<RunEvent[]> {
  let data;
  try {
    data = await must(
      api.services.http.GET(
        '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/timeline',
        { params: { path: { project_id: projectId, run_id: runId } }, signal: api.signal },
      ),
    );
  } catch (error) {
    if (error instanceof LoadcraftApiError && NO_TIMELINE.has(error.code)) return [];
    throw error;
  }
  const events: RunEvent[] = [];
  for (const event of data.events ?? []) {
    switch (event.type) {
      case 'help_requested':
        events.push({
          type: event.type,
          pathIndex: event.path_index,
          attempt: event.attempt,
          reason: event.reason,
          agentSays: event.agent_says ?? null,
          expiresAt: event.expires_at ?? null,
        });
        break;
      case 'control_taken':
        events.push({ type: event.type, pathIndex: event.path_index, attempt: event.attempt });
        break;
      case 'control_returned':
        events.push({
          type: event.type,
          pathIndex: event.path_index,
          attempt: event.attempt,
          reason: event.reason,
          choice: event.choice ?? null,
          obstacleKind: event.obstacle_kind ?? null,
        });
        break;
      default:
        break;
    }
  }
  return events;
}

/**
 * `POST …/runs/{run_id}/cancel`: the run ends at once, whatever it was doing (a pause for the
 * approval included). True when LoadCraft cancelled it, false when it had ended before.
 */
export async function cancelDescribeRun(
  api: ApiContext,
  projectId: string,
  runId: string,
): Promise<boolean> {
  const data = await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/cancel',
      { params: { path: { project_id: projectId, run_id: runId } }, signal: api.signal },
    ),
  );
  return data.cancelled;
}

export type StopAnswer =
  /** LoadCraft stops the walk: the path in progress ends, built paths are saved. */
  | { readonly kind: 'accepted' }
  /** `stop_nothing_running` | `stop_already_stopping` | `stop_control_taken`. */
  | { readonly kind: 'refused'; readonly code: string }
  /** The run had ended; the channel answered with its last frame. */
  | { readonly kind: 'ended' }
  /** No answer within the limit. */
  | { readonly kind: 'none' };

/**
 * Sends `stop` on the run's channel and waits for the answer: the gentle stop the application's
 * Stop button sends. Rejects as `openChannel` does when
 * the channel is refused or cannot be opened.
 */
export async function stopRun(
  ctx: ChannelContext & { readonly clock: Clock },
  projectId: string,
  runId: string,
  timeoutMs: number,
): Promise<StopAnswer> {
  const limit = new AbortController();
  const timer = new AbortController();
  ctx.clock.sleep(timeoutMs, timer.signal).then(
    () => {
      limit.abort();
    },
    () => undefined,
  );
  let channel: Awaited<ReturnType<typeof openChannel<'describe'>>> | undefined;
  try {
    channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: projectId, run_id: runId },
      signal: limit.signal,
      clock: ctx.clock,
    });
    channel.send({ type: 'stop' });
    for await (const frame of channel.frames) {
      if (frame.type === 'stop_accepted') return { kind: 'accepted' };
      if (frame.type === 'stop_refused') return { kind: 'refused', code: frame.data.code };
      if (TERMINAL_FRAMES.has(frame.type)) return { kind: 'ended' };
    }
    return { kind: 'none' };
  } catch (error) {
    if (limit.signal.aborted && ctx.signal?.aborted !== true) return { kind: 'none' };
    throw error;
  } finally {
    timer.abort();
    channel?.close();
  }
}

/** One proposed path; `raw` is the path as the planner wrote it, to be sent back on approval. */
export interface ProposedPath {
  readonly name: string;
  readonly steps: readonly string[];
  readonly dependsOnPrior: boolean;
  /** The path registers its own account: the shared sign-in skips it. */
  readonly ownIdentity: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** A proposed path read from the planner's own object (a frame, or the plan kept for approval). */
export function proposedPath(raw: Readonly<Record<string, unknown>>): ProposedPath {
  const { name, steps } = raw;
  return {
    name: typeof name === 'string' ? name : '',
    steps: Array.isArray(steps)
      ? steps.filter((step): step is string => typeof step === 'string')
      : [],
    dependsOnPrior: raw['depends_on_prior'] === true,
    ownIdentity: raw['creates_own_identity'] === true,
    raw,
  };
}

export type PlanRead =
  | {
      readonly kind: 'plan';
      readonly paths: readonly ProposedPath[];
      /** One sign-in runs before the paths (an account was given, not every path brings its own). */
      readonly sharedSignIn: boolean;
    }
  /** No proposal within the limit, or the channel showed the run past its pause. */
  | { readonly kind: 'none' };

/**
 * Opens the run's channel, takes the `split_proposal` frame and closes the socket: the pause for
 * the approval outlives the connection. Gives up after `timeoutMs` on `clock`. Refusals and
 * network failures reject as `openChannel` does (`LoadcraftApiError`, `ChannelUnavailable`,
 * `ChannelLost`, `FrameParseError`).
 */
export async function readPlan(
  ctx: ChannelContext & { readonly clock: Clock },
  projectId: string,
  runId: string,
  timeoutMs: number,
): Promise<PlanRead> {
  const limit = new AbortController();
  const timer = new AbortController();
  ctx.clock.sleep(timeoutMs, timer.signal).then(
    () => {
      limit.abort();
    },
    () => undefined,
  );
  let channel: Awaited<ReturnType<typeof openChannel<'describe'>>> | undefined;
  try {
    channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: projectId, run_id: runId },
      signal: limit.signal,
      clock: ctx.clock,
    });
    for await (const frame of channel.frames) {
      if (frame.type === 'split_proposal') {
        return {
          kind: 'plan',
          sharedSignIn: frame.data.shared_sign_in === true,
          paths: frame.data.proposed_paths.map((path) => proposedPath(path)),
        };
      }
      // A walk in progress or a run that ended: no proposal follows on this socket.
      if (frame.type === 'drive_snapshot' || TERMINAL_FRAMES.has(frame.type)) break;
    }
    return { kind: 'none' };
  } catch (error) {
    // The limit ended the wait; an abort of the call itself travels on.
    if (limit.signal.aborted && ctx.signal?.aborted !== true) return { kind: 'none' };
    throw error;
  } finally {
    timer.abort();
    channel?.close();
  }
}

const TERMINAL_FRAMES: ReadonlySet<string> = new Set([
  'complete',
  'error',
  'cancelled',
  'interrupted',
]);
