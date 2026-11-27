// What stops a deletion before anything is sent: an operation of this workspace still running on the
// project (the state file), or a test of the project under way in LoadCraft (its list of runs). A
// running operation is named in the refusal. Also the counting helpers of the card: one cheap read
// per number, and a number that cannot be read is null (shown as unknown, never guessed).

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { callOperation } from '../../http/operation.js';
import type { DeleteCount } from '../../render/views/deletion.js';
import { readProjectBinding } from '../../workspace/binding.js';
import { shownName } from './card.js';

/** The largest page of the lists of runs, scenarios and compositions. */
export const LIST_LIMIT = 100;

/** A list that names every item it counts, up to `limit`: a full page may hold more. */
export const listedCount = (n: number, limit = LIST_LIMIT): DeleteCount => ({
  n,
  more: n >= limit,
});

/** A count the backend gives for the whole project. */
export const exactCount = (n: number): DeleteCount => ({ n, more: false });

/** Two counts added; unknown when either is. */
export function sumCounts(a: DeleteCount, b: DeleteCount): DeleteCount {
  return a === null || b === null ? null : { n: a.n + b.n, more: a.more || b.more };
}

/** The count of one read; null when the read fails. */
export async function counted(read: () => Promise<DeleteCount>): Promise<DeleteCount> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** The project this repository is bound to; undefined when none (or the binding is unreadable). */
export function boundProject(ctx: ToolContext): { id: string; name: string } | undefined {
  try {
    return readProjectBinding(ctx)?.project;
  } catch {
    return undefined;
  }
}

const LIVE = new Set(['running', 'waiting_user']);

/**
 * The first operation of this workspace still running on `projectId`, as `kind "label"`; the state
 * file holds the operations of the bound project only.
 */
export function liveOperation(ctx: ToolContext, projectId: string): string | undefined {
  if (boundProject(ctx)?.id !== projectId) return undefined;
  const row = ctx.state.process()?.operations.find((operation) => LIVE.has(operation.status));
  if (row === undefined) return undefined;
  return `${row.kind} "${shownName(ctx, row.label ?? row.handle)}"`;
}

/** A test of the project that is under way. */
export interface RunningTest {
  readonly id: string;
  readonly status: string;
  readonly scenarioId: string | null;
  readonly compositeId: string | null;
}

export interface ProjectRuns {
  /** The load runs of the project (the newest page of them). */
  readonly count: DeleteCount;
  readonly running: readonly RunningTest[];
  /** False when the list could not be read, or a full page may hide a test that still runs. */
  readonly known: boolean;
}

const FINISHED = new Set(['completed', 'failed', 'cancelled']);

/**
 * The load runs of the project, newest first, one page: their number and the tests among them that
 * are under way (not finished, still driven by LoadCraft, not a self-check).
 */
export async function readRuns(ctx: ToolContext, projectId: string): Promise<ProjectRuns> {
  try {
    const data = await callOperation(
      ctx.services.http,
      'list_executions_api_v1_projects__project_id__gatling_executions_get',
      { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      { signal: ctx.signal, secrets: ctx.secrets },
    );
    const running = data.executions
      .filter(
        (row) =>
          !FINISHED.has(row.status) && row.supervised !== false && row.source !== 'self_check',
      )
      .map((row) => ({
        id: row.id,
        status: row.status,
        scenarioId: row.scenario_id,
        compositeId: row.composite_id,
      }));
    return {
      count: listedCount(data.executions.length),
      running,
      known: data.executions.length < LIST_LIMIT || running.length > 0,
    };
  } catch {
    return { count: null, running: [], known: false };
  }
}

/** `test e-3f9a12c4 (running)`: a test as the other tools name it. */
export function testName(test: RunningTest): string {
  return `test e-${test.id.slice(0, 8).toLowerCase()} (${test.status})`;
}

/** The refusal of a deletion while `operation` runs on `target`. */
export function busy(operation: string, target: string): ToolError {
  return new ToolError('delete_busy', { params: { operation, target } });
}

/** The refusal of a deletion while it cannot be checked that no test runs on `target`. */
export function unchecked(target: string): ToolError {
  return new ToolError('delete_unchecked', { params: { target } });
}

/** The refusal of a card that would name more than `max` items. */
export function tooMany(max: number, what: string): ToolError {
  return new ToolError('invalid', {
    params: {
      detail: `one card names at most ${String(max)} ${what}; ask for the rest in another card`,
    },
  });
}
