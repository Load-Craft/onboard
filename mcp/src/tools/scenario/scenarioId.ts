// The scenario a call works on: the id the model gave, else the only scenario the state of this
// workspace knows (`ids.scenario_ids`, flow id -> scenario id). Several or none: `missing_argument`
// naming the argument, so the model asks `scenario_list` and passes one.

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { createResolver } from '../../resolve/handles.js';

export function scenarioIdOf(ctx: Pick<ToolContext, 'state'>, given: string | undefined): string {
  if (given !== undefined) return given.toLowerCase();
  const known = [...new Set(Object.values(ctx.state.process()?.ids.scenario_ids ?? {}))];
  const [only] = known;
  if (only !== undefined && known.length === 1) return only;
  throw new ToolError('missing_argument', { params: { name: 'scenario_id' } });
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/**
 * The scenario a call means, as its id: an id (a UUID) goes as it is, with no request; a name is looked up
 * in the project's scenarios (no match `not_found`, several `ambiguous`); without either, the only
 * scenario of the workspace (`scenarioIdOf`).
 */
export async function resolveScenarioId(
  ctx: ToolContext,
  projectId: string,
  given: string | undefined,
): Promise<string> {
  const wanted = given?.trim();
  if (wanted === undefined) return scenarioIdOf(ctx, undefined);
  if (UUID.test(wanted)) return wanted.toLowerCase();
  return (await createResolver(ctx).scenario(projectId, wanted)).id;
}
