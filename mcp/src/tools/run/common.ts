// What the read tools of module run share: the handle of a run, the pick of a stored item by id or
// name, a count of figures, and the few words a stored workload carries.

import { ToolError } from '../../errors.js';
import { inline } from '../../render/primitives.js';
import { content, type CallContext } from '../moduleCall.js';

const SHORT_LENGTH = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** Names an error lists, and the longest name it quotes. */
const LISTED = 10;
const NAME_LIMIT = 120;

/** The handle of a run: `e-` and the first eight hex digits of its UUID. */
export const handleOf = (id: string): string => `e-${id.slice(0, SHORT_LENGTH).toLowerCase()}`;

/** A figure rounded to one decimal, halves away from zero. */
export function tenth(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
}

const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

export interface Named {
  readonly id: string;
  readonly name: string;
}

/**
 * The one item whose id or name is `input` (a name matches without regard to case). None is
 * `not_found` listing the names the project has, several is `ambiguous`; the names pass the mask of
 * a third party's text, the input is quoted as one line.
 */
export function pickNamed(
  ctx: Pick<CallContext, 'secrets'>,
  kind: 'profile' | 'saved_run' | 'test_type' | 'validator' | 'flow' | 'template',
  input: string,
  items: readonly Named[],
): Named {
  const wanted = input.trim();
  const byId = UUID.test(wanted) ? items.filter((item) => same(item.id, wanted)) : [];
  const found = byId.length > 0 ? byId : items.filter((item) => same(item.name, wanted));
  if (found.length === 1 && found[0] !== undefined) return found[0];
  const names = (list: readonly Named[]): string =>
    list
      .slice(0, LISTED)
      .map((item) => `"${content(ctx, item.name, NAME_LIMIT)}"`)
      .join(', ');
  const quoted = inline(wanted, NAME_LIMIT);
  if (found.length > 1) {
    throw new ToolError('ambiguous', {
      message: `More than one ${kind} matches "${quoted}".`,
      params: { kind, name: quoted, candidates: names(found) },
    });
  }
  throw new ToolError('not_found', {
    message: `No ${kind} "${quoted}".${items.length === 0 ? '' : ` There are: ${names(items)}.`}`,
    params: { available: items.length === 0 ? '' : ` There are: ${names(items)}.` },
  });
}

/** A number the record holds under `key`, else null. */
export function numberAt(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A short word the record holds under `key` (a profile type), else null. */
export function wordAt(
  ctx: Pick<CallContext, 'secrets'>,
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? content(ctx, value, 40) : null;
}

/** The load a stored workload names: the profile type, the users, the ramp and the hold, in seconds. */
export interface WorkloadFacts {
  readonly type: string | null;
  readonly vusers: number | null;
  readonly ramp: number | null;
  readonly hold: number | null;
}

export function workloadOf(
  ctx: Pick<CallContext, 'secrets'>,
  workload: Readonly<Record<string, unknown>> | null | undefined,
): WorkloadFacts | null {
  if (workload === null || workload === undefined) return null;
  // a run's manifest wraps the load as `{ kind, value: { type, vusers, … } }`
  const inner = workload['value'];
  const facts =
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? (inner as Readonly<Record<string, unknown>>)
      : workload;
  return {
    type: wordAt(ctx, facts, 'type'),
    vusers: numberAt(facts, 'vusers'),
    ramp: numberAt(facts, 'ramp'),
    hold: numberAt(facts, 'hold'),
  };
}
