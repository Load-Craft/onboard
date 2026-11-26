// The warning `flows_need_input` follows the open items of the flows read: one warning with the flows
// that have items and how many items are definite. A reading of the whole list replaces it; a reading
// of some flows (one flow, the flows just built, a list cut short) changes only the flows it read.

import { describe, expect, it } from 'vitest';

import { needsInputUpdate } from '../src/flow/needsInput.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function open(ids: readonly string[], definite: number) {
  return {
    problems: [
      {
        id: 'p1',
        module: 'flows' as const,
        tool: 'process_get_status',
        code: 'flows_need_input',
        severity: 'warning' as const,
        message: 'm',
        flow_ids: [...ids],
        definite_count: definite,
        at: '2026-11-22T10:00:00.000Z',
      },
    ],
  };
}

const opened = (update: ReturnType<typeof needsInputUpdate>) => update?.problems?.open?.[0];

describe('flows_need_input from a reading of the flows', () => {
  it('a whole list replaces the warning with the flows that have items and their definite ones', () => {
    const update = needsInputUpdate(
      open([A], 2),
      [
        { id: B, count: 2, definite: 1 },
        { id: C, count: 0, definite: 0 },
      ],
      'process_get_status',
      'all',
    );
    expect(update?.problems?.close).toEqual([{ code: 'flows_need_input' }]);
    expect(opened(update)).toMatchObject({
      code: 'flows_need_input',
      severity: 'warning',
      module: 'flows',
      flow_ids: [B],
      definite_count: 1,
    });
  });

  it('the same reading again changes nothing', () => {
    expect(
      needsInputUpdate(open([A], 1), [{ id: A, count: 3, definite: 1 }], 'flows_get', 'all'),
    ).toBeUndefined();
  });

  it('a whole list without items closes the warning, and nothing open stays nothing', () => {
    expect(needsInputUpdate(open([A], 0), [{ id: A, count: 0, definite: 0 }], 't', 'all')).toEqual({
      problems: { close: [{ code: 'flows_need_input' }] },
    });
    expect(needsInputUpdate(undefined, [{ id: A, count: 0, definite: 0 }], 't', 'all')).toBe(
      undefined,
    );
  });

  it('a reading of some flows keeps the flows it did not read', () => {
    const update = needsInputUpdate(
      open([A], 1),
      [{ id: B, count: 1, definite: 1 }],
      'flows_get',
      'some',
    );
    expect([...(opened(update)?.flow_ids ?? [])].sort()).toEqual([A, B]);
    // the definite items of A are not known from this reading: the count never falls below them
    expect(opened(update)?.definite_count).toBe(1);
  });

  it('a reading of the only flow of the warning is exact: answered items close it', () => {
    expect(
      opened(needsInputUpdate(open([A], 1), [{ id: A, count: 2, definite: 0 }], 'f', 'some')),
    ).toMatchObject({ flow_ids: [A], definite_count: 0 });
    expect(needsInputUpdate(open([A], 1), [{ id: A, count: 0, definite: 0 }], 'f', 'some')).toEqual(
      { problems: { close: [{ code: 'flows_need_input' }] } },
    );
  });

  it('a definite item is still a warning, and an id the state does not take is left out', () => {
    const update = needsInputUpdate(
      undefined,
      [
        { id: 'not-a-uuid', count: 1, definite: 1 },
        { id: A, count: 1, definite: 1 },
      ],
      'flows_generate_from_endpoints',
      'some',
    );
    expect(opened(update)).toMatchObject({ severity: 'warning', flow_ids: [A], definite_count: 1 });
  });
});
