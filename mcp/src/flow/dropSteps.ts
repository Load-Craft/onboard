// The steps of a flow named by their number in the outline (`flows_get`), taken out of its graph. The
// blocks that stay are returned as they were stored, so no value of a header or a body goes through the
// model: it names numbers, the tool reads the flow and sends the changed graph back. The edges are
// stitched across what went (the step before now leads to the step after), the entry follows when it
// was dropped, and the validators bound to a dropped request go with it. What cannot be done without
// guessing is refused with the number of the step and the reason: a step inside a container or a
// branch, a container or a conditional itself, a step with two ways on, a flow left with no step.

import { buildOutline, outlineBlocks, type OutlineSource } from './outline.js';

type Rec = Record<string, unknown>;

export interface DropSource extends OutlineSource {
  readonly blocks: Rec[];
  readonly edges: Rec[];
  readonly entry_block_id?: string | null;
}

export interface DroppedStep {
  readonly num: string;
  readonly name: string;
}

export type DropRefusal =
  'unknown_step' | 'nested_step' | 'container' | 'branching' | 'would_empty';

export type DropResult =
  | {
      readonly ok: true;
      readonly graph: { blocks: Rec[]; edges: Rec[]; entry_block_id: string | null };
      readonly dropped: readonly DroppedStep[];
    }
  | { readonly ok: false; readonly step: string; readonly reason: DropRefusal };

const CONTAINERS = new Set(['group', 'retry', 'loop', 'conditional']);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const isBinding = (edge: Rec): boolean => edge['type'] === 'binding';

/** The block a validator is bound to, as the outline reads it (top level or `config`). */
function boundTo(block: Rec): string {
  if (block['type'] !== 'validator') return '';
  const config =
    typeof block['config'] === 'object' && block['config'] !== null ? (block['config'] as Rec) : {};
  return text(config['bound_to_request_id']) || text(block['bound_to_request_id']);
}

export function dropSteps(flow: DropSource, nums: readonly string[]): DropResult {
  const outline = buildOutline(flow);
  const names = new Map(outline.steps.map((step) => [step.num, step.name]));
  const blocks = outlineBlocks(flow);
  const dropped: (DroppedStep & { id: string })[] = [];
  for (const num of [...new Set(nums)]) {
    const block = blocks.get(num);
    if (block === undefined) return { ok: false, step: num, reason: 'unknown_step' };
    if (block.depth > 0) return { ok: false, step: num, reason: 'nested_step' };
    if (CONTAINERS.has(block.type)) return { ok: false, step: num, reason: 'container' };
    dropped.push({ num, name: names.get(num) ?? '', id: block.id });
  }
  const gone = new Set(dropped.map((item) => item.id));
  const lastNum = dropped.at(-1)?.num ?? '';
  const stays = flow.blocks.filter((block) => {
    const id = text(block['id']);
    return !gone.has(id) && !gone.has(boundTo(block));
  });
  const survivors = new Set(stays.map((block) => text(block['id'])));
  const standing = [...blocks.values()].filter((block) => !gone.has(block.id));
  if (standing.length === 0) return { ok: false, step: lastNum, reason: 'would_empty' };

  // stitch the edges across the dropped blocks, one block at a time, in the order they were named
  let edges: Rec[] = flow.edges.map((edge) => ({ ...edge }));
  let entry = flow.entry_block_id ?? null;
  for (const item of dropped) {
    const into = edges.filter((edge) => !isBinding(edge) && text(edge['target']) === item.id);
    const out = edges.filter((edge) => !isBinding(edge) && text(edge['source']) === item.id);
    if (out.length > 1) return { ok: false, step: item.num, reason: 'branching' };
    const next = out[0] === undefined ? undefined : text(out[0]['target']);
    const rest = edges.filter((edge) => !into.includes(edge) && !out.includes(edge));
    const joined: Rec[] = next === undefined ? [] : into.map((edge) => ({ ...edge, target: next }));
    edges = [...rest, ...joined].filter(
      (edge, index, all) =>
        all.findIndex(
          (other) => other['source'] === edge['source'] && other['target'] === edge['target'],
        ) === index,
    );
    if (entry === item.id) entry = next ?? null;
  }
  const keptEdges = edges.filter(
    (edge) => survivors.has(text(edge['source'])) && survivors.has(text(edge['target'])),
  );
  // the order of the edges is the order they had; a joined edge takes the place of the one it replaced
  const order = new Map(flow.edges.map((edge, index) => [text(edge['id']), index]));
  keptEdges.sort((a, b) => (order.get(text(a['id'])) ?? 0) - (order.get(text(b['id'])) ?? 0));
  return {
    ok: true,
    graph: {
      blocks: stays.map((block) => ({ ...block })),
      edges: keptEdges,
      entry_block_id: entry,
    },
    dropped: dropped.map(({ num, name }) => ({ num, name })),
  };
}
