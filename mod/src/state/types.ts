/**
 * What the mod knows about the session: which step it is in, which project and environment the
 * user works on, and whether a long operation runs. Plain JSON data, kept in `$.state`.
 *
 * The values come from two places only: the name of a LoadCraft tool the model called, and the
 * data block of `process_get_status` (`format: "data"`). No secret and no address is ever part of it.
 */

import type { OperationSnapshot } from '../view/status.js';

/** Steps of a test session: 1 API documentation … 8 diagnosis; 0 while nothing is known yet. */
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ModOperation {
  /** `<kind>:<id>`, exactly as the server gave it. */
  readonly handle: string;
  readonly kind: string;
  /** The tool whose result named the operation; empty when only the status knows it. */
  readonly tool: string;
  /** Epoch milliseconds, on the clock the caller of `reduce` passes in. */
  readonly startedAt: number;
}

/**
 * What the live line of a `run_start` call is drawn from while the call is open (the call holds
 * until the test ends or its wait runs out). Kept apart from the session state, in an atom of its
 * own (`loadcraft.progress`): it changes with every read of the poll and lives as long as the call.
 */
export interface ModProgress {
  /** `tool_use_id` of the open `run_start` call; the progress row of that call is the one drawn. */
  readonly call?: string;
  /** Requests per second of the newest reads, oldest first, at most `MAX_SAMPLES` (series.ts). */
  readonly samples: readonly number[];
  readonly snapshot?: OperationSnapshot;
}

export const INITIAL_PROGRESS: ModProgress = { samples: [] };

/**
 * One bar: a long operation in progress, as the server's `process_get_status` with `progress` lists it
 * (the state file of the plugin; see `parseBars` in bars.ts). Times are epoch milliseconds.
 */
export interface BarRow {
  /** The call that wrote the row; with `handle` it tells one bar from another, whatever the key. */
  readonly call: string;
  readonly handle?: string;
  /** Kind of operation (`scenario_generation`), when the row follows one. */
  readonly kind?: string;
  /** Short name of the tool of the call that waits. */
  readonly tool: string;
  /** The stage in words, as the server wrote it (`scenario 2/2 · Cart: Generating feeder data...`). */
  readonly stage: string;
  /** 0..100 when the server knows how far the operation is; absent: an indeterminate wait. */
  readonly percent?: number;
  readonly n?: number;
  readonly m?: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  /** True while a call still waits for the operation. */
  readonly open: boolean;
}

/** How the operation of a bar ended, when the server says (`ended` of the same answer). */
export type BarEnd = 'done' | 'failed' | 'cancelled';

/**
 * What the bars draw from (atom `loadcraft.bars`): the rows of the last read, and the bars that
 * ended since, which stay on screen as finished for a few seconds, with how their operation ended
 * when the server said.
 */
export interface ModBars {
  readonly rows: readonly BarRow[];
  readonly finished: readonly {
    readonly row: BarRow;
    readonly until: number;
    readonly end?: BarEnd;
  }[];
}

export const INITIAL_BARS: ModBars = { rows: [], finished: [] };

export interface ModState {
  readonly project?: { readonly name: string; readonly id: string };
  readonly environment?: { readonly name: string; readonly protected: boolean };
  readonly step: Step;
  /** Steps known to be behind the user, ascending. */
  readonly done: readonly number[];
  readonly operation?: ModOperation;
  /** Handle of the newest test run, as `process_get_status` lists it. */
  readonly lastExecution?: string;
  /**
   * Handles of operations known to be over (ended, or lost track of), the newest last, at most
   * `MAX_ENDED`. A signal or a status that names one of them never puts it back in progress.
   */
  readonly ended: readonly string[];
  /**
   * Steps the session does not owe, ascending: the diagnosis (8) of a test whose thresholds held.
   * The band shows them apart from the steps still ahead. A new test empties the list.
   */
  readonly skipped: readonly number[];
  /** Epoch milliseconds of the last change. */
  readonly updatedAt: number;
  /**
   * True until the first fact arrives. `/clear`, `/resume` and `/branch` put every `$.state` value
   * back to its default and `session.start` does not fire again, so a state still stale after a
   * tool call is one the status has to refill.
   */
  readonly isStale: boolean;
}

export const INITIAL_STATE: ModState = {
  step: 0,
  done: [],
  ended: [],
  skipped: [],
  updatedAt: 0,
  isStale: true,
};

/** One thing the mod learned, in the form `reduce` takes. */
export type Signal =
  /** A LoadCraft tool returned: its short name, and what its text carries (see `signal.ts`). */
  | {
      readonly kind: 'tool';
      readonly tool: string;
      readonly handle?: string;
      readonly errorCode?: string;
    }
  /** The parsed data block of `process_get_status`. */
  | {
      readonly kind: 'status';
      readonly data: unknown;
      /** The kind of operation to follow when the list holds several (a `run_start` call waits). */
      readonly prefer?: string;
    }
  /** The parsed snapshot of one operation (`process_get_status` with `operation`). */
  | { readonly kind: 'operation'; readonly data: unknown }
  /** The mod gave up reading this operation: its state is unknown, so it is not in progress. */
  | { readonly kind: 'lost'; readonly handle: string };

/** How many ended handles the state keeps. */
export const MAX_ENDED = 20;
