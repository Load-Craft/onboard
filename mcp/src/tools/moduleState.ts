// Defaults of the arguments of module tools, read from the process state of the workspace. The
// catalog names where an argument comes from when the model leaves it out (`from_state` of an
// argument, or the `state_reads` of the tool: `ids.run_id`, `choices.run.compare_to`); a tool asks
// here instead of reading the state file itself. Reading only: a tool changes the state through the
// `update` of its outcome.

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { readProjectBinding } from '../workspace/binding.js';

type StateContext = Pick<ToolContext, 'state' | 'config'>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value at a dotted path of the process of this workspace (`ids.walk_id`), when it is a text,
 * a number or a flag; undefined when the path holds nothing, or a list or an object.
 */
export function fromState(ctx: StateContext, path: string): string | number | boolean | undefined {
  let current: unknown = ctx.state.process();
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean'
    ? current
    : undefined;
}

/**
 * The project a call works on: the `project_id` the model gave, else the project this workspace is
 * bound to (`loadcraft/project.json`), else `ids.project_id` of the process. None: `no_project`.
 */
export function projectIdOf(ctx: StateContext, given: string | undefined): string {
  if (given !== undefined) return given;
  const bound = readProjectBinding(ctx);
  if (bound !== null) return bound.project.id;
  const kept = fromState(ctx, 'ids.project_id');
  if (typeof kept === 'string') return kept;
  throw new ToolError('no_project');
}

/**
 * An id argument: the value the model gave, else the one the state holds at `path`. None: the error
 * `missing_argument` naming the argument, so the model knows what to pass.
 */
export function idOf(
  ctx: StateContext,
  name: string,
  given: string | undefined,
  path: string,
): string {
  if (given !== undefined) return given;
  const kept = fromState(ctx, path);
  if (typeof kept === 'string') return kept;
  throw new ToolError('missing_argument', { params: { name } });
}
