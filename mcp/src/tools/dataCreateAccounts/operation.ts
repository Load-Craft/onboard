// The series of batches of `data_create_accounts` as a long operation (`account_provision:<id>`).
//
// The plugin itself sends the batches, so the series runs in the server process: it goes on after
// the call that started it returns its handle, `process_wait` follows it, `process_cancel` stops it. When the
// process ends, the series ends with it. A `process_wait` in a new process finds no series and only reads
// what exists (the dataset's row count and the slot's bindings); it never sends a batch, so no
// account is created twice. The same call with the same count creates the missing ones.

import { randomUUID } from 'node:crypto';

import { getScenarioSlots, listDatasets } from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import {
  awaitOperation,
  callWaitS,
  defineOperationKind,
  encodeHandle,
  endOperation,
  findAllRunning,
  listOperations,
  recordOperation,
  type OperationOutcome,
} from '../../ops/operation.js';
import { createLockTable, withLock } from '../../ops/lock.js';
import type { DoneOutcome } from '../../outcome.js';
import { num } from '../../render/primitives.js';
import {
  renderProvision,
  renderProvisionStopped,
  type ProvisionConfirmView,
  type ProvisionStoppedView,
  type ProvisionView,
} from '../../render/views/data.js';
import { CallSecretScope } from '../../workspace/secrets.js';
import {
  prepareSeries,
  SERIES_SECTION,
  provisionSaved,
  provisionView,
  refusal,
  runSeries,
  type SeriesApi,
  type ProvisionArgs,
  type ProvisionSaved,
  type SeriesResult,
} from './provision.js';

const KIND = 'account_provision';

/** What a finished provisioning shows: the series' own result, or how far it got before it stopped. */
export type ProvisionData = ProvisionView | ProvisionStoppedView;

const isStopped = (data: ProvisionData): data is ProvisionStoppedView => 'stopped' in data;

interface Series {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly saved: ProvisionSaved;
  readonly stop: AbortController;
  progress: SeriesResult;
  error?: unknown;
  /** Settles when the series ends, however it ends; never rejects. */
  ended: Promise<void>;
  /** Passwords the answers carried, registered in every call that finishes the series. */
  readonly secrets: string[];
  /** Told after every batch and at the end. */
  readonly listeners: Set<() => void>;
}

/**
 * Series still running or ended but not yet shown, per process (the services object): a series
 * outlives the call that started it, and `process_wait` reads it from here.
 */
const seriesOf = new WeakMap<object, Map<string, Series>>();

function table(ctx: Pick<ToolContext, 'services'>): Map<string, Series> {
  let found = seriesOf.get(ctx.services);
  if (found === undefined) {
    found = new Map();
    seriesOf.set(ctx.services, found);
  }
  return found;
}

type ProvisionState =
  | { readonly phase: 'running'; readonly done: number; readonly total: number }
  | {
      readonly phase: 'completed';
      readonly done: number;
      readonly total: number;
      readonly result: SeriesResult;
    }
  | {
      readonly phase: 'failed';
      readonly done: number;
      readonly total: number;
      readonly error: unknown;
    }
  | {
      readonly phase: 'stopped';
      readonly done: number;
      readonly total: number;
      readonly reason: ProvisionStoppedView['stopped'];
      readonly pinned: boolean | null;
    };

function stateOf(series: Series): ProvisionState {
  const done = series.saved.earlier + series.progress.created;
  const total = series.saved.count;
  switch (series.status) {
    case 'running':
      return { phase: 'running', done, total };
    case 'completed':
      return { phase: 'completed', done, total, result: series.progress };
    case 'failed':
      return { phase: 'failed', done, total, error: series.error };
    case 'cancelled':
      return { phase: 'stopped', done, total, reason: 'cancelled', pinned: series.progress.pinned };
  }
}

/** Whether every scenario that reads the slot has the dataset as its pick; `null` when it cannot tell. */
async function isPinned(ctx: ToolContext, saved: ProvisionSaved): Promise<boolean | null> {
  if (saved.scenarioIds.length === 0) return null;
  const scenarios = await Promise.all(
    saved.scenarioIds.map((id) => getScenarioSlots(ctx, saved.projectId, id)),
  );
  return scenarios.every((scenario) => scenario.bindings[saved.slot] === saved.dataset.id);
}

export const accountProvisionOperation = defineOperationKind({
  kind: KIND,
  saved: provisionSaved,
  initial: (_ctx, _id, saved): ProvisionState => ({
    phase: 'running',
    done: saved.earlier,
    total: saved.count,
  }),
  // A series of this process is read from memory; without one, the backend is only read.
  recoverIsRead: true,
  async recover(ctx, id, saved): Promise<ProvisionState> {
    const series = table(ctx).get(id);
    if (series !== undefined) return stateOf(series);
    const datasets = await listDatasets(ctx, saved.projectId);
    const rows = datasets.find((dataset) => dataset.id === saved.dataset.id)?.rows ?? 0;
    return {
      phase: 'stopped',
      done: Math.max(0, rows - saved.baseline),
      total: saved.count,
      reason: 'restart',
      pinned: await isPinned(ctx, saved),
    };
  },
  isTerminal: (state) => state.phase !== 'running',
  // a series the process lost in a restart ended without anyone following it
  ended: (state) =>
    state.phase === 'failed'
      ? 'failed'
      : state.phase === 'stopped'
        ? state.reason === 'cancelled'
          ? 'cancelled'
          : 'lost'
        : undefined,
  describe: (state, t) => ({
    message: t('data.provision.progress', {
      done: num(state.done, t.locale),
      total: num(state.total, t.locale),
    }),
    fraction: state.total === 0 ? 1 : Math.min(1, state.done / state.total),
  }),
  async finish(ctx, id, state, saved): Promise<DoneOutcome<ProvisionData>> {
    const series = table(ctx).get(id);
    for (const value of series?.secrets ?? []) ctx.secrets.add(value);
    table(ctx).delete(id);
    if (state.phase === 'completed') {
      return { status: 'done', data: await provisionView(ctx, saved, state.result) };
    }
    if (state.phase === 'failed') throw refusal(state.error, ctx);
    if (state.phase === 'running') throw new ToolError('internal_error');
    const complete = state.done >= state.total && state.pinned === true;
    // Nothing is left to resume: a later call with the same count is a new provisioning.
    if (complete) await ctx.state.delete(SERIES_SECTION, saved.dataset.id);
    return {
      status: 'done',
      data: {
        stopped: state.reason,
        slot: saved.slot,
        dataset: saved.dataset.name,
        requested: saved.count,
        exist: state.done,
        pinned: state.pinned,
        masked: true,
      },
    };
  },
  view: (data: ProvisionData, t) =>
    isStopped(data) ? renderProvisionStopped(data, t) : renderProvision(data, t),
  // `cancel` only: the series stops after the batch in flight is cut; what was created stays.
  cancel(ctx, id): Promise<boolean> {
    const series = table(ctx).get(id);
    if (series?.status !== 'running') return Promise.resolve(false);
    series.status = 'cancelled';
    series.stop.abort();
    // `process_cancel` drops the entry of the operation, so no `process_wait` will finish it: the series goes too.
    void series.ended.then(() => table(ctx).delete(id));
    return Promise.resolve(true);
  },
});

/** Starts the series of `plan` in the server process and returns it; nothing waits for it here. */
function startSeries(ctx: ToolContext, id: string, plan: Parameters<typeof runSeries>[1]): Series {
  const stop = new AbortController();
  const secrets: string[] = [];
  // The series outlives the call: its own scope keeps the passwords the answers carry.
  const scope = new CallSecretScope(ctx.log);
  const api: SeriesApi = {
    log: ctx.log,
    services: ctx.services,
    signal: stop.signal,
    secrets: {
      add: (value) => {
        secrets.push(value);
        return scope.add(value);
      },
      scrub: (text) => scope.scrub(text),
      scrubDeep: (value) => scope.scrubDeep(value),
      containsSecret: (value) => scope.containsSecret(value),
    },
  };
  const series: Series = {
    status: 'running',
    saved: plan.saved,
    stop,
    progress: {
      created: 0,
      failed: 0,
      ran: 0,
      aborted: false,
      failures: [],
      environment: null,
      registerOperation: null,
      pinned: false,
    },
    ended: Promise.resolve(),
    secrets,
    listeners: new Set(),
  };
  const tell = (): void => {
    for (const listener of series.listeners) listener();
  };
  table(ctx).set(id, series);
  series.ended = runSeries(api, plan, (progress) => {
    series.progress = progress;
    tell();
  }).then(
    (result) => {
      series.progress = result;
      if (series.status === 'running') series.status = 'completed';
      tell();
    },
    (error: unknown) => {
      // A cancelled series ends with the cut request; that is its stop, not a failure.
      if (series.status === 'running') {
        series.status = 'failed';
        series.error = error;
      }
      ctx.log.info('account provisioning ended early', { status: series.status, err: error });
      tell();
    },
  );
  return series;
}

/**
 * Waits for the series up to the time limit of the call, telling the progress after each batch,
 * then hands over to the operation: its final view when the series ended, else its handle.
 */
async function follow(
  ctx: ToolContext,
  id: string,
  series: Series,
  maxWaitS: number,
  saved?: ProvisionSaved,
): Promise<OperationOutcome<ProvisionData>> {
  const report = (): void => {
    const { message, fraction } = accountProvisionOperation.spec.describe(stateOf(series), ctx.t);
    ctx.progress.report(message, fraction);
  };
  series.listeners.add(report);
  const timer = new AbortController();
  try {
    await Promise.race([
      series.ended,
      ctx.clock
        .sleep(callWaitS(maxWaitS) * 1000, AbortSignal.any([timer.signal, ctx.signal]))
        .catch((error: unknown) => {
          // The client gave up the wait (Esc): the series goes on, the call ends.
          if (ctx.signal.aborted) throw error;
        }),
    ]);
  } finally {
    series.listeners.delete(report);
    timer.abort();
  }
  return awaitOperation(ctx, accountProvisionOperation, id, {
    maxWaitS: 0,
    ...(saved === undefined ? {} : { saved }),
  });
}

const sameSlot = (saved: ProvisionSaved, args: ProvisionArgs): boolean =>
  saved.projectId === args.projectId &&
  saved.target.id === args.target.id &&
  saved.slot === args.slot;

const sameWork = (saved: ProvisionSaved, args: ProvisionArgs): boolean =>
  saved.count === args.count &&
  (saved.environment?.id ?? null) === (args.environment?.id ?? null) &&
  saved.registerOperation === (args.register_operation ?? null);

export type ProvisionOutcome =
  | (OperationOutcome<ProvisionData> & { readonly joined: boolean })
  | (DoneOutcome<ProvisionConfirmView> & { readonly joined: false });

/** Provisionings of one slot being started in this process: two calls at once start one series. */
const startLocks = createLockTable();

type Started =
  | { readonly kind: 'confirm'; readonly data: ProvisionConfirmView }
  | {
      readonly kind: 'series';
      readonly id: string;
      readonly series: Series;
      readonly joined: boolean;
      readonly saved?: ProvisionSaved;
    };

/**
 * The one way accounts are created. A series for the same slot that this process runs (or ended
 * without anyone seeing it) is joined when the call asks for the same work, and refused when it
 * asks for other work; otherwise the checks run, and a new series starts and is followed. Finding
 * a series and starting one happen under a lock per project and slot, and a new series is recorded
 * before the lock is let go, so a call at the same moment finds it instead of starting another.
 */
export async function provisionOrJoin(
  ctx: ToolContext,
  args: ProvisionArgs,
  maxWaitS: number,
): Promise<ProvisionOutcome> {
  const started = await withLock(
    startLocks,
    `${args.projectId}:${args.slot}`,
    async (): Promise<Started> => {
      const recorded = new Set(listOperations(ctx.state).map((operation) => operation.handle));
      for (const [id, series] of table(ctx)) {
        const handle = encodeHandle(KIND, id);
        if (!recorded.has(handle) || !sameSlot(series.saved, args)) continue;
        if (!sameWork(series.saved, args)) {
          throw new ToolError('provision_already_running', {
            params: { slot: args.slot, operation: handle },
          });
        }
        return { kind: 'series', id, series, joined: true };
      }

      const prepared = await prepareSeries(ctx, args);
      if (prepared.kind === 'confirm') return prepared;
      const { plan } = prepared;
      // A series of an ended process for this dataset is over: it gives way to the new one, and its row
      // says how it ended (lost when no process holds it any more), written with the entry of this call.
      for (const stale of findAllRunning(
        ctx,
        accountProvisionOperation,
        (saved) => saved.dataset.id === plan.saved.dataset.id,
        Number.POSITIVE_INFINITY,
      )) {
        const status = table(ctx).get(stale.id)?.status;
        if (status === 'running') continue;
        const end = status === 'completed' ? 'done' : status === undefined ? 'lost' : status;
        endOperation(ctx, encodeHandle(KIND, stale.id), end);
      }
      const id = randomUUID();
      const series = startSeries(ctx, id, plan);
      await recordOperation(ctx.state, {
        kind: KIND,
        id,
        startedAt: plan.saved.startedAtMs,
        saved: plan.saved,
      });
      return { kind: 'series', id, series, joined: false, saved: plan.saved };
    },
  );
  if (started.kind === 'confirm') return { status: 'done', data: started.data, joined: false };
  const { id, series, joined, saved } = started;
  return { ...(await follow(ctx, id, series, maxWaitS, saved)), joined };
}
