// Following a started run to its end. The run has no channel of its own here: its state is read
// through REST every 3 s (`recover`), and, while it runs, its numbers every 10 s from the result
// of a run under way. The numbers are read beside the state, never in front of it: a metrics
// store that is slow or down costs the numbers, not the state. A client abort ends the wait and
// leaves the run and its entry in the workspace alone; stopping a test is the job of `process_cancel`.

import {
  cancelRun,
  readRun,
  readRunNumbers,
  RESULT_TIMEOUT_MS,
  type RunNumbers,
  type RunStatus,
} from '../../api/executions.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { defineOperationKind, type OperationContext } from '../../ops/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import { plannedDurationSeconds } from '../../profiles/duration.js';
import { inline } from '../../render/primitives.js';
import {
  renderRunProgress,
  renderRunDone,
  type RunDoneData,
  type RunLiveNumbers,
} from '../../render/views/run.js';
import { createResolver } from '../../resolve/handles.js';
import { asProfile, testRunSaved, type TestRunSaved } from './saved.js';

/** The state of the run is read this often. */
const STATE_POLL_MS = 3000;
/** The numbers of a run under way are read this often. */
const NUMBERS_EVERY_MS = 10_000;
/** A run that has not moved on this long after its planned end is taken as lost. */
const ABANDONED_AFTER_S = 600;
const MAX_REASON = 300;
/** The reason in a snapshot is read by a card of one short line. */
const MAX_SNAPSHOT_REASON = 160;

type Phase = RunStatus | 'abandoned';

export interface RunState {
  readonly phase: Phase;
  /** Seconds since the start of the run, on the clock of this call. */
  readonly waitedS: number;
  /** Seconds of load so far; null until the load starts. */
  readonly elapsedS: number | null;
  readonly plannedS: number | null;
  /** Seconds from the start of the run to the start of the load. */
  readonly buildS: number | null;
  /** Measured seconds of load of a finished run. */
  readonly durationS: number | null;
  readonly errorMessage: string | null;
  readonly numbers: RunLiveNumbers | null;
}

interface NumbersSlot {
  value: RunLiveNumbers | null;
  readAt: number | undefined;
  inflight: Promise<void> | undefined;
}

/** One slot per call: the numbers read in the background by `recover`, and the time of the read. */
const slots = new WeakMap<object, NumbersSlot>();

function liveOf(numbers: RunNumbers): RunLiveNumbers {
  return { rps: numbers.rps, p95Ms: numbers.p95Ms, errorRate: numbers.errorRate };
}

/**
 * The newest numbers there are, starting a read in the background when the last one is older than
 * `NUMBERS_EVERY_MS` and none is under way. A read that fails or takes longer than the backend's
 * own wait leaves no numbers, so the progress line falls back to the time alone.
 */
function liveNumbers(ctx: ToolContext, projectId: string, id: string): RunLiveNumbers | null {
  let slot = slots.get(ctx);
  if (slot === undefined) {
    slot = { value: null, readAt: undefined, inflight: undefined };
    slots.set(ctx, slot);
  }
  const current = slot;
  const now = ctx.clock.now();
  if (
    current.inflight === undefined &&
    (current.readAt === undefined || now - current.readAt >= NUMBERS_EVERY_MS)
  ) {
    current.readAt = now;
    const limit = new AbortController();
    const timer = new AbortController();
    ctx.clock.sleep(RESULT_TIMEOUT_MS, timer.signal).then(
      () => {
        limit.abort();
      },
      () => undefined,
    );
    const signal = AbortSignal.any([ctx.signal, limit.signal]);
    current.inflight = readRunNumbers({ services: ctx.services, signal }, projectId, id).then(
      (numbers) => {
        current.value = liveOf(numbers);
      },
      (error: unknown) => {
        current.value = null;
        if (!ctx.signal.aborted) ctx.log.info('numbers of the run unavailable', { error });
      },
    );
    void current.inflight.finally(() => {
      timer.abort();
      current.inflight = undefined;
    });
  }
  return current.value;
}

/** A snapshot gives the numbers this long to arrive; the backend itself may wait up to 30 s for them. */
const SNAPSHOT_NUMBERS_MS = 3000;

/**
 * The numbers of a run for one reading: a single read of the result, given `SNAPSHOT_NUMBERS_MS`.
 * A read that fails or is late leaves no numbers; the reading still has everything else.
 */
async function numbersWithin(
  ctx: ToolContext,
  projectId: string,
  id: string,
): Promise<RunLiveNumbers | null> {
  const limit = new AbortController();
  const timer = new AbortController();
  ctx.clock.sleep(SNAPSHOT_NUMBERS_MS, timer.signal).then(
    () => {
      limit.abort();
    },
    () => undefined,
  );
  try {
    const numbers = await readRunNumbers(
      { services: ctx.services, signal: AbortSignal.any([ctx.signal, limit.signal]) },
      projectId,
      id,
    );
    return liveOf(numbers);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log.info('numbers of the run unavailable for a snapshot', { error });
    return null;
  } finally {
    timer.abort();
  }
}

function secondsBetween(from: number | null, to: number | null): number | null {
  return from === null || to === null ? null : Math.max(0, (to - from) / 1000);
}

function stateFrom(
  ctx: OperationContext,
  saved: TestRunSaved,
  row: Awaited<ReturnType<typeof readRun>>,
  numbers: RunLiveNumbers | null,
): RunState {
  const now = ctx.clock.now();
  const plannedS = plannedDurationSeconds(asProfile(saved.effective));
  const waitedS = Math.max(0, (now - saved.startedAt) / 1000);
  const elapsedS = row.status === 'running' ? secondsBetween(row.startedAt, now) : null;
  const limit = (plannedS ?? 0) + ABANDONED_AFTER_S;
  const unmoved = row.status === 'running' ? (elapsedS ?? waitedS) : waitedS;
  const active = row.status === 'pending' || row.status === 'building' || row.status === 'running';
  return {
    phase: active && unmoved > limit ? 'abandoned' : row.status,
    waitedS,
    elapsedS,
    plannedS,
    buildS: secondsBetween(row.createdAt, row.startedAt),
    durationS: row.durationS,
    errorMessage: row.errorMessage,
    numbers,
  };
}

export const testRunOperation = defineOperationKind<RunState, RunDoneData, TestRunSaved>({
  kind: 'test_run',
  pollIntervalMs: STATE_POLL_MS,
  saved: testRunSaved,
  initial: (ctx, _id, saved) => ({
    phase: 'building',
    waitedS: Math.max(0, (ctx.clock.now() - saved.startedAt) / 1000),
    elapsedS: null,
    plannedS: plannedDurationSeconds(asProfile(saved.effective)),
    buildS: null,
    durationS: null,
    errorMessage: null,
    numbers: null,
  }),
  // No channel: the state of a run is on the row, a 404 means LoadCraft forgot the run.
  async recover(ctx, id, saved) {
    const row = await readRun(ctx, saved.project.id, id);
    const numbers = row.status === 'running' ? liveNumbers(ctx, saved.project.id, id) : null;
    return stateFrom(ctx, saved, row, numbers);
  },
  cancel: (ctx, id, saved) => cancelRun(ctx, saved.project.id, id),
  // One read of the row and, once the load has started, one of its numbers; no waiting.
  async snapshot(ctx, id, saved) {
    const row = await readRun(ctx, saved.project.id, id);
    const state = stateFrom(ctx, saved, row, null);
    const loaded =
      row.status === 'running' || row.status === 'completed' || row.status === 'cancelled';
    const numbers = loaded ? await numbersWithin(ctx, saved.project.id, id) : null;
    const loadS = row.status === 'running' ? state.elapsedS : state.durationS;
    const reason =
      state.phase === 'failed' && state.errorMessage !== null
        ? inline(ctx.secrets.scrubDeep(state.errorMessage), MAX_SNAPSHOT_REASON)
        : '';
    return {
      phase: state.phase,
      // The cause LoadCraft gave for a failed run, the same one `run_failed` quotes: masked first,
      // then cut, so that a secret cut in half is not left half readable.
      ...(reason === '' ? {} : { reason }),
      ...(loadS === null ? {} : { loadElapsedS: loadS }),
      ...(state.plannedS === null ? {} : { plannedS: state.plannedS }),
      ...(numbers === null
        ? {}
        : {
            live: {
              rps: numbers.rps,
              p95Ms: numbers.p95Ms,
              errorPct: numbers.errorRate === null ? null : numbers.errorRate * 100,
            },
          }),
    };
  },
  isTerminal: (state) =>
    state.phase !== 'pending' && state.phase !== 'building' && state.phase !== 'running',
  // a run that stopped moving long after its planned end is followed by nobody any more
  ended: (state) =>
    state.phase === 'failed' || state.phase === 'cancelled'
      ? state.phase
      : state.phase === 'abandoned'
        ? 'lost'
        : undefined,
  describe(state, t) {
    const running =
      state.phase === 'running' || state.phase === 'completed' || state.phase === 'cancelled';
    const message = renderRunProgress(
      {
        phase: running ? 'running' : 'building',
        waitedS: state.waitedS,
        elapsedS: state.elapsedS ?? state.durationS,
        plannedS: state.plannedS,
        numbers: state.numbers,
      },
      t,
    );
    const known = state.elapsedS !== null && state.plannedS !== null && state.plannedS > 0;
    return {
      message,
      ...(known ? { fraction: Math.min(1, (state.elapsedS ?? 0) / (state.plannedS ?? 1)) } : {}),
    };
  },
  async finish(ctx, id, state, saved): Promise<DoneOutcome<RunDoneData>> {
    const handle = createResolver(ctx).shortExecution(id);
    if (state.phase === 'abandoned') throw new ToolError('run_abandoned', { params: { handle } });
    if (state.phase === 'failed') {
      throw new ToolError('run_failed', {
        params: {
          handle,
          detail:
            state.errorMessage === null || state.errorMessage === ''
              ? ctx.t('runStart.failed.noDetail')
              : inline(state.errorMessage, MAX_REASON),
        },
      });
    }
    // Only a finished run gets here. Its numbers are read once more, for the final line and the
    // chart; a store that does not answer costs those, not the end of the run.
    let numbers: RunNumbers | null = null;
    try {
      numbers = await readRunNumbers(ctx, saved.project.id, id);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      ctx.log.info('final numbers of the run unavailable', { error });
    }
    const link = ctx.services.links.executionLive(saved.project.id, id);
    return {
      status: 'done',
      data: {
        execution: { id, handle },
        target: { kind: saved.target.kind, name: saved.target.name },
        environment: {
          name: saved.environment.name,
          protected: saved.environment.protected,
          caps: {
            ...(saved.environment.caps.maxVu === undefined
              ? {}
              : { maxVu: saved.environment.caps.maxVu }),
            ...(saved.environment.caps.maxRps === undefined
              ? {}
              : { maxRps: saved.environment.caps.maxRps }),
          },
        },
        label: saved.label,
        requested: asProfile(saved.requested),
        effective: asProfile(saved.effective),
        clamped: saved.clamped,
        ...(saved.note === undefined ? {} : { note: saved.note }),
        thresholds: saved.thresholds,
        dataCheck: saved.dataCheck,
        link: link.url,
        end: {
          outcome: state.phase === 'cancelled' ? 'cancelled' : 'completed',
          buildS: state.buildS,
          elapsedS: state.durationS,
          plannedS: state.plannedS,
          numbers: numbers === null ? null : liveOf(numbers),
          series: numbers === null ? [] : numbers.series,
        },
      },
    };
  },
  view: renderRunDone,
});
