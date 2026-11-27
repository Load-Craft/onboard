// The run a results tool reads: the argument, else the last run of the workspace. Shared by the
// tools of module results.
//
// A run is named by its handle (`e-1a2b3c4d`, what run_start and process_get_status print) or its
// UUID. The value the model gave and the value the state holds (`ids.run_id`,
// `choices.run.compare_to`) pass the same pattern: a state file is edited by hand and by other
// programs, so what it holds is not trusted more than what the model typed.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { createResolver, type ResolverContext } from '../../resolve/handles.js';
import { fromState } from '../moduleState.js';

/** The handle of a run: `e-` and the first eight hex digits of its UUID. */
export const RUN_HANDLE_PATTERN = /^e-[0-9a-f]{8}$/u;

/** A run by its handle or its UUID (the schema of `tools/list` carries the pattern). */
export const RunRef = z
  .string()
  .trim()
  .regex(
    /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|e-[0-9a-f]{8})$/u,
  );

/** The `run_id` argument of every tool of the module. */
export const RUN_ID_DESCRIPTION =
  'The run: its handle (e-1a2b3c4d) from run_test or process_get_status, or its UUID; default: the last run of this workspace.';

export function runIdArgument(): z.ZodOptional<typeof RunRef> {
  return RunRef.optional().describe(RUN_ID_DESCRIPTION);
}

export interface RunOf {
  /** The UUID of the run. */
  readonly id: string;
  /** Its handle. */
  readonly run: string;
}

/** Whether a value is a run handle or a UUID (after trimming). */
export function isRunRef(value: unknown): value is string {
  return typeof value === 'string' && RunRef.safeParse(value).success;
}

type RunContext = ResolverContext & Parameters<typeof fromState>[0];

/**
 * The run of a call: `given`, else `ids.run_id` of the process state when it is a run reference,
 * else `missing_argument`. The resolver turns a handle into the UUID the backend takes (a handle the
 * project's recent runs do not have is `not_found`).
 */
export async function runOf(
  ctx: RunContext,
  projectId: string,
  given: string | undefined,
): Promise<RunOf> {
  const kept = fromState(ctx, 'ids.run_id');
  const value = given ?? (typeof kept === 'string' && isRunRef(kept) ? kept.trim() : undefined);
  if (value === undefined) throw new ToolError('missing_argument', { params: { name: 'run_id' } });
  const resolver = createResolver(ctx);
  const { id } = await resolver.execution(projectId, value);
  return { id, run: resolver.shortExecution(id) };
}

/** A figure rounded to one decimal, halves away from zero (-6.25 is -6.3, as the view prints it). */
export function tenth(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
}
