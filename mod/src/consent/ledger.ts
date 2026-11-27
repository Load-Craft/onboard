/**
 * The record of what the user agreed to, kept in `$.state` so that one consent is not asked for
 * twice: the server answers a first call with a request for consent (`confirm_capped`,
 * `confirm_protected`), the model repeats the call with it, and the repeat carries the very facts
 * the user just agreed to. Pure functions of the ledger and the time; no `$`.
 *
 * An entry is good for one use and for ten minutes. A refusal leaves no entry.
 */

/** How long a consent stays good for its repeat. */
export const CONSENT_TTL_MS = 10 * 60 * 1000;

/** At most this many entries are kept; the oldest go first. */
const MAX_ENTRIES = 16;

export interface ConsentEntry {
  /** The short tool name (`run_start`). */
  readonly tool: string;
  /** The facts the user agreed to, as one string (see `consentKey` in decide.ts). */
  readonly key: string;
  /** Clock time of the consent, in milliseconds. */
  readonly at: number;
}

export interface Ledger {
  readonly entries: readonly ConsentEntry[];
}

export const EMPTY_LEDGER: Ledger = { entries: [] };

function isEntry(value: unknown): value is ConsentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { tool, key, at } = value as Record<string, unknown>;
  return typeof tool === 'string' && typeof key === 'string' && typeof at === 'number';
}

function isFresh(entry: ConsentEntry, now: number): boolean {
  return now >= entry.at && now - entry.at < CONSENT_TTL_MS;
}

/** The well-formed entries still good at `now`; anything else in the state counts as nothing. */
function fresh(ledger: Ledger, now: number): ConsentEntry[] {
  const entries: unknown = (ledger as { entries?: unknown } | undefined)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(isEntry).filter((entry) => isFresh(entry, now));
}

/** Whether the user agreed to these facts for this tool less than ten minutes ago. */
export function hasConsent(ledger: Ledger, tool: string, key: string, now: number): boolean {
  return fresh(ledger, now).some((entry) => entry.tool === tool && entry.key === key);
}

/** The ledger after the user agreed to `key` for `tool` at `now`. */
export function grant(ledger: Ledger, tool: string, key: string, now: number): Ledger {
  const kept = fresh(ledger, now).filter((entry) => !(entry.tool === tool && entry.key === key));
  return { entries: [...kept, { tool, key, at: now }].slice(-MAX_ENTRIES) };
}

/** The ledger after the consent for `key` was used: the entry is gone. */
export function consume(ledger: Ledger, tool: string, key: string, now: number): Ledger {
  return {
    entries: fresh(ledger, now).filter((entry) => !(entry.tool === tool && entry.key === key)),
  };
}
