// What earlier runs took from an exclusive pool, read from the backend's sentence about a slot.
// The data check gives the rows and the need as fields, but what was drawn, from what pool and by
// which runs only inside its English sentence (DOKTOR-02). The plugin takes those few facts out of
// the sentence's known phrases, so a view in any language can say them in its own words; anything
// it does not recognise leaves the facts null and the sentence is shown as the backend's.

/** The facts of a spent pool; numbers and run handles only, nothing else of the sentence. */
export interface SpentPool {
  /** Values earlier runs drew from the pool; null when the sentence does not say. */
  readonly drawn: number | null;
  /** Distinct values the pool holds; null when the sentence does not say. */
  readonly pool: number | null;
  /** Values the pool can still hand out. */
  readonly free: number;
  /** Handles (`e-1a2b3c4d`) of the runs that drew them; empty when the sentence names none. */
  readonly runs: string[];
  /** The strategy that reads the file from its top on every run (so the spent values come first). */
  readonly rereads: string | null;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const DRAWN_FROM_POOL = /already drew (\d{1,9}) values? from its pool of (\d{1,9})\b/u;
const FREE_REMAIN = /\b(\d{1,9}) free values? remains?\b/u;
const DRAWN_OF_THEM = /already drew (\d{1,9}) of them\b/u;
const EARLIER_RUNS = /\bearlier runs? \(([^()]{1,400})\)/gu;
const REREADS = /its '([a-z_]{1,32})' strategy reads the file from the top\b/u;

/** The handle of a run as the resolver takes it. */
export const runHandle = (id: string): string => `e-${id.slice(0, 8).toLowerCase()}`;

/** The facts of the sentence, or null when it states neither what was drawn nor what is free. */
export function spentPoolOf(sentence: string | null | undefined): SpentPool | null {
  if (sentence == null) return null;
  const fromPool = DRAWN_FROM_POOL.exec(sentence);
  const remain = FREE_REMAIN.exec(sentence);
  if (fromPool === null && remain === null) return null;
  const drawn =
    fromPool !== null ? Number(fromPool[1]) : Number(DRAWN_OF_THEM.exec(sentence)?.[1] ?? NaN);
  const pool = fromPool === null ? null : Number(fromPool[2]);
  const free = remain !== null ? Number(remain[1]) : Math.max((pool ?? 0) - drawn, 0);
  const runs = [...sentence.matchAll(EARLIER_RUNS)].flatMap((match) =>
    [...(match[1] ?? '').matchAll(UUID)].map((id) => runHandle(id[0])),
  );
  return {
    drawn: Number.isFinite(drawn) ? drawn : null,
    pool,
    free,
    runs: [...new Set(runs)],
    rereads: REREADS.exec(sentence)?.[1] ?? null,
  };
}

/** The sentence with the ids of the earlier runs it names given as handles. */
export function withRunHandles(sentence: string): string {
  return sentence.replace(EARLIER_RUNS, (whole) => whole.replace(UUID, (id) => runHandle(id)));
}
