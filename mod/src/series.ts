/**
 * The requests-per-second series behind the live line of a running test, and the one function that
 * changes the progress state (`ModProgress`, the atom `loadcraft.progress`). Pure: no `$`, no clock,
 * no exception; a function that has nothing to change hands back the same object, so that the
 * caller does not write.
 *
 * The series is fed by the snapshots the poll of the operation in progress reads (poll.ts, every
 * few seconds), so it holds one sample per read and never asks the server for more.
 */

import { shortToolName } from './state/signal.js';
import { INITIAL_PROGRESS, type ModProgress } from './state/types.js';
import { isTerminal, type OperationSnapshot } from './view/status.js';

/** The longest series kept; the oldest sample goes first. */
export const MAX_SAMPLES = 40;

const BLOCKS = '▁▂▃▄▅▆▇█';

/** `samples` with `value` appended; a missing or non-finite value adds nothing. */
export function addSample(
  samples: readonly number[],
  value: number | null | undefined,
  max = MAX_SAMPLES,
): readonly number[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return samples;
  return [...samples, value].slice(-Math.max(1, max));
}

/**
 * The newest `width` samples as blocks `▁▂▃▄▅▆▇█`, scaled from zero to the highest of them, so that
 * small noise on a steady rate stays a flat line and a ramp-up reads as a ramp. Fewer samples than
 * `width` give a shorter line; no samples (or no room) give an empty one.
 */
export function sparkline(samples: readonly number[], width: number): string {
  if (!(width >= 1)) return '';
  const shown = samples.filter((value) => Number.isFinite(value)).slice(-Math.floor(width));
  if (shown.length === 0) return '';
  const top = Math.max(0, ...shown);
  return shown
    .map((value) => {
      if (top === 0) return BLOCKS.charAt(0);
      const level = Math.round((Math.max(0, value) / top) * (BLOCKS.length - 1));
      return BLOCKS.charAt(level);
    })
    .join('');
}

/** What happens to the progress of the session. */
export type ProgressEvent =
  /** A `run_start` call began: a new series for it. */
  | { readonly kind: 'open'; readonly call: string }
  /** That call returned: its progress is gone. */
  | { readonly kind: 'close'; readonly call: string }
  /** The poll read a snapshot of the operation in progress. */
  | { readonly kind: 'snapshot'; readonly snapshot: OperationSnapshot }
  /** The mod gave up reading the operation. */
  | { readonly kind: 'end' };

export function withProgress(progress: ModProgress, event: ProgressEvent): ModProgress {
  switch (event.kind) {
    case 'open':
      return progress.call === event.call &&
        progress.samples.length === 0 &&
        progress.snapshot === undefined
        ? progress
        : { call: event.call, samples: [] };
    case 'close':
      return progress.call === event.call ? INITIAL_PROGRESS : progress;
    case 'end':
      return progress.call === undefined ||
        (progress.samples.length === 0 && progress.snapshot === undefined)
        ? progress
        : { call: progress.call, samples: [] };
    case 'snapshot': {
      const { snapshot } = event;
      // Only a test run that a `run_start` call is waiting for has a live line.
      if (progress.call === undefined || snapshot.kind !== 'test_run') return progress;
      if (isTerminal(snapshot)) {
        return progress.snapshot === undefined && progress.samples.length === 0
          ? progress
          : { call: progress.call, samples: [] };
      }
      const same = progress.snapshot?.operation === snapshot.operation;
      return {
        call: progress.call,
        samples: addSample(same ? progress.samples : [], snapshot.live?.rps),
        snapshot,
      };
    }
    default:
      return progress;
  }
}

/** The id of a call of `run_start` (and of no other tool), or `undefined`. */
export function runStartCall(tool: unknown, id: unknown): string | undefined {
  return shortToolName(tool) === 'run_start' && typeof id === 'string' && id !== ''
    ? id
    : undefined;
}
