// The composition a call means: the id or the name the model gave, else the composition of this
// workspace (`ids.composition_id`), else `missing_argument` naming `composition_id`. An id (a UUID)
// goes as it is, with no request; a name is looked up in the project's compositions (no match
// `not_found`, several `ambiguous`).

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { createResolver } from '../../resolve/handles.js';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

export async function compositionIdOf(
  ctx: ToolContext,
  projectId: string,
  given: string | undefined,
): Promise<string> {
  const kept = given ?? ctx.state.process()?.ids.composition_id;
  if (kept === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'composition_id' } });
  }
  const wanted = kept.trim();
  if (UUID.test(wanted)) return wanted.toLowerCase();
  return (await createResolver(ctx).composition(projectId, wanted)).id;
}
