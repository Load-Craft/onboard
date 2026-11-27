/**
 * Flow outline: the numbered list of steps the LoadCraft Outline screen shows, built from the raw
 * `blocks` and `edges` of `GET /api/v1/projects/{pid}/flows/{flow_id}`. The backend has no outline
 * endpoint, so the plugin walks the graph itself.
 *
 * This is a copy of rules owned by LoadCraft. Source of truth:
 *   - the frontend's outline screen: spine, validator bridging, containment, merge point, branch
 *     chains and labels, flattening and numbering, request/pause/transform/loop drafts, refs of
 *     bound validators; pause source states; flat + config node data
 *   - the backend's flow copilot: reference pattern, produced variables, bridging over bound
 *     validators only, the 250-node budget, a bound validator producing for its request
 *   - the backend's test blocks: `action_start`, `query_params`, `expected_statuses`, pause delays
 *     and source, `bound_to_request_id`
 * `test/flow.outline.test.ts` pins every rule in tables. When those sources change, re-check both.
 *
 * Deliberate differences from the sources, each stated by the plugin's task:
 *   - a block with `enabled: false` is not a step, nor is anything inside it; the walk still passes
 *     through it, and what it would produce is not produced (the screen shows it greyed out);
 *   - `feederVars` are references no EARLIER step produced (the backend's flow digest counts a
 *     producer anywhere in the flow), so a value read before it is produced is test data, not a variable;
 *   - only validators bound to a request are folded (as the backend's block order does);
 *     an unbound validator stays a step, as in the backend's `step_count` (the screen hides it);
 *   - a step of a conditional branch carries its branch label in `name` (`[TRUE] …`).
 */

/** Steps above this are cut and `truncated` is set (the backend's flow digest budget). */
export const MAX_OUTLINE_STEPS = 250;

export type PauseSource = 'recording' | 'default_human' | 'manual' | 'machine_wait';
/** A stored `config.source` outside the four values (legacy pauses have none) reads `unknown`. */
export type PauseSourceState = PauseSource | 'unknown';
export type ActionClass = 'page' | 'form_submit' | 'in_page' | 'api_call';

export interface OutlinePause {
  minMs: number;
  maxMs: number;
  source: PauseSourceState;
  /** `config.action_start.class` of the next request in the outline: what the person is about to do. */
  actionClass?: ActionClass;
}

export interface OutlineStep {
  /** Outline number as the screen shows it: `3`, `4.2`, `4.2.1`. */
  num: string;
  kind: 'request' | 'pause' | 'other';
  /** The block's own `type` (`request`, `pause`, `loop`, `conditional`, …). */
  blockType: string;
  /** Nesting level: 0 on the main chain, +1 inside a container or a branch. */
  depth: number;
  name: string;
  /** The block's `description`, when it has one (a pause describes the person's activity there). */
  description?: string;
  method?: string;
  /** `config.path` plus `config.query_params`; every reference written as `#{x}`. */
  path?: string;
  /** Variables an earlier step produced, in the order they were produced. */
  uses: string[];
  produces: string[];
  /** References no earlier step produced: values of the test data, in the order they appear. */
  feederVars: string[];
  expectedStatuses: number[];
  /** Names of the validators bound to this request. */
  validators: string[];
  pause?: OutlinePause;
}

export interface FlowOutline {
  flowId: string;
  name: string;
  version: number;
  /** Every step, including the ones cut by the limit. */
  stepCount: number;
  requestCount: number;
  pauseCount: number;
  /** At most `MAX_OUTLINE_STEPS` steps. */
  steps: OutlineStep[];
  truncated: boolean;
}

/** The fields of `FlowDetail` the outline reads. */
export interface OutlineSource {
  id: string;
  name: string;
  current_version: number;
  blocks: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  entry_block_id?: string | null;
}

// ---- reading blocks -------------------------------------------------------------------------

type Data = Record<string, unknown>;

interface Block {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** Top-level fields of a flat block merged with `config` (projectFlowNodeData.ts:633-641). */
  readonly data: Data;
}

/** Block keys that are not configuration (projectFlowNodeData.ts:5, plus the base fields). */
const RESERVED_KEYS = new Set([
  'id',
  'type',
  'name',
  'description',
  'enabled',
  'position',
  'position_x',
  'position_y',
  'config',
]);

/** `#{name}` (Gatling EL) and `{{name}}` (HAR bodies and headers). */
const VAR_REF = /(?:#\{|\{\{)([a-zA-Z_][a-zA-Z0-9_]*)\}\}?/g;

const PAUSE_SOURCES: readonly string[] = ['recording', 'default_human', 'manual', 'machine_wait'];
const ACTION_CLASSES: readonly string[] = ['page', 'form_submit', 'in_page', 'api_call'];
const CONTAINER_TYPES = new Set(['group', 'retry', 'loop']);

/** Single-name "save as" fields across block types. */
const SINGLE_VAR_FIELDS = [
  'save_response_as',
  'save_result_as',
  'save_events_as',
  'save_messages_as',
  'save_callbacks_as',
  'save_url_as',
  'save_all_pages_as',
] as const;

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readBlock(raw: Data): Block | undefined {
  const id = text(raw['id']);
  if (id === '') return undefined;
  const config = isRecord(raw['config']) ? raw['config'] : {};
  const top = Object.fromEntries(Object.entries(raw).filter(([key]) => !RESERVED_KEYS.has(key)));
  return {
    id,
    type: text(raw['type']),
    name: text(raw['name']),
    description: text(raw['description']),
    enabled: raw['enabled'] !== false && config['enabled'] !== false,
    data: { ...top, ...config },
  };
}

function boundRequestOf(block: Block): string | undefined {
  if (block.type !== 'validator') return undefined;
  const target = text(block.data['bound_to_request_id']);
  return target === '' ? undefined : target;
}

/** Every reference in a value, first occurrence first. */
function collectRefs(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(VAR_REF)) {
      const name = match[1];
      if (name !== undefined && !out.includes(name)) out.push(name);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectRefs(item, out);
  }
}

/** Session variables a block produces. */
function producedBy(data: Data): string[] {
  const out: string[] = [];
  const add = (name: unknown): void => {
    if (typeof name === 'string' && name !== '' && !out.includes(name)) out.push(name);
  };
  for (const key of ['request_checks', 'response_checks']) {
    const checks = data[key];
    if (!Array.isArray(checks)) continue;
    for (const check of checks) if (isRecord(check)) add(check['save_as']);
  }
  const saveVariables = data['save_variables'];
  if (isRecord(saveVariables)) Object.keys(saveVariables).forEach(add);
  for (const field of SINGLE_VAR_FIELDS) add(data[field]);
  const sessionSet = data['session_set'];
  if (isRecord(sessionSet)) Object.keys(sessionSet).forEach(add);
  add(data['output_variable']);
  const transforms = data['transforms'];
  if (Array.isArray(transforms)) {
    for (const spec of transforms) if (isRecord(spec)) add(spec['target']);
  }
  // What a loop defines for its body, as the screen reads it (flowOutlineViewModel.ts:1488-1496):
  // a foreach loop its element, a while / do_while loop its counter `pollCount`. The body comes
  // after the loop in the outline, so its references resolve to the loop. The source does not
  // know `foreach_index_variable`, so neither does the outline.
  const loopType = data['loop_type'] ?? data['loopType'];
  if (loopType === 'foreach') add(data['foreach_variable']);
  if (loopType === 'while' || loopType === 'do_while') add('pollCount');
  return out;
}

/** `path` plus the query string, references normalised to `#{x}`. */
function displayPath(data: Data): string {
  let path = text(data['path']);
  const query = data['query_params'];
  if (isRecord(query)) {
    const pairs = Object.entries(query)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => `${key}=${String(value as string | number | boolean)}`);
    if (pairs.length > 0) path += `${path.includes('?') ? '&' : '?'}${pairs.join('&')}`;
  }
  return path.replace(VAR_REF, (_match, name: string) => `#{${name}}`);
}

function statusesOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : [];
}

function actionClassOf(data: Data): ActionClass | undefined {
  const start = data['action_start'];
  if (!isRecord(start)) return undefined;
  const value = start['class'];
  return typeof value === 'string' && ACTION_CLASSES.includes(value)
    ? (value as ActionClass)
    : undefined;
}

// ---- the graph ------------------------------------------------------------------------------

interface Branch {
  readonly label: string;
  readonly ids: string[];
}

type Containment =
  { kind: 'body'; ids: string[] } | { kind: 'switch'; merge?: string; cases: Branch[] };

interface Graph {
  readonly blocks: Block[];
  readonly byId: Map<string, Block>;
  readonly out: Map<string, string[]>;
  readonly inCount: Map<string, number>;
  readonly containment: Map<string, Containment>;
  readonly owned: Set<string>;
}

/**
 * Execution edges without `binding` ones, bridged over bound validators: `a -> v -> b` becomes
 * `a -> b`, as the backend's block order does.
 */
function executionEdges(
  edges: Record<string, unknown>[],
  bound: Set<string>,
  byId: Map<string, Block>,
): [string, string][] {
  const pairs: [string, string][] = [];
  for (const edge of edges) {
    const source = text(edge['source']);
    const target = text(edge['target']);
    if (edge['type'] === 'binding' || source === '' || target === '') continue;
    pairs.push([source, target]);
  }
  const rawOut = new Map<string, string[]>();
  for (const [source, target] of pairs) rawOut.set(source, [...(rawOut.get(source) ?? []), target]);

  const resolve = (target: string, seen: Set<string>): string[] => {
    if (!bound.has(target)) return byId.has(target) ? [target] : [];
    if (seen.has(target)) return [];
    const next = new Set([...seen, target]);
    return (rawOut.get(target) ?? []).flatMap((item) => resolve(item, next));
  };

  const bridged: [string, string][] = [];
  for (const [source, target] of pairs) {
    if (bound.has(source) || !byId.has(source)) continue;
    for (const resolved of resolve(target, new Set())) bridged.push([source, resolved]);
  }
  return bridged;
}

/** A loop without `body_blocks` closes its body with edges back to itself (HAR-assembled). */
function walkLoopCycle(loopId: string, graph: Pick<Graph, 'out' | 'byId'>): string[] {
  const ids: string[] = [];
  let current = (graph.out.get(loopId) ?? []).find((id) => graph.byId.has(id));
  while (current !== undefined && current !== loopId && !ids.includes(current)) {
    ids.push(current);
    current = (graph.out.get(current) ?? []).find((id) => id === loopId || graph.byId.has(id));
  }
  return ids;
}

function distancesFrom(start: string, graph: Pick<Graph, 'out' | 'byId'>): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    const distance = distances.get(current) ?? 0;
    for (const next of graph.out.get(current) ?? []) {
      if (!graph.byId.has(next) || distances.has(next)) continue;
      distances.set(next, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

/** The nearest block reachable from every branch start: where the branches join. */
function mergeOf(starts: string[], graph: Pick<Graph, 'out' | 'byId'>): string | undefined {
  if (starts.length < 2) return undefined;
  const [first, ...rest] = starts.map((start) => distancesFrom(start, graph));
  if (first === undefined) return undefined;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const [node, distance] of first) {
    if (starts.includes(node)) continue;
    const others = rest.map((map) => map.get(node));
    if (others.some((value) => value === undefined)) continue;
    const score = Math.max(distance, ...(others as number[]));
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function walkBranch(start: string, merge: string | undefined, graph: Pick<Graph, 'out' | 'byId'>) {
  const ids: string[] = [];
  let current: string | undefined = start;
  while (current !== undefined && current !== merge && graph.byId.has(current)) {
    if (ids.includes(current)) break;
    ids.push(current);
    current = (graph.out.get(current) ?? []).find((id) => graph.byId.has(id) && id !== merge);
  }
  return ids;
}

/** Branch starts with their labels. */
function branchesOf(data: Data): { start: string; label: string }[] {
  const switchType = text(data['switch_type']) || 'if_else';
  const cases = Array.isArray(data['switch_cases']) ? data['switch_cases'].filter(isRecord) : [];
  if (switchType === 'if_else' && cases.length === 0) {
    const trueLabel = text(data['true_label']) || 'TRUE';
    const falseLabel = text(data['false_label']) || 'FALSE';
    return [
      { start: text(data['true_branch']), label: trueLabel },
      { start: text(data['false_branch']), label: falseLabel },
    ].filter((branch) => branch.start !== '');
  }
  return cases.map((item, index) => {
    let label = `Case ${String(index + 1)}`;
    if (switchType === 'if_else') {
      label =
        index === 0
          ? text(data['true_label']) || 'TRUE'
          : index === 1
            ? text(data['false_label']) || 'FALSE'
            : label;
    } else if (switchType === 'random' || switchType === 'uniform_random') {
      const probability = item['probability'];
      label =
        typeof probability === 'number'
          ? `${String(probability)}%`
          : `${String(Math.round(100 / cases.length))}%`;
    } else if (text(item['value']) !== '') {
      label = text(item['value']);
    }
    return { start: text(item['branch_block_id']), label };
  });
}

function buildGraph(source: OutlineSource): { graph: Graph; validators: Map<string, Block[]> } {
  const all = source.blocks.map(readBlock).filter((block): block is Block => block !== undefined);
  const bound = new Set<string>();
  const validators = new Map<string, Block[]>();
  for (const block of all) {
    const target = boundRequestOf(block);
    if (target === undefined) continue;
    bound.add(block.id);
    if (block.enabled) validators.set(target, [...(validators.get(target) ?? []), block]);
  }
  const blocks = all.filter((block) => !bound.has(block.id));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const out = new Map<string, string[]>();
  const inCount = new Map<string, number>();
  for (const [from, to] of executionEdges(source.edges, bound, byId)) {
    out.set(from, [...(out.get(from) ?? []), to]);
    inCount.set(to, (inCount.get(to) ?? 0) + 1);
  }

  const partial = { out, byId };
  const containment = new Map<string, Containment>();
  for (const block of blocks) {
    if (CONTAINER_TYPES.has(block.type)) {
      const declared = idList(block.data['body_blocks']).filter(
        (id) => byId.has(id) && id !== block.id,
      );
      const ids =
        block.type === 'loop' && declared.length === 0
          ? walkLoopCycle(block.id, partial)
          : declared;
      containment.set(block.id, { kind: 'body', ids });
    } else if (block.type === 'conditional') {
      const branches = branchesOf(block.data).filter((branch) => byId.has(branch.start));
      const merge = mergeOf(
        branches.map((branch) => branch.start),
        partial,
      );
      containment.set(block.id, {
        kind: 'switch',
        ...(merge === undefined ? {} : { merge }),
        cases: branches.map((branch) => ({
          label: branch.label,
          ids: walkBranch(branch.start, merge, partial),
        })),
      });
    }
  }
  const owned = new Set<string>();
  for (const info of containment.values()) {
    const ids = info.kind === 'body' ? info.ids : info.cases.flatMap((branch) => branch.ids);
    for (const id of ids) owned.add(id);
  }
  return { graph: { blocks, byId, out, inCount, containment, owned }, validators };
}

/** The stored entry wins when it names a top-level block; else the first one nothing points to. */
function rootStart(entry: string | null | undefined, graph: Graph): string | undefined {
  if (entry !== null && entry !== undefined && graph.byId.has(entry) && !graph.owned.has(entry)) {
    return entry;
  }
  const eligible = graph.blocks.filter((block) => !graph.owned.has(block.id));
  return (eligible.find((block) => (graph.inCount.get(block.id) ?? 0) === 0) ?? eligible[0])?.id;
}

/** When a container's own edge does not lead out, the last body block's edge does. */
function exitOf(body: string[], graph: Graph, visited: Set<string>): string | undefined {
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const id = body[index];
    if (id === undefined) continue;
    const found = (graph.out.get(id) ?? []).find(
      (next) =>
        graph.byId.has(next) &&
        !graph.owned.has(next) &&
        !visited.has(next) &&
        !body.includes(next),
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function walkChain(start: string, graph: Graph, visited: Set<string>): string[] {
  const ids: string[] = [];
  let current: string | undefined = start;
  while (
    current !== undefined &&
    graph.byId.has(current) &&
    !visited.has(current) &&
    !graph.owned.has(current)
  ) {
    ids.push(current);
    visited.add(current);
    const info = graph.containment.get(current);
    let next: string | undefined = info?.kind === 'switch' ? info.merge : undefined;
    next ??= (graph.out.get(current) ?? []).find(
      (id) => graph.byId.has(id) && !graph.owned.has(id) && !visited.has(id),
    );
    if (next === undefined && info?.kind === 'body') next = exitOf(info.ids, graph, visited);
    current = next;
  }
  return ids;
}

/** Top-level blocks in order; a fragment the walk never reached follows in declaration order. */
function rootSequence(source: OutlineSource, graph: Graph): string[] {
  const visited = new Set<string>();
  const start = rootStart(source.entry_block_id, graph);
  const ids = start === undefined ? [] : walkChain(start, graph, visited);
  for (const block of graph.blocks) {
    if (!graph.owned.has(block.id) && !visited.has(block.id)) {
      ids.push(...walkChain(block.id, graph, visited));
    }
  }
  return ids;
}

// ---- steps ----------------------------------------------------------------------------------

interface Draft {
  readonly block: Block;
  readonly num: string;
  readonly depth: number;
  readonly branch?: string;
}

function flatten(
  ids: string[],
  depth: number,
  prefix: string,
  branchOf: Map<string, string>,
  graph: Graph,
  emitted: Set<string>,
  out: Draft[],
): void {
  let index = 0;
  for (const id of ids) {
    const block = graph.byId.get(id);
    if (block === undefined || !block.enabled || emitted.has(id)) continue;
    emitted.add(id);
    index += 1;
    const num = prefix === '' ? String(index) : `${prefix}.${String(index)}`;
    const branch = branchOf.get(id);
    out.push({ block, num, depth, ...(branch === undefined ? {} : { branch }) });
    const info = graph.containment.get(id);
    if (info?.kind === 'body') {
      flatten(info.ids, depth + 1, num, new Map(), graph, emitted, out);
    } else if (info?.kind === 'switch') {
      const labels = new Map<string, string>();
      for (const branchCase of info.cases) {
        for (const child of branchCase.ids) labels.set(child, branchCase.label);
      }
      const children = info.cases.flatMap((branchCase) => branchCase.ids);
      flatten(children, depth + 1, num, labels, graph, emitted, out);
    }
  }
}

function kindOf(type: string): OutlineStep['kind'] {
  if (type === 'request') return 'request';
  if (type === 'pause') return 'pause';
  return 'other';
}

function nameOf(block: Block, branch: string | undefined): string {
  let name = block.name;
  if (name === '' && block.type === 'request') {
    name = `${text(block.data['method']).toUpperCase()} ${text(block.data['path'])}`.trim();
  }
  if (name === '') name = block.type;
  return branch === undefined ? name : `[${branch}] ${name}`;
}

function stepOf(
  draft: Draft,
  validators: Block[],
  available: Map<string, number>,
  counter: { next: number },
): OutlineStep {
  const { block } = draft;
  const kind = kindOf(block.type);
  const refs: string[] = [];
  collectRefs(block.data, refs);
  const produces = producedBy(block.data);
  // A validator folded into its request: its references and productions are the request's.
  for (const validator of validators) {
    collectRefs(validator.data, refs);
    for (const name of producedBy(validator.data))
      if (!produces.includes(name)) produces.push(name);
  }
  const uses = refs
    .filter((name) => available.has(name))
    .sort((a, b) => (available.get(a) ?? 0) - (available.get(b) ?? 0));
  const feederVars = refs.filter((name) => !available.has(name));
  for (const name of produces) {
    if (!available.has(name)) available.set(name, counter.next++);
  }

  const step: OutlineStep = {
    num: draft.num,
    kind,
    blockType: block.type,
    depth: draft.depth,
    name: nameOf(block, draft.branch),
    ...(block.description === '' ? {} : { description: block.description }),
    uses,
    produces,
    feederVars,
    expectedStatuses: kind === 'request' ? statusesOf(block.data['expected_statuses']) : [],
    // The name the screen shows (flowOutlineViewModel.ts:1777-1781).
    validators: validators.map(
      (validator) =>
        text(validator.data['validator_display_name']) ||
        text(validator.data['validator_name']) ||
        text(validator.data['validator_id']) ||
        'validator',
    ),
  };
  if (kind === 'request') {
    step.method = text(block.data['method']).trim().toUpperCase();
    step.path = displayPath(block.data);
  }
  if (kind === 'pause') {
    const min = block.data['delay_min_ms'];
    const max = block.data['delay_max_ms'];
    const minMs = typeof min === 'number' ? min : 0;
    const source = block.data['source'];
    step.pause = {
      minMs,
      maxMs: typeof max === 'number' ? max : minMs,
      source:
        typeof source === 'string' && PAUSE_SOURCES.includes(source)
          ? (source as PauseSource)
          : 'unknown',
    };
  }
  return step;
}

/** The block each step of the outline is, by its number: what a change of the graph (`flow/dropSteps.ts`) addresses. */
export function outlineBlocks(
  flow: OutlineSource,
): ReadonlyMap<string, { readonly id: string; readonly type: string; readonly depth: number }> {
  const { graph } = buildGraph(flow);
  const drafts: Draft[] = [];
  flatten(rootSequence(flow, graph), 0, '', new Map(), graph, new Set(), drafts);
  return new Map(
    drafts.map((draft) => [
      draft.num,
      { id: draft.block.id, type: draft.block.type, depth: draft.depth },
    ]),
  );
}

/** The outline of a flow, as the Outline screen numbers it. Pure: same flow, same outline. */
export function buildOutline(flow: OutlineSource): FlowOutline {
  const { graph, validators } = buildGraph(flow);
  const drafts: Draft[] = [];
  flatten(rootSequence(flow, graph), 0, '', new Map(), graph, new Set(), drafts);

  const available = new Map<string, number>();
  const counter = { next: 0 };
  const steps = drafts.map((draft) =>
    stepOf(draft, validators.get(draft.block.id) ?? [], available, counter),
  );

  // The class of the action a pause stands before is on the request that opens it.
  let nextClass: ActionClass | undefined;
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const draft = drafts[index];
    if (step === undefined || draft === undefined) continue;
    if (step.kind === 'request') nextClass = actionClassOf(draft.block.data);
    if (step.pause !== undefined && nextClass !== undefined) step.pause.actionClass = nextClass;
  }

  return {
    flowId: flow.id,
    name: flow.name,
    version: flow.current_version,
    stepCount: steps.length,
    requestCount: steps.filter((step) => step.kind === 'request').length,
    pauseCount: steps.filter((step) => step.kind === 'pause').length,
    steps: steps.slice(0, MAX_OUTLINE_STEPS),
    truncated: steps.length > MAX_OUTLINE_STEPS,
  };
}
