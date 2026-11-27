// The dataset a call of module data works on: the id given, else the only dataset of the workspace's
// state; else `missing_argument`. Shared by the tools that take `dataset_id` with that default.

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';

export function datasetIdOf(ctx: Pick<ToolContext, 'state'>, given: string | undefined): string {
  if (given !== undefined) return given.toLowerCase();
  const known = [...new Set(ctx.state.process()?.ids.dataset_ids ?? [])];
  const [only] = known;
  if (only !== undefined && known.length === 1) return only;
  throw new ToolError('missing_argument', { params: { name: 'dataset_id' } });
}
