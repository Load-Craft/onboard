/**
 * What the background poll of the operation in progress decides, as a pure object: no `$`, no
 * clock, no exception. The hook in register.ts asks it on every tick what to read, hands it what
 * the read answered, and does what it says (read, draw the line, notify).
 *
 * - One read at a time: the gate (state/reader.ts) is shared with the status read, and a tick that
 *   finds a read running asks for none.
 * - No operation in the state, no read.
 * - A read that fails changes nothing and the next try comes after a longer pause (every second
 *   failure doubles it, up to a minute); after `MAX_FAILURES` the operation is let go: the user is
 *   told once that its state is unknown, and the state drops it.
 * - A request of the user is told once per episode: it is told again only after a call of a
 *   LoadCraft tool that came after the notice (someone reacted).
 * - The line is handed back only when its text changed, and cleared when the operation ends.
 * - The end of an operation is told once, and an operation that has ended is never read again.
 */

import {
  endedText,
  isTerminal,
  lostNotice,
  notice,
  parseSnapshot,
  statusLine,
  type Locale,
  type Notice,
  type OperationSnapshot,
} from './view/status.js';

/**
 * The poll runs this often. A test shows its seconds and its numbers move on a scale of seconds
 * (the server reads the numbers of a run every 10 s and its state every 3 s), so a shorter period
 * only repeats the answer, and a longer one makes the clock on the line jump. Each read is one
 * read of the run and one of its numbers on the backend, one at a time.
 */
export const POLL_MS = 5000;
/** Consecutive failed reads after which the operation is let go. */
export const MAX_FAILURES = 6;
/** The pause after a failure never exceeds this many ticks (one minute at `POLL_MS`). */
const MAX_PAUSE_TICKS = 11;

export interface Plan {
  /** The operation to read now. */
  readonly read?: string;
  /** The new text of the line; `null` clears it. Absent when the line stays. */
  readonly line?: string | null;
  readonly notice?: Notice;
}

export interface Outcome {
  /** What the read found, for the state to take. */
  readonly snapshot?: OperationSnapshot;
  /** The operation the mod gave up reading: the state takes it out. */
  readonly lost?: string;
  readonly line?: string | null;
  readonly notice?: Notice;
}

export interface Poller {
  /**
   * Called on every tick with the handle of the operation the state names, if it names one, and
   * whether a read of the gate is running (then none is asked for).
   */
  tick(handle: string | undefined, busy: boolean): Plan;
  /**
   * Called when the read `tick` asked for ends; `data` is the parsed answer, or `undefined`, and
   * `calls` how many calls of LoadCraft tools the gate has noted so far.
   */
  settle(handle: string, data: unknown, calls: number): Outcome;
}

export function createPoller(locale: Locale): Poller {
  /** The operation followed now, and the last thing seen of it. */
  let current: { readonly handle: string; last: OperationSnapshot | undefined } | undefined;
  let failures = 0;
  let pause = 0;
  let drawn: string | undefined;
  /** Per operation: how many tool calls the gate had counted when its request was told. */
  const toldAt = new Map<string, number>();
  /** Operations that ended, or that the mod gave up reading: never read again. */
  const over = new Set<string>();

  const reset = (): void => {
    failures = 0;
    pause = 0;
  };
  const clearLine = (): { line?: null } => {
    if (drawn === undefined) return {};
    drawn = undefined;
    return { line: null };
  };

  return {
    tick(handle, busy) {
      if (handle === undefined) {
        // The operation left the state. A kind that reports no phase gives no other sign of its end.
        const last = current?.last;
        const ended =
          last !== undefined && last.phase === undefined && !over.has(last.operation)
            ? { notice: { kind: 'done', text: endedText(last, locale) } as const }
            : {};
        if (current !== undefined) over.add(current.handle);
        current = undefined;
        reset();
        return { ...clearLine(), ...ended };
      }
      if (current?.handle !== handle) {
        current = { handle, last: undefined };
        reset();
      }
      if (over.has(handle)) return clearLine();
      if (busy) return {};
      if (pause > 0) {
        pause -= 1;
        return {};
      }
      return { read: handle };
    },

    settle(handle, data, calls) {
      const snapshot = parseSnapshot(data);
      if (snapshot === undefined || snapshot.operation !== handle) {
        failures += 1;
        pause = Math.min(2 ** (failures - 1) - 1, MAX_PAUSE_TICKS);
        if (failures < MAX_FAILURES) return {};
        over.add(handle);
        return { ...clearLine(), lost: handle, notice: lostNotice(locale) };
      }
      reset();
      const previous = current?.handle === handle ? current.last : undefined;
      if (current?.handle === handle) current.last = snapshot;
      let told = notice(previous, snapshot, locale);
      if (told?.kind === 'needs_user') {
        const at = toldAt.get(handle);
        // Told already, and no call of a LoadCraft tool since: no one has reacted, so it stays quiet.
        if (at !== undefined && calls <= at) told = undefined;
        else toldAt.set(handle, calls);
      }
      const said = told === undefined ? {} : { notice: told };
      if (isTerminal(snapshot)) {
        over.add(handle);
        return { snapshot, ...clearLine(), ...said };
      }
      const line = statusLine(snapshot, locale);
      const changed = line === drawn ? {} : { line };
      drawn = line;
      return { snapshot, ...changed, ...said };
    },
  };
}
