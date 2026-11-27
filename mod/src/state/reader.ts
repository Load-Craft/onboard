/**
 * The one gate every background read of the server goes through (the status read after a tool call
 * and the poll of the operation in progress): pure, no `$`, no clock (the time comes in).
 *
 * - One read at a time. A read that has not answered after `READ_STALE_MS` no longer counts as
 *   running, and the next one takes its place; the old one then finds it is not the current read
 *   and drops its answer.
 * - A tool call that arrives while a read runs is noted on it; the read puts it on top of its
 *   answer, so the answer cannot undo what the call said.
 * - A status read that was refused because one was running is queued: exactly one follows when the
 *   running one ends.
 */

import type { ModState, Signal } from './types.js';

/** A read that has not come back after this long no longer blocks the next one. */
export const READ_STALE_MS = 30_000;

export interface Noted {
  readonly signal: Signal;
  readonly at: number;
}

/** One read in flight. */
export interface Ticket {
  /** Clock time the read started at. */
  readonly since: number;
  /** What the calls that arrived after the read started told the state, with their times. */
  readonly signals: Noted[];
}

export interface Gate {
  /** A call of a LoadCraft tool said this at `at`: noted on the read in flight, and counted. */
  note(signal: Signal, at: number): void;
  /** How many calls of LoadCraft tools were noted so far. */
  calls(): number;
  /** True while a read that still counts is running. */
  busy(at: number): boolean;
  /**
   * Starts a read: the ticket, or `undefined` when one is running. With `queue`, a refused read is
   * kept and `end` of the running one says so.
   */
  begin(at: number, queue: boolean): Ticket | undefined;
  /** True while `ticket` is the read that counts. */
  isCurrent(ticket: Ticket): boolean;
  /** Registers `listener`: it is called with the new state after every write that changed it. */
  onStateChange(listener: (state: ModState) => void): void;
  /** Said by whoever wrote the state (a hook, a read, the poll): lets every listener know. */
  changed(state: ModState): void;
  /** Ends `ticket`. True when it was the current read and a queued one is waiting for its place. */
  end(ticket: Ticket): boolean;
}

export function createGate(): Gate {
  let reading: Ticket | undefined;
  let queued = false;
  let calls = 0;
  const listeners: ((state: ModState) => void)[] = [];
  const running = (at: number): boolean =>
    reading !== undefined && at - reading.since < READ_STALE_MS;
  return {
    note(signal, at) {
      calls += 1;
      reading?.signals.push({ signal, at });
    },
    calls: () => calls,
    busy: running,
    begin(at, queue) {
      if (running(at)) {
        if (queue) queued = true;
        return undefined;
      }
      const ticket: Ticket = { since: at, signals: [] };
      reading = ticket;
      queued = false;
      return ticket;
    },
    onStateChange(listener) {
      listeners.push(listener);
    },
    changed(state) {
      for (const listener of listeners) {
        try {
          listener(state);
        } catch {
          // A listener that fails does not stop the others, nor the write.
        }
      }
    },
    isCurrent: (ticket) => reading === ticket,
    end(ticket) {
      if (reading !== ticket) return false;
      reading = undefined;
      return queued;
    },
  };
}
