// The flow outline built from raw blocks: each rule copied from the LoadCraft Outline screen and
// backend (sources in `src/flow/outline.ts`) in a table, plus the four "zakupy" flows of the
// mock-up session checked against the golden texts the outline view has to reproduce.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildOutline,
  MAX_OUTLINE_STEPS,
  type FlowOutline,
  type OutlineSource,
  type OutlineStep,
} from '../src/flow/outline.js';
import type { components } from '../src/http/generated/api.js';
import { createIdSource, createStore } from './fake-backend/store.js';
import { SKLEP_COLLECTIONS, seedSklep } from './fake-backend/worlds/sklep.js';
import { goldenText, SKLEP_IDS, type GoldenRun } from './golden/index.js';

type FlowDetail = components['schemas']['FlowDetail'];
type Block = Record<string, unknown>;

function fixture(name: string): FlowDetail {
  const url = new URL(`./fixtures/flows/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as FlowDetail;
}

/** A flow of these blocks chained in order, unless edges are given. */
function flow(blocks: Block[], edges?: Block[], entry?: string): OutlineSource {
  const ids = blocks.map((block) => String(block['id']));
  return {
    id: 'flow-1',
    name: 'test',
    current_version: 3,
    blocks,
    edges:
      edges ??
      ids.slice(0, -1).map((source, index) => ({
        id: `e${String(index)}`,
        source,
        target: ids[index + 1],
      })),
    entry_block_id: entry ?? ids[0] ?? null,
  };
}

function request(id: string, config: Block = {}, extra: Block = {}): Block {
  return {
    id,
    type: 'request',
    name: id,
    description: '',
    enabled: true,
    config: { method: 'GET', path: `/${id}`, ...config },
    ...extra,
  };
}

function pause(id: string, config: Block = {}, extra: Block = {}): Block {
  return {
    id,
    type: 'pause',
    name: 'Pause',
    enabled: true,
    config: { delay_min_ms: 1000, delay_max_ms: 3000, ...config },
    ...extra,
  };
}

function block(id: string, type: string, config: Block = {}, extra: Block = {}): Block {
  return { id, type, name: id, enabled: true, config, ...extra };
}

function step(outline: FlowOutline, num: string): OutlineStep {
  const found = outline.steps.find((item) => item.num === num);
  if (found === undefined) throw new Error(`no step ${num} in ${JSON.stringify(outline.steps)}`);
  return found;
}

/** `num depth kind name` of every step: the shape of the outline at a glance. */
function shape(outline: FlowOutline): string[] {
  return outline.steps.map((item) => `${item.num} ${String(item.depth)} ${item.kind} ${item.name}`);
}

// ---- the four "zakupy" flows against the golden texts ---------------------------------------

/** One outline row of a golden text, read back into the facts the view prints. */
interface GoldenRow {
  num: string;
  method: string;
  path?: string;
  minMs?: number;
  maxMs?: number;
  source?: string;
  activity?: string;
  uses: string[];
  produces: string[];
  statuses: number[];
}

const SOURCE_WORDS: Record<string, string> = { założona: 'default_human', nagrana: 'recording' };

/** What the golden texts say after the source: the class of the next request's action. */
const CLASS_WORDS: Record<string, string> = {
  form_submit: 'formularz',
  in_page: 'akcja w stronie',
  page: 'strona',
};

function seconds(value: string): number {
  return Math.round(Number(value.replace(',', '.')) * 1000);
}

function goldenOutline(run: GoldenRun, file: string): { header: string; rows: GoldenRow[] } {
  const lines = goldenText(run, file).split('\n');
  const headerIndex = lines.findIndex((line) => /^(flow „)?zakupy”? .*kroków \(/.test(line));
  const header = lines[headerIndex] ?? '';
  const rows: GoldenRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const match = /^ {2}(\d+) {2}(POST|GET|PAUSE) +(.+?) {2,}(.*)$/.exec(line);
    if (match === null) break;
    const [, num = '', method = '', where = '', notes = ''] = match;
    if (method === 'PAUSE') {
      const [low = '', high = low] = where.replace(/ s$/, '').split('–');
      const [sourceWord = '', activity = ''] = notes.split(' · ');
      rows.push({
        num,
        method,
        minMs: seconds(low),
        maxMs: seconds(high),
        source: SOURCE_WORDS[sourceWord] ?? sourceWord,
        activity,
        uses: [],
        produces: [],
        statuses: [],
      });
      continue;
    }
    const list = (pattern: RegExp): string[] =>
      (pattern.exec(notes)?.[1] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    rows.push({
      num,
      method,
      path: where,
      uses: list(/używa: ([^·]+)/),
      produces: list(/→ ([^·]+)/),
      statuses: (/✓ (.*)$/.exec(notes)?.[1] ?? '')
        .split(' · ')
        .filter((item) => item !== '')
        .map(Number),
    });
  }
  return { header, rows };
}

function asGoldenRow(item: OutlineStep): GoldenRow {
  if (item.kind === 'pause') {
    return {
      num: item.num,
      method: 'PAUSE',
      minMs: item.pause?.minMs ?? -1,
      maxMs: item.pause?.maxMs ?? -1,
      source: item.pause?.source ?? '',
      activity: CLASS_WORDS[item.pause?.actionClass ?? ''] ?? '',
      uses: [],
      produces: [],
      statuses: [],
    };
  }
  return {
    num: item.num,
    method: item.method ?? '',
    path: item.path ?? '',
    uses: item.uses,
    produces: item.produces,
    statuses: item.expectedStatuses,
  };
}

const ZAKUPY: [string, GoldenRun, string, string][] = [
  ['run 1 (from the API docs)', 'run1', '04-flows_generate_from_suggestions', 'zakupy-run1'],
  ['run 2 (manual)', 'run2', '03-flows_generate_from_endpoints', 'zakupy-run2-reczne'],
  ['run 3 (from a description)', 'run3', '04-flows_record_journeys', 'zakupy-run3-opis'],
  ['run 4 (HAR recording)', 'run4', '04-flows_generate_from_har', 'zakupy-run4-har'],
];

describe('buildOutline: the "zakupy" flows of the mock-up', () => {
  it.each(ZAKUPY)('%s gives every fact of the golden rows', (_label, run, file, name) => {
    const outline = buildOutline(fixture(name));
    const golden = goldenOutline(run, file);
    expect(golden.rows.length).toBeGreaterThan(0);
    expect(outline.steps.map(asGoldenRow)).toEqual(golden.rows);
    const counts = /(\d+) kroków \((\d+) żąda\S* · (\d+) pauz/.exec(golden.header);
    expect([outline.stepCount, outline.requestCount, outline.pauseCount]).toEqual(
      counts?.slice(1, 4).map(Number),
    );
    expect(outline.truncated).toBe(false);
    expect(outline.name).toBe('zakupy');
  });

  it('run 1: 7 steps, 4 requests, step 3 and step 7 as in the mock-up', () => {
    const outline = buildOutline(fixture('zakupy-run1'));
    expect(outline).toMatchObject({
      flowId: SKLEP_IDS.flowZakupy,
      version: 1,
      stepCount: 7,
      requestCount: 4,
      pauseCount: 3,
    });
    expect(step(outline, '3')).toMatchObject({
      kind: 'request',
      method: 'GET',
      path: '/products?q=#{q}',
      uses: ['token'],
      produces: ['productId'],
      feederVars: ['q'],
    });
    expect(step(outline, '7').expectedStatuses).toEqual([201, 409]);
    expect(step(outline, '1').feederVars).toEqual(['email', 'password']);
  });

  it('run 1 fixture is the flow of the fake world "sklep"', () => {
    const store = createStore(createIdSource(1));
    seedSklep(store, { stage: 'flows' });
    const world = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).get(SKLEP_IDS.flowZakupy);
    expect(world).toEqual(fixture('zakupy-run1'));
  });

  it('a pause takes the action class of the request after it (form_submit)', () => {
    const outline = buildOutline(fixture('zakupy-run1'));
    expect(step(outline, '2').pause).toEqual({
      minMs: 3000,
      maxMs: 8000,
      source: 'default_human',
      actionClass: 'form_submit',
    });
    expect(step(outline, '4').pause?.actionClass).toBe('in_page');
  });

  it('a recorded pause has min = max', () => {
    const outline = buildOutline(fixture('zakupy-run4-har'));
    expect(step(outline, '2').pause).toMatchObject({
      minMs: 4200,
      maxMs: 4200,
      source: 'recording',
    });
  });

  it('a recorded pause is within the 10 s the backend caps captured think time at', () => {
    // The backend's `THINK_TIME_MAX_MS`.
    const outline = buildOutline(fixture('zakupy-run4-har'));
    const recorded = outline.steps.filter((item) => item.pause?.source === 'recording');
    expect(recorded).toHaveLength(3);
    expect(Math.max(...recorded.map((item) => item.pause?.maxMs ?? 0))).toBe(10_000);
  });

  it('a pause carries the fixed sentence the backend writes, not the activity of a person', () => {
    const outline = buildOutline(fixture('zakupy-run1'));
    expect(step(outline, '2').description).toBe(
      'Assumed default think time before an API call (not measured)',
    );
  });

  it('a bound validator is folded into its request and is no step', () => {
    const har = fixture('zakupy-run4-har');
    expect(har.blocks.filter((item) => item['type'] === 'validator')).toHaveLength(4);
    const outline = buildOutline(har);
    expect(outline.stepCount).toBe(7);
    expect(outline.steps.every((item) => item.blockType !== 'validator')).toBe(true);
    expect(step(outline, '7').validators).toEqual(['Status code']);
    // HAR writes references as {{x}}; the path shows them as #{x}.
    expect(step(outline, '3')).toMatchObject({
      path: '/products?q=#{q}',
      uses: ['token'],
      feederVars: ['q'],
    });
  });
});

// ---- order: chain, containers, branches -------------------------------------------------------

describe('buildOutline: order of steps', () => {
  it('loop, disabled block, both branches and a group of the "katalog" flow', () => {
    const outline = buildOutline(fixture('katalog-petla-galaz'));
    expect(shape(outline)).toEqual([
      '1 0 request Log in',
      '2 0 request List products',
      '3 0 other For each product',
      '3.1 1 request Show product',
      '3.2 1 pause Pause',
      '4 0 other Has a cart?',
      '4.1 1 request [TRUE] Add to cart',
      '4.2 1 pause [TRUE] Wait after add',
      '4.3 1 other [FALSE] Pick a cart',
      '5 0 request Check out',
      '6 0 other Orders',
      '6.1 1 request List my orders',
    ]);
    expect([outline.stepCount, outline.requestCount, outline.pauseCount]).toEqual([12, 6, 2]);
  });

  it('variables across the loop and the branches of "katalog"', () => {
    const outline = buildOutline(fixture('katalog-petla-galaz'));
    expect(step(outline, '3').produces).toEqual(['item']);
    expect(step(outline, '3.1')).toMatchObject({
      path: '/products/#{item}',
      uses: ['token', 'item'],
    });
    expect(step(outline, '4').uses).toEqual(['items']);
    expect(step(outline, '4.3').produces).toEqual(['cartId']);
    expect(step(outline, '5')).toMatchObject({
      uses: ['token', 'cartId'],
      feederVars: [],
      expectedStatuses: [201],
    });
    // Produced only by the disabled block: nobody produces it, so it is test data.
    expect(step(outline, '6.1')).toMatchObject({ uses: ['token'], feederVars: ['ghost'] });
    expect(step(outline, '4.2').pause).toEqual({
      minMs: 500,
      maxMs: 500,
      source: 'machine_wait',
      actionClass: 'form_submit',
    });
  });

  const ORDER: [string, OutlineSource, string[]][] = [
    [
      'binding edges are not followed',
      flow(
        [request('a'), request('b'), request('c')],
        [
          { id: 'x', source: 'a', target: 'c', type: 'binding' },
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'c' },
        ],
      ),
      ['1 0 request a', '2 0 request b', '3 0 request c'],
    ],
    [
      'the walk starts at entry_block_id, not at the first block',
      flow([request('b'), request('a')], [{ id: 'e1', source: 'a', target: 'b' }], 'a'),
      ['1 0 request a', '2 0 request b'],
    ],
    [
      'without a known entry it starts at the block nothing points to',
      flow([request('b'), request('a')], [{ id: 'e1', source: 'a', target: 'b' }], 'gone'),
      ['1 0 request a', '2 0 request b'],
    ],
    [
      'a disabled block is skipped and the chain goes on through it',
      flow([request('a'), request('b', {}, { enabled: false }), request('c')]),
      ['1 0 request a', '2 0 request c'],
    ],
    [
      'a disabled container hides its body',
      flow(
        [
          request('a'),
          block('g', 'group', { body_blocks: ['in'] }, { enabled: false }),
          request('in'),
          request('z'),
        ],
        [
          { id: 'e1', source: 'a', target: 'g' },
          { id: 'e2', source: 'g', target: 'z' },
        ],
      ),
      ['1 0 request a', '2 0 request z'],
    ],
    [
      'retry, group and loop bodies come in body_blocks order, one level deeper',
      flow(
        [
          block('r', 'retry', { body_blocks: ['r2', 'r1'] }),
          request('r1'),
          request('r2'),
          block('g', 'group', { body_blocks: ['l'] }),
          block('l', 'loop', { loop_type: 'times', body_blocks: ['l1'] }),
          request('l1'),
        ],
        [{ id: 'e1', source: 'r', target: 'g' }],
      ),
      [
        '1 0 other r',
        '1.1 1 request r2',
        '1.2 1 request r1',
        '2 0 other g',
        '2.1 1 other l',
        '2.1.1 2 request l1',
      ],
    ],
    [
      'a loop without body_blocks takes the cycle of its edges as body',
      flow(
        [block('l', 'loop', { loop_type: 'while' }), request('x'), request('y'), request('z')],
        [
          { id: 'e1', source: 'l', target: 'x' },
          { id: 'e2', source: 'x', target: 'y' },
          { id: 'e3', source: 'y', target: 'l' },
          { id: 'e4', source: 'l', target: 'z' },
        ],
      ),
      ['1 0 other l', '1.1 1 request x', '1.2 1 request y', '2 0 request z'],
    ],
    [
      'switch cases are labelled with their values, random ones with percentages',
      flow(
        [
          block('s', 'conditional', {
            switch_type: 'switch',
            switch_cases: [{ value: 'card', branch_block_id: 'c' }, { branch_block_id: 'd' }],
          }),
          request('c'),
          request('d'),
          block('r', 'conditional', {
            switch_type: 'random',
            switch_cases: [
              { probability: 70, branch_block_id: 'p' },
              { probability: 30, branch_block_id: 'q' },
            ],
          }),
          request('p'),
          request('q'),
          request('end'),
        ],
        [
          { id: 'e1', source: 'c', target: 'r' },
          { id: 'e2', source: 'd', target: 'r' },
          { id: 'e3', source: 'p', target: 'end' },
          { id: 'e4', source: 'q', target: 'end' },
        ],
      ),
      [
        '1 0 other s',
        '1.1 1 request [card] c',
        '1.2 1 request [Case 2] d',
        '2 0 other r',
        '2.1 1 request [70%] p',
        '2.2 1 request [30%] q',
        '3 0 request end',
      ],
    ],
    [
      'if/else stored as switch_cases reads TRUE / FALSE by position',
      flow(
        [
          block('i', 'conditional', {
            switch_type: 'if_else',
            switch_cases: [{ branch_block_id: 't' }, { branch_block_id: 'f' }],
          }),
          request('t'),
          request('f'),
        ],
        [],
      ),
      ['1 0 other i', '1.1 1 request [TRUE] t', '1.2 1 request [FALSE] f'],
    ],
    [
      'a request without a name is named by its method and path',
      flow([request('a', { method: 'post', path: '/orders' }, { name: '' })]),
      ['1 0 request POST /orders'],
    ],
    [
      'an unbound validator stays a step',
      flow([request('a'), block('v', 'validator', { validator_name: 'Schema' })]),
      ['1 0 request a', '2 0 other v'],
    ],
    [
      'a block nobody reaches still shows up at the end',
      flow([request('a'), request('lost')], []),
      ['1 0 request a', '2 0 request lost'],
    ],
  ];

  it.each(ORDER)('%s', (_label, source, expected) => {
    expect(shape(buildOutline(source))).toEqual(expected);
  });

  it('the chain runs on through a bound validator to the next block', () => {
    const outline = buildOutline(
      flow(
        [
          request('a'),
          block('v', 'validator', { validator_id: 'status', bound_to_request_id: 'a' }),
          pause('p'),
          request('b'),
        ],
        [
          { id: 'e1', source: 'a', target: 'v' },
          { id: 'e2', source: 'v', target: 'p' },
          { id: 'e3', source: 'p', target: 'b' },
        ],
      ),
    );
    expect(shape(outline)).toEqual(['1 0 request a', '2 0 pause Pause', '3 0 request b']);
    expect(step(outline, '1').validators).toEqual(['status']);
  });

  // Declaration order differs from execution order, so only the bridged edges give a -> b -> c;
  // without bridging the walk stops at a and the unreached blocks follow in declaration order.
  it.each([
    [
      'one validator',
      [
        request('c'),
        block('v', 'validator', { validator_id: 'status', bound_to_request_id: 'a' }),
        request('b'),
        request('a'),
      ],
      [
        { id: 'e1', source: 'a', target: 'v' },
        { id: 'e2', source: 'v', target: 'b' },
        { id: 'e3', source: 'b', target: 'c' },
      ],
      ['1 0 request a', '2 0 request b', '3 0 request c'],
    ],
    [
      'two validators and a pause in a row',
      [
        request('c'),
        pause('p'),
        block('v2', 'validator', { validator_id: 'schema', bound_to_request_id: 'a' }),
        request('b'),
        block('v1', 'validator', { validator_id: 'status', bound_to_request_id: 'a' }),
        request('a'),
      ],
      [
        { id: 'e1', source: 'a', target: 'v1' },
        { id: 'e2', source: 'v1', target: 'v2' },
        { id: 'e3', source: 'v2', target: 'p' },
        { id: 'e4', source: 'p', target: 'b' },
        { id: 'e5', source: 'b', target: 'c' },
      ],
      ['1 0 request a', '2 0 pause Pause', '3 0 request b', '4 0 request c'],
    ],
  ])('edges through bound validators are bridged: %s', (_label, blocks, edges, expected) => {
    expect(shape(buildOutline(flow(blocks, edges, 'a')))).toEqual(expected);
  });

  it(`more than ${String(MAX_OUTLINE_STEPS)} steps are cut and marked`, () => {
    const blocks = Array.from({ length: 300 }, (_, index) => request(`r${String(index)}`));
    const outline = buildOutline(flow(blocks));
    expect(outline.steps).toHaveLength(MAX_OUTLINE_STEPS);
    expect(outline).toMatchObject({ stepCount: 300, requestCount: 300, truncated: true });
    expect(outline.steps.at(-1)?.num).toBe('250');
  });

  it('exactly the limit is not cut', () => {
    const blocks = Array.from({ length: MAX_OUTLINE_STEPS }, (_, index) =>
      request(`r${String(index)}`),
    );
    expect(buildOutline(flow(blocks)).truncated).toBe(false);
  });
});

// ---- variables --------------------------------------------------------------------------------

describe('buildOutline: what a step produces', () => {
  const PRODUCES: [string, Block, string[]][] = [
    [
      'save_as of request_checks and response_checks',
      request('a', {
        request_checks: [{ check_type: 'json_path', selector: '$.id', save_as: 'id' }],
        response_checks: [
          { check_type: 'header', header_name: 'Location', save_as: 'location' },
          { check_type: 'status', expected_value: 200 },
        ],
      }),
      ['id', 'location'],
    ],
    [
      'keys of save_variables',
      request('a', { save_variables: { token: '$.t', user: '$.u' } }),
      ['token', 'user'],
    ],
    ['save_response_as', request('a', { save_response_as: 'page' }), ['page']],
    [
      'every transform target',
      block('t', 'transform', {
        transforms: [
          { source: '$.a', target: 'first', operation: 'extract' },
          { source: 'x', target: 'second', operation: 'uppercase' },
        ],
      }),
      ['first', 'second'],
    ],
    [
      'output_variable of an auth block',
      block('au', 'auth', { output_variable: 'accessToken' }),
      ['accessToken'],
    ],
    [
      'keys of session_set of a dummy block',
      block('d', 'dummy', { session_set: { mode: 'x' } }),
      ['mode'],
    ],
    ['save_events_as of an SSE block', block('s', 'sse', { save_events_as: 'events' }), ['events']],
    [
      'the element of a foreach loop, not its index',
      block('l', 'loop', {
        loop_type: 'foreach',
        foreach_variable: 'item',
        foreach_index_variable: 'i',
      }),
      ['item'],
    ],
    ['pollCount of a while loop', block('l', 'loop', { loop_type: 'while' }), ['pollCount']],
    ['pollCount of a do_while loop', block('l', 'loop', { loop_type: 'do_while' }), ['pollCount']],
    ['nothing from a times loop', block('l', 'loop', { loop_type: 'times' }), []],
    [
      'fields of a flat block (no config) as well',
      {
        id: 'f',
        type: 'request',
        name: 'f',
        method: 'GET',
        path: '/f',
        save_variables: { flat: '$' },
      },
      ['flat'],
    ],
  ];

  it.each(PRODUCES)('%s', (_label, item, expected) => {
    expect(buildOutline(flow([item])).steps[0]?.produces).toEqual(expected);
  });

  it('what a bound validator produces is produced by its request', () => {
    const outline = buildOutline(
      flow(
        [
          request('a'),
          block('v', 'validator', { bound_to_request_id: 'a', save_result_as: 'checked' }),
          request('b', { headers: { 'X-Checked': '#{checked}' } }),
        ],
        [{ id: 'e1', source: 'a', target: 'b' }],
      ),
    );
    expect(step(outline, '1').produces).toEqual(['checked']);
    expect(step(outline, '2').uses).toEqual(['checked']);
  });
});

describe('buildOutline: what a step uses and what comes from test data', () => {
  const USES: [string, Block, Block, { uses: string[]; feederVars: string[] }][] = [
    [
      '#{x} in a header, also inside a longer value',
      request('p', { save_variables: { token: '$.t' } }),
      request('u', { headers: { Authorization: 'Bearer #{token}' } }),
      { uses: ['token'], feederVars: [] },
    ],
    [
      '{{x}} written by the HAR import',
      request('p', { save_variables: { token: '$.t' } }),
      request('u', { headers: { Authorization: 'Bearer {{token}}' } }),
      { uses: ['token'], feederVars: [] },
    ],
    [
      'deep inside the body, in arrays',
      request('p', { save_variables: { id: '$.id' } }),
      request('u', { body: { items: [{ product: { id: '#{id}' } }] } }),
      { uses: ['id'], feederVars: [] },
    ],
    [
      'in any config field, query parameters included',
      request('p', { save_variables: { page: '$.p' } }),
      request('u', { query_params: { page: '#{page}', q: '#{q}' } }),
      { uses: ['page'], feederVars: ['q'] },
    ],
    [
      'what nobody produced is test data, in the order it appears',
      request('p'),
      request('u', { body: { b: '#{second}', a: '#{first}', again: '#{second}' } }),
      { uses: [], feederVars: ['second', 'first'] },
    ],
    [
      'uses come in the order they were produced',
      request('p', { save_variables: { z: '$.z', a: '$.a' } }),
      request('u', { body: { a: '#{a}', z: '#{z}' } }),
      { uses: ['z', 'a'], feederVars: [] },
    ],
    [
      'not a reference: a name starting with a digit, a bare $x',
      request('p'),
      request('u', { body: { a: '#{1x}', b: '$x', c: '{x}' } }),
      { uses: [], feederVars: [] },
    ],
    [
      'a description is not configuration',
      request('p'),
      request('u', {}, { description: 'sends #{note}' }),
      { uses: [], feederVars: [] },
    ],
  ];

  it.each(USES)('%s', (_label, producer, consumer, expected) => {
    const consumerStep = buildOutline(flow([producer, consumer])).steps[1];
    expect({ uses: consumerStep?.uses, feederVars: consumerStep?.feederVars }).toEqual(expected);
  });

  it('a variable used before it is produced is test data at that step', () => {
    const outline = buildOutline(
      flow([
        request('early', { headers: { 'X-Late': '#{late}' } }),
        request('maker', { save_variables: { late: '$.l' } }),
        request('after', { headers: { 'X-Late': '#{late}' } }),
      ]),
    );
    expect(step(outline, '1')).toMatchObject({ uses: [], feederVars: ['late'] });
    expect(step(outline, '2').produces).toEqual(['late']);
    expect(step(outline, '3')).toMatchObject({ uses: ['late'], feederVars: [] });
  });

  it('references in a bound validator count for its request', () => {
    const outline = buildOutline(
      flow(
        [
          request('a', { save_variables: { expected: '$.e' } }),
          request('b'),
          block('v', 'validator', {
            bound_to_request_id: 'b',
            parameter_overrides: { value: '#{expected}', other: '#{fromData}' },
          }),
        ],
        [{ id: 'e1', source: 'a', target: 'b' }],
      ),
    );
    expect(step(outline, '2')).toMatchObject({ uses: ['expected'], feederVars: ['fromData'] });
  });
});

describe('buildOutline: request and pause fields', () => {
  it.each([
    [
      'path with query parameters',
      { path: '/p', query_params: { a: 1, b: true } },
      '/p?a=1&b=true',
    ],
    ['a path that has a query already', { path: '/p?x=1', query_params: { a: 'b' } }, '/p?x=1&a=b'],
    ['empty query parameters', { path: '/p', query_params: {} }, '/p'],
    ['{{x}} in the path becomes #{x}', { path: '/orders/{{orderId}}' }, '/orders/#{orderId}'],
  ])('%s', (_label, config, expected) => {
    expect(buildOutline(flow([request('a', config)])).steps[0]?.path).toBe(expected);
  });

  it.each([
    ['a list of statuses', [201, 409], [201, 409]],
    ['null', null, []],
    ['missing', undefined, []],
  ])('expected_statuses: %s', (_label, value, expected) => {
    const config = value === undefined ? {} : { expected_statuses: value };
    expect(buildOutline(flow([request('a', config)])).steps[0]?.expectedStatuses).toEqual(expected);
  });

  it.each([
    [
      'recording',
      { delay_min_ms: 4200, delay_max_ms: 4200, source: 'recording' },
      { minMs: 4200, maxMs: 4200, source: 'recording' },
    ],
    [
      'default_human',
      { source: 'default_human' },
      { minMs: 1000, maxMs: 3000, source: 'default_human' },
    ],
    ['manual', { source: 'manual' }, { minMs: 1000, maxMs: 3000, source: 'manual' }],
    [
      'machine_wait',
      { source: 'machine_wait' },
      { minMs: 1000, maxMs: 3000, source: 'machine_wait' },
    ],
    ['no source (legacy)', { source: null }, { minMs: 1000, maxMs: 3000, source: 'unknown' }],
    ['an unknown source', { source: 'guess' }, { minMs: 1000, maxMs: 3000, source: 'unknown' }],
    [
      'no max: max = min',
      { delay_min_ms: 500, delay_max_ms: undefined },
      { minMs: 500, maxMs: 500, source: 'unknown' },
    ],
  ])('pause source %s', (_label, config, expected) => {
    expect(buildOutline(flow([pause('p', config)])).steps[0]?.pause).toEqual(expected);
  });

  it.each([
    [
      'the next request opens an action',
      [pause('p'), request('r', { action_start: { class: 'page' } })],
      'page',
    ],
    [
      'the next request opens none',
      [pause('p'), request('r'), request('s', { action_start: { class: 'page' } })],
      undefined,
    ],
    [
      'no request after the pause',
      [request('r', { action_start: { class: 'page' } }), pause('p')],
      undefined,
    ],
    [
      'an unknown class',
      [pause('p'), request('r', { action_start: { class: 'swipe' } })],
      undefined,
    ],
    [
      'other steps between the pause and the request',
      [
        pause('p'),
        block('t', 'transform', {}),
        request('r', { action_start: { class: 'api_call' } }),
      ],
      'api_call',
    ],
  ])('action class: %s', (_label, blocks, expected) => {
    const pauseStep = buildOutline(flow(blocks)).steps.find((item) => item.kind === 'pause');
    expect(pauseStep?.pause?.actionClass).toBe(expected);
  });

  it('the description of a block is passed on, an empty one is not', () => {
    const outline = buildOutline(
      flow([
        pause('p', {}, { description: 'wpisuje frazę' }),
        request('r', {}, { description: '' }),
      ]),
    );
    expect(outline.steps[0]?.description).toBe('wpisuje frazę');
    expect(outline.steps[1]).not.toHaveProperty('description');
  });

  it('an empty flow has no steps', () => {
    expect(buildOutline(flow([]))).toEqual({
      flowId: 'flow-1',
      name: 'test',
      version: 3,
      stepCount: 0,
      requestCount: 0,
      pauseCount: 0,
      steps: [],
      truncated: false,
    });
  });
});
