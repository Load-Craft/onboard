// What the tools that show a flow or a version of it share: the flow the call means and the mask of
// a text of the flow (the masks of the outline and of the questions are in flow/maskOutline.ts).

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { content, type CallContext } from '../moduleCall.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHORT_HANDLE = /^r-([0-9a-f]{8})$/iu;
const OPERATION_HANDLE = /^record_run:(.+)$/iu;

export const TEXT_LIMIT = 300;

/** A text of the flow (a name, the reason of a change) masked as a third party's text, made one line. */
export const mask = (ctx: CallContext, text: string, max = 200): string => content(ctx, text, max);

/** The flow the call means: the argument, else the only flow of the workspace, else `missing_argument`. */
export function flowRefOf(ctx: ToolContext, given: string | undefined): string {
  if (given !== undefined) return given;
  const kept = ctx.state.process()?.ids.flow_ids ?? [];
  const [only] = kept;
  if (kept.length === 1 && only !== undefined) return only;
  throw new ToolError('missing_argument', { params: { name: 'flow_id' } });
}

/**
 * The walk a call means, as its uuid: the uuid itself, `record_run:<uuid>` (the handle of the
 * operation) or the short handle `r-xxxxxxxx` of a walk the workspace knows. A handle of none is
 * `operation_unknown`.
 */
export function walkIdOf(ctx: ToolContext, given: string): string {
  const named = OPERATION_HANDLE.exec(given)?.[1] ?? given;
  if (UUID.test(named)) return named.toLowerCase();
  const short = SHORT_HANDLE.exec(named)?.[1]?.toLowerCase();
  const found =
    short === undefined
      ? undefined
      : (ctx.state.process()?.operations ?? [])
          .map((row) => OPERATION_HANDLE.exec(row.handle)?.[1] ?? '')
          .find((id) => id.toLowerCase().startsWith(short));
  if (found === undefined) {
    throw new ToolError('operation_unknown', { params: { value: content(ctx, given, 120) } });
  }
  return found.toLowerCase();
}

/** The walk of a call: the argument, else the walk of the workspace (`ids.walk_id`), else `missing_argument`. */
export function walkRefOf(ctx: ToolContext, given: string | undefined): string {
  const wanted = given ?? ctx.state.process()?.ids.walk_id;
  if (wanted === undefined)
    throw new ToolError('missing_argument', { params: { name: 'walk_id' } });
  return wanted;
}
