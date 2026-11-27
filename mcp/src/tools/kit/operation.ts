// The block of a long operation for module tools (docs/long-operation.md). A tool of `kind: process`
// starts work that outlives one call; the mechanism is the one the older tools use (`ops/operation.ts`:
// kinds, handles, the row in the process, `process_wait`, `process_cancel`, progress). This file adds no
// second one: it is the thin join between that mechanism and `moduleTool`.
//
//   startOperation(ctx, kind, plan, { maxWaitS })  → the outcome of the call: done, or running with the handle
//   operationId(ctx, ...parts)                     → the id of one call
//   renderOperation(kind)                          → the view of the tool: the view of its kind
//
// On a consent card (docs/consent-card.md) `run(ctx, args, facts)` is `startOperation(...)`: the write that
// starts the work is in `plan.start`, which runs once, after the person's yes, and only when no operation
// of the same work is still under way (`plan.matches`).

import { createHash } from 'node:crypto';

import type { Translator } from '../../context.js';
import {
  callWaitS,
  startOrJoin,
  type OperationContext,
  type KindChannel,
  type OperationKind,
  type StartOrJoin,
} from '../../ops/operation.js';
import type { ToolOutcome } from '../../outcome.js';

export {
  defineOperationKind,
  encodeHandle,
  maxWaitInput,
  MAX_CALL_WAIT_S,
  type OperationContext,
} from '../../ops/operation.js';

/** What `startOperation` needs to know about the work a call is about. */
export interface OperationPlan<V> {
  /** True for the saved data of an operation that is the same work as this call asks for. */
  readonly matches: StartOrJoin<V>['matches'];
  /**
   * Sends the write that starts the work and returns the id of the operation with the data the kind
   * saves to follow and resume it. Runs once per work, and only when nothing of it is under way.
   */
  readonly start: StartOrJoin<V>['start'];
  /**
   * For a kind whose channel is joined first (`connectFirst`): chooses the id before the start, so the request
   * that starts the work carries it as its session id. `start` gets it.
   */
  readonly newId?: StartOrJoin<V>['newId'];
  /** An operation older than this is not joined; default 30 minutes. */
  readonly maxAgeMs?: number;
}

export interface StartOptions {
  /** Seconds the call waits, as the argument `max_wait_s` says; default and limit: 100. */
  readonly maxWaitS?: number;
}

/**
 * Starts the work of `plan` (or goes on with the same work still under way) and follows it for the
 * time of one call. A finished operation is the `done` outcome of the kind; an unfinished one is
 * `running` with the handle `<kind>:<id>` for `process_wait`. The row of the operation in the
 * process is written by the mechanism, never by the tool.
 */
export function startOperation<S, D, V, C extends KindChannel>(
  ctx: OperationContext,
  kind: OperationKind<S, D, V, C>,
  plan: OperationPlan<V>,
  options: StartOptions = {},
): Promise<ToolOutcome<D>> {
  return startOrJoin(ctx, kind, {
    maxWaitS: callWaitS(options.maxWaitS ?? Number.POSITIVE_INFINITY),
    matches: plan.matches,
    start: plan.start,
    ...(plan.newId === undefined ? {} : { newId: plan.newId }),
    ...(plan.maxAgeMs === undefined ? {} : { maxAgeMs: plan.maxAgeMs }),
  });
}

/**
 * The id of one call: a hash of what the work is about and of the moment, so the same work asked
 * again later is another operation (while one is under way it is joined by `matches` instead).
 */
export function operationId(
  ctx: OperationContext,
  prefix: string,
  ...parts: readonly string[]
): string {
  const key = [...parts, String(ctx.clock.now())].join('|');
  return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

/**
 * The view of a tool of this kind: the view of the kind itself, so the tool and `process_wait`
 * print finished data the same way. `render: renderOperation(kind)` in the spec of `moduleTool`.
 */
export function renderOperation<S, D, V, C extends KindChannel>(
  kind: OperationKind<S, D, V, C>,
): (data: D, t: Translator) => string {
  return kind.spec.view;
}
