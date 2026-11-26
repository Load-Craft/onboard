// An exclusive lock on a file shared by several server processes (the conversation and its subagents each
// run their own): `<path>.lock` created with the `wx` flag, so exactly one creator wins. The lock file names
// its owner (host, pid, time, token). A lock left behind by a process that died is taken over: its pid no
// longer exists on this host, or it is older than `staleMs` (the pid may have been reused by another process,
// or the owner hangs). A lock of a live process younger than `staleMs` is never taken over: the caller waits
// up to `timeoutMs` and gets `state_locked`.
//
// Removing a lock file is never a check followed by an unlink on its own: between the two another process
// could replace the file, and we would delete its lock. Every removal of `<path>.lock` (a dead lock, or our
// own on release) happens while holding a second, short mutex `<path>.lock.takeover`; creating the lock needs
// no mutex (`wx` fails while the file exists), so under the mutex the file checked is the file removed. The
// mutex is held for one read and one unlink; a mutex left by a process that died is moved aside by rename and
// removed only if the moved file is the one judged dead (otherwise it is linked back).
import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { ToolError } from '../errors.js';

/** The file operations of the lock; tests wrap them to put another process's step between two of ours. */
export type LockFs = Pick<
  typeof nodeFs,
  | 'openSync'
  | 'writeSync'
  | 'closeSync'
  | 'readFileSync'
  | 'statSync'
  | 'unlinkSync'
  | 'renameSync'
  | 'linkSync'
>;

export interface FileLockOptions {
  /** How long to wait for a lock held by a live process. */
  timeoutMs?: number;
  /** A lock older than this is dead whatever its pid says. A write holds the lock for milliseconds. */
  staleMs?: number;
  /** Pause between two attempts (a random jitter of the same size is added). */
  pollMs?: number;
  /** Wall clock: lock times are compared across processes, so this is never a test clock of the state. */
  now?: () => number;
  fs?: LockFs;
}

export const LOCK_DEFAULTS = {
  timeoutMs: 5_000,
  staleMs: 15_000,
  pollMs: 10,
  /** The takeover mutex is held for one read and one unlink. */
  takeoverStaleMs: 2_000,
} as const;

interface Owner {
  host: string;
  pid: number;
  at: number;
  token: string;
}

/** A held lock: what `releaseLock` needs. */
export interface LockHandle {
  readonly path: string;
  readonly token: string;
}

interface Settings {
  staleMs: number;
  pollMs: number;
  now: () => number;
  fs: LockFs;
}

function settingsOf(options: FileLockOptions): Settings {
  return {
    staleMs: options.staleMs ?? LOCK_DEFAULTS.staleMs,
    pollMs: options.pollMs ?? LOCK_DEFAULTS.pollMs,
    now: options.now ?? Date.now,
    fs: options.fs ?? nodeFs,
  };
}

function parseOwner(text: string): Owner | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { host, pid, at, token } = value as Record<string, unknown>;
  // pid 0 and negative pids address process groups in kill(); such a file is treated as unreadable.
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  if (typeof host !== 'string' || typeof token !== 'string') return undefined;
  return { host, pid, at, token };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

function readText(fs: LockFs, path: string): string | undefined {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function unlinkQuiet(fs: LockFs, path: string): void {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') throw error;
  }
}

/** Creates `path` with `wx` and the owner's text; false when it already exists. */
function create(fs: LockFs, path: string, text: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(path, 'wx', 0o600);
  } catch (error) {
    if (codeOf(error) === 'EEXIST') return false;
    throw error;
  }
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function isDead(s: Settings, path: string, text: string, staleMs: number): boolean {
  const owner = parseOwner(text);
  if (owner === undefined) {
    // Unreadable: the owner may be between creating the file and writing it, so only age counts.
    try {
      return s.now() - s.fs.statSync(path).mtimeMs > staleMs;
    } catch {
      return false;
    }
  }
  if (s.now() - owner.at > staleMs) return true;
  return owner.host === hostname() && !pidAlive(owner.pid);
}

function ownerText(s: Settings): { text: string; token: string } {
  const token = randomBytes(8).toString('hex');
  return {
    token,
    text: JSON.stringify({ host: hostname(), pid: process.pid, at: s.now(), token }),
  };
}

// Moves `path` aside and removes it only if it is still `text`; a file that changed in the meantime (a new
// owner) is linked back. Used for the takeover mutex itself, which has no mutex above it.
function removeIfUnchanged(fs: LockFs, path: string, text: string): void {
  const grave = `${path}.${randomBytes(6).toString('hex')}.gone`;
  try {
    fs.renameSync(path, grave);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return;
    throw error;
  }
  if (readText(fs, grave) !== text) {
    try {
      fs.linkSync(grave, path);
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error;
    }
  }
  unlinkQuiet(fs, grave);
}

/** Runs `fn` under `<lock>.takeover` if the mutex is free (or dead); undefined when it is busy. */
function underTakeover<T>(s: Settings, lockPath: string, fn: () => T): { value: T } | undefined {
  const path = `${lockPath}.takeover`;
  const me = ownerText(s);
  if (!create(s.fs, path, me.text)) {
    const text = readText(s.fs, path);
    if (text !== undefined && isDead(s, path, text, LOCK_DEFAULTS.takeoverStaleMs)) {
      removeIfUnchanged(s.fs, path, text);
    }
    if (!create(s.fs, path, me.text)) return undefined;
  }
  try {
    return { value: fn() };
  } finally {
    removeIfUnchanged(s.fs, path, me.text);
  }
}

/** One attempt to take `<path>.lock`, without waiting: a dead lock is removed first (under the mutex). */
export function tryAcquire(path: string, options: FileLockOptions = {}): LockHandle | undefined {
  const s = settingsOf(options);
  const lockPath = `${path}.lock`;
  const me = ownerText(s);
  if (create(s.fs, lockPath, me.text)) return { path: lockPath, token: me.token };
  const text = readText(s.fs, lockPath);
  if (text === undefined || !isDead(s, lockPath, text, s.staleMs)) return undefined;
  const removed = underTakeover(s, lockPath, () => {
    // checked again under the mutex: nobody can remove or replace the file until we unlink it
    const again = readText(s.fs, lockPath);
    if (again === undefined) return true;
    if (!isDead(s, lockPath, again, s.staleMs)) return false;
    unlinkQuiet(s.fs, lockPath);
    return true;
  });
  if (removed?.value !== true) return undefined;
  return create(s.fs, lockPath, me.text) ? { path: lockPath, token: me.token } : undefined;
}

/**
 * Removes the lock if it is still ours (after a takeover it belongs to someone else), under the same mutex as
 * a takeover. If the mutex stays busy beyond the stale limit the lock is left: others take it over as dead.
 */
export async function releaseLock(
  handle: LockHandle,
  options: FileLockOptions = {},
): Promise<void> {
  const s = settingsOf(options);
  const started = s.now();
  for (;;) {
    const done = underTakeover(s, handle.path, () => {
      const text = readText(s.fs, handle.path);
      if (text !== undefined && parseOwner(text)?.token === handle.token)
        unlinkQuiet(s.fs, handle.path);
    });
    if (done !== undefined || s.now() - started > s.staleMs) return;
    await sleep(s.pollMs + Math.floor(Math.random() * s.pollMs));
  }
}

/** Runs `fn` while holding `<path>.lock`; the lock is released even when `fn` throws. */
export async function withFileLock<T>(
  path: string,
  fn: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const s = settingsOf(options);
  const timeoutMs = options.timeoutMs ?? LOCK_DEFAULTS.timeoutMs;
  // Yield first, as two processes would: a parallel writer in the same process then reads the state before
  // this one writes, and the rev check of the reducer, not the timing, decides who retries.
  await Promise.resolve();
  const started = s.now();
  let handle = tryAcquire(path, options);
  while (handle === undefined) {
    if (s.now() - started >= timeoutMs) {
      throw new ToolError('state_locked', {
        message: 'Another LoadCraft process holds the lock of the state file.',
        hint: 'Call again in a moment.',
      });
    }
    await sleep(s.pollMs + Math.floor(Math.random() * s.pollMs));
    handle = tryAcquire(path, options);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(handle, options);
  }
}
