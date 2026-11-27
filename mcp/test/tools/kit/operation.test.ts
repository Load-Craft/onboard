// The block of a long operation (src/tools/kit/operation.ts, docs/long-operation.md). The helpers that
// need no backend are tested here; the whole path (start, progress, finish, error, cancel, resume after a
// restart, no secret in a progress line) runs through the first tool written on the block, in
// test/tools/scenario/checkDrift.test.ts.

import { describe, expect, it } from 'vitest';

import { selfCheckOperation } from '../../../src/tools/scenarioCheckSelf.js';
import { operationId, renderOperation } from '../../../src/tools/kit/operation.js';
import type { OperationContext } from '../../../src/ops/operation.js';
import { createTestClock } from '../../helpers/clock.js';

function at(ms: number): OperationContext {
  return { clock: createTestClock(ms) } as unknown as OperationContext;
}

describe('operationId', () => {
  it('is the prefix and twelve hex digits, stable for the same parts and moment', () => {
    const id = operationId(at(1_000), 'dc', 'project', 'scenario');
    expect(id).toMatch(/^dc-[0-9a-f]{12}$/u);
    expect(operationId(at(1_000), 'dc', 'project', 'scenario')).toBe(id);
  });

  it('differs when the work or the moment differs: the same work asked again later is another operation', () => {
    const base = operationId(at(1_000), 'dc', 'project', 'scenario');
    expect(operationId(at(1_000), 'dc', 'project', 'other')).not.toBe(base);
    expect(operationId(at(2_000), 'dc', 'project', 'scenario')).not.toBe(base);
  });

  it('is a valid operation id for a handle (letters, digits, dot, dash, underscore)', () => {
    expect(operationId(at(5), 'dc', 'a b', '/x')).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
  });
});

describe('renderOperation', () => {
  it('is the view of the kind itself, so a tool and process_wait print finished data the same way', () => {
    expect(renderOperation(selfCheckOperation)).toBe(selfCheckOperation.spec.view);
  });
});
