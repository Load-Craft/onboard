// Long operations: one definition per kind says where the state comes from (a WebSocket channel
// with a REST recovery, or REST only), and `awaitOperation` gives every waiting tool the same
// behaviour: progress, a time limit that returns a handle, resuming that handle later, and falling
// back to REST when the channel fails. Swapping a kind from its channel to a REST state read means
// editing its definition only; tools and views do not see the difference.
//
// The kind owns its final view: the tool that starts an operation and `process_wait` both draw finished
// data with `view` of the kind, so they show the same text. An unfinished outcome is drawn by the
// registry from `describe`.
//
// A client abort (Esc) ends the wait, never the operation: the channel is closed, the cache entry
// stays, and `cancel` of the kind is called only by the `process_cancel` tool.

import * as z from 'zod';

import type { ToolContext, Translator } from '../context.js';
import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import type { DoneOutcome, Link, OperationProgress, PendingData } from '../outcome.js';
import type { EndedRow, StateCache } from '../workspace/cache.js';
import { OPERATION_MODULE } from '../workspace/migrate.js';
import { ChannelLost, ChannelUnavailable, DEFAULT_RECONNECT, openChannel } from '../ws/channel.js';
import type { ChannelHandle, ClientMessage, ReconnectPolicy } from '../ws/channel.js';
import { FrameParseError } from '../ws/frames.js';
import type { Channel, ParsedFrame } from '../ws/frames.js';
import type { ChannelParams } from '../ws/url.js';
import { abortError } from './clock.js';
import { pollUntil } from './poll.js';
import { createWriteChain, type WriteChain } from './writeChain.js';

// ---- handles ----------------------------------------------------------------------------

/** The name of a WebSocket channel, for the code that is generic over the channel of a kind (`src/tools/kit/operation.ts`). */
export type KindChannel = Channel;

/** Kinds accepted by the `process_wait` tool. */
export const OPERATION_KINDS = [
  'setup_analysis',
  'refine',
  'batch_generation',
  'flow_generation',
  'har_generation',
  'har_split',
  'scenario_generation',
  'self_check',
  'record_run',
  'test_run',
  'analysis',
  'account_provision',
  'drift_check',
  'test_types_generation',
  'payload_generation',
  'dataset_generation',
] as const;
export type OperationKindName = (typeof OPERATION_KINDS)[number];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HANDLE_FORMAT = '<kind>:<id>, e.g. "test_run:0b5c77aa-…"';

function isKindName(value: string): value is OperationKindName {
  return (OPERATION_KINDS as readonly string[]).includes(value);
}

function invalidHandle(message: string, value: string): ToolError {
  return new ToolError('invalid_operation', {
    message,
    params: { value },
    hint: `Pass the operation handle exactly as a tool returned it (${HANDLE_FORMAT}).`,
  });
}

export function encodeHandle(kind: OperationKindName, id: string): string {
  if (!isKindName(kind))
    throw invalidHandle(`Unknown operation kind "${String(kind)}".`, String(kind));
  if (!ID_PATTERN.test(id)) throw invalidHandle(`"${id}" is not a valid operation id.`, id);
  return `${kind}:${id}`;
}

export function parseHandle(handle: unknown): { kind: OperationKindName; id: string } {
  if (typeof handle !== 'string')
    throw invalidHandle('The operation handle must be a string.', typeof handle);
  const at = handle.indexOf(':');
  if (at <= 0) throw invalidHandle(`"${handle}" is not an operation handle.`, handle);
  const kind = handle.slice(0, at);
  const id = handle.slice(at + 1);
  if (!isKindName(kind)) {
    throw invalidHandle(
      `Unknown operation kind "${kind}"; known kinds: ${OPERATION_KINDS.join(', ')}.`,
      handle,
    );
  }
  if (!ID_PATTERN.test(id)) throw invalidHandle(`"${handle}" has no valid operation id.`, handle);
  return { kind, id };
}

// ---- definitions ------------------------------------------------------------------------

/** A long operation runs in the context of the tool that waits for it (state and clock included). */
export type OperationContext = ToolContext;

/**
 * Returned when the wait ended before the operation did; `wait(operation)` continues. `running`:
 * the time limit of the call passed. `needs_user`: the operation waits for something only the user
 * can do (`needsUser` of the kind), and `links` say where.
 */
export interface RunningOperation {
  readonly status: 'running' | 'needs_user';
  readonly operation: string;
  readonly data: PendingData;
  readonly links?: readonly Link[];
}

/** What an operation waits for from the user, in the language of the call, and where it is done. */
export interface NeedsUser {
  readonly message: string;
  readonly links?: readonly Link[];
  /** The next step, when it is not `process_wait`: the user's part is done by another tool. */
  readonly next?: string;
}

export type OperationOutcome<D> = DoneOutcome<D> | RunningOperation;

/** What a kind adds to a snapshot of its operation; every field is optional. */
export interface KindSnapshot {
  /** Where the operation stands, as a code of the kind (`building`, `running`, `completed`…). */
  readonly phase?: string;
  /** Seconds the load has been running, for an operation that has a start of its own. */
  readonly loadElapsedS?: number;
  /** Planned seconds of the operation, when the kind knows them. */
  readonly plannedS?: number;
  /** Numbers of the operation in flight; `null` for one the metrics store did not give. */
  readonly live?: {
    readonly rps: number | null;
    readonly p95Ms: number | null;
    /** Percent points: 0.6 is 0.6%. */
    readonly errorPct: number | null;
  };
  /** What the operation waits for from the user, when it does. */
  readonly needsUser?: string;
  /** Why an operation that failed failed, in one clean line; absent when no reason is known. */
  readonly reason?: string;
  /** The view of a self-check as the state file section holds it, read now (never written by a snapshot). */
  readonly selfCheck?: Readonly<Record<string, unknown>>;
}

/** One reading of an operation, in the shape `process_get_status` returns for `operation`. */
export interface OperationSnapshot {
  readonly operation: string;
  readonly kind: OperationKindName;
  readonly phase?: string;
  /** Seconds since the operation started, on the clock of this call. */
  readonly elapsed_s: number;
  readonly load_elapsed_s?: number;
  readonly planned_s?: number;
  readonly live?: {
    readonly rps: number | null;
    readonly p95_ms: number | null;
    readonly error_pct: number | null;
  };
  readonly needs_user?: string;
  readonly reason?: string;
  readonly selfCheck?: Readonly<Record<string, unknown>>;
}

export interface OperationChannel<S, V, C extends Channel> {
  readonly name: C;
  params(id: string, saved: V): ChannelParams<C>;
  /**
   * For a channel that sends nothing on connect and replays nothing (the backend says "connect first"): the
   * address of the channel from the id alone. `startOrJoin` then chooses the id first (`StartOrJoin.newId`),
   * connects, and only then starts the work, so no frame sent right after the start is lost; the same
   * connection is the one the wait follows. Without it the channel is opened once the work has started.
   */
  connectFirst?(id: string): ChannelParams<C>;
  /**
   * The message that asks the backend to stop (`process_cancel`). A kind that has it and no cancel method of its own is
   * stopped by sending it on a fresh connection and waiting for the answer frame; the stop counts as accepted
   * (`'stopping'`): a backend that cannot interrupt the work it already does still ends the operation itself.
   */
  readonly cancelMessage?: ClientMessage;
  // What the connection presents (token, Origin) follows the frame contract of the channel.
  /**
   * Whether this operation follows the channel at all; default: it does. A kind whose operation
   * has a part without a channel says which saved data has one.
   */
  enabled?(saved: V): boolean;
  /**
   * Takes a frame as it arrives, before `reduce`: where the call's context is at hand, so a text of a
   * third party in it (a name, a label) is masked with the secrets of the call registered (FIX-77).
   * The answer of the call (`respond`) still sees the frame as it came.
   */
  accept?(ctx: OperationContext, frame: ParsedFrame<C>): ParsedFrame<C>;
  /** Folds one frame into the state; keep-alive and unknown frames never reach it. */
  reduce(state: S, frame: ParsedFrame<C>): S;
  /**
   * Folds a message the call sent on the socket (`AwaitOptions.respond`) into the state, once the
   * socket took it.
   */
  sent?(state: S, message: ClientMessage): S;
  /** The channel counts as lost after this long without a frame. */
  readonly silenceMs?: number;
  /** Reconnects before the channel counts as lost; default `DEFAULT_RECONNECT`. */
  readonly reconnect?: ReconnectPolicy;
}

export interface OperationKindSpec<S, D, V, C extends Channel> {
  readonly kind: OperationKindName;
  /** Shape of the data saved when the operation started (tags, source flow, start time…). */
  readonly saved: z.ZodType<V>;
  initial(ctx: OperationContext, id: string, saved: V): S;
  /**
   * Optional: registers the secrets the backend may repeat in the state of this operation (the
   * password of an account the saved data names), so that no output of the call shows them. Called
   * before the first read of the channel or REST by every call that follows, reads or stops the
   * operation; it must not fail the call.
   */
  secrets?(ctx: OperationContext, saved: V): Promise<void>;
  /**
   * Optional: the saved data once the call has seen `state`: what a later call of the same handle
   * must know (an answer the socket took, a part of the operation that began). The wait goes on
   * with it and the entry keeps it. It never undoes what an earlier state settled.
   */
  advance?(state: S, saved: V): V;
  /**
   * Optional: what the entry keeps of `saved`, when not all of it: data only the call that
   * carries it may act on stays out of the state file. Default: all of it.
   */
  stored?(saved: V): V;
  /** Way 1, optional: frames of a channel change the state. */
  readonly channel?: OperationChannel<S, V, C>;
  /**
   * Way 2, required: the state rebuilt through REST, e.g. whether the result of the operation
   * already exists. A `LoadcraftApiError` with status 404 means the backend forgot the operation.
   */
  recover(ctx: OperationContext, id: string, saved: V): Promise<S>;
  /**
   * `recover` only reads from the backend, so the time limit of a call may use it to look for a
   * result. Leave it unset when `recover` can start or change anything.
   */
  readonly recoverIsRead?: boolean;
  /**
   * Optional: what a single read shows of the operation, for `snapshotOperation`. It reads and
   * never waits, writes nothing and leaves the entry of the operation alone. A kind without it
   * has nothing to show but the time since the start.
   */
  snapshot?(ctx: OperationContext, id: string, saved: V): Promise<KindSnapshot>;
  isTerminal(state: S): boolean;
  /**
   * Optional: called after a read of the channel or of REST gave a state that is not terminal, for a view
   * of the operation a client beside the chat reads from the state file while the operation runs. It runs
   * in the write chain of the call, after the read, so it never holds the wait; it writes only a section
   * of its own and only when what it shows changed. A failure is logged as a warning and the operation
   * goes on. A terminal state is left to `finish`, which writes what the end shows.
   */
  observe?(ctx: OperationContext, id: string, state: S, saved: V): Promise<void>;
  /**
   * Optional: how the operation ended in a terminal `state`, for its row in the process. Undefined
   * (or absent) leaves it to `finish`: `done` when it returned, `failed` when it threw. A kind whose
   * state says a failure, a stop or a loss (also one `finish` reports as a plain result) names it.
   */
  ended?(state: S): OperationEnd | undefined;
  /**
   * Optional: what the operation waits for from the user in `state`, or undefined. The wait ends
   * with `needs_user` and keeps the entry: after the user acted, `process_wait` follows the operation on.
   */
  needsUser?(ctx: OperationContext, id: string, state: S, saved: V): NeedsUser | undefined;
  /**
   * Optional: called once when the channel failed, before the state is read through REST. A
   * `ToolError` thrown here ends the wait and keeps the entry: for a step only the channel can
   * take, which REST would wait for in vain.
   */
  channelLost?(ctx: OperationContext, id: string, state: S, saved: V): Promise<void>;
  /** Progress in the language of the call; the registry draws it while the operation runs. */
  describe(state: S, t: Translator): OperationProgress;
  finish(ctx: OperationContext, id: string, state: S, saved: V): Promise<DoneOutcome<D>>;
  /** Text of the finished data (a `render/views/*` function); `process_wait` draws with it too. */
  readonly view: (data: D, t: Translator) => string;
  /** Delay between two REST reads of the state; default: 2 s growing to 5 s (`pollUntil`). */
  readonly pollIntervalMs?: number;
  /**
   * Called only by the `process_cancel` tool; absent when the operation cannot be stopped. Resolves `true`
   * when the backend stopped it, `'stopping'` when the backend accepted a stop and the operation
   * still ends on its own (its entry stays, so `process_wait` shows how), and `false` when it was not
   * running (it ended, or is unknown).
   */
  cancel?(ctx: OperationContext, id: string, saved: V): Promise<boolean | 'stopping'>;
}

export interface AwaitOptions<V, S = unknown, C extends Channel = Channel> {
  readonly maxWaitS: number;
  /** Saved data of a new operation; when absent, read from the cache entry of the handle. */
  readonly saved?: V;
  /**
   * A message this call sends on the same socket after `frame` was folded into `state`: the answer
   * to a question the channel asks (it asks again on a new socket while the answer is missing).
   * It belongs to this call alone: the entry never holds it, so a later `process_wait` of the same handle
   * cannot send it.
   */
  readonly respond?: (state: S, frame: ParsedFrame<C>) => ClientMessage | undefined;
  /** The connection `startOrJoin` opened before the start (`connectFirst`); the wait follows it instead of opening one. */
  readonly connected?: ChannelHandle<C>;
}

/** A kind with its type parameters bound, ready to be awaited by handle (the `process_wait` tool). */
export interface OperationKind<S, D, V, C extends Channel = Channel> {
  readonly kind: OperationKindName;
  readonly spec: OperationKindSpec<S, D, V, C>;
}

/** Any kind, with its types erased, as a list for `resumeOperation` and `viewOperation`. */
export interface AnyOperationKind {
  readonly kind: OperationKindName;
  resume(ctx: OperationContext, id: string, maxWaitS: number): Promise<OperationOutcome<unknown>>;
  /** `view` of the kind for data that a resume of this kind finished with. */
  view(data: unknown, t: Translator): string;
  /** One reading of operation `id` from the saved data of its cache entry; never waits. */
  snapshot(ctx: OperationContext, id: string): Promise<OperationSnapshot>;
  /** Stops operation `id` using the saved data of the cache entry; absent for a kind that cannot. */
  readonly cancel?: (ctx: OperationContext, id: string) => Promise<boolean | 'stopping'>;
}

/** How long the answer to a stop message is awaited before the stop counts as sent. */
const STOP_ANSWER_MS = 2000;

/** `cancelMessage` of a channel: sent on a fresh connection, the first frame back is the answer. */
async function stopOnChannel<S, V, C extends Channel>(
  ctx: OperationContext,
  channel: OperationChannel<S, V, C>,
  message: ClientMessage,
  id: string,
  saved: V,
): Promise<boolean | 'stopping'> {
  const timer = new AbortController();
  let handle: ChannelHandle<C> | undefined;
  try {
    handle = await openChannel(
      { config: ctx.config, log: ctx.log, signal: ctx.signal },
      { channel: channel.name, params: channel.params(id, saved), clock: ctx.clock },
    );
    const open = handle;
    handle.send(message);
    ctx.clock.sleep(STOP_ANSWER_MS, timer.signal).then(
      () => open.close(),
      () => undefined,
    );
    for await (const frame of handle.frames) {
      ctx.log.debug('stop answered', { channel: channel.name, type: frame.type });
      break;
    }
    return 'stopping';
  } catch (error) {
    if (ctx.signal.aborted) throw abortError(ctx.signal);
    if (error instanceof ChannelLost || error instanceof ChannelUnavailable) return false;
    throw error;
  } finally {
    timer.abort();
    handle?.close();
  }
}

export function defineOperationKind<S, D, V, C extends Channel = Channel>(
  spec: OperationKindSpec<S, D, V, C>,
): OperationKind<S, D, V, C> & AnyOperationKind {
  const cancelMessage = spec.channel?.cancelMessage;
  const cancelling =
    spec.cancel?.bind(spec) ??
    (spec.channel !== undefined && cancelMessage !== undefined
      ? (ctx: OperationContext, id: string, saved: V) =>
          stopOnChannel(ctx, spec.channel as OperationChannel<S, V, C>, cancelMessage, id, saved)
      : undefined);
  const kind: OperationKind<S, D, V, C> & AnyOperationKind = {
    kind: spec.kind,
    spec,
    resume: (ctx, id, maxWaitS) => awaitOperation(ctx, kind, id, { maxWaitS }),
    // Reached only through a handle of this kind, whose finished data comes from `spec.finish`.
    view: (data, t) => spec.view(data as D, t),
    async snapshot(ctx, id) {
      const handle = encodeHandle(spec.kind, id);
      const { saved, startedAt } = resolveSaved(ctx, spec.saved, handle, undefined);
      await spec.secrets?.(ctx, saved);
      const base = {
        operation: handle,
        kind: spec.kind,
        elapsed_s: Math.max(0, (ctx.clock.now() - startedAt) / 1000),
      };
      if (spec.snapshot === undefined) return base;
      let shown: KindSnapshot;
      try {
        shown = await spec.snapshot(ctx, id, saved);
      } catch (error) {
        // Reading does not forget the operation: the entry stays for `process_wait` to settle.
        if (isNotFound(error)) throw operationLost(handle, error);
        throw error;
      }
      return {
        ...base,
        ...(shown.phase === undefined ? {} : { phase: shown.phase }),
        ...(shown.loadElapsedS === undefined ? {} : { load_elapsed_s: shown.loadElapsedS }),
        ...(shown.plannedS === undefined ? {} : { planned_s: shown.plannedS }),
        ...(shown.live === undefined
          ? {}
          : {
              live: {
                rps: shown.live.rps,
                p95_ms: shown.live.p95Ms,
                error_pct: shown.live.errorPct,
              },
            }),
        ...(shown.needsUser === undefined ? {} : { needs_user: shown.needsUser }),
        ...(shown.reason === undefined ? {} : { reason: shown.reason }),
        ...(shown.selfCheck === undefined ? {} : { selfCheck: shown.selfCheck }),
      };
    },
    ...(cancelling === undefined
      ? {}
      : {
          cancel: async (ctx, id) => {
            const { saved } = resolveSaved(ctx, spec.saved, encodeHandle(spec.kind, id), undefined);
            await spec.secrets?.(ctx, saved);
            return cancelling(ctx, id, saved);
          },
        }),
  };
  return kind;
}

// ---- cache entries ----------------------------------------------------------------------

const SECTION = 'operations';

const entrySchema = z.object({
  kind: z.string(),
  id: z.string(),
  startedAt: z.number(),
  saved: z.unknown(),
});

/** What `state.json → operations[handle]` holds; `process_get_status` lists these. */
export type OperationEntry = z.infer<typeof entrySchema>;

/** One operation recorded in the workspace, as `process_get_status` shows it. */
export interface OperationSummary {
  readonly handle: string;
  readonly kind: OperationKindName;
  readonly id: string;
  readonly startedAt: number;
}

/**
 * Operations recorded in the workspace state, oldest first. An entry that does not match the
 * schema, names an unknown kind or is stored under a key other than its `kind:id` is skipped.
 */
export function listOperations(state: Pick<StateCache, 'entries'>): OperationSummary[] {
  const listed: OperationSummary[] = [];
  for (const [handle, raw] of state.entries(SECTION)) {
    const checked = entrySchema.safeParse(raw.value);
    if (!checked.success) continue;
    const { kind, id, startedAt } = checked.data;
    if (!isKindName(kind) || handle !== `${kind}:${id}`) continue;
    listed.push({ handle, kind, id, startedAt });
  }
  return listed.sort((a, b) => a.startedAt - b.startedAt || (a.handle < b.handle ? -1 : 1));
}

/**
 * Records a started operation in the workspace state, so `process_wait`, `process_get_status` and later reports
 * find it (and what it saved) before anyone waits for it. Returns its handle.
 */
export async function recordOperation(
  state: Pick<StateCache, 'set'>,
  entry: { kind: OperationKindName; id: string; startedAt: number; saved: unknown },
): Promise<string> {
  const handle = encodeHandle(entry.kind, entry.id);
  await state.set(SECTION, handle, entry satisfies OperationEntry);
  return handle;
}

function readEntry(ctx: OperationContext, handle: string): OperationEntry | undefined {
  const raw = ctx.state.get(SECTION, handle);
  if (raw === undefined) return undefined;
  const checked = entrySchema.safeParse(raw.value);
  return checked.success ? checked.data : undefined;
}

/** No usable entry for the handle in this workspace (another directory, or a cleared cache). */
function operationUnknown(handle: string): ToolError {
  return new ToolError('operation_unknown', { params: { value: handle } });
}

function resolveSaved<V>(
  ctx: OperationContext,
  schema: z.ZodType<V>,
  handle: string,
  given: V | undefined,
): { saved: V; startedAt: number } {
  const entry = readEntry(ctx, handle);
  // Resuming needs the entry, even for a kind that saves nothing.
  if (given === undefined && entry === undefined) throw operationUnknown(handle);
  const startedAt = entry?.startedAt ?? ctx.clock.now();
  const checked = schema.safeParse(given ?? entry?.saved);
  if (!checked.success) throw operationUnknown(handle);
  return { saved: checked.data, startedAt };
}

// ---- waiting ----------------------------------------------------------------------------

/**
 * The longest one call waits, whatever `max_wait_s` asks for. Claude Code moves a tool call that
 * runs past 120 s to the background; staying under that returns the handle on every path.
 */
export const MAX_CALL_WAIT_S = 100;

/**
 * The `max_wait_s` input of every tool that waits for a long operation: default and limit are
 * the same everywhere, and the description tells the model what happens at the limit.
 */
export function maxWaitInput(what: string) {
  return z
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(MAX_CALL_WAIT_S)
    .describe(
      `Seconds the call waits for ${what}; at most ${String(MAX_CALL_WAIT_S)} (a larger value counts as ${String(MAX_CALL_WAIT_S)}). ` +
        'When it ends first, the result carries the operation handle (<kind>:<id>); pass it to process_wait to keep waiting.',
    );
}

/** Seconds one call may wait when the caller asked for `requestedS`. */
export function callWaitS(requestedS: number): number {
  return Math.min(Math.max(0, requestedS), MAX_CALL_WAIT_S);
}

/** Polling interval once the channel has failed. */
export const FALLBACK_POLL_MS = 5000;

/** How an operation ended, as its row in the process says. */
export type OperationEnd = 'done' | 'failed' | 'cancelled' | 'lost';

/**
 * The row of an ended operation, built on the row the file holds, so it keeps the tool that started the
 * operation and its label; complete, so it also stands for a row the file never got (no room).
 */
function endedRow(
  ctx: OperationContext,
  kind: OperationKindName,
  handle: string,
  startedAt: number,
  status: OperationEnd,
): EndedRow {
  const row = ctx.state.process()?.operations.find((one) => one.handle === handle);
  return {
    handle,
    kind,
    module: OPERATION_MODULE[kind],
    tool: row?.tool ?? kind,
    status,
    started_at: row?.started_at ?? new Date(startedAt).toISOString(),
    ...(row?.label === undefined ? {} : { label: row.label }),
  };
}

/**
 * Ends operation `handle` (recorded in this workspace) as `status`: for a tool that learns how an
 * operation ended outside a wait (a stop, a run the backend forgot, a series a restart left). The
 * call no longer sees it, and the registry writes its row with the log entry (`StateCache.endOperation`).
 */
export function endOperation(ctx: OperationContext, handle: string, status: OperationEnd): void {
  const { kind } = parseHandle(handle);
  const startedAt = readEntry(ctx, handle)?.startedAt ?? ctx.clock.now();
  ctx.state.endOperation(endedRow(ctx, kind, handle, startedAt, status));
}

export function operationLost(handle: string, cause?: unknown): ToolError {
  return new ToolError('operation_lost', {
    message: `LoadCraft no longer knows operation "${handle}", and its result was not found.`,
    hint: 'LoadCraft was restarted; check process_get_status and run the step again.',
    params: { value: handle },
    ...(cause === undefined ? {} : { cause }),
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof LoadcraftApiError && error.status === 404;
}

type ChannelResult<S> =
  | { readonly kind: 'terminal'; readonly state: S }
  | { readonly kind: 'needs_user'; readonly state: S }
  | { readonly kind: 'timeout'; readonly state: S }
  | { readonly kind: 'fallback'; readonly state: S }
  | { readonly kind: 'not_found'; readonly state: S };

interface Follow<S, V, C extends Channel> {
  readonly start: S;
  readonly deadline: number;
  /** The saved data as the call knows it now (`advance` may have changed it). */
  readonly saved: () => V;
  /** Every new state, after its frame was folded in and answered. */
  readonly seen: (state: S) => void;
  readonly respond?: (state: S, frame: ParsedFrame<C>) => ClientMessage | undefined;
  /** An open connection to follow (see `AwaitOptions.connected`). */
  readonly connected?: ChannelHandle<C>;
}

async function followChannel<S, D, V, C extends Channel>(
  ctx: OperationContext,
  spec: OperationKindSpec<S, D, V, C>,
  channel: OperationChannel<S, V, C>,
  id: string,
  follow: Follow<S, V, C>,
): Promise<ChannelResult<S>> {
  const { start, deadline } = follow;
  let state = start;
  let timedOut = false;
  // Ends the channel at the deadline; aborted in `finally` so no timer outlives the wait.
  const limit = new AbortController();
  const timer = new AbortController();
  ctx.clock.sleep(Math.max(0, deadline - ctx.clock.now()), timer.signal).then(
    () => {
      timedOut = true;
      limit.abort();
    },
    () => undefined,
  );

  let handle: ChannelHandle<C> | undefined;
  try {
    if (follow.connected === undefined) {
      handle = await openChannel(
        { config: ctx.config, log: ctx.log, signal: ctx.signal },
        {
          channel: channel.name,
          params: channel.params(id, follow.saved()),
          signal: limit.signal,
          reconnect: channel.reconnect ?? DEFAULT_RECONNECT,
          clock: ctx.clock,
          ...(channel.silenceMs === undefined ? {} : { silenceMs: channel.silenceMs }),
        },
      );
    } else {
      // Opened before the start: the time limit of this wait ends it here, as it would end one opened above.
      const opened = follow.connected;
      handle = opened;
      limit.signal.addEventListener('abort', () => opened.close(), { once: true });
    }
    for await (const frame of handle.frames) {
      state = channel.reduce(state, channel.accept?.(ctx, frame) ?? frame);
      const answer = follow.respond?.(state, frame);
      if (answer !== undefined) {
        try {
          handle.send(answer);
          state = channel.sent?.(state, answer) ?? state;
        } catch (error) {
          // The socket went away under the answer; the channel asks again on the next one.
          ctx.log.info('channel answer not sent', {
            channel: channel.name,
            type: answer.type,
            error,
          });
        }
      }
      follow.seen(state);
      const { message, fraction } = spec.describe(state, ctx.t);
      ctx.progress.report(message, fraction);
      if (spec.isTerminal(state)) return { kind: 'terminal', state };
      if (spec.needsUser?.(ctx, id, state, follow.saved()) !== undefined)
        return { kind: 'needs_user', state };
    }
    if (timedOut) return { kind: 'timeout', state };
    // The server closed the channel normally before a final state: the result is read by REST.
    ctx.log.info('channel ended before the operation did', { channel: channel.name });
    return { kind: 'fallback', state };
  } catch (error) {
    if (ctx.signal.aborted) throw abortError(ctx.signal);
    if (timedOut) return { kind: 'timeout', state };
    if (error instanceof ChannelLost || error instanceof ChannelUnavailable) {
      ctx.log.info('channel failed, reading the state through REST', {
        channel: channel.name,
        error,
      });
      return { kind: 'fallback', state };
    }
    if (error instanceof FrameParseError) {
      // A frame outside the contract must show in the log, but REST still gives the result.
      ctx.log.warn('channel frame outside the contract, reading the state through REST', {
        channel: channel.name,
        error,
      });
      return { kind: 'fallback', state };
    }
    if (error instanceof LoadcraftApiError && error.code === 'not_found') {
      return { kind: 'not_found', state };
    }
    throw error;
  } finally {
    timer.abort();
    handle?.close();
  }
}

/**
 * Waits for operation `id` of `kind`: records it in the state file, follows its channel (or polls
 * its REST recovery), reports progress, and returns the kind's final outcome — or, after
 * `maxWaitS`, `{status: 'running', operation}` so that `process_wait` can continue later.
 */
export async function awaitOperation<S, D, V, C extends Channel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  id: string,
  opts: AwaitOptions<V, S, C>,
): Promise<OperationOutcome<D>> {
  // What the callbacks of the wait write (the entry changes with every frame) goes through one chain, and the
  // call returns only after it: the state file never lags behind the answer.
  const writes = createWriteChain();
  let outcome: OperationOutcome<D>;
  try {
    outcome = await followOperation(ctx, kind, id, opts, writes);
  } catch (error) {
    await writes.flush().catch(() => undefined);
    throw error;
  }
  await writes.flush();
  return outcome;
}

async function followOperation<S, D, V, C extends Channel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  id: string,
  opts: AwaitOptions<V, S, C>,
  writes: WriteChain,
): Promise<OperationOutcome<D>> {
  const { spec } = kind;
  const handle = encodeHandle(spec.kind, id);
  const resolved = resolveSaved(ctx, spec.saved, handle, opts.saved);
  const { startedAt } = resolved;
  let saved = resolved.saved;
  // The bar of this operation in the workspace state follows the handle from here on.
  ctx.progress.attach?.(handle);
  await spec.secrets?.(ctx, saved);
  // What the kind shows of a running operation; never a reason for the wait to fail or to wait longer.
  const observe = (state: S): void => {
    if (spec.observe === undefined || spec.isTerminal(state)) return;
    const current = saved;
    void writes.run(async () => {
      try {
        await spec.observe?.(ctx, id, state, current);
      } catch (error) {
        ctx.log.warn('operation view not written', { operation: handle, error });
      }
    });
  };
  // The entry is written again only when what it keeps changes.
  let kept: string | undefined;
  const keep = (): Promise<void> => {
    const value = spec.stored?.(saved) ?? saved;
    const text = JSON.stringify(value);
    if (text === kept) return Promise.resolve();
    kept = text;
    return writes.run(() =>
      recordOperation(ctx.state, { kind: spec.kind, id, startedAt, saved: value }),
    );
  };
  const seen = (state: S): void => {
    if (spec.advance !== undefined) saved = spec.advance(state, saved);
    void keep();
    observe(state);
  };
  // The entry is on disk before the wait starts: a handle handed out is a handle that is saved.
  await keep();

  const deadline = ctx.clock.now() + callWaitS(opts.maxWaitS) * 1000;
  let note: string | undefined;
  const report = (state: S): void => {
    const { message, fraction } = spec.describe(state, ctx.t);
    ctx.progress.report(
      note === undefined ? message : ctx.t('operation.progressNote', { message, note }),
      fraction,
    );
  };
  // The end is noted in the cache of the call (`StateCache.endOperation`): the registry writes the row with
  // the log entry, in one write that also drops the payload, and nothing is removed before that write. It
  // is noted before `finish`, which then no longer finds the operation; a kind that records its entry again
  // there (a plan shown and waiting for its approval) takes the note back: the operation goes on.
  const end = (status: OperationEnd): EndedRow => {
    const row = endedRow(ctx, spec.kind, handle, startedAt, status);
    ctx.state.endOperation(row);
    return row;
  };
  const done = async (state: S): Promise<DoneOutcome<D>> => {
    // What `observe` still writes of a running state lands before `finish` writes the end. A failure of an
    // earlier write is left for the flush of `awaitOperation` to report.
    await writes.run(() => Promise.resolve());
    const noted = end(spec.ended?.(state) ?? 'done');
    try {
      return await spec.finish(ctx, id, state, saved);
    } catch (error) {
      // `finish` threw: failed, unless the state says otherwise, or `finish` noted another end itself
      if (ctx.state.endOf(handle) === noted) end(spec.ended?.(state) ?? 'failed');
      throw error;
    }
  };
  const lost = (cause?: unknown): Promise<never> => {
    end('lost');
    return Promise.reject(operationLost(handle, cause));
  };
  const running = (state: S): RunningOperation => ({
    status: 'running',
    operation: handle,
    data: { ...spec.describe(state, ctx.t), ...(note === undefined ? {} : { note }) },
  });
  const asked = (state: S): NeedsUser | undefined => spec.needsUser?.(ctx, id, state, saved);
  // The entry stays: once the user acted, `process_wait` follows the operation on.
  const waiting = (need: NeedsUser): RunningOperation => ({
    status: 'needs_user',
    operation: handle,
    data: {
      message: need.message,
      ...(note === undefined ? {} : { note }),
      ...(need.next === undefined ? {} : { next: need.next }),
    },
    ...(need.links === undefined ? {} : { links: need.links }),
  });
  const notDone = (state: S): RunningOperation => {
    const need = asked(state);
    return need === undefined ? running(state) : waiting(need);
  };
  const recover = async (): Promise<S> => {
    try {
      const recovered = await spec.recover(ctx, id, saved);
      seen(recovered);
      return recovered;
    } catch (error) {
      if (isNotFound(error)) return lost(error);
      throw error;
    }
  };

  let state = spec.initial(ctx, id, saved);
  report(state);

  let intervalMs: number | undefined = spec.pollIntervalMs;
  if (spec.channel !== undefined && (spec.channel.enabled?.(saved) ?? true)) {
    const result = await followChannel(ctx, spec, spec.channel, id, {
      start: state,
      deadline,
      saved: () => saved,
      seen,
      ...(opts.respond === undefined ? {} : { respond: opts.respond }),
      ...(opts.connected === undefined ? {} : { connected: opts.connected }),
    });
    state = result.state;
    switch (result.kind) {
      case 'terminal':
        return done(state);
      case 'needs_user':
        return notDone(state);
      case 'timeout': {
        // A channel that stays silent from one call to the next never reports its own loss, and a
        // call ends before the silence limit: for a kind whose `recover` only reads, one read
        // keeps a finished (or given up) operation from being reported as running again and again.
        // A kind whose `recover` writes is never called here: a time limit changes nothing.
        if (spec.recoverIsRead !== true) return running(state);
        const recovered = await recover();
        if (spec.isTerminal(recovered)) return done(recovered);
        return asked(recovered) === undefined ? running(state) : notDone(recovered);
      }
      case 'not_found': {
        // The backend forgot the job; only an existing result can still finish it.
        const recovered = await recover();
        if (spec.isTerminal(recovered)) return done(recovered);
        return lost();
      }
      case 'fallback':
        await spec.channelLost?.(ctx, id, state, saved);
        note = ctx.t('operation.channelUnavailable');
        intervalMs = FALLBACK_POLL_MS;
        report(state);
        break;
    }
  }

  const polled = await pollUntil(recover, {
    isTerminal: (s) => spec.isTerminal(s) || asked(s) !== undefined,
    deadlineMs: Math.max(0, deadline - ctx.clock.now()),
    signal: ctx.signal,
    clock: ctx.clock,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    onState: (s) => report(s),
  });
  if (polled.timedOut || !spec.isTerminal(polled.state)) return notDone(polled.state);
  return done(polled.state);
}

/** What `startOrJoin` needs to know about the operation a call is about. */
export interface StartOrJoin<V> {
  readonly maxWaitS: number;
  /** True for the saved data of an operation that is the same work as this call asks for. */
  readonly matches: (saved: V) => boolean;
  /** An operation older than this is not joined; default 30 minutes. */
  readonly maxAgeMs?: number;
  /**
   * Chooses the id of a new operation before it starts: needed by a kind whose channel is joined first
   * (`OperationChannel.connectFirst`), which has its own session id in the request that starts the work.
   */
  readonly newId?: () => string;
  /**
   * Starts the work in the backend; called only when no matching operation is under way. Gets the id
   * `newId` chose (and must return it), or nothing.
   */
  readonly start: (chosen?: string) => Promise<{ readonly id: string; readonly saved: V }>;
}

/** Longest an operation recorded in the workspace is still taken for one that is under way. */
const JOIN_MAX_AGE_MS = 30 * 60_000;

/**
 * Operations of `kind` recorded in the workspace whose saved data satisfies `matches`: work that an
 * earlier call started and that has not been seen finished. Newest last.
 */
export function findAllRunning<S, D, V, C extends Channel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  matches: (saved: V) => boolean,
  maxAgeMs = JOIN_MAX_AGE_MS,
): { readonly id: string; readonly saved: V }[] {
  const now = ctx.clock.now();
  return listOperations(ctx.state).flatMap((operation) => {
    if (operation.kind !== kind.kind || now - operation.startedAt >= maxAgeMs) return [];
    const entry = readEntry(ctx, operation.handle);
    const saved = kind.spec.saved.safeParse(entry?.saved);
    return saved.success && matches(saved.data) ? [{ id: operation.id, saved: saved.data }] : [];
  });
}

/**
 * Handle of the newest operation of `kind` recorded in the workspace whose saved data satisfies
 * `matches`: work that an earlier call started and that has not been seen finished.
 */
export function findRunning<S, D, V, C extends Channel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  matches: (saved: V) => boolean,
  maxAgeMs = JOIN_MAX_AGE_MS,
): string | undefined {
  return findAllRunning(ctx, kind, matches, maxAgeMs).at(-1)?.id;
}

/**
 * The one way a tool starts a long operation: a call that asks for the same work as an operation
 * still under way (its entry is in the workspace state) goes on with that operation instead of
 * starting a second, paid one; otherwise `start` runs and the new operation is followed. Both
 * return the same handle, so a model that calls the tool again instead of `process_wait` loses nothing.
 */
export async function startOrJoin<S, D, V, C extends Channel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  plan: StartOrJoin<V>,
): Promise<OperationOutcome<D>> {
  const joined = findRunning(ctx, kind, plan.matches, plan.maxAgeMs);
  if (joined !== undefined) {
    try {
      return await awaitOperation(ctx, kind, joined, { maxWaitS: plan.maxWaitS });
    } catch (error) {
      // The backend forgot it (a restart): the work is started again below.
      if (!(error instanceof ToolError) || error.code !== 'operation_lost') throw error;
    }
  }
  const channel = kind.spec.channel;
  if (channel?.connectFirst !== undefined && plan.newId !== undefined) {
    const chosen = plan.newId();
    // A channel that cannot be reached before the start is no reason not to start: the wait then opens it
    // after, and the result comes through REST if the channel stays down.
    const connected = await openChannel(
      { config: ctx.config, log: ctx.log, signal: ctx.signal },
      {
        channel: channel.name,
        params: channel.connectFirst(chosen),
        reconnect: channel.reconnect ?? DEFAULT_RECONNECT,
        clock: ctx.clock,
        ...(channel.silenceMs === undefined ? {} : { silenceMs: channel.silenceMs }),
      },
    ).catch((error: unknown): undefined => {
      if (ctx.signal.aborted) throw abortError(ctx.signal);
      if (!(error instanceof ChannelLost || error instanceof ChannelUnavailable)) throw error;
      ctx.log.info('channel not reached before the start', {
        channel: channel.name,
        error,
      });
      return undefined;
    });
    let started: { readonly id: string; readonly saved: V };
    try {
      started = await plan.start(chosen);
    } catch (error) {
      connected?.close();
      throw error;
    }
    return awaitOperation(ctx, kind, started.id, {
      maxWaitS: plan.maxWaitS,
      saved: started.saved,
      ...(connected === undefined ? {} : { connected }),
    });
  }
  const { id, saved } = await plan.start();
  return awaitOperation(ctx, kind, id, { maxWaitS: plan.maxWaitS, saved });
}

function kindOf(
  kinds: readonly AnyOperationKind[],
  handle: unknown,
): { defined: AnyOperationKind; id: string } {
  const { kind, id } = parseHandle(handle);
  const defined = kinds.find((candidate) => candidate.kind === kind);
  if (defined === undefined) {
    throw new ToolError('operation_kind_unsupported', {
      params: { value: `${kind}:${id}`, kind },
    });
  }
  return { defined, id };
}

/** Continues an operation by its handle (the `process_wait` tool); saved data comes from the cache. */
export async function resumeOperation(
  ctx: OperationContext,
  kinds: readonly AnyOperationKind[],
  handle: unknown,
  opts: { readonly maxWaitS: number },
): Promise<OperationOutcome<unknown>> {
  const { defined, id } = kindOf(kinds, handle);
  return defined.resume(ctx, id, opts.maxWaitS);
}

/**
 * One reading of operation `handle` (`process_get_status` with `operation`): the kind's `snapshot` runs
 * with the saved data of the cache entry. It makes the reads the kind names and no more, never
 * waits, and changes neither the backend nor the entry.
 */
export function snapshotOperation(
  ctx: OperationContext,
  kinds: readonly AnyOperationKind[],
  handle: unknown,
): Promise<OperationSnapshot> {
  const { defined, id } = kindOf(kinds, handle);
  return defined.snapshot(ctx, id);
}

/**
 * Stops operation `handle` (the `process_cancel` tool): the kind's `cancel` runs with the saved data of the
 * cache entry. The operation ends (`endOperation`: its row `cancelled`, written by the call, which
 * drops the entry with it) only when the backend really stopped it; for one that was not running the
 * entry stays, so `process_wait` can still show how it ended, and so it does for one that is stopping
 * (`stopping`: it still ends on its own).
 */
export async function cancelOperation(
  ctx: OperationContext,
  kinds: readonly AnyOperationKind[],
  handle: unknown,
): Promise<{
  readonly kind: OperationKindName;
  readonly cancelled: boolean;
  readonly stopping: boolean;
}> {
  const { kind, id } = parseHandle(handle);
  const defined = kinds.find((candidate) => candidate.kind === kind);
  if (defined === undefined) {
    throw new ToolError('operation_kind_unsupported', { params: { value: `${kind}:${id}`, kind } });
  }
  if (defined.cancel === undefined) {
    const stoppable = kinds.filter((candidate) => candidate.cancel !== undefined);
    throw new ToolError('not_cancellable', {
      params: {
        kind,
        kinds: stoppable
          .map((candidate) => candidate.kind)
          .sort()
          .join(', '),
      },
    });
  }
  const result = await defined.cancel(ctx, id);
  if (result !== true)
    return { kind, cancelled: result !== false, stopping: result === 'stopping' };
  // its row says cancelled, written with the entry of this call, which drops the payload
  endOperation(ctx, encodeHandle(kind, id), 'cancelled');
  return { kind, cancelled: true, stopping: false };
}

/**
 * Drops the cache entry of operation `handle`: for a kind that learns it can no longer be waited
 * for (the backend cancelled it) and does not want the next call to join it.
 */
export async function forgetOperation(
  state: Pick<StateCache, 'delete'>,
  handle: string,
): Promise<void> {
  await state.delete(SECTION, handle);
}

/**
 * Text of finished data of the operation `handle`, drawn by the view of its kind: `process_wait` renders
 * with this, so it shows what the tool that started the operation showed.
 */
export function viewOperation(
  kinds: readonly AnyOperationKind[],
  handle: unknown,
  data: unknown,
  t: Translator,
): string {
  return kindOf(kinds, handle).defined.view(data, t);
}
