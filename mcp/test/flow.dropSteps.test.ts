// `dropSteps` (src/flow/dropSteps.ts): the steps of a flow, named by their number in the outline, taken
// out of its graph. The blocks that stay are sent back as they were stored (the tool never shows them),
// the edges are stitched across what went, the entry follows, and what cannot be dropped without
// guessing is refused with the step and the reason.

import { describe, expect, it } from 'vitest';

import { dropSteps } from '../src/flow/dropSteps.js';

type Rec = Record<string, unknown>;

const request = (id: string, name: string, extra: Rec = {}): Rec => ({
  id,
  type: 'request',
  name,
  enabled: true,
  config: {
    method: 'GET',
    path: `/${name}`,
    headers: { 'x-api-key': 'literal-header-value' },
    ...extra,
  },
});
const pause = (id: string): Rec => ({
  id,
  type: 'pause',
  name: 'Pause',
  enabled: true,
  config: { delay_min_ms: 1000, delay_max_ms: 2000, source: 'default_human' },
});
const edge = (id: string, source: string, target: string, extra: Rec = {}): Rec => ({
  id,
  source,
  target,
  ...extra,
});

/** 1 login, 2 pause, 3 cart, 4 pause, 5 checkout, 6 pause, 7 done: a chain. */
function chain(): {
  blocks: Rec[];
  edges: Rec[];
  entry_block_id: string;
  id: string;
  name: string;
  current_version: number;
} {
  const blocks = [
    request('b1', 'login'),
    pause('b2'),
    request('b3', 'cart'),
    pause('b4'),
    request('b5', 'checkout'),
    pause('b6'),
    request('b7', 'done'),
  ];
  const ids = blocks.map((block) => String(block['id']));
  return {
    id: 'f1',
    name: 'signup',
    current_version: 3,
    blocks,
    edges: ids
      .slice(0, -1)
      .map((source, index) => edge(`e${String(index + 1)}`, source, ids[index + 1] as string)),
    entry_block_id: 'b1',
  };
}

const ids = (blocks: readonly Rec[]): string[] => blocks.map((block) => String(block['id']));
const pairs = (edges: readonly Rec[]): string[] =>
  edges.map((e) => `${String(e['source'])}>${String(e['target'])}`);

describe('dropSteps', () => {
  it('drops the last two steps of a chain: the blocks and the edges that led to them go', () => {
    const result = dropSteps(chain(), ['6', '7']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.graph.blocks)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(pairs(result.graph.edges)).toEqual(['b1>b2', 'b2>b3', 'b3>b4', 'b4>b5']);
    expect(result.graph.entry_block_id).toBe('b1');
    expect(result.dropped.map((item) => [item.num, item.name])).toEqual([
      ['6', 'Pause'],
      ['7', 'done'],
    ]);
  });

  it('drops a step in the middle: its neighbours are joined and the edge keeps its id', () => {
    const result = dropSteps(chain(), ['3']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.graph.blocks)).toEqual(['b1', 'b2', 'b4', 'b5', 'b6', 'b7']);
    expect(pairs(result.graph.edges)).toEqual(['b1>b2', 'b2>b4', 'b4>b5', 'b5>b6', 'b6>b7']);
    expect(result.graph.edges.find((e) => e['target'] === 'b4')?.['id']).toBe('e2');
  });

  it('drops the first step: the entry moves to the step after it', () => {
    const result = dropSteps(chain(), ['1']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.entry_block_id).toBe('b2');
    expect(ids(result.graph.blocks)[0]).toBe('b2');
  });

  it('drops adjacent steps in the middle without leaving a hole', () => {
    const result = dropSteps(chain(), ['3', '4']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pairs(result.graph.edges)).toEqual(['b1>b2', 'b2>b5', 'b5>b6', 'b6>b7']);
  });

  it('keeps the blocks that stay exactly as stored, headers and all', () => {
    const flow = chain();
    const result = dropSteps(flow, ['7']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.blocks[0]).toEqual(flow.blocks[0]);
    expect(JSON.stringify(result.graph.blocks)).toContain('literal-header-value');
  });

  it('takes the validators bound to a dropped request with it, and their binding edges', () => {
    const flow = chain();
    flow.blocks.push({
      id: 'v1',
      type: 'validator',
      name: 'Status',
      enabled: true,
      config: { bound_to_request_id: 'b7', validator_id: 'status' },
    });
    flow.edges.push(edge('eb', 'b7', 'v1', { type: 'binding' }));
    const result = dropSteps(flow, ['7']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.graph.blocks)).not.toContain('v1');
    expect(pairs(result.graph.edges)).not.toContain('b7>v1');
  });

  it('refuses a number the outline does not have', () => {
    expect(dropSteps(chain(), ['9'])).toEqual({ ok: false, step: '9', reason: 'unknown_step' });
    expect(dropSteps(chain(), ['x'])).toEqual({ ok: false, step: 'x', reason: 'unknown_step' });
  });

  it('refuses to drop every step', () => {
    const flow = chain();
    expect(dropSteps(flow, ['1', '2', '3', '4', '5', '6', '7'])).toEqual({
      ok: false,
      step: '7',
      reason: 'would_empty',
    });
  });

  it('refuses a step that branches (it has two ways on), and one inside a container', () => {
    const branching = chain();
    branching.edges.push(edge('ex', 'b3', 'b6'));
    expect(dropSteps(branching, ['3'])).toMatchObject({
      ok: false,
      step: '3',
      reason: 'branching',
    });
    const nested = chain();
    nested.blocks[3] = {
      id: 'b4',
      type: 'group',
      name: 'Group',
      enabled: true,
      config: { body_blocks: ['b5'] },
    };
    expect(dropSteps(nested, ['4.1'])).toMatchObject({
      ok: false,
      step: '4.1',
      reason: 'nested_step',
    });
    expect(dropSteps(nested, ['4'])).toMatchObject({ ok: false, step: '4', reason: 'container' });
  });

  it('names a step twice only once', () => {
    const result = dropSteps(chain(), ['7', '7']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toHaveLength(1);
  });

  it('does not change the flow it was given', () => {
    const flow = chain();
    const before = JSON.stringify(flow);
    dropSteps(flow, ['6', '7']);
    expect(JSON.stringify(flow)).toBe(before);
  });
});
