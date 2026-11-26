import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderSuggestJourneys,
  type SuggestionsData,
} from '../src/render/views/suggestJourneys.js';
import { flowsSuggestJourneys } from '../src/tools/flowsSuggestJourneys.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
  type SuggestionHandles,
  type SuggestionWorld,
} from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS } from './fake-backend/worlds/sklep.js';
import { rejection, waitFor } from './helpers/async.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T09:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const WORLD = SKLEP_SUGGESTIONS;

interface Rig {
  readonly r: ToolRig;
  readonly handles: SuggestionHandles;
}

async function rig(
  world: SuggestionWorld = WORLD,
  options: { locale?: 'en' | 'pl'; stage?: 'project' | 'flows' } = {},
): Promise<Rig> {
  let handles: SuggestionHandles | undefined;
  const r = await toolRig({
    tools: [flowsSuggestJourneys],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      handles = registerSuggestionRoutes(fake, world);
      seedSklep(fake.store, { stage: options.stage ?? 'project' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
  if (handles === undefined) throw new Error('the world did not register the suggestion routes');
  return { r, handles };
}

interface Structured {
  readonly status: string;
  readonly operation?: string;
  readonly data: SuggestionsData;
}

const structured = (result: RigCallResult): Structured => result.outcome as Structured;

/** Moves the test clock until the call settles (see `settleClock`). */
const settle = (r: ToolRig, call: Promise<RigCallResult>, seconds = 120): Promise<RigCallResult> =>
  settleClock(r, call, { limitMs: seconds * 1000 });

/** Starts the call and waits until the channel of the refine job has a listener. */
async function startAndListen(rg: Rig, args: Record<string, unknown> = {}) {
  const call = rg.r.call('flows_suggest_journeys', args);
  await waitFor(() => rg.handles.jobs.length === 1, 'the refine job to start');
  const job = rg.handles.jobs[0] ?? '';
  const stub = rg.r.fake.channel('refine', { job_id: job });
  await waitFor(() => stub.connections === 1, 'the channel to open');
  return { call, job, stub };
}

const callsTo = (r: ToolRig, fragment: string): number =>
  r.fake.calls.filter((call) => call.path.includes(fragment)).length;

const countOf = (r: ToolRig, msg: string): number =>
  r.logRecords().filter((record) => record.msg === msg).length;

const channelFailures = (r: ToolRig): number =>
  r.logRecords().filter((record) => record.msg === 'channel failed, reading the state through REST')
    .length;

/** Handles of the operations recorded in the state file. */
function operationHandles(r: ToolRig): string[] {
  let text: string;
  try {
    text = readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  } catch {
    return [];
  }
  return Object.keys((JSON.parse(text) as { opPayloads: Record<string, unknown> }).opPayloads);
}

describe('flows_suggest_journeys', () => {
  it('answers at once from the backend cache and opens no channel', async () => {
    const rg = await rig({ ...WORLD, cached: true });
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError, result.text).toBe(false);
    const { status, data } = structured(result);
    expect(status).toBe('done');
    expect(data.refined).toBe(true);
    expect(data.suggestions.map((s) => s.name)).toEqual([
      'zakupy',
      'przeglądanie',
      'konto',
      'status zamówienia',
    ]);
    expect(data.suggestions[0]?.steps).toEqual([
      'Log in and get a token',
      'Search products',
      'Add an item to the cart',
      'Place an order',
    ]);
    // The saved proposals carry what each step does, so a client can list them (the mod's Path tab).
    const saved = JSON.parse(
      readFileSync(join(rg.r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as {
      suggestions: Record<
        string,
        { value: { baskets: { name: string; step_labels?: string[] }[] } }
      >;
    };
    const [entry] = Object.values(saved.suggestions);
    expect(entry?.value.baskets[0]?.step_labels).toEqual([
      'Log in and get a token',
      'Search products',
      'Add an item to the cart',
      'Place an order',
    ]);
    expect(rg.handles.jobs).toEqual([]);
    expect(callsTo(rg.r, '/flow-suggestions/heuristic')).toBe(1);
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(1);
    expect(rg.r.logRecords().filter((record) => record.msg.includes('channel'))).toEqual([]);
    rg.r.assertClean();
  });

  it('opens the channel before the 45 s limit, reports progress and ends with the result of the complete frame', async () => {
    const rg = await rig();
    const { call, job, stub } = await startAndListen(rg);
    // Nothing has moved the clock yet: the listener came right after the POST.
    expect(rg.r.clock.now()).toBe(NOW);
    await rg.r.clock.advance(5000);
    await waitFor(() => stub.connections === 1, 'the channel to stay open');
    await rg.r.clock.advance(15_000);
    const result = await call;
    expect(result.isError, result.text).toBe(false);
    const { status, data } = structured(result);
    expect(status).toBe('done');
    expect(data.refined).toBe(true);
    expect(data.suggestions).toHaveLength(4);
    expect(stub.status).toBe('finished');
    expect(rg.handles.jobs).toEqual([job]);
    expect(
      result.progress.some((entry) => /4 of 10/.test(entry.message ?? '')),
      JSON.stringify(result.progress),
    ).toBe(true);
    // The finished operation is no longer listed as in progress.
    const state = JSON.parse(
      readFileSync(join(rg.r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(Object.keys(state.opPayloads)).toEqual([]);
    rg.r.assertClean();
  });

  it('survives a cut channel: it reconnects and the result is still right', async () => {
    const rg = await rig();
    const { call, stub } = await startAndListen(rg);
    await rg.r.clock.advance(6000);
    rg.r.fake.faults.dropChannel('refine');
    const result = await settle(rg.r, call);
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data.suggestions).toHaveLength(4);
    expect(stub.opened).toBeGreaterThanOrEqual(2);
    rg.r.assertClean();
  });

  it('reads the result through REST when the channel is lost for good and the job already ended', async () => {
    const rg = await rig({ ...WORLD, durationMs: 3000, progress: [] });
    const { call, stub } = await startAndListen(rg);
    rg.r.fake.faults.blockWebSocket();
    rg.r.fake.faults.dropChannel('refine');
    const result = await settle(rg.r, call);
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data.refined).toBe(true);
    expect(structured(result).data.suggestions).toHaveLength(4);
    expect(stub.status).toBe('finished');
    // The result came from the cache of the backend: a second POST without `force`.
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(2);
    rg.r.assertClean();
  });

  it('says WebSocket is unavailable and names refine: false when the channel cannot be opened', async () => {
    const rg = await rig();
    rg.r.fake.faults.blockWebSocket();
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('WebSocket');
    expect(result.text).toContain('refine: false');
    // No job was started a second time while the plugin looked for another way.
    expect(rg.handles.jobs).toHaveLength(1);
    // One start, then REST looked after each of the two tries to open the channel: 3 POSTs, 2 tries.
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(3);
    expect(channelFailures(rg.r)).toBe(2);
    expect(operationHandles(rg.r)).toEqual([`refine:${rg.handles.jobs[0] ?? ''}`]);
    rg.r.assertClean();
  });

  it('opens the channel a second time after a short break and finishes without an error', async () => {
    const holder: { rg?: Rig } = {};
    const rg = await rig({
      ...WORLD,
      // The POST that follows the first failed try is the moment the network comes back.
      onRefinePost: (count) => {
        if (count === 2) holder.rg?.r.fake.faults.allowWebSocket();
      },
    });
    holder.rg = rg;
    rg.r.fake.faults.blockWebSocket();
    const call = rg.r.call('flows_suggest_journeys', {});
    const result = await settle(rg.r, call);
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data.refined).toBe(true);
    expect(structured(result).data.suggestions).toHaveLength(4);
    expect(channelFailures(rg.r)).toBe(1);
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(2);
    expect(rg.handles.jobs).toHaveLength(1);
    expect(operationHandles(rg.r)).toEqual([]);
  });

  it('tries to reconnect for 30 s of the clock, not shorter and not much longer', async () => {
    const rg = await rig({ ...WORLD, durationMs: 300_000, progress: [] });
    const { call } = await startAndListen(rg);
    let settled = false;
    void call.then(
      () => (settled = true),
      () => (settled = true),
    );
    rg.r.fake.faults.blockWebSocket();
    rg.r.fake.faults.dropChannel('refine');
    const from = rg.r.clock.now();
    // The clock moves only when the plugin has registered its next wait (the log says so), never by
    // a step of real time: real I/O between two waits takes as long as the machine needs.
    const delaysMs = [500, 1500, 4000, 9000, 15_000];
    for (const [index, delayMs] of delaysMs.entries()) {
      await waitFor(() => countOf(rg.r, 'channel reconnect scheduled') === index + 1, 'a wait');
      const last = index === delaysMs.length - 1;
      await rg.r.clock.advance(last ? delayMs - 1 : delayMs);
      if (last) {
        // One millisecond short of the 30 s: the last try has not been made yet.
        await new Promise<void>((done) => setTimeout(done, 50));
        expect(settled).toBe(false);
        expect(countOf(rg.r, 'channel reconnect failed')).toBe(delaysMs.length - 1);
        await rg.r.clock.advance(1);
      } else {
        await waitFor(() => countOf(rg.r, 'channel reconnect failed') === index + 1, 'a failure');
      }
    }
    const result = await call;
    expect(result.isError).toBe(true);
    expect(result.text).toContain('refine: false');
    // The channel gave up right after the last delay: 30 s of the clock, no step more.
    expect(rg.r.clock.now() - from).toBe(30_000);
  });

  it('says the refinement was cancelled and drops the operation: a cancelled frame of the channel', async () => {
    const rg = await rig({ ...WORLD, cancelled: true });
    const result = await settle(rg.r, rg.r.call('flows_suggest_journeys', {}));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('cancelled the refinement');
    expect(result.text).toContain('flows_suggest_journeys again');
    expect(operationHandles(rg.r)).toEqual([]);
  });

  it('says the refinement expired, stops the job the repeated POST started, and drops the operation: a backend that forgot the job', async () => {
    const rg = await rig({ ...WORLD, forgetsJobs: true });
    rg.r.fake.faults.blockWebSocket();
    const result = await settle(rg.r, rg.r.call('flows_suggest_journeys', {}));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('expired');
    expect(result.text).toContain('flows_suggest_journeys again');
    expect(operationHandles(rg.r)).toEqual([]);
    // The job that the check started (a new one, nobody watches it) is stopped at once.
    expect(callsTo(rg.r, '/cancel')).toBe(1);
  });

  it('says the same in Polish', async () => {
    const rg = await rig({ ...WORLD, cancelled: true }, { locale: 'pl' });
    const result = await settle(rg.r, rg.r.call('flows_suggest_journeys', {}));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('anulował doprecyzowanie');
  });

  it('with refine: false returns the heuristic proposals and starts no job', async () => {
    const rg = await rig();
    const result = await rg.r.call('flows_suggest_journeys', { refine: false });
    expect(result.isError, result.text).toBe(false);
    const { data } = structured(result);
    expect(data.refined).toBe(false);
    expect(data.suggestions.map((s) => s.name)).toEqual(['cart and orders']);
    expect(data.suggestions[0]?.confidence).toBe(0.7);
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(0);
    expect(rg.handles.jobs).toEqual([]);
    expect(result.text).toContain('not refined');
  });

  it('turns a project without a specification into a hint about documentation or another way', async () => {
    const rg = await rig();
    const specs = rg.r.fake.store.collection(SKLEP_COLLECTIONS.specs);
    for (const spec of specs.list()) specs.delete(spec.id);
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no OpenAPI documentation');
    expect(result.text).toContain('→ ');
    expect(result.text).toContain('project_import_docs');
  });

  it.each([
    [true, 'again'],
    [false, 'refine: false'],
  ])('shows the error frame (recoverable %s) with the next step', async (recoverable, advice) => {
    const rg = await rig({
      ...WORLD,
      failure: { error: 'The model refused to answer', recoverable },
    });
    const { call } = await startAndListen(rg);
    const result = await settle(rg.r, call);
    expect(result.isError).toBe(true);
    // The text of the `error` frame is backend text: the model gets the code and the advice only.
    expect(result.text).toMatch(/^\[refine_failed\] /u);
    expect(result.text).not.toContain('The model refused to answer');
    expect(result.text).toContain(advice);
    if (!recoverable) expect(result.text).not.toContain('again');
    // The free proposals are kept for flows_generate_from_suggestions even though the refinement failed.
    const state = JSON.parse(
      readFileSync(join(rg.r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { suggestions: Record<string, { value: { baskets: { name: string }[] } }> };
    expect(state.suggestions[SKLEP_IDS.project]?.value.baskets.map((b) => b.name)).toEqual([
      'cart and orders',
    ]);
  });

  it('returns a handle when the wait ends first, and keeps the operation in the state file', async () => {
    const rg = await rig();
    const { call, job } = await startAndListen(rg, { max_wait_s: 10 });
    await rg.r.clock.advance(11_000);
    const result = await call;
    expect(result.isError, result.text).toBe(false);
    const body = structured(result);
    expect(body.status).toBe('running');
    expect(body.operation).toBe(`refine:${job}`);
    expect(result.text).toContain(`refine:${job}`);
    const state = JSON.parse(
      readFileSync(join(rg.r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(Object.keys(state.opPayloads)).toEqual([`refine:${job}`]);
    // The time limit reads nothing from the backend: the only refine POST is the one that started the job.
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(1);

    // Asked for again while the job runs, the call joins it: the same handle and no refine POST.
    const again = await settle(rg.r, rg.r.call('flows_suggest_journeys', { max_wait_s: 5 }), 6);
    expect(structured(again).operation).toBe(`refine:${job}`);
    expect(again.text).toContain(`refine:${job}`);
    expect(callsTo(rg.r, '/flow-suggestions/refine')).toBe(1);
  });

  it('does not cancel the job when the client aborts (Esc ends the wait only)', async () => {
    const rg = await rig();
    const abort = new AbortController();
    const call = rg.r.call('flows_suggest_journeys', {}, { signal: abort.signal });
    await waitFor(() => rg.handles.jobs.length === 1, 'the refine job to start');
    const stub = rg.r.fake.channel('refine', { job_id: rg.handles.jobs[0] ?? '' });
    await waitFor(() => stub.connections === 1, 'the channel to open');
    abort.abort();
    await rejection(call);
    expect(callsTo(rg.r, '/cancel')).toBe(0);
    await waitFor(() => stub.connections === 0, 'the channel to close');
    expect(stub.status).toBe('running');
  });

  it('keeps full baskets with endpoint UUIDs and the hash of the specification in the state file', async () => {
    const rg = await rig({ ...WORLD, cached: true });
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError, result.text).toBe(false);
    const state = JSON.parse(
      readFileSync(join(rg.r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as {
      suggestions: Record<
        string,
        {
          value: {
            specHash: string;
            baskets: {
              name: string;
              description: string;
              endpoint_ids: string[];
              pattern_type: string;
              tags: string[];
            }[];
          };
        }
      >;
    };
    const saved = state.suggestions[SKLEP_IDS.project]?.value;
    expect(saved?.specHash).toBe('a41f9c2e');
    expect(saved?.baskets.map((basket) => basket.name)).toEqual([
      'zakupy',
      'przeglądanie',
      'konto',
      'status zamówienia',
    ]);
    const first = saved?.baskets[0];
    expect(first?.endpoint_ids).toHaveLength(4);
    for (const id of first?.endpoint_ids ?? []) expect(id).toMatch(UUID);
    expect(first?.description).toContain('place the order');
    expect(first?.pattern_type).toBe('semantic');
    expect(first?.tags).toEqual(['sklep']);
    expect(saved?.baskets[3]?.pattern_type).toBe('async_polling');
  });

  it('numbers proposals that share a name', async () => {
    const twin = WORLD.refined[1];
    if (twin === undefined) throw new Error('no second basket');
    const rg = await rig({ ...WORLD, cached: true, refined: [...WORLD.refined, twin, twin] });
    const { data } = structured(await rg.r.call('flows_suggest_journeys', {}));
    expect(data.suggestions.map((s) => s.name)).toEqual([
      'zakupy',
      'przeglądanie',
      'konto',
      'status zamówienia',
      'przeglądanie (2)',
      'przeglądanie (3)',
    ]);
  });

  it('counts coverage, lists at most five uncovered operations and names failed units', async () => {
    const rg = await rig({ ...WORLD, cached: true, failedUnits: ['payments'] });
    const { data } = structured(await rg.r.call('flows_suggest_journeys', {}));
    expect(data.coverage.covered).toBe(8);
    expect(data.coverage.total).toBe(42);
    expect(data.coverage.uncovered).toHaveLength(5);
    expect(data.coverage.more).toBe(29);
    expect(data.failedUnits).toEqual(['payments']);
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const rg = await rig();
    rg.r.fake.faults.next('POST', '/api/v1/projects/{project_id}/flow-suggestions/heuristic', {
      status: 401,
      body: { detail: 'Invalid token' },
    });
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
  });

  it('refuses a backend without /meta as too old', async () => {
    const rg = await rig();
    rg.r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('names the project that does not exist', async () => {
    const rg = await rig();
    const result = await rg.r.call('flows_suggest_journeys', { project: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nope');
  });

  it('keeps the token out of the result and the log', async () => {
    const rg = await rig({ ...WORLD, cached: true });
    const result = await rg.r.call('flows_suggest_journeys', {});
    expect(JSON.stringify(result)).not.toContain(CANARY);
    rg.r.assertClean();
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('refined proposals (%s)', async (locale) => {
      const rg = await rig({ ...WORLD, cached: true }, { locale });
      const result = await rg.r.call('flows_suggest_journeys', {});
      await expect(result.text).toMatchFileSnapshot(
        `__snapshots__/suggestJourneys.refined.${locale}.txt`,
      );
    });

    it.each(['en', 'pl'] as const)('heuristic only (%s)', async (locale) => {
      const rg = await rig(WORLD, { locale });
      const result = await rg.r.call('flows_suggest_journeys', { refine: false });
      await expect(result.text).toMatchFileSnapshot(
        `__snapshots__/suggestJourneys.heuristic.${locale}.txt`,
      );
    });
  });
});

describe('flows_suggest_journeys view', () => {
  const data = JSON.parse(
    readFileSync(goldenUrl('run1/03-flows_suggest_journeys.view.json'), 'utf8'),
  ) as SuggestionsData;

  it('draws the pl golden text from the golden data', () => {
    const text = renderSuggestJourneys(data, createTranslator('pl'));
    expect(`${text}\n`).toBe(goldenText('run1', '03-flows_suggest_journeys'));
  });

  it('draws the same data in en as a snapshot', async () => {
    const text = renderSuggestJourneys(data, createTranslator('en'));
    await expect(`${text}\n`).toMatchFileSnapshot('__snapshots__/suggestJourneys.golden.en.txt');
  });

  it('wraps a long chain under the steps column and keeps every line within 77 columns', () => {
    const long: SuggestionsData = {
      ...data,
      suggestions: [
        {
          name: 'zakupy',
          steps: Array.from({ length: 9 }, (_, i) => `krok numer ${String(i + 1)}`),
          patternType: 'auth_rejection',
        },
        {
          name: 'a very long proposal name that cannot sit in a column',
          steps: ['a', 'b'],
          patternType: 'semantic',
        },
      ],
    };
    const text = renderSuggestJourneys(long, createTranslator('pl'));
    for (const line of text.split('\n')) expect([...line].length, line).toBeLessThanOrEqual(77);
    expect(text).toContain('oczekuje 401');
  });
});
