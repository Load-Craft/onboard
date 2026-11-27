// The undo test of a write with a declared undo: call the tool, take the undo from the last log
// entry of the workspace's state file, call it, and compare the object in the fake backend with
// what it was before (the object, not only the answer of a tool).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { CHECKS } from '../../src/catalog.generated.js';
import { createLogger } from '../../src/log.js';
import { createProcessStore } from '../../src/workspace/reducer.js';
import { CallSecretScope } from '../../src/workspace/secrets.js';

import type { ToolRig } from './rig.js';

export interface LoggedUndo {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly level?: number;
  readonly note?: string;
}

export interface LoggedCall {
  readonly tool: string;
  readonly status: string;
  readonly args: string;
  readonly result: string;
  readonly undo?: LoggedUndo;
}

interface StateFile {
  readonly process: Record<string, { readonly log?: readonly LoggedCall[] }>;
}

/** The entries of the log of calls, oldest first, of every process in the state file. */
export function loggedCalls(r: ToolRig): LoggedCall[] {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const state = JSON.parse(text) as StateFile;
  return Object.values(state.process).flatMap((process) => process.log ?? []);
}

/**
 * Calls `tool`, then the undo its log entry declares, and expects the object `snapshot` reads to be
 * as it was before the first call. Returns the undo the entry carried.
 */
export async function expectUndoRestores<T>(
  r: ToolRig,
  call: { readonly tool: string; readonly args: Record<string, unknown> },
  snapshot: () => T,
): Promise<LoggedUndo> {
  const before = snapshot();
  const first = await r.call(call.tool, call.args);
  expect(first.isError, first.text).toBeFalsy();
  const changed = snapshot();
  expect(changed).not.toEqual(before);
  const entry = loggedCalls(r).at(-1);
  expect(entry?.tool).toBe(call.tool);
  const undo = entry?.undo;
  if (undo === undefined) throw new Error('the log entry of the write carries no undo');
  const undone = await r.call(undo.tool, undo.args);
  expect(undone.isError, undone.text).toBeFalsy();
  expect(snapshot()).toEqual(before);
  return undo;
}

/**
 * The undo of a write that CREATES objects is a deletion (`flows_delete`, level 3: a card and the
 * person's yes, never called by a tool). The test takes the undo from the log, checks that it names
 * `tool` with the arguments `expectedArgs(...)` gives, then does what that deletion does on the
 * fake (`remove`) and expects the objects `snapshot` reads to be as they were before the call.
 */
export async function expectUndoDeletes<T>(
  r: ToolRig,
  call: { readonly tool: string; readonly args: Record<string, unknown> },
  snapshot: () => T,
  remove: (undoArgs: Record<string, unknown>) => void,
): Promise<LoggedUndo> {
  const before = snapshot();
  const first = await r.call(call.tool, call.args);
  expect(first.isError, first.text).toBeFalsy();
  expect(snapshot()).not.toEqual(before);
  const undo = loggedCalls(r).at(-1)?.undo;
  if (undo === undefined) throw new Error('the log entry of the write carries no undo');
  expect(undo.tool).toBe('flows_delete');
  remove(undo.args);
  expect(snapshot()).toEqual(before);
  return undo;
}

/**
 * The undo of a write whose way back is a tool no test can run here (not written yet, or one that asks for
 * consent) is only named in the log: the test takes it, checks the tool it names, applies what that tool
 * would do on the fake (`apply`) and expects the objects `snapshot` reads to be as they were before the call.
 */
export async function expectUndoApplies<T>(
  r: ToolRig,
  call: { readonly tool: string; readonly args: Record<string, unknown> },
  undoTool: string,
  snapshot: () => T,
  apply: (undoArgs: Record<string, unknown>) => void,
): Promise<LoggedUndo> {
  const before = snapshot();
  const first = await r.call(call.tool, call.args);
  expect(first.isError, first.text).toBeFalsy();
  expect(snapshot()).not.toEqual(before);
  const undo = loggedCalls(r).at(-1)?.undo;
  if (undo === undefined) throw new Error('the log entry of the write carries no undo');
  expect(undo.tool).toBe(undoTool);
  apply(undo.args);
  expect(snapshot()).toEqual(before);
  return undo;
}

// ---- verdicts of the checks of the process (invalidation by the reducer) ---------------------

interface StoredCheck {
  readonly ok: boolean | null;
  readonly by?: string;
}
interface StoredStep {
  readonly checks: Record<string, StoredCheck>;
}

/** Every check of the catalog holds `ok: true` before the call under test (written as a tool would). */
export async function seedVerdicts(r: ToolRig, projectId: string): Promise<void> {
  const checks: Record<string, Record<string, { ok: boolean }>> = {};
  for (const check of CHECKS) (checks[check.module] ??= {})[check.check] = { ok: true };
  const store = createProcessStore(r.workspace, {
    secrets: new CallSecretScope(createLogger({ level: 'error', sink: () => undefined })),
    clock: { now: () => Date.parse('2026-11-27T11:00:00Z') },
  });
  await store.applyUpdate(projectId, { checks }, { tool: 'seed_tool' });
}

/** The `ok` of each check named `module.check`, as the state file holds it now. */
export function verdictsOf(
  r: ToolRig,
  projectId: string,
  names: readonly string[],
): Record<string, boolean | null | undefined> {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as {
    process: Record<string, { steps: Record<string, StoredStep> }>;
  };
  const steps = state.process[projectId]?.steps ?? {};
  return Object.fromEntries(
    names.map((name) => {
      const [module = '', check = ''] = name.split('.');
      return [name, steps[module]?.checks[check]?.ok];
    }),
  );
}
