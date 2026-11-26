// A lock per key inside the server process: work started under a key waits for every earlier
// holder of the same key. Two calls at once that must not both start something (a test on one
// environment, accounts for one slot) take the same key.

/** Holders under way, per key: the promise that settles when the last of them is done. */
export type LockTable = Map<string, Promise<void>>;

export function createLockTable(): LockTable {
  return new Map();
}

/** Runs `work` after every earlier holder of `key` in `table` is done; the next holder waits for it. */
export async function withLock<T>(
  table: LockTable,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const before = table.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = before.then(() => mine);
  table.set(key, tail);
  await before;
  try {
    return await work();
  } finally {
    release();
    if (table.get(key) === tail) table.delete(key);
  }
}
