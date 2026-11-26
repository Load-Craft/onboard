// Writes of one call to the state file, in the order they were asked for. A callback that cannot wait (a frame
// of a channel, a progress report) hands its write to the chain; the call awaits `flush` before it returns, so
// the file holds everything the call wrote and a failed write surfaces as the error of the call. A failed
// write does not stop the ones after it: the chain goes on, and `flush` reports the first failure once.

export interface WriteChain {
  /** Runs `write` after the writes asked for before it; the promise settles with that write. */
  run(write: () => Promise<unknown>): Promise<void>;
  /** Resolves when every write asked for so far is done; rejects with the first failure since the last flush. */
  flush(): Promise<void>;
}

export function createWriteChain(): WriteChain {
  let tail: Promise<void> = Promise.resolve();
  let failure: { readonly error: unknown } | undefined;
  return {
    run(write) {
      const next = tail.then(async () => {
        try {
          await write();
        } catch (error) {
          failure ??= { error };
          throw error;
        }
      });
      // The failure is delivered by `flush` (and to the caller of `run`); the chain itself goes on.
      tail = next.catch(() => undefined);
      return next;
    },
    async flush() {
      await tail;
      if (failure === undefined) return;
      const { error } = failure;
      failure = undefined;
      throw error;
    },
  };
}
