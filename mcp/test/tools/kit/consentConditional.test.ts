// The consent card of a tool of level 1 that asks only for the calls that meet an escalation of its
// entry (src/tools/kit/consent.ts: `asksConditionally`, `{ proceed: true }`, `volatile`), through the
// whole server: a toy on the entry of `run_save`. A call that does not meet the escalation (decided
// from facts `card` read from the backend) runs at once; one that does gets a card at level 3, and only
// the person's yes runs it. Nothing the model sends can stand in for the facts or for the yes. Also the
// reasons `external` and `schedule` of the card.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { GITHUB_PUSH } from '../../../src/tools/github/meta.generated.js';
import { asksConditionally, asksOnACard } from '../../../src/tools/kit/consent.js';
import { LIMITS, projectIdOf, thirdParty } from '../../../src/tools/kit/transitional.js';
import { exposedTools, moduleTool, type ConsentMeta } from '../../../src/tools/moduleTool.js';
import { getProject, updateProject } from '../../../src/tools/project/update.js';
import { RUN_SAVE, RUN_START } from '../../../src/tools/run/meta.generated.js';
import { SCENARIO_DELETE } from '../../../src/tools/scenario/meta.generated.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import { SKLEP_COLLECTIONS, seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
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

/** The project description says whether the toy's "saved run" has a schedule, and when it next starts. */
const scheduledNow = (description: string | null | undefined): boolean =>
  (description ?? '').startsWith('scheduled');

interface Facts {
  readonly name: string;
  readonly workload: string;
}

/** A level-1 write that asks, at level 3, only when the stored object has a schedule and the call changes the load. */
const save = moduleTool(RUN_SAVE, {
  title: 'Save (a toy on a conditional card)',
  input: {
    workload: z.string().min(1).max(40).optional(),
    label: z.string().min(1).max(40).optional(),
  },
  async card(ctx, args) {
    const project = await getProject(ctx, { project_id: projectIdOf(ctx, undefined) });
    // from the facts read from the backend and from what the call touches, never from a flag
    if (!scheduledNow(project.description) || args.workload === undefined) {
      return { proceed: true };
    }
    const facts: Facts = {
      name: thirdParty(ctx, project.name, LIMITS.name),
      workload: thirdParty(ctx, args.workload, LIMITS.name),
    };
    return {
      facts,
      escalation: 'scheduled_run',
      volatile: { next_start: thirdParty(ctx, project.description ?? '', LIMITS.name) },
    };
  },
  cardView: (facts, t, volatile) => ({
    title: `Change the load of scheduled run "${facts.name}": ${String(volatile['next_start'])}`,
    lines: [`new load: ${facts.workload}`],
    undo: t.locale === 'pl' ? 'poprzednie wartości' : 'the previous values',
  }),
  async run(ctx, args) {
    await updateProject(
      ctx,
      { project_id: projectIdOf(ctx, undefined) },
      { name: args.workload ?? args.label ?? 'saved' },
    );
    return {
      status: 'done',
      data: { saved: true },
      update: { log: { values: { name: 'saved run' } } },
    };
  },
  render: () => 'saved',
});

/** A level-3 tool whose reason is `external` (the entry of `github_push`). */
const push = moduleTool(GITHUB_PUSH, {
  title: 'Push (a toy on a card)',
  input: {},
  card: () => Promise.resolve({ facts: { name: 'comp', repo: 'github.com/acme/shop' } }),
  cardView: (facts) => ({
    title: `Push ${facts.name} to ${facts.repo}`,
    lines: [],
    undo: 'revert it in the repository',
  }),
  run: () => Promise.resolve({ status: 'done' as const, data: { commit: 'abc1234' } }),
  render: (data) => `pushed: ${data.commit}`,
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly description?: string;
  readonly tools?: Parameters<typeof toolRig>[0]['tools'];
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: options.tools ?? [save],
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      if (options.description !== undefined) {
        fake.store
          .collection<{ id: string; description: string }>(SKLEP_COLLECTIONS.projects)
          .update(PROJECT, { description: options.description });
      }
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

const writes = (r: ToolRig) => writesOf(r, PROJECT);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
const projectName = (r: ToolRig): string | undefined =>
  r.fake.store.collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects).get(PROJECT)
    ?.name;

function drafts(r: ToolRig): string[] {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return Object.keys(
    (JSON.parse(text) as { drafts?: Record<string, unknown> }).drafts ?? {},
  ).filter((key) => key.startsWith('card:run_save:'));
}

describe('conditional card: which tools it may serve', () => {
  it('a level-1 entry with a level 3 by argument and an escalation is conditional, and no tool that always asks is', () => {
    expect(asksConditionally(RUN_SAVE)).toBe(true);
    expect(asksOnACard(RUN_SAVE)).toBe(false);
    expect(asksConditionally(SCENARIO_DELETE)).toBe(false);
    expect(asksConditionally(GITHUB_PUSH)).toBe(false);
    expect(asksConditionally(RUN_START)).toBe(false);
    expect(asksConditionally({ ...RUN_SAVE, install_allow: true })).toBe(false);
    expect(asksConditionally({ ...RUN_SAVE, secret: true })).toBe(false);
    expect(asksOnACard(GITHUB_PUSH)).toBe(true);
  });

  it('a conditional entry built without the overload stays a scaffold, and so does a tool out of scope given a card', () => {
    const scaffold = moduleTool(RUN_SAVE, { title: 'Scaffold', input: {} });
    expect(scaffold.implemented).toBe(false);
    expect(scaffold.onCard).toBe(false);
    expect(exposedTools([scaffold])).toEqual([]);
    const cast = moduleTool(RUN_START as unknown as ConsentMeta, {
      title: 'Cast',
      input: {},
      card: () => Promise.resolve({ facts: {} }),
      cardView: () => ({ title: 'x', lines: [], undo: 'x' }),
      run: () => Promise.resolve({ status: 'done' as const, data: { written: true } }),
      render: () => 'written',
    });
    expect(cast.implemented).toBe(false);
    expect(cast.onCard).toBe(false);
    expect(save.implemented).toBe(true);
    expect(save.onCard).toBe(true);
  });
});

describe('conditional card: a call that does not meet the escalation', () => {
  it('no schedule: the tool runs at once, nobody is asked, no card is kept, and the entry carries no consent', async () => {
    const who = person();
    const r = await rig({ who, description: 'plain' });
    const done = await r.call('run_save', { workload: '50 users' });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe('saved');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toHaveLength(1);
    expect(projectName(r)).toBe('50 users');
    expect(drafts(r)).toEqual([]);
    const entry = loggedCalls(r).at(-1) as ReturnType<typeof loggedCalls>[number] & {
      consent?: unknown;
    };
    expect(entry).toMatchObject({ tool: 'run_save', status: 'ok' });
    expect(entry.consent).toBeUndefined();
  });

  it('a schedule, but the call leaves the load alone: it runs at once too', async () => {
    const who = person();
    const r = await rig({ who, description: 'scheduled 12:30' });
    const done = await r.call('run_save', { label: 'renamed' });
    expect(done.text).toBe('saved');
    expect(who.asked).toEqual([]);
    expect(projectName(r)).toBe('renamed');
  });
});

describe('conditional card: a call that meets it', () => {
  it('asks at level 3 with the reason, shows the volatile fact, sends nothing and asks nobody yet', async () => {
    const who = person();
    const r = await rig({ who, description: 'scheduled 12:30' });
    const card = await r.call('run_save', { workload: '80 users' });
    expect(card.isError, card.text).toBe(false);
    expect(card.text).toBe(
      [
        'Consent needed (level 3) · Change the load of scheduled run "sklep": scheduled 12:30',
        '  new load: 80 users',
        'Can be undone: the previous values',
        'Asked on its own: the saved run has a schedule, so its next start uses this change without another question.',
        'Nothing was done yet. Tell the user what this card says. To go on, call run_save again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(drafts(r)).toHaveLength(1);
    // the data of a card, from a card of its own (a repeat would ask the person)
    const other = await rig({ description: 'scheduled 12:30' });
    expect(
      JSON.parse((await other.call('run_save', { workload: '80 users', format: 'data' })).text),
    ).toMatchObject({
      consent: 'needed',
      level: 3,
      why: 'scheduled_run',
      volatile: { next_start: 'scheduled 12:30' },
    });
  });

  it("the person's yes runs it once, with the entry naming the dialog", async () => {
    const who = person();
    const r = await rig({ who, description: 'scheduled 12:30' });
    await r.call('run_save', { workload: '80 users' });
    const done = await r.call('run_save', { workload: '80 users' });
    expect(done.text).toBe('saved');
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain('Change the load of scheduled run "sklep"');
    expect(who.asked[0]).toContain('without another question');
    expect(writes(r)).toHaveLength(1);
    expect(projectName(r)).toBe('80 users');
    expect(loggedCalls(r).at(-1)).toMatchObject({
      status: 'ok',
      consent: { via: 'client_dialog' },
    });
    expect(drafts(r)).toEqual([]);
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer), description: 'scheduled 12:30' });
      await r.call('run_save', { workload: '80 users' });
      expect(code(await r.call('run_save', { workload: '80 users' }))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(drafts(r)).toEqual([]);
    },
  );

  it('the volatile fact moves without a new card: the next start changes while the person is asked, and the yes still runs', async () => {
    const who = person();
    const r = await rig({ who, description: 'scheduled 12:30' });
    who.during = () => {
      r.fake.store
        .collection<{ id: string; description: string }>(SKLEP_COLLECTIONS.projects)
        .update(PROJECT, { description: 'scheduled 12:45' });
    };
    await r.call('run_save', { workload: '80 users' });
    const done = await r.call('run_save', { workload: '80 users' });
    expect(done.text).toBe('saved');
    expect(writes(r)).toHaveLength(1);
    expect(who.asked[0]).toContain('scheduled 12:30');
  });

  it('a fact that is not volatile still makes a new card: the schedule is gone and the object changed', async () => {
    const who = person();
    const r = await rig({ who, description: 'scheduled 12:30' });
    await r.call('run_save', { workload: '80 users' });
    r.fake.store
      .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
      .update(PROJECT, { name: 'renamed meanwhile' });
    const next = await r.call('run_save', { workload: '80 users' });
    expect(next.text).toContain('"renamed meanwhile"');
    expect(next.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('answers in Polish with the reason of the block', async () => {
    const r = await rig({ locale: 'pl', description: 'scheduled 12:30' });
    const card = await r.call('run_save', { workload: '80 users' });
    expect(card.text.split('\n').slice(0, 5)).toEqual([
      'Potrzebna zgoda (poziom 3) · Change the load of scheduled run "sklep": scheduled 12:30',
      '  new load: 80 users',
      'Da się cofnąć: poprzednie wartości',
      'Pytane osobno: zapisany przebieg ma harmonogram, więc następny start użyje tej zmiany bez kolejnego pytania.',
      expect.stringContaining('Nic jeszcze nie zrobiono.'),
    ]);
  });
});

describe('conditional card: what the model cannot do', () => {
  it('no argument skips the card or carries the decision: confirm, consent, token, proceed, skip_card are refused', async () => {
    const r = await rig({ description: 'scheduled 12:30' });
    for (const extra of [
      { confirm: true },
      { consent: 'given' },
      { token: 'abc' },
      { proceed: true },
      { skip_card: true },
      { schedule: false },
    ]) {
      const result = await r.call('run_save', { workload: '80 users', ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(writes(r)).toEqual([]);
    expect(drafts(r)).toEqual([]);
  });

  it('every call that changes the load of a scheduled object gets a card, whatever else it sends; repeating never runs it', async () => {
    const who = person('declined');
    const r = await rig({ who, description: 'scheduled 12:30' });
    for (const args of [
      { workload: '1' },
      { workload: '1', label: 'x' },
      { label: 'x', workload: '2 users' },
    ]) {
      const first = await r.call('run_save', args);
      expect(first.text, JSON.stringify(args)).toContain('Consent needed (level 3)');
      expect(code(await r.call('run_save', args))).toBe('consent_missing');
    }
    expect(writes(r)).toEqual([]);
    expect(who.asked).toHaveLength(3);
  });

  it('a client that cannot ask anyone gets consent_missing for a call that meets the escalation, and a plain call still runs', async () => {
    const r = await rig({ who: null, description: 'scheduled 12:30' });
    expect(code(await r.call('run_save', { workload: '80 users' }))).toBe('consent_missing');
    expect(writes(r)).toEqual([]);
    expect((await r.call('run_save', { label: 'renamed' })).text).toBe('saved');
  });

  it('a card of a tool that asks by argument without its escalation is a mistake of the tool, not a level-2 card', async () => {
    const level2 = moduleTool(RUN_SAVE, {
      title: 'No escalation (a toy)',
      input: {},
      card: () => Promise.resolve({ facts: { name: 'x' } }),
      cardView: () => ({ title: 'x', lines: [], undo: 'x' }),
      run: () => Promise.resolve({ status: 'done' as const, data: { saved: true } }),
      render: () => 'never',
    });
    const r = await rig({ tools: [level2] });
    const result = await r.call('run_save', {});
    expect(result.isError).toBe(true);
    expect(code(result)).toBe('internal_error');
    expect(writes(r)).toEqual([]);
  });

  it('a tool that always asks never goes on without a card, even when a cast makes its card answer proceed', async () => {
    const cheat = moduleTool(SCENARIO_DELETE, {
      title: 'Proceeds (a toy)',
      input: {},
      card: () => Promise.resolve({ proceed: true } as never),
      cardView: () => ({ title: 'x', lines: [], undo: 'x' }),
      run: () => Promise.resolve({ status: 'done' as const, data: { count: 1, kind: 'scenario' } }),
      render: () => 'deleted',
    });
    const r = await rig({ tools: [cheat] });
    const result = await r.call('scenario_delete', {});
    expect(result.isError).toBe(true);
    expect(code(result)).toBe('internal_error');
    expect(writes(r)).toEqual([]);
  });
});

describe('consent card: the reasons external and schedule', () => {
  it('a level-3 tool whose reason is external says so on the card and in the question, in both languages', async () => {
    const who = person();
    const r = await rig({ who, tools: [push] });
    const card = await r.call('github_push', {});
    expect(card.text.split('\n').slice(0, 4)).toEqual([
      'Consent needed (level 3) · Push comp to github.com/acme/shop',
      'Cannot be undone: revert it in the repository',
      'Asked on its own: it sends data to a service outside LoadCraft.',
      expect.stringContaining('Nothing was done yet.'),
    ]);
    await r.call('github_push', {});
    expect(who.asked[0]).toContain(
      'Asked on its own: it sends data to a service outside LoadCraft.',
    );
    const pl = await rig({ locale: 'pl', tools: [push] });
    expect((await pl.call('github_push', {})).text).toContain(
      'Pytane osobno: wysyła dane do usługi poza LoadCraft.',
    );
  });
});
