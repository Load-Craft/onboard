// `flows_describe_journeys`: the start of building flows "from a description". LoadCraft gets the
// description, the frontend address of an environment and a test account, opens the application in
// its own browser and splits the description into paths; the call ends with the plan of those paths,
// for the user to approve (`flows_record_journeys`). The account is read from an env file by this server: the
// password is a `Secret` revealed only in the body of the request, never in the result, the log or
// the state file.
//
// A run is one long operation of the kind `record_run`, in two parts. The plan, here: it ends when
// the run pauses for the approval of its split (two paths or more), or when the walk has begun
// (one path, which LoadCraft does not ask about). The plan itself comes only on the run's channel,
// so the socket is opened to take that one frame and closed: the pause outlives the connection.
// The walk, once `flows_record_journeys` approved the plan (`recordWalk.ts`): only that call sends the
// approval; once the socket took it, the saved data holds the walk and the same handle follows it
// on the channel. A plan nobody approved yet stays a plan: a later `process_wait` says it waits for the
// approval and sends nothing.
//
// The password of the account is read again from its env file by every call that follows, reads
// or stops the run (`secrets`), so that a text of the backend that repeats it is masked there too.

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import * as z from 'zod';

import {
  getDescribeRun,
  getDescribeTarget,
  getProjectDescription,
  proposedPath,
  readPlan,
  startDescribeRun,
  type DescribeRun,
  type DescribeTarget,
  type PlanRead,
  type ProposedPath,
} from '../api/describe.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { withheldJobText } from '../http/errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { requireCapability } from '../http/compat.js';
import type { DoneOutcome } from '../outcome.js';
import {
  defineOperationKind,
  encodeHandle,
  findAllRunning,
  maxWaitInput,
  recordOperation,
  startOrJoin,
} from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { inline } from '../render/primitives.js';
import { type DescribeFlowsData, type DescribedPath } from '../render/views/describeFlows.js';
import { renderRecordRun, type RecordRunData } from '../render/views/recordFlows.js';
import { createResolver } from '../resolve/handles.js';
import { appContextFor } from '../workspace/appContext.js';
import { readAccountFromEnv } from '../workspace/envFile.js';
import { ChannelLost, ChannelUnavailable } from '../ws/channel.js';
import { FrameParseError } from '../ws/frames.js';
import {
  approvalPending,
  cancelRecordRun,
  describeWalk,
  finishWalk,
  recoverWalk,
  acceptWalkFrame,
  reduceWalk,
  sentWalk,
  walkAdvance,
  walkChannelLost,
  walkInitial,
  walkIsTerminal,
  walkNeedsUser,
  walkSavedSchema,
  type WalkState,
} from './recordWalk.js';
import { content } from './moduleCall.js';

/** How long the plan may take to arrive on the channel once the run waits for the approval. */
export const PLAN_FRAME_TIMEOUT_MS = 15_000;
const ADVICE =
  'Update the LoadCraft server, or record the journeys in a browser and use flows_import_har.';

const input = z.strictObject({
  description: z
    .string()
    .trim()
    .min(20)
    .describe(
      'What users do in the application, in plain words (at least 20 characters), e.g. "Customers ' +
        'log in, search for a product, add it to the cart and pay; some only browse the catalog".',
    ),
  environment: z
    .string()
    .trim()
    .min(1)
    .describe('Name of the environment whose frontend address the LoadCraft browser opens.'),
  account: z
    .strictObject({
      from_env: z
        .string()
        .trim()
        .min(1)
        .describe('Path of an env file in the repository, e.g. ".env.perf".'),
      email_key: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Key of the login (email) in that file; default TEST_USER_EMAIL.'),
      password_key: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Key of the password in that file; default TEST_USER_PASSWORD.'),
    })
    .optional()
    .describe(
      'Test account the browser signs in with, read by the server from an env file; pass key ' +
        'names, never values. Omit it for an application that needs no sign-in.',
    ),
  max_steps: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe('Most browser actions per path; default: LoadCraft decides.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  max_wait_s: maxWaitInput('the plan of the paths'),
});

// ---- the address the browser opens ------------------------------------------------------------

function v4Private(address: string): boolean {
  const [a = -1, b = -1] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function v4LinkLocal(address: string): boolean {
  const [a = -1, b = -1] = address.split('.').map(Number);
  return a === 169 && b === 254;
}

function v6Private(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(lower)?.[1];
  if (mapped !== undefined) return v4Private(mapped);
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd][0-9a-f]{0,2}:/u.test(lower) || /^fe[89ab][0-9a-f]?:/u.test(lower);
}

/**
 * Whether the host of `url` is a loopback, private, link-local or local-only name, which the
 * browser of a LoadCraft server elsewhere does not reach. The ranges follow the address checks of
 * the backend (`is_loopback`, `is_private`,
 * `is_link_local`) for literal addresses; names are not resolved.
 */
export function isPrivateAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  switch (isIP(bare)) {
    case 4:
      return v4Private(bare);
    case 6:
      return v6Private(bare);
    default:
      return false;
  }
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  } catch {
    return undefined;
  }
}

/** 169.254.0.0/16 and fe80::/10 (also as an IPv4-mapped address): the cloud metadata range. */
function isLinkLocalAddress(url: string): boolean {
  const host = hostOf(url);
  if (host === undefined) return false;
  switch (isIP(host)) {
    case 4:
      return v4LinkLocal(host);
    case 6: {
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host)?.[1];
      return mapped !== undefined ? v4LinkLocal(mapped) : /^fe[89ab][0-9a-f]?:/u.test(host);
    }
    default:
      return false;
  }
}

/** Loopback only: `localhost`, `*.localhost`, 127.0.0.0/8, `::1` (also IPv4-mapped). */
export function isLoopbackAddress(url: string): boolean {
  const host = hostOf(url);
  if (host === undefined) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  switch (isIP(host)) {
    case 4:
      return host.startsWith('127.');
    case 6:
      return host === '::1' || /^::ffff:127\./u.test(host);
    default:
      return false;
  }
}

export type TargetRefusal = 'private' | 'link_local' | 'blocked_local' | 'blocked';

/**
 * Why the browser of the LoadCraft server will not open `frontendUrl`, or undefined. Link-local
 * addresses (cloud metadata) are always refused. Private and loopback addresses are refused up
 * front only when the backend of the plugin (`apiUrl`) is not on the loopback: a backend on this
 * machine decides for itself, and its probe result (`blocked`) is the verdict then.
 */
export function targetRefusal(
  frontendUrl: string,
  probe: 'blocked' | 'ok' | undefined,
  apiUrl: string,
): TargetRefusal | undefined {
  if (isLinkLocalAddress(frontendUrl)) return 'link_local';
  const backendLocal = isLoopbackAddress(apiUrl);
  if (!backendLocal && isPrivateAddress(frontendUrl)) return 'private';
  if (probe === 'blocked') return backendLocal ? 'blocked_local' : 'blocked';
  return undefined;
}

/** An address with a scheme; an environment may hold a bare host (`perf.example.com`). */
function withScheme(address: string): string | undefined {
  for (const candidate of [address, `https://${address}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return candidate;
    } catch {
      // the next candidate
    }
  }
  return undefined;
}

/** The address the browser opens, or the error that says why there is none it can reach. */
function targetUrl(environment: string, target: DescribeTarget, ctx: ToolContext): string {
  const url = target.frontendUrl === null ? undefined : withScheme(target.frontendUrl);
  if (url === undefined) {
    throw new ToolError('environment_without_frontend', {
      params: { environment: inline(environment) },
    });
  }
  const reason = targetRefusal(
    url,
    target.frontendProbe === 'blocked' ? 'blocked' : undefined,
    ctx.config.apiUrl,
  );
  if (reason !== undefined) {
    throw new ToolError('target_unreachable', {
      params: { url: inline(url), reason: ctx.t(`describe.unreachable.${reason}`) },
    });
  }
  return url;
}

// ---- the run as a long operation ----------------------------------------------------------------

const savedSchema = z.object({
  projectId: z.string(),
  environmentId: z.string(),
  /** Digest of what the call asked for: a call that asks the same continues this run. */
  match: z.string(),
  account: z
    .object({
      file: z.string(),
      emailKey: z.string(),
      /** Absent in entries written before it was kept: the default key of the env file. */
      passwordKey: z.string().optional(),
    })
    .nullable(),
  /** The proposed paths as the planner wrote them, kept for the approval. */
  plan: z
    .object({
      proposed: z.array(z.record(z.string(), z.unknown())),
      sharedSignIn: z.boolean(),
    })
    .optional(),
  /** Set by `flows_record_journeys`: the walk the handle follows once it is approved. */
  walk: walkSavedSchema.optional(),
});
/** What a `record_run` operation keeps in the state file. */
export type RecordRunSaved = z.infer<typeof savedSchema>;
type Saved = RecordRunSaved;

interface PlanState {
  readonly phase: 'plan';
  /** Undefined until the first read. */
  readonly run?: DescribeRun;
  /** The plan was read and shown: a run that still waits for its approval waits for the user. */
  readonly shown: boolean;
}

type RunState = PlanState | WalkState;

/** The channel of a run: the plan is read there, and the walk followed. */
const RUN_CHANNEL = 'describe' as const;

/** Ended runs that left nothing to approve or walk. */
const FAILED: ReadonlySet<string> = new Set(['failed', 'cancelled', 'interrupted']);
export const ENDED: ReadonlySet<string> = new Set([...FAILED, 'completed', 'needs_input']);

/** `r-` and the first 8 characters of the run id: what the user and `flows_record_journeys` name the plan by. */
export function planHandle(runId: string): string {
  return `r-${runId.slice(0, 8).toLowerCase()}`;
}

const PLAN_HANDLE = /^r-([0-9a-f]{8})$/iu;

/** Whether `given` is the short handle of a plan (`r-xxxxxxxx`). */
export function isPlanHandle(given: unknown): boolean {
  return typeof given === 'string' && PLAN_HANDLE.test(given.trim());
}

/** The newest plan this workspace recorded (in memory or `state.json`) under the short handle. */
export function findPlanRun(
  ctx: ToolContext,
  given: string,
): { readonly id: string; readonly saved: RecordRunSaved } | undefined {
  const short = PLAN_HANDLE.exec(given.trim())?.[1]?.toLowerCase();
  if (short === undefined) return undefined;
  return findAllRunning(ctx, recordRunOperation, () => true, Number.POSITIVE_INFINITY)
    .filter((run) => run.id.toLowerCase().startsWith(short))
    .at(-1);
}

/** The operation handle (`record_run:<id>`) of a plan; an unknown plan is a named error. */
export function planOperationHandle(ctx: ToolContext, given: string): string {
  const found = findPlanRun(ctx, given);
  if (found === undefined) {
    throw new ToolError('operation_unknown', { params: { value: inline(given, 120) } });
  }
  return encodeHandle('record_run', found.id);
}

/** The saved data of the run without a walk: the plan, waiting to be approved. */
function plain(saved: Saved): Saved {
  return {
    projectId: saved.projectId,
    environmentId: saved.environmentId,
    match: saved.match,
    account: saved.account,
    ...(saved.plan === undefined ? {} : { plan: saved.plan }),
  };
}

/** Keeps the run in the state file (with the plan, once read) after the wait for it ended. */
async function keep(ctx: ToolContext, id: string, saved: Saved): Promise<void> {
  await recordOperation(ctx.state, {
    kind: 'record_run',
    id,
    startedAt: ctx.clock.now(),
    saved: plain(saved),
  });
}

/** The account as the views name it: the file and the key of the login. */
function accountShown(account: Saved['account']): DescribeFlowsData['accountUsed'] {
  return account === null ? null : { file: account.file, emailKey: account.emailKey };
}

/**
 * Registers the password of the run's account in the secrets of this call. A file that cannot be
 * read any more fails nothing here: it only leaves the password unknown to this call.
 */
async function accountSecret(ctx: ToolContext, saved: Saved): Promise<void> {
  const { account } = saved;
  if (account === null) return;
  try {
    await readAccountFromEnv(ctx.config.workspaceRoot, account.file, ctx.secrets, {
      emailKey: account.emailKey,
      ...(account.passwordKey === undefined ? {} : { passwordKey: account.passwordKey }),
    });
  } catch (error) {
    ctx.log.info('account file of the run not read; its password is not masked in this call', {
      code: error instanceof ToolError ? error.code : 'unknown',
    });
  }
}

function failed(run: DescribeRun, ctx: ToolContext): ToolError {
  return new ToolError('describe_run_failed', {
    params: {
      status: run.status,
      detail:
        withheldJobText(ctx, 'flows_describe_journeys', run.error) ??
        ctx.t('describe.failed.noDetail'),
    },
  });
}

function stateText(run: DescribeRun, ctx: ToolContext): string {
  if (run.awaitingApproval) return ctx.t('describe.state.awaiting');
  if (run.status === 'queued' || run.status === 'running') return ctx.t('describe.state.planning');
  return ctx.t('describe.state.other', { status: inline(run.status) });
}

/** Codes `openChannel` gives a refused handshake or a refusing close code. */
const REFUSALS: ReadonlySet<string> = new Set(['unauthorized', 'forbidden', 'not_found']);

/** The channel's refusal or failure, as an error that keeps the run (it waits in LoadCraft). */
function channelError(error: unknown, link: string, ctx: ToolContext): ToolError | undefined {
  // A handshake refused before it is accepted reaches the client as HTTP 403 whatever the reason;
  // a close code after the accept tells the reasons apart.
  if (error instanceof LoadcraftApiError && REFUSALS.has(error.code)) {
    return new ToolError('describe_channel_refused', {
      params: { reason: ctx.t(`describe.refusal.${error.code}`), link },
      cause: error,
    });
  }
  if (error instanceof ChannelUnavailable || error instanceof ChannelLost) {
    return new ToolError('describe_channel_unavailable', { params: { link }, cause: error });
  }
  return undefined;
}

function started(id: string, run: DescribeRun, saved: Saved, link: string): DescribeFlowsData {
  return {
    plan: planHandle(id),
    paths: run.walked.map((name): DescribedPath => ({
      name,
      steps: [],
      dependsOnPrior: false,
      ownIdentity: false,
    })),
    sharedSignIn: [],
    single: run.walked.length <= 1,
    started: true,
    accountUsed: accountShown(saved.account),
    link,
  };
}

async function finishPlan(
  ctx: ToolContext,
  id: string,
  state: PlanState,
  saved: Saved,
): Promise<DoneOutcome<DescribeFlowsData>> {
  const run = state.run ?? (await getDescribeRun(ctx, saved.projectId, id));
  if (FAILED.has(run.status)) throw failed(run, ctx);
  const link = ctx.services.links.describeRun(saved.projectId, id);
  if (!run.awaitingApproval) {
    // The walk has begun (one path, or a split approved in the app) or ended: nothing to approve.
    await keep(ctx, id, {
      ...saved,
      plan: { proposed: run.walked.map((name) => ({ name, steps: [] })), sharedSignIn: false },
    });
    return { status: 'done', data: started(id, run, saved, link.url), links: [link] };
  }

  // Kept before the socket opens: a call that asks again after a failed read continues this run.
  await keep(ctx, id, saved);
  let read: PlanRead;
  try {
    read = await readPlan(
      { config: ctx.config, log: ctx.log, signal: ctx.signal, clock: ctx.clock },
      saved.projectId,
      id,
      PLAN_FRAME_TIMEOUT_MS,
    );
  } catch (error) {
    const known = channelError(error, link.url, ctx);
    if (known !== undefined) {
      ctx.log.info('describe channel failed', { error });
      throw known;
    }
    if (!(error instanceof FrameParseError)) throw error;
    // A frame outside the contract must show in the log; the plan then counts as not received.
    ctx.log.warn('describe channel frame outside the contract', { error });
    read = { kind: 'none' };
  }

  if (read.kind === 'none') {
    const now = await getDescribeRun(ctx, saved.projectId, id);
    if (FAILED.has(now.status)) throw failed(now, ctx);
    if (!now.awaitingApproval && (now.walked.length > 0 || ENDED.has(now.status))) {
      return { status: 'done', data: started(id, now, saved, link.url), links: [link] };
    }
    throw new ToolError('plan_not_received', {
      params: {
        seconds: PLAN_FRAME_TIMEOUT_MS / 1000,
        state: stateText(now, ctx),
        link: link.url,
      },
    });
  }

  const shared = saved.account !== null && read.sharedSignIn;
  await keep(ctx, id, {
    ...saved,
    plan: { proposed: read.paths.map((path) => ({ ...path.raw })), sharedSignIn: shared },
  });
  return { status: 'done', data: planView(ctx, id, read.paths, shared, saved, link.url) };
}

/** The plan as `flows_describe_journeys` shows it: from the proposal read, or from the plan kept. */
function planView(
  ctx: ToolContext,
  id: string,
  paths: readonly ProposedPath[],
  shared: boolean,
  saved: Saved,
  link: string,
): DescribeFlowsData {
  return {
    plan: planHandle(id),
    // the generator's names, shown masked; a masked name still picks its path (FIX-76)
    paths: paths.map((path) => ({
      name: content(ctx, path.name, 120),
      steps: [...path.steps],
      dependsOnPrior: path.dependsOnPrior,
      ownIdentity: path.ownIdentity,
    })),
    // One sign-in runs before every path except one that registers its own account
    // (`shared_login_is_wanted`).
    sharedSignIn: shared ? paths.filter((path) => !path.ownIdentity).map((path) => path.name) : [],
    single: paths.length === 1,
    started: false,
    accountUsed: accountShown(saved.account),
    link,
  };
}

/**
 * The same request again, after its plan was shown: while the run still waits for the approval,
 * the plan kept in the workspace is shown again as it was, with no socket and nothing sent.
 */
async function shownAgain(
  ctx: ToolContext,
  matches: (saved: Saved) => boolean,
): Promise<DoneOutcome<DescribeFlowsData> | undefined> {
  const found = findAllRunning(ctx, recordRunOperation, matches).at(-1);
  if (found === undefined) return undefined;
  const { id, saved } = found;
  if (saved.plan === undefined || saved.walk !== undefined) return undefined;
  const run = await getDescribeRun(ctx, saved.projectId, id);
  if (!run.awaitingApproval || ENDED.has(run.status)) return undefined;
  const link = ctx.services.links.describeRun(saved.projectId, id).url;
  const paths = saved.plan.proposed.map((raw) => proposedPath(raw));
  return { status: 'done', data: planView(ctx, id, paths, saved.plan.sharedSignIn, saved, link) };
}

/** The handle and the path names of the plan kept with the run. */
function planOf(id: string, saved: Saved): { handle: string; names: string[] } {
  return {
    handle: planHandle(id),
    names: (saved.plan?.proposed ?? []).map((raw) => proposedPath(raw).name),
  };
}

/** A plan already shown whose run still waits for the approval: only the user moves it on. */
function planWaits(state: PlanState): boolean {
  const { run } = state;
  return state.shown && run !== undefined && run.awaitingApproval && !ENDED.has(run.status);
}

function planIsTerminal(state: PlanState): boolean {
  const { run } = state;
  if (run === undefined || planWaits(state)) return false;
  return run.awaitingApproval || ENDED.has(run.status) || run.walked.length > 0;
}

async function finishRun(
  ctx: ToolContext,
  id: string,
  state: RunState,
  saved: Saved,
): Promise<DoneOutcome<RecordRunData>> {
  if (state.phase === 'plan') return finishPlan(ctx, id, state, saved);
  // A refused approval leaves the run waiting for one: the plan stays, `flows_record_journeys` can try again.
  if (state.refusal !== undefined) await keep(ctx, id, saved);
  return finishWalk(ctx, id, state, saved.projectId);
}

export const recordRunOperation = defineOperationKind({
  kind: 'record_run',
  saved: savedSchema,
  initial: (_ctx, _id, saved): RunState =>
    saved.walk === undefined
      ? { phase: 'plan', shown: saved.plan !== undefined }
      : walkInitial(saved.walk),
  secrets: accountSecret,
  // The walk is approved once the socket took the approval or the walk was seen under way.
  advance: (state, saved) =>
    state.phase === 'walk' && saved.walk !== undefined
      ? { ...saved, walk: walkAdvance(state, saved.walk) }
      : saved,
  // A walk not approved yet is not kept: the entry stays the plan, which a `process_wait` only reads.
  stored: (saved) =>
    saved.walk === undefined || saved.walk.approved === true ? saved : plain(saved),
  // Only the walk follows the channel; the plan is read by REST and one frame (`readPlan`).
  channel: {
    name: RUN_CHANNEL,
    params: (id, saved) => ({ project_id: saved.projectId, run_id: id }),
    enabled: (saved) => saved.walk !== undefined,
    accept: (ctx, frame) => acceptWalkFrame(ctx, frame),
    reduce: (state, frame) => (state.phase === 'walk' ? reduceWalk(state, frame) : state),
    sent: (state, message) => (state.phase === 'walk' ? sentWalk(state, message) : state),
  },
  recover: async (ctx, id, saved): Promise<RunState> =>
    saved.walk === undefined
      ? {
          phase: 'plan',
          run: await getDescribeRun(ctx, saved.projectId, id),
          shown: saved.plan !== undefined,
        }
      : recoverWalk(ctx, id, saved.projectId, saved.walk),
  recoverIsRead: true,
  isTerminal: (state) => (state.phase === 'walk' ? walkIsTerminal(state) : planIsTerminal(state)),
  // a plan shown, or a refused approval, keeps the run (`finish` records it again); a walk ends as it ended
  ended: (state) =>
    state.phase !== 'walk' || state.end === undefined || state.end.kind === 'complete'
      ? undefined
      : state.end.kind === 'cancelled'
        ? 'cancelled'
        : 'failed',
  needsUser: (ctx, id, state, saved) => {
    if (state.phase === 'walk') {
      return walkNeedsUser(ctx, id, state, saved.projectId, planOf(id, saved));
    }
    return planWaits(state)
      ? approvalPending(ctx, id, saved.projectId, planOf(id, saved))
      : undefined;
  },
  channelLost: async (ctx, id, state, saved) => {
    if (state.phase !== 'walk') return;
    try {
      await walkChannelLost(ctx, id, state, saved.projectId);
    } catch (error) {
      // The approval was never sent: the plan stays, without it, so that `process_wait` (which only reads)
      // never sends it later; `flows_record_journeys` approves again.
      await keep(ctx, id, saved);
      throw error;
    }
  },
  describe: (state, t) => {
    if (state.phase === 'walk') return describeWalk(state, t);
    return {
      message: t(
        state.run === undefined || state.run.status === 'queued'
          ? 'describe.progress.queued'
          : 'describe.progress.planning',
      ),
    };
  },
  finish: finishRun,
  view: renderRecordRun,
  // The walk stops gently on the channel; a run that waits for the approval is cancelled.
  cancel: (ctx, id, saved) => cancelRecordRun(ctx, id, saved.projectId, saved.walk !== undefined),
});

// ---- the tool ---------------------------------------------------------------------------------

/** What makes two calls the same request: the same text, address, account and limit. */
function matchOf(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export const flowsDescribeJourneys = defineTool({
  name: 'flows_describe_journeys',
  title: 'Plan flows from a description',
  description:
    'Flows from a description, browser walk, plan of paths: LoadCraft opens the customer ' +
    "application at the environment's frontend address in its own browser, signs in with the " +
    'given test account (read by this server from an env file; the password never passes ' +
    'through the model) and splits the description into paths. Returns the plan (handle ' +
    'r-xxxxxxxx) for the user to approve with flows_record_journeys; with a single path the walk starts ' +
    'at once. It does not record or save flows, and it reaches a private or local address only when the LoadCraft backend runs on ' +
    'this machine and allows it (otherwise use flows_import_har with a HAR recording). Use a test account, never a production one: ' +
    'LoadCraft keeps the credentials with the run.',
  input,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await requireCapability(ctx.services.http, 'api_token_sockets', ADVICE);
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project?.trim() ?? '');
    const environment = await resolver.environment(project.id, args.environment);
    const target = await getDescribeTarget(ctx, project.id, environment.id);
    if (target === undefined) {
      throw new ToolError('environment_without_frontend', {
        params: { environment: content(ctx, environment.name, 120) },
      });
    }
    const url = targetUrl(environment.name, target, ctx);

    const wanted = args.account;
    const account =
      wanted === undefined
        ? undefined
        : await readAccountFromEnv(ctx.config.workspaceRoot, wanted.from_env, ctx.secrets, {
            ...(wanted.email_key === undefined ? {} : { emailKey: wanted.email_key }),
            ...(wanted.password_key === undefined ? {} : { passwordKey: wanted.password_key }),
          });

    const appContext = await appContextFor(
      ctx.config.workspaceRoot,
      await getProjectDescription(ctx, project.id),
      ctx.secrets,
    );

    const match = matchOf([
      args.description,
      environment.id,
      url,
      wanted?.from_env ?? null,
      account?.keys.email ?? null,
      account?.keys.password ?? null,
      args.max_steps ?? null,
    ]);
    const saved: Saved = {
      projectId: project.id,
      environmentId: environment.id,
      match,
      account:
        wanted === undefined || account === undefined
          ? null
          : {
              file: wanted.from_env,
              emailKey: account.keys.email,
              passwordKey: account.keys.password,
            },
    };
    const matches = (other: Saved): boolean =>
      other.projectId === project.id && other.match === match;
    const again = await shownAgain(ctx, matches);
    if (again !== undefined) return again;
    return startOrJoin(ctx, recordRunOperation, {
      maxWaitS: args.max_wait_s,
      matches,
      start: async () => {
        const id = await startDescribeRun(ctx, project.id, {
          description: args.description,
          targetUrl: url,
          environmentId: environment.id,
          ...(args.max_steps === undefined ? {} : { maxSteps: args.max_steps }),
          ...(appContext === undefined ? {} : { appContext }),
          ...(account === undefined
            ? {}
            : { account: { username: account.email, password: account.password } }),
        });
        return { id, saved };
      },
    });
  },
  render: renderRecordRun,
});
