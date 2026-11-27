// Long-running backend jobs driven by the test clock: a job follows a schedule of states and its
// current state is read from the clock, so a test moves a job forward with `clock.advance`
// instead of waiting. Jobs live in memory only and vanish on a simulated backend restart.

import type { Clock } from '../../src/ops/clock.js';
import { FakeHttpError } from './store.js';

export interface JobStep<S> {
  /** Milliseconds after the start at which the job enters `state`. */
  readonly afterMs: number;
  readonly state: S;
}

export interface JobSchedule<S> {
  /** First step at `afterMs: 0`, then strictly ascending. */
  readonly steps: readonly JobStep<S>[];
  /** Fixed identifier (e.g. one pinned by golden texts); a seeded one otherwise. */
  readonly id?: string;
}

export interface Job<S = unknown> {
  readonly id: string;
  readonly kind: string;
  /** State of the latest step reached at the current clock time. */
  readonly state: S;
  readonly startedAt: number;
  readonly elapsedMs: number;
  /** True once the last step is reached. */
  readonly finished: boolean;
}

export interface Jobs {
  start<S>(kind: string, schedule: JobSchedule<S>): Job<S>;
  /** The job now; an unknown id throws a 404 the server sends as `Job not found: <id>`. */
  read<S = unknown>(id: string): Job<S>;
  find<S = unknown>(id: string): Job<S> | undefined;
  /** Forgets every job (backend restart). */
  clear(): void;
}

interface Entry {
  readonly id: string;
  readonly kind: string;
  readonly startedAt: number;
  readonly steps: readonly JobStep<unknown>[];
}

function validate(kind: string, steps: readonly JobStep<unknown>[]): void {
  const first = steps[0];
  if (first === undefined) throw new Error(`job ${kind}: needs at least one step`);
  if (first.afterMs !== 0) throw new Error(`job ${kind}: the first step must be at afterMs 0`);
  steps.forEach((step, index) => {
    const previous = steps[index - 1];
    if (previous !== undefined && step.afterMs <= previous.afterMs) {
      throw new Error(`job ${kind}: step afterMs must be strictly ascending`);
    }
  });
}

export function createJobs(clock: Pick<Clock, 'now'>, newId: () => string): Jobs {
  const entries = new Map<string, Entry>();

  const view = <S>(entry: Entry): Job<S> => {
    const elapsedMs = clock.now() - entry.startedAt;
    let reached = 0;
    entry.steps.forEach((step, index) => {
      if (step.afterMs <= elapsedMs) reached = index;
    });
    return {
      id: entry.id,
      kind: entry.kind,
      // The schedule was given as JobStep<S>; `read<S>` names the same S back.
      state: entry.steps[reached]?.state as S,
      startedAt: entry.startedAt,
      elapsedMs,
      finished: reached === entry.steps.length - 1,
    };
  };

  return {
    start(kind, schedule) {
      validate(kind, schedule.steps);
      const id = schedule.id ?? newId();
      if (entries.has(id)) throw new Error(`job ${kind}: id ${id} already exists`);
      const entry: Entry = { id, kind, startedAt: clock.now(), steps: schedule.steps };
      entries.set(id, entry);
      return view(entry);
    },
    read(id) {
      const entry = entries.get(id);
      if (entry === undefined) throw new FakeHttpError(404, { detail: `Job not found: ${id}` });
      return view(entry);
    },
    find(id) {
      const entry = entries.get(id);
      return entry === undefined ? undefined : view(entry);
    },
    clear() {
      entries.clear();
    },
  };
}
