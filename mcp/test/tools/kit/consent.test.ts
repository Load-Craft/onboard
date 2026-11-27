// The consent card of module tools (src/tools/kit/consent.ts, docs/consent-card.md), through the
// whole server: two toy tools on real catalog entries (a level-2 write that renames the project, a
// level-3 deletion that sends one DELETE), the fake backend over HTTP, and a client whose person
// answers the server's question. What is compared is what reached the backend and the state file,
// not only the text: a card writes nothing, only the person's yes to exactly that card runs the
// tool, once, and nothing the model sends can stand in for that yes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { DATA_UPDATE_DATASET } from '../../../src/tools/data/meta.generated.js';
import { exposedTools, moduleTool, type ConsentMeta } from '../../../src/tools/moduleTool.js';
import { getProject, updateProject } from '../../../src/tools/project/update.js';
import { SCENARIO_DELETE } from '../../../src/tools/scenario/meta.generated.js';
import { TRAFFIC_CREATE_TOKEN } from '../../../src/tools/traffic/meta.generated.js';
import { FLOWS_MIGRATE_DOCS } from '../../../src/tools/flows/meta.generated.js';
import { RUN_START } from '../../../src/tools/run/meta.generated.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  thirdParty,
} from '../../../src/tools/kit/transitional.js';
import { asksOnACard } from '../../../src/tools/kit/consent.js';
import { CARD_TTL_MINUTES } from '../../../src/consent/confirmCard.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import type { Elicitor } from '../../helpers/mcp.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';

const PROJECT = SKLEP_IDS.project;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

interface RenameFacts {
  readonly name: string;
  readonly to: string;
  readonly rows?: string;
}

/** A level-2 write on a card: it renames the project (the entry is `data_update_dataset`'s). */
const rename = moduleTool(DATA_UPDATE_DATASET, {
  title: 'Rename (a toy on a card)',
  input: {
    name: z.string().min(1).max(255),
    file: z.string().min(1).max(260).optional(),
  },
  async card(ctx, args) {
    const project = await getProject(ctx, { project_id: projectIdOf(ctx, undefined) });
    if (project.name === args.name) return { unchanged: { name: args.name, changed: false } };
    const facts: RenameFacts = {
      name: thirdParty(ctx, project.name, LIMITS.name),
      to: thirdParty(ctx, args.name, LIMITS.name),
      ...(args.file === undefined ? {} : { rows: thirdParty(ctx, args.file, LIMITS.name) }),
    };
    // a file of rows may hold secrets: the escalation of the catalog entry
    return args.file === undefined ? { facts } : { facts, escalation: 'secret_ref' };
  },
  cardView: (facts, t) => ({
    title: `Rename "${facts.name}"`,
    lines: [
      `new name: "${facts.to}"`,
      ...(facts.rows === undefined ? [] : [`rows from: ${facts.rows}`]),
    ],
    cost: t.locale === 'pl' ? 'jedno wysłanie' : 'one upload',
    undo:
      t.locale === 'pl'
        ? 'to samo narzędzie z poprzednią nazwą'
        : 'the same tool with the previous name',
  }),
  async run(ctx, args, facts) {
    const path = { project_id: projectIdOf(ctx, undefined) };
    await updateProject(ctx, path, { name: args.name });
    return {
      status: 'done',
      data: { name: args.name, changed: true },
      update: { log: { values: { name: facts.to }, undo_args: { name: facts.name } } },
    };
  },
  render: (data) => (data.changed ? `renamed to "${data.name}"` : `already "${data.name}"`),
});

/** A level-3 deletion on a card: one DELETE of a flow (the entry is `scenario_delete`'s). */
const remove = moduleTool(SCENARIO_DELETE, {
  title: 'Delete (a toy on a card)',
  input: { flow_id: z.string().min(1).max(64) },
  card: (_ctx, args) => Promise.resolve({ facts: { kind: 'scenario', names: args.flow_id } }),
  cardView: (facts) => ({
    title: `Delete ${facts.kind} ${facts.names}`,
    lines: [],
    undo: 'permanent',
  }),
  async run(ctx, args, facts) {
    await callBackend(ctx, 'delete_flow_api_v1_projects__project_id__flows__flow_id__delete', {
      path: { project_id: projectIdOf(ctx, undefined), flow_id: args.flow_id },
    });
    return {
      status: 'done',
      data: { count: 1, kind: facts.kind },
      update: { log: { values: { names: facts.names } } },
    };
  },
  render: (data) => `${String(data.count)} ${data.kind} deleted`,
});

/** A tool whose `card` tries to write: the block refuses the request before it is sent. */
const eager = moduleTool(SCENARIO_DELETE, {
  title: 'Writes in its card (a toy)',
  input: {},
  async card(ctx) {
    await updateProject(ctx, { project_id: projectIdOf(ctx, undefined) }, { name: 'too early' });
    return { facts: { kind: 'scenario', names: 'x' } };
  },
  cardView: () => ({ title: 'never shown', lines: [], undo: 'never' }),
  run: () => Promise.resolve({ status: 'done' as const, data: { count: 0, kind: 'scenario' } }),
  render: () => 'never',
});

/** A tool whose card leaves out the cost its catalog entry names. */
const silent = moduleTool(DATA_UPDATE_DATASET, {
  title: 'No cost on its card (a toy)',
  input: {},
  card: () => Promise.resolve({ facts: { name: 'x' } }),
  cardView: () => ({ title: 'x', lines: [], undo: 'x' }),
  run: () => Promise.resolve({ status: 'done' as const, data: { name: 'x' } }),
  render: () => 'never',
});

/** The person behind the client: what they answer, what they were asked. */
interface Person {
  answer: 'yes' | 'unticked' | 'declined' | 'cancelled';
  readonly asked: string[];
  /** Happens while the question is on the screen. */
  during?: () => void;
}

const person = (answer: Person['answer'] = 'yes'): Person => ({ answer, asked: [] });

const answering =
  (who: Person): Elicitor =>
  ({ message }) => {
    who.asked.push(message);
    who.during?.();
    if (who.answer === 'declined') return { action: 'decline' };
    if (who.answer === 'cancelled') return { action: 'cancel' };
    return { action: 'accept', content: { confirm: who.answer === 'yes' } };
  };

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly tools?: Parameters<typeof toolRig>[0]['tools'];
  readonly seed?: (fake: Fake) => void;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: options.tools ?? [rename, remove],
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writes = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => WRITES.has(call.method))
    .map((call) => `${call.method} ${call.path.replace(`/api/v1/projects/${PROJECT}`, '~')}`);

const projectName = (r: ToolRig): string | undefined =>
  r.fake.store.collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects).get(PROJECT)
    ?.name;

const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;

interface KeptCard {
  readonly token: string;
  readonly issuedAt: number;
  readonly frozen: Record<string, unknown>;
}

/** The card the state file keeps for `tool`, or undefined. */
function keptCard(r: ToolRig, tool: string): KeptCard | undefined {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as {
    drafts?: Record<string, { value: { cards: KeptCard[] } }>;
  };
  // the newest of the cards of the scope (several are kept at once: DOKTOR-12)
  return state.drafts?.[`card:${tool}:${PROJECT}`]?.value.cards.at(-1);
}

const CARD = [
  'Consent needed (level 2) · Rename "sklep"',
  '  new name: "shop"',
  'Cost: one upload',
  'Can be undone: the same tool with the previous name',
  'Nothing was done yet. Tell the user what this card says. To go on, call data_update_dataset again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
].join('\n');

describe('consent card: the first call', () => {
  it('makes the card and does nothing: no write, the person is not asked, the log entry waits', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call('data_update_dataset', { name: 'shop' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(CARD);
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(projectName(r)).toBe('sklep');
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: 'data_update_dataset',
      status: 'queued',
      args: 'Update dataset sklep',
      result: "awaiting the user's decision",
    });
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('keeps two hashes and a token in the state file: no argument, no fact, and the token never reaches the model', async () => {
    const r = await rig();
    const result = await r.call('data_update_dataset', { name: 'shop' });
    const card = keptCard(r, 'data_update_dataset');
    expect(card?.frozen).toEqual({
      args: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
      facts: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
    });
    expect(JSON.stringify(card)).not.toContain('shop');
    expect(JSON.stringify(card)).not.toContain('sklep');
    expect(result.text).not.toContain(card?.token ?? 'no card');
  });

  it('prints the data as it is under format data', async () => {
    const r = await rig();
    const result = await r.call('data_update_dataset', { name: 'shop', format: 'data' });
    expect(JSON.parse(result.text)).toEqual({
      consent: 'needed',
      tool: 'data_update_dataset',
      level: 2,
      card: { name: 'sklep', to: 'shop' },
      costly: true,
      reversible: 'yes',
      why: null,
      valid_minutes: CARD_TTL_MINUTES,
    });
    expect(writes(r)).toEqual([]);
  });

  it('answers in Polish with every line of the block', async () => {
    const r = await rig({ locale: 'pl' });
    expect((await r.call('data_update_dataset', { name: 'shop' })).text).toBe(
      [
        'Potrzebna zgoda (poziom 2) · Rename "sklep"',
        '  new name: "shop"',
        'Koszt: jedno wysłanie',
        'Da się cofnąć: to samo narzędzie z poprzednią nazwą',
        'Nic jeszcze nie zrobiono. Powiedz użytkownikowi, co jest na tej karcie. Żeby iść dalej, wywołaj data_update_dataset jeszcze raz z tymi samymi argumentami: użytkownik dostanie wtedy okno z prośbą o potwierdzenie i dopiero jego „tak” w tym oknie uruchomi wywołanie. Karta jest ważna 30 min.',
      ].join('\n'),
    );
  });

  it('a level-3 card names its level and why it is asked on its own; an escalation makes a level-2 tool ask the same way', async () => {
    const r = await rig();
    const deletion = await r.call('scenario_delete', { flow_id: SKLEP_IDS.flowZakupy });
    expect(deletion.text.split('\n').slice(0, 3)).toEqual([
      `Consent needed (level 3) · Delete scenario ${SKLEP_IDS.flowZakupy}`,
      'Cannot be undone: permanent',
      'Asked on its own: it deletes for good.',
    ]);
    const escalated = await r.call('data_update_dataset', { name: 'shop', file: 'rows.csv' });
    expect(escalated.text).toContain('Consent needed (level 3) · Rename "sklep"');
    expect(escalated.text).toContain(
      'Asked on its own: the call names a file that may hold secrets. LoadCraft reads it; its values are never shown.',
    );
    expect(writes(r)).toEqual([]);
  });

  it('values already as given need no card: the tool answers at once, nothing is asked or sent', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call('data_update_dataset', { name: 'sklep' });
    expect(result.text).toBe('already "sklep"');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
    expect(keptCard(r, 'data_update_dataset')).toBeUndefined();
  });

  it('a client that cannot ask anyone gets consent_missing at once, with the link to the app, and no card', async () => {
    const r = await rig({ who: null });
    for (let call = 0; call < 3; call += 1) {
      const refused = await r.call('data_update_dataset', { name: 'shop' });
      expect(code(refused)).toBe('consent_missing');
      expect(refused.text).toContain('https://app.loadcraft.io');
    }
    expect(writes(r)).toEqual([]);
    expect(keptCard(r, 'data_update_dataset')).toBeUndefined();
  });
});

describe('consent card: the decision', () => {
  it("the person's yes runs the tool once: one write, the entry names the dialog and carries the undo", async () => {
    const who = person();
    const r = await rig({ who });
    await r.call('data_update_dataset', { name: 'shop' });
    const done = await r.call('data_update_dataset', { name: 'shop' });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe('renamed to "shop"');
    expect(who.asked).toEqual([
      [
        'Rename "sklep"',
        'new name: "shop"',
        'Cost: one upload',
        'Can be undone: the same tool with the previous name',
        'Tick the box to confirm. Anything else changes nothing.',
      ].join('\n'),
    ]);
    expect(writes(r)).toEqual(['PUT ~']);
    expect(projectName(r)).toBe('shop');
    const entry = loggedCalls(r).at(-1) as ReturnType<typeof loggedCalls>[number] & {
      consent?: { via: string };
    };
    expect(entry).toMatchObject({
      tool: 'data_update_dataset',
      status: 'ok',
      result: 'dataset shop updated',
      consent: { via: 'client_dialog' },
      undo: { tool: 'data_restore_dataset', args: { name: 'sklep' } },
    });
    // the card is used: the same call again is a new card, not a second write
    expect(keptCard(r, 'data_update_dataset')).toBeUndefined();
    const again = await r.call('data_update_dataset', { name: 'shop' });
    expect(again.text).toBe('already "shop"');
    expect(writes(r)).toEqual(['PUT ~']);
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const who = person(answer);
      const r = await rig({ who });
      await r.call('data_update_dataset', { name: 'shop' });
      const refused = await r.call('data_update_dataset', { name: 'shop' });
      expect(code(refused)).toBe('consent_missing');
      expect(who.asked).toHaveLength(1);
      expect(writes(r)).toEqual([]);
      expect(projectName(r)).toBe('sklep');
      expect(keptCard(r, 'data_update_dataset')).toBeUndefined();
      // the next call starts from a card again; the person is not asked a second time by it
      const next = await r.call('data_update_dataset', { name: 'shop' });
      expect(next.text).toBe(CARD);
      expect(who.asked).toHaveLength(1);
    },
  );

  it('a card is bound to its arguments: other arguments get a card of their own, and the yes belongs to the card asked about', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call('data_update_dataset', { name: 'shop' });
    const other = await r.call('data_update_dataset', { name: 'store' });
    expect(other.text).toContain('new name: "store"');
    expect(other.text).toContain(
      'The arguments or the facts differ from the earlier card: this is a new one.',
    );
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
    // the card of "shop" stays next to the one of "store" (DOKTOR-12): its repeat asks about "shop"
    const done = await r.call('data_update_dataset', { name: 'shop' });
    expect(done.text).toBe('renamed to "shop"');
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain('new name: "shop"');
    expect(who.asked[0]).not.toContain('"store"');
  });

  it('the view argument is not part of the card: format may differ between the two calls', async () => {
    const r = await rig();
    await r.call('data_update_dataset', { name: 'shop', format: 'data' });
    const done = await r.call('data_update_dataset', { name: 'shop' });
    expect(done.text).toBe('renamed to "shop"');
  });

  it('a card is bound to its facts: a change while the question is on the screen makes a new card, the yes runs nothing', async () => {
    const who = person();
    const r = await rig({ who });
    who.during = () => {
      r.fake.store
        .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
        .update(PROJECT, { name: 'renamed meanwhile' });
    };
    await r.call('data_update_dataset', { name: 'shop' });
    const stale = await r.call('data_update_dataset', { name: 'shop' });
    expect(stale.isError, stale.text).toBe(false);
    expect(stale.text).toContain('Consent needed (level 2) · Rename "renamed meanwhile"');
    expect(stale.text).toContain('this is a new one');
    expect(who.asked).toHaveLength(1);
    expect(writes(r)).toEqual([]);
    expect(projectName(r)).toBe('renamed meanwhile');
  });

  it('a card expires: after its time the repeat is a new card, nobody is asked, nothing runs', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call('data_update_dataset', { name: 'shop' });
    await r.clock.advance((CARD_TTL_MINUTES + 1) * 60_000);
    const late = await r.call('data_update_dataset', { name: 'shop' });
    expect(late.text).toContain('The earlier card expired: this is a new one.');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
    // the new card is good again
    expect((await r.call('data_update_dataset', { name: 'shop' })).text).toBe('renamed to "shop"');
  });

  it('a level-3 tool runs the same way, only after the yes', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call('scenario_delete', { flow_id: SKLEP_IDS.flowZakupy });
    expect(writes(r)).toEqual([]);
    const done = await r.call('scenario_delete', { flow_id: SKLEP_IDS.flowZakupy });
    expect(done.text).toBe('1 scenario deleted');
    expect(who.asked[0]).toContain('Asked on its own: it deletes for good.');
    expect(writes(r)).toEqual([`DELETE ~/flows/${SKLEP_IDS.flowZakupy}`]);
  });
});

describe('consent card: what the model cannot do', () => {
  it('no argument carries the decision: a made-up confirmation is refused as an unknown argument', async () => {
    const who = person('declined');
    const r = await rig({ who });
    await r.call('data_update_dataset', { name: 'shop' });
    const token = keptCard(r, 'data_update_dataset')?.token ?? '';
    for (const extra of [
      { confirm: token },
      { confirm: true },
      { confirmed: true },
      { decision: 'yes' },
      { inputResponses: { confirm: true } },
      { from_panel: true },
    ]) {
      const result = await r.call('data_update_dataset', { name: 'shop', ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(code(result), JSON.stringify(extra)).not.toBe('consent_missing');
    }
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('repeating the call never runs it: every repeat asks the person, and their no stands', async () => {
    const who = person('declined');
    const r = await rig({ who });
    for (let round = 0; round < 3; round += 1) {
      await r.call('data_update_dataset', { name: 'shop' });
      expect(code(await r.call('data_update_dataset', { name: 'shop' }))).toBe('consent_missing');
    }
    expect(who.asked).toHaveLength(3);
    expect(writes(r)).toEqual([]);
    expect(projectName(r)).toBe('sklep');
  });

  it('the card of a tool only reads: a write in `card` is refused before it is sent', async () => {
    const r = await rig({ tools: [eager] });
    const result = await r.call('scenario_delete', {});
    expect(result.isError).toBe(true);
    expect(writes(r)).toEqual([]);
    expect(projectName(r)).toBe('sklep');
    expect(
      r
        .logRecords('error')
        .map((record) => JSON.stringify(record))
        .join('\n'),
    ).toContain('the card of a tool only reads');
  });
});

describe('consent card: what the catalog entry decides', () => {
  it('a card that leaves out the cost its entry names is a mistake of the tool, not a card', async () => {
    const r = await rig({ tools: [silent] });
    const result = await r.call('data_update_dataset', {});
    expect(code(result)).toBe('internal_error');
    expect(
      r
        .logRecords('error')
        .map((record) => JSON.stringify(record))
        .join('\n'),
    ).toContain('must say a cost the catalog entry names');
  });
});

describe('consent card: secrets', () => {
  it('a secret in a name the card shows reaches neither the card, the question, the log nor the state file', async () => {
    const who = person();
    const r = await rig({
      who,
      seed: (fake) => {
        fake.store
          .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
          .update(PROJECT, {
            name: `shop\u001b[31m\npassword: ${BACKEND_CANARY} Authorization: Bearer ${SHAPE_CANARY}`,
          });
      },
    });
    const card = await r.call('data_update_dataset', { name: 'shop' });
    expect(card.text).not.toContain('\u001b');
    expect(card.text).not.toContain(SHAPE_CANARY);
    const done = await r.call('data_update_dataset', { name: 'shop' });
    expect(done.text).toBe('renamed to "shop"');
    expect(who.asked.join('\n')).not.toContain(BACKEND_CANARY);
    expect(who.asked.join('\n')).not.toContain(SHAPE_CANARY);
    // the rig checks every result, log line and file of the workspace for the canary when the test ends
  });
});

describe('consent card: which tools it may ask for', () => {
  it('covers a level-2 write and a level-3 deletion; a secret, traffic to the target and a level by argument stay out', () => {
    expect(asksOnACard(DATA_UPDATE_DATASET)).toBe(true);
    expect(asksOnACard(SCENARIO_DELETE)).toBe(true);
    for (const meta of [TRAFFIC_CREATE_TOKEN, RUN_START, FLOWS_MIGRATE_DOCS]) {
      expect(asksOnACard(meta), meta.name).toBe(false);
    }
    expect(asksOnACard({ ...DATA_UPDATE_DATASET, install_allow: true })).toBe(false);
  });

  it('a tool outside its scope stays a scaffold, even when a cast gives it a card', async () => {
    const spec = {
      title: 'Out of scope',
      input: {},
      card: () => Promise.resolve({ facts: {} }),
      cardView: () => ({ title: 'x', lines: [], undo: 'x' }),
      run: () => Promise.resolve({ status: 'done' as const, data: { written: true } }),
      render: () => 'written',
    };
    // @ts-expect-error a secret tool takes no card: its secret must not pass through the model
    const typed = moduleTool(TRAFFIC_CREATE_TOKEN, spec);
    for (const meta of [TRAFFIC_CREATE_TOKEN, RUN_START, FLOWS_MIGRATE_DOCS]) {
      const cast = moduleTool(meta as unknown as ConsentMeta, spec);
      for (const tool of [typed, cast]) {
        expect(tool.implemented, tool.name).toBe(false);
        expect(tool.onCard, tool.name).toBe(false);
        expect(exposedTools([tool])).toEqual([]);
      }
    }
    const r = await rig({ tools: [typed] });
    expect(code(await r.call('traffic_create_token', {}))).toBe('not_implemented');
  });

  it('the tools on a card say so, and are offered', () => {
    for (const tool of [rename, remove]) {
      expect(tool.implemented).toBe(true);
      expect(tool.onCard).toBe(true);
    }
  });
});
