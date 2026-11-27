// `project_delete` and `flows_delete`: a level-3 consent card that names every item (name, id, for a
// flow its version and time) with the numbers of what goes with it, read from the contract; a repeat
// with the card's token deletes only after the person said yes to the question the client asks
// (an MCP elicitation, answered outside the arguments), never on the model's word, whatever the model
// sends; a running operation or test, or one that cannot be checked, refuses the deletion; deleting
// the bound project unbinds the repository; deleting flows takes them out of the process and recounts
// the warning of flows on an older docs version.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/log.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { flowsDelete } from '../src/tools/flowsDelete.js';
import { projectDelete } from '../src/tools/projectDelete.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore, type ProcessUpdateInput } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { refuseProjectDeletion, registerDeletionRoutes } from './fake-backend/routes/deletion.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerSpecMigrationRoutes } from './fake-backend/routes/specMigration.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepExecution,
} from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { settleClock } from './helpers/clock.js';
import type { Elicitor } from './helpers/mcp.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';
import { leakedPieces } from './helpers/canary.js';

const PROJECT = SKLEP_IDS.project;
const ZAKUPY = SKLEP_IDS.flowZakupy;
const DUPLICATE = '0f3c9a51-7d2e-4b84-a6c1-9e5d2b7f3a08';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writes = (calls: readonly FakeCall[]): string[] =>
  calls.filter((call) => WRITES.has(call.method)).map((call) => `${call.method} ${call.path}`);

/** The text with its wrapped lines joined. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ');

interface Count {
  n: number;
  more: boolean;
}

interface CardData {
  needsConfirmation: true;
  confirm: string;
  scope: string;
  kind: string;
  items: {
    id: string;
    name: string;
    version?: number;
    at?: string;
    counts?: Record<string, Count | null>;
  }[];
  stays?: { scenarios: Count | null; compositions: Count | null };
  bound?: string;
}

interface StateFile {
  bound_project_id?: string;
  process: Record<
    string,
    {
      ids: { flow_ids: string[] };
      problems: { code: string; flow_ids?: string[] }[];
      steps: Record<string, { checks: Record<string, { ok: boolean | null; by?: string }> }>;
      log: {
        tool: string;
        status: string;
        origin: string;
        args: string;
        result: string;
        consent?: { via: string };
        undo?: unknown;
      }[];
    }
  >;
}

function stateOf(r: ToolRig): StateFile {
  return JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as StateFile;
}

function world(fake: Fake): void {
  registerLookupRoutes(fake);
  registerFlowRoutes(fake);
  registerSpecMigrationRoutes(fake);
  registerDeletionRoutes(fake);
  seedSklep(fake.store, { stage: 'executed' });
}

/** The person behind the client: what they answer to the server's question, and what they read. */
interface Person {
  answer: 'yes' | 'unticked' | 'declined' | 'cancelled';
  readonly asked: string[];
  /** Happens while the question is on screen, before the person answers. */
  during?: () => Promise<void>;
}

function person(answer: Person['answer'] = 'yes'): Person {
  return { answer, asked: [] };
}

/** The client's answer to an elicitation, as the person gives it. */
const answering =
  (who: Person): Elicitor =>
  async ({ message }) => {
    who.asked.push(message);
    await who.during?.();
    switch (who.answer) {
      case 'yes':
        return { action: 'accept', content: { confirm: true } };
      case 'unticked':
        return { action: 'accept', content: { confirm: false } };
      case 'declined':
        return { action: 'decline' };
      case 'cancelled':
        return { action: 'cancel' };
    }
  };

/**
 * A rig with a client that asks `who` (none: a client that cannot ask anyone, like a run without a
 * person). The model's calls are the rig's calls: arguments only.
 */
async function rig(
  options: { locale?: 'en' | 'pl'; who?: Person; era?: 'current' | 'legacy' } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: [projectDelete, flowsDelete, processGetStatus],
    world,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
    ...(options.era === undefined ? {} : { era: options.era }),
    ...(options.who === undefined ? {} : { elicit: answering(options.who) }),
  });
}

const call = (r: ToolRig, tool: string, args: Record<string, unknown>): Promise<RigCallResult> =>
  settleClock(r, r.call(tool, args));

async function card(
  r: ToolRig,
  tool: 'project_delete' | 'flows_delete',
  args: Record<string, unknown>,
): Promise<CardData> {
  const result = await call(r, tool, args);
  expect(result.isError, result.text).toBe(false);
  const data = result.outcome?.data as CardData;
  expect(data.needsConfirmation).toBe(true);
  return data;
}

async function seedProcess(r: ToolRig, update: ProcessUpdateInput): Promise<void> {
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const store = createProcessStore(r.workspace, { secrets, clock: { now: () => r.clock.now() } });
  await store.applyUpdate(PROJECT, update, { tool: 'process_get_status' });
}

function addRunningTest(fake: Fake, scenarioOf?: string): void {
  const runs = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const [first] = runs.list();
  if (first === undefined) throw new Error('the world has no run');
  const scenario =
    scenarioOf === undefined
      ? undefined
      : fake.store
          .collection<{ id: string; source_flow_id: string }>(SKLEP_COLLECTIONS.scenarios)
          .list((row) => row.source_flow_id === scenarioOf)[0]?.id;
  runs.insert({
    ...first,
    ...(scenario === undefined ? {} : { scenario_id: scenario, composite_id: null }),
    id: '7e1d3c5a-2b4f-4a68-9c07-1d5e8f2a6b39',
    status: 'running' as 'completed',
    supervised: true,
    source: 'manual',
    created_at: '2026-11-26T09:00:00Z',
  });
}

function addDuplicateFlow(fake: Fake): void {
  const flows = fake.store.collection<{ id: string; current_version: number; updated_at: string }>(
    SKLEP_COLLECTIONS.flows,
  );
  const original = flows.require(ZAKUPY);
  flows.insert({
    ...original,
    id: DUPLICATE,
    current_version: 1,
    updated_at: '2026-11-25T08:30:00Z',
  });
}

describe('project_delete: the card names the project and counts what goes with it', () => {
  it('the first call is a card with the name, the id, the numbers and "cannot be undone"; nothing is sent', async () => {
    const who = person();
    const r = await rig({ who });
    const before = r.fake.calls.length;
    const data = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    const store = r.fake.store;
    const flows = store.collection(SKLEP_COLLECTIONS.flows).list().length;
    const scenarios = store.collection(SKLEP_COLLECTIONS.scenarios).list().length;
    const compositions = store.collection(SKLEP_COLLECTIONS.compositions).list().length;
    const specs = store.collection(SKLEP_COLLECTIONS.specs).list().length;
    const environments = store
      .collection<{ id: string; project_id: string }>(SKLEP_COLLECTIONS.environments)
      .list((env) => env.project_id === PROJECT).length;
    const runs = store.collection(SKLEP_COLLECTIONS.executions).list().length;

    expect(data.scope).toBe('project:delete');
    expect(data.items).toEqual([
      {
        id: PROJECT,
        name: 'sklep',
        counts: {
          flows: { n: flows, more: false },
          scenarios: { n: scenarios, more: false },
          compositions: { n: compositions, more: false },
          docs: { n: specs, more: false },
          environments: { n: environments, more: false },
          // the list of datasets carries their content: no cheap read, so no number
          datasets: null,
          runs: { n: runs, more: false },
        },
      },
    ]);
    expect(data.bound).toBe('sklep');
    const text = flat(result(r).text);
    expect(text).toContain(`"sklep" (id ${PROJECT})`);
    expect(text).toContain(`flows ${String(flows)} · scenarios ${String(scenarios)}`);
    expect(text).toContain('datasets unknown');
    expect(text).toContain('cannot be undone');
    expect(text).toContain(`confirm: "${data.confirm}"`);
    expect(text).toContain('a dialog of its own');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    // the card asks nobody: the person is asked on the repeat with its token
    expect(who.asked).toEqual([]);
  });

  it('writes the card in Polish for a Polish user', async () => {
    const r = await rig({ locale: 'pl' });
    await card(r, 'project_delete', { kind: 'project', names: ['sklep'] });
    const text = flat(result(r).text);
    expect(text).toContain('bez cofnięcia');
    expect(text).toContain('zbiory danych nieznane');
  });

  it('refuses a kind it does not delete yet, and sends nothing', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    const refused = await call(r, 'project_delete', { kind: 'env', ids: [PROJECT] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^\[delete_kind_unsupported\] /u);
    expect(r.fake.calls.slice(before)).toEqual([]);
  });

  it('masks a credential in the names it lists when a name matches nothing (FIX-74)', async () => {
    const r = await rig();
    const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZWxldGUifQ.c2VudGluZWwtZGVsZXRlLXNpZw';
    r.fake.store
      .collection(SKLEP_COLLECTIONS.projects)
      .update(PROJECT, { name: `sklep ${secret}` });
    r.fake.store.collection(SKLEP_COLLECTIONS.flows).update(ZAKUPY, { name: `zakupy ${secret}` });
    const project = await call(r, 'project_delete', { kind: 'project', names: ['nie-ma'] });
    const flow = await call(r, 'flows_delete', { kind: 'flow', names: ['nie-ma'] });
    for (const result of [project, flow]) {
      expect(result.text).toMatch(/^\[not_found\] /u);
      expect(leakedPieces(result.text, [secret])).toEqual([]);
    }
    expect(project.text).toContain('sklep');
    expect(flow.text).toContain('zakupy');
  });

  it('names at most five projects per card, so the question lists each one', async () => {
    const r = await rig();
    const ids = Array.from(
      { length: 6 },
      (_, i) => `0000000${String(i)}-0000-4000-8000-000000000000`,
    );
    for (const id of ids) {
      r.fake.store.collection(SKLEP_COLLECTIONS.projects).insert({
        ...r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).require(PROJECT),
        id,
      });
    }
    const refused = await call(r, 'project_delete', { kind: 'project', ids });
    expect(refused.text).toMatch(/^\[invalid\] .*at most 5 projects/su);
  });
});

describe('only the person deletes: the model cannot, whatever it sends', () => {
  it('both tools are marked for Claude Code to ask the user before every call', async () => {
    const r = await rig();
    const listed = await r.session.listTools();
    for (const name of ['project_delete', 'flows_delete']) {
      expect(listed.find((tool) => tool.name === name)?.meta, name).toMatchObject({
        'anthropic/requiresUserInteraction': true,
      });
    }
  });

  const ADVERSARY: readonly {
    tool: 'project_delete' | 'flows_delete';
    target: Record<string, unknown>;
    exists: (r: ToolRig) => boolean;
  }[] = [
    {
      tool: 'project_delete',
      target: { kind: 'project', ids: [PROJECT] },
      exists: (r) => r.fake.store.collection(SKLEP_COLLECTIONS.projects).get(PROJECT) !== undefined,
    },
    {
      tool: 'flows_delete',
      target: { kind: 'flow', flow_ids: [ZAKUPY] },
      exists: (r) => r.fake.store.collection(SKLEP_COLLECTIONS.flows).get(ZAKUPY) !== undefined,
    },
  ];

  /** What a model may send in place of the person's yes, with the token of the card. */
  const forged = (target: Record<string, unknown>, confirm: string): Record<string, unknown>[] => [
    { ...target, confirm },
    { ...target, confirm, from_panel: true },
    { kind: target['kind'], confirm, from_panel: true },
    { ...target, confirm, approved: true },
    {
      ...target,
      confirm,
      inputResponses: { delete: { action: 'accept', content: { confirm: true } } },
    },
    { ...target, confirm: `${confirm} ` },
    { ...target, confirm: 'ffffffffffffffff' },
  ];

  async function textOf(r: ToolRig, tool: string, args: Record<string, unknown>): Promise<string> {
    try {
      return (await call(r, tool, args)).text;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  it.each(ADVERSARY)(
    '$tool: a client that cannot ask anyone gets no deletion for any arguments the model may send',
    async ({ tool, target, exists }) => {
      const r = await rig();
      const { confirm } = await card(r, tool, target);
      const before = r.fake.calls.length;
      for (const args of forged(target, confirm)) {
        expect(await textOf(r, tool, args), JSON.stringify(args)).not.toContain('deleted for good');
      }
      expect(writes(r.fake.calls.slice(before))).toEqual([]);
      expect(exists(r)).toBe(true);
      expect(existsSync(join(r.workspace, 'loadcraft', 'project.json'))).toBe(true);
    },
  );

  it.each(ADVERSARY)(
    '$tool: with a client that asks and a person who declines, extra arguments of the model change nothing',
    async ({ tool, target, exists }) => {
      const who = person('declined');
      const r = await rig({ who });
      const { confirm } = await card(r, tool, target);
      const before = r.fake.calls.length;
      for (const args of forged(target, confirm)) {
        expect(await textOf(r, tool, args), JSON.stringify(args)).not.toContain('deleted for good');
      }
      expect(writes(r.fake.calls.slice(before))).toEqual([]);
      expect(exists(r)).toBe(true);
      // only the calls with the card's own arguments (the token with a space trims to it) got as far
      // as the question; every other one was refused before it
      expect(who.asked).toHaveLength(2);
    },
  );

  it.each(['current', 'legacy'] as const)(
    '%s protocol: a client that cannot ask anyone gets consent_missing with the link to the app',
    async (era) => {
      const r = await rig({ era });
      const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
      const before = r.fake.calls.length;
      const refused = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
      expect(refused.isError).toBe(true);
      expect(refused.text).toMatch(/^\[consent_missing\] /u);
      expect(refused.text).toContain('https://app.loadcraft.io/projects');
      expect(writes(r.fake.calls.slice(before))).toEqual([]);
    },
  );

  it('the card, then the model repeating the call with its token, three times: nothing is deleted', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    const { confirm } = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY] });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm }).catch(
        () => undefined,
      );
    }
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s deletes nothing, and the model reads consent_missing',
    async (answer) => {
      const who = person(answer);
      const r = await rig({ who });
      const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
      const before = r.fake.calls.length;
      const refused = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
      expect(who.asked).toHaveLength(1);
      expect(refused.isError).toBe(true);
      expect(refused.text).toMatch(/^\[consent_missing\] /u);
      expect(refused.text).toContain('https://app.loadcraft.io/projects');
      expect(writes(r.fake.calls.slice(before))).toEqual([]);
    },
  );

  it('a card replaced while the question is on screen: the yes deletes nothing', async () => {
    const who = person('yes');
    const r = await rig({ who });
    const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    who.during = async () => {
      // another session makes a new card of the same scope: the token on screen is no longer valid
      await call(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    };
    const before = r.fake.calls.length;
    const answer = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
    expect(who.asked).toHaveLength(1);
    expect(answer.isError, answer.text).toBe(false);
    expect((answer.outcome?.data as CardData).needsConfirmation).toBe(true);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(r.fake.store.collection(SKLEP_COLLECTIONS.projects).get(PROJECT)).toBeDefined();
  });

  it('a test that starts while the question is on screen: the yes deletes nothing', async () => {
    const who = person('yes');
    const r = await rig({ who });
    const { confirm } = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY] });
    who.during = async () => {
      // a test of a scenario built on this flow
      addRunningTest(r.fake, ZAKUPY);
      await Promise.resolve();
    };
    const before = r.fake.calls.length;
    const refused = await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm });
    expect(who.asked).toHaveLength(1);
    expect(refused.text).toMatch(/^\[delete_busy\] /u);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('every call with the token asks again: an earlier yes never stands for a later call', async () => {
    const who = person('unticked');
    const r = await rig({ who });
    const { confirm } = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY] });
    await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm });
    await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm });
    expect(who.asked).toHaveLength(2);
  });

  it('the question names each project, its id, what goes with it and that it cannot be undone', async () => {
    const who = person('declined');
    const r = await rig({ who });
    const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
    const [question] = who.asked;
    expect(question).toContain('this cannot be undone: 1 LoadCraft project');
    expect(question).toContain(`"sklep" (id ${PROJECT})`);
    expect(question).toMatch(/flows 3 · scenarios \d+ · compositions \d+ · docs versions \d+/u);
    expect(question).toContain('datasets unknown');
    expect(question).toContain('this repository is bound to "sklep"');
  });

  it('a name cannot pose as facts in the question: its quotation marks become apostrophes', async () => {
    const who = person('declined');
    const r = await rig({ who });
    r.fake.store
      .collection(SKLEP_COLLECTIONS.flows)
      .update(ZAKUPY, { name: 'zakupy" (id 0000), with flows 0\n- "other' });
    const { confirm } = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY] });
    await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm });
    const [question] = who.asked;
    expect(question).toContain(`"zakupy' (id 0000), with flows 0 - 'other" (id ${ZAKUPY}, v`);
    expect(question?.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
  });
});

describe('with the yes of the person: deleted, and the repository unbound', () => {
  it.each(['current', 'legacy'] as const)(
    '%s protocol: deletes the bound project, removes the binding and its process, logs no undo',
    async (era) => {
      const who = person('yes');
      const r = await rig({ who, era });
      const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
      expect(stateOf(r).process[PROJECT]).toBeDefined();
      const before = r.fake.calls.length;
      const done = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
      expect(done.isError, done.text).toBe(false);
      expect(who.asked).toHaveLength(1);

      expect(writes(r.fake.calls.slice(before))).toEqual(['POST /api/v1/projects/batch-delete']);
      expect(r.fake.store.collection(SKLEP_COLLECTIONS.projects).get(PROJECT)).toBeUndefined();
      expect(existsSync(join(r.workspace, 'loadcraft', 'project.json'))).toBe(false);
      const state = stateOf(r);
      expect(state.process[PROJECT]).toBeUndefined();
      expect(state.bound_project_id).toBeUndefined();
      const text = flat(done.text);
      expect(text).toContain('1 project deleted for good');
      expect(text).toContain('cannot be undone');
      expect(text).toContain('no longer bound');

      const entries = state.process[NEW_KEY]?.log.filter((item) => item.tool === 'project_delete');
      // the card's entry went with the process of the project; the round that asked the person is
      // no call of its own and leaves no entry
      expect(entries?.map((item) => item.result)).toEqual(['1 project deleted']);
      const entry = entries?.[0];
      expect(entry).toMatchObject({ status: 'ok', args: 'Delete project: sklep' });
      expect(entry?.undo).toBeUndefined();
      // the token served once
      const again = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
      expect(again.isError).toBe(true);
    },
  );

  it('a deletion whose unbinding fails is still reported as done, and says what to do', async () => {
    const who = person('yes');
    const r = await rig({ who });
    const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    // the binding becomes a folder: the file cannot be removed
    rmSync(join(r.workspace, 'loadcraft', 'project.json'));
    mkdirSync(join(r.workspace, 'loadcraft', 'project.json', 'x'), { recursive: true });
    writeFileSync(
      join(r.workspace, 'loadcraft', 'project.json', 'x', 'y'),
      'a folder in place of the binding',
    );
    const done = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
    expect(done.isError, done.text).toBe(false);
    expect(r.fake.store.collection(SKLEP_COLLECTIONS.projects).get(PROJECT)).toBeUndefined();
    expect(flat(done.text)).toContain('1 project deleted for good');
  });

  it('deletes flows, takes them out of the process and recounts the old-docs warning', async () => {
    const who = person('yes');
    const r = await rig({ who });
    await seedProcess(r, {
      add: { flow_ids: [ZAKUPY, SKLEP_WORLD_IDS.flowPrzegladanie] },
      checks: { scenario: { generated: { ok: true } } },
      problems: {
        open: [
          {
            module: 'flows',
            tool: 'process_get_status',
            code: 'flows_on_old_docs',
            severity: 'warning',
            message: 'two flows are pinned to an older docs version',
            flow_ids: [ZAKUPY, SKLEP_WORLD_IDS.flowPrzegladanie],
          },
        ],
      },
    });
    const data = await card(r, 'flows_delete', { kind: 'flow', names: ['zakupy'] });
    expect(data.items.map((item) => [item.id, item.name, typeof item.version])).toEqual([
      [ZAKUPY, 'zakupy', 'number'],
    ]);
    expect(data.stays?.scenarios?.n).toBeGreaterThan(0);
    const before = r.fake.calls.length;
    const done = await call(r, 'flows_delete', {
      kind: 'flow',
      names: ['zakupy'],
      confirm: data.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    // the question shows the version and the time the flow was saved
    expect(who.asked[0]).toMatch(
      new RegExp(
        `"zakupy" \\(id ${ZAKUPY}, v\\d+, updated \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}\\)`,
        'u',
      ),
    );
    expect(who.asked[0]).toMatch(/stay, pointing at a deleted flow: scenarios \d+/u);
    expect(writes(r.fake.calls.slice(before))).toEqual([
      `POST /api/v1/projects/${PROJECT}/flows/batch-delete`,
    ]);
    const process = stateOf(r).process[PROJECT];
    expect(process?.ids.flow_ids).toEqual([SKLEP_WORLD_IDS.flowPrzegladanie]);
    expect(process?.problems.find((p) => p.code === 'flows_on_old_docs')?.flow_ids).toEqual([
      SKLEP_WORLD_IDS.flowPrzegladanie,
    ]);
    expect(process?.steps['scenario']?.checks['generated']).toMatchObject({
      ok: null,
      by: 'invalidated:flows_delete',
    });
    expect(flat(done.text)).toContain('1 flow of project "sklep" deleted for good');
  });
});

describe('a running operation, or one that cannot be checked, refuses the deletion', () => {
  it('names the operation of this workspace that still runs on the project', async () => {
    const r = await rig({ who: person('yes') });
    await seedProcess(r, {
      operations: [
        {
          handle: `scenario_generation:${SKLEP_IDS.setupAnalysis}`,
          kind: 'scenario_generation',
          module: 'scenario',
          tool: 'scenario_generate',
          label: 'checkout',
          status: 'running',
          started_at: '2026-11-26T09:00:00.000Z',
          updated_at: '2026-11-26T09:00:00.000Z',
        },
      ],
    });
    const before = r.fake.calls.length;
    for (const [tool, args] of [
      ['project_delete', { kind: 'project', ids: [PROJECT] }],
      ['flows_delete', { kind: 'flow', flow_ids: [ZAKUPY] }],
    ] as const) {
      const refused = await call(r, tool, args);
      expect(refused.isError).toBe(true);
      expect(refused.text).toMatch(/^\[delete_busy\] /u);
      expect(refused.text).toContain('scenario_generation "checkout"');
    }
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('names a test of the project that LoadCraft is running', async () => {
    const r = await rig();
    addRunningTest(r.fake);
    const refused = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    expect(refused.text).toMatch(/^\[delete_busy\] /u);
    expect(refused.text).toContain('test e-7e1d3c5a (running)');
  });

  it('a test that starts after the card stops the deletion before the person is asked', async () => {
    const who = person('yes');
    const r = await rig({ who });
    const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    addRunningTest(r.fake);
    const before = r.fake.calls.length;
    const refused = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
    expect(refused.text).toMatch(/^\[delete_busy\] /u);
    expect(who.asked).toEqual([]);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('a list of runs that cannot be read shows on the card and refuses the deletion', async () => {
    const who = person('yes');
    const r = await rig({ who });
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/gatling/executions',
      {
        status: 500,
        body: 'down',
      },
      { outsideContract: true },
    );
    const data = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    expect(flat(result(r).text)).toContain('could not be checked: the deletion is refused');
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/gatling/executions',
      {
        status: 500,
        body: 'down',
      },
      { outsideContract: true },
    );
    const before = r.fake.calls.length;
    const refused = await call(r, 'project_delete', {
      kind: 'project',
      ids: [PROJECT],
      confirm: data.confirm,
    });
    expect(refused.text).toMatch(/^\[delete_unchecked\] /u);
    expect(who.asked).toEqual([]);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('reads the refusal of the backend for a browser walk that still works', async () => {
    const r = await rig({ who: person('yes') });
    const { confirm } = await card(r, 'project_delete', { kind: 'project', ids: [PROJECT] });
    refuseProjectDeletion(r.fake);
    const refused = await call(r, 'project_delete', { kind: 'project', ids: [PROJECT], confirm });
    expect(refused.text).toMatch(/^\[run_not_finished\] Nothing was deleted/u);
    expect(existsSync(join(r.workspace, 'loadcraft', 'project.json'))).toBe(true);
  });
});

describe('flows of one name: each with its id, version and time, to pick from', () => {
  it('a name of two flows gets no card but both flows with their ids; the card by ids lists each', async () => {
    const r = await rig();
    addDuplicateFlow(r.fake);
    const choice = await call(r, 'flows_delete', { kind: 'flow', names: ['zakupy'] });
    expect(choice.isError, choice.text).toBe(false);
    const data = choice.outcome?.data as {
      choice: true;
      ambiguous: { name: string; matches: { id: string; version: number }[] }[];
      confirm?: string;
    };
    expect(data.confirm).toBeUndefined();
    expect(data.ambiguous[0]?.matches.map((item) => item.id).sort()).toEqual(
      [ZAKUPY, DUPLICATE].sort(),
    );
    const text = flat(choice.text);
    expect(text).toContain(`(id ${DUPLICATE}, v1, updated 2026-11-25 08:30)`);
    expect(text).toContain(`(id ${ZAKUPY}, v`);
    expect(text).toContain('no card');

    const picked = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [DUPLICATE] });
    expect(picked.items).toEqual([
      { id: DUPLICATE, name: 'zakupy', version: 1, at: '2026-11-25T08:30:00Z' },
    ]);
    expect(flat(result(r).text)).toContain(
      `"zakupy" (id ${DUPLICATE}, v1, updated 2026-11-25 08:30)`,
    );
  });

  it('a project with more flows than one list shows takes no names: a duplicate could hide', async () => {
    const r = await rig();
    const flows = r.fake.store.collection<{ id: string; name: string; updated_at: string }>(
      SKLEP_COLLECTIONS.flows,
    );
    const original = flows.require(ZAKUPY);
    for (let i = 0; i < 100; i += 1) {
      flows.insert({
        ...original,
        id: `1a2b3c4d-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `other ${String(i)}`,
        updated_at: '2026-11-26T08:30:00Z',
      });
    }
    const refused = await call(r, 'flows_delete', { kind: 'flow', names: ['zakupy'] });
    expect(refused.text).toMatch(/^\[invalid\] .*name the flows by flow_ids/su);
  });

  it('the repeat must name the same flows as the card', async () => {
    const who = person('yes');
    const r = await rig({ who });
    addDuplicateFlow(r.fake);
    const { confirm } = await card(r, 'flows_delete', { kind: 'flow', flow_ids: [DUPLICATE] });
    const before = r.fake.calls.length;
    const other = await call(r, 'flows_delete', { kind: 'flow', flow_ids: [ZAKUPY], confirm });
    expect(other.isError, other.text).toBe(false);
    expect((other.outcome?.data as CardData).items.map((item) => item.id)).toEqual([ZAKUPY]);
    expect(flat(other.text)).toContain('names other items than the card');
    expect(who.asked).toEqual([]);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });
});

/** The last result of the rig. */
function result(r: ToolRig): RigCallResult {
  const last = r.results[r.results.length - 1];
  if (last === undefined) throw new Error('no call yet');
  return last;
}
