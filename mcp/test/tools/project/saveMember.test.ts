// `project_save_member` (module project) on a consent card, level 2: the first call reads the team and
// makes the card, nothing is sent; the repeat with the same arguments asks the person in the client's
// dialog, and only their yes adds the member or changes the role. The fake backend is compared (the
// team), not only the answer.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectSaveMember } from '../../../src/tools/project/saveMember.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import {
  seedTeamMember,
  TEAM_MEMBERS,
  type StoredMember,
} from '../../fake-backend/routes/project.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { expectUndoApplies, loggedCalls } from '../../helpers/undo.js';

const TOOL = 'project_save_member';
const PROJECT = SKLEP_IDS.project;
const ANA = '7d1f3a52-8c64-4e09-b2a7-5f0c9d1e3b84';
const BEN = '2b6e9c41-0a73-4d58-9e1f-8c3a5d7f0e62';
const NEW = '9c4a7e10-5b28-4f63-a0d9-1e6b3c8f2a75';
const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly seed?: (fake: Fake) => void;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: [projectSaveMember],
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      seedTeamMember(fake.store, PROJECT, { id: 'm-ana', user_id: ANA, role: 'owner' }, true);
      seedTeamMember(fake.store, PROJECT, { id: 'm-ben', user_id: BEN, role: 'viewer' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: { 'loadcraft/project.json': BOUND },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

const team = (r: ToolRig): Record<string, string> =>
  Object.fromEntries(
    r.fake.store
      .collection<StoredMember>(TEAM_MEMBERS)
      .list()
      .map((entry) => [entry.member.user_id, entry.member.role]),
  );
const writes = (r: ToolRig) => writesOf(r, PROJECT);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;

const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

describe('project_save_member: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(projectSaveMember);
    expect(projectSaveMember.implemented).toBe(true);
  });

  it('a role change shows from -> to and what the role allows; nothing is sent, nobody asked', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        `Consent needed (level 2) · Give ${BEN} the role editor`,
        `  changes the role of ${BEN} from viewer to editor`,
        '  editor: changes the project and runs tests; no control of the team',
        'Can be undone: project_save_member with the previous role viewer',
        'Nothing was done yet. Tell the user what this card says. To go on, call project_save_member again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(team(r)[BEN]).toBe('viewer');
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'queued',
      args: `Give ${BEN} the role editor`,
    });
    expect(kept(r)).toHaveLength(1);
  });

  it('a new member is added: the card says so, and the undo is the removal', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { user_id: NEW, role: 'viewer' });
    expect(result.text.split('\n').slice(0, 4)).toEqual([
      `Consent needed (level 2) · Give ${NEW} the role viewer`,
      `  adds the person ${NEW} to this project as viewer`,
      '  viewer: reads only',
      'Can be undone: project_delete with kind member removes the person again',
    ]);
  });

  it('the person who already has the role: nothing to ask, nothing sent, no card', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { user_id: BEN, role: 'viewer' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(`${BEN} already has the role viewer; nothing to change.`);
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const card = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(card.text.split('\n').slice(0, 4)).toEqual([
      `Potrzebna zgoda (poziom 2) · Rola editor dla ${BEN}`,
      `  zmienia rolę ${BEN} z viewer na editor`,
      '  editor: zmienia projekt i uruchamia testy; bez kontroli nad zespołem',
      'Da się cofnąć: project_save_member z poprzednią rolą viewer',
    ]);
    const done = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(done.text).toBe(
      [
        `Rola ${BEN} to teraz editor (była viewer).`,
        'Cofnięcie: project_save_member z rolą viewer (znów pyta o zgodę).',
      ].join('\n'),
    );
  });
});

describe('project_save_member: the decision', () => {
  it("the person's yes changes the role once; the entry carries the dialog and the undo, and the undo runs", async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, { user_id: BEN, role: 'editor' });
    const done = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(
      [
        `The role of ${BEN} is now editor (was viewer).`,
        'To undo: project_save_member with the role viewer (it asks for consent again).',
      ].join('\n'),
    );
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain(`changes the role of ${BEN} from viewer to editor`);
    expect(writes(r)).toEqual([`PUT /team/${BEN}`]);
    expect(team(r)).toEqual({ [ANA]: 'owner', [BEN]: 'editor' });
    const entry = loggedCalls(r).at(-1) as ReturnType<typeof loggedCalls>[number] & {
      consent?: { via: string };
    };
    expect(entry).toMatchObject({
      tool: TOOL,
      status: 'ok',
      args: `Give ${BEN} the role editor`,
      result: `${BEN}: editor`,
      consent: { via: 'client_dialog' },
      undo: { tool: TOOL, args: { user_id: BEN, role: 'viewer' } },
    });
    expect(kept(r)).toEqual([]);
    // the undo, run for real: a second card and a second yes
    const undo = entry.undo;
    if (undo === undefined) throw new Error('no undo');
    await r.call(undo.tool, { user_id: undo.args['user_id'], role: undo.args['role'] });
    const undone = await r.call(undo.tool, {
      user_id: undo.args['user_id'],
      role: undo.args['role'],
    });
    expect(undone.isError, undone.text).toBe(false);
    expect(team(r)).toEqual({ [ANA]: 'owner', [BEN]: 'viewer' });
  });

  it('a new member is added with one POST; the undo names the removal and removing them restores the team', async () => {
    const r = await rig();
    await r.call(TOOL, { user_id: NEW, role: 'editor' });
    const call = { tool: TOOL, args: { user_id: NEW, role: 'editor' } };
    const done = await r.call(call.tool, call.args);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(
      [
        `Added ${NEW} to the project as editor.`,
        'To undo: project_delete with kind member removes them (it asks for consent).',
      ].join('\n'),
    );
    expect(writes(r)).toEqual(['POST /team']);
    expect(team(r)[NEW]).toBe('editor');
    const undo = loggedCalls(r).at(-1)?.undo;
    expect(undo).toMatchObject({
      tool: 'project_delete',
      level: 3,
      args: { kind: 'member', user_id: NEW },
    });
  });

  it('the undo of a new member, applied by what project_delete does, restores the team', async () => {
    const r = await rig({ who: person() });
    await r.call(TOOL, { user_id: NEW, role: 'viewer' });
    await expectUndoApplies(
      r,
      { tool: TOOL, args: { user_id: NEW, role: 'viewer' } },
      'project_delete',
      () => team(r),
      (args) => {
        const entries = r.fake.store.collection<StoredMember>(TEAM_MEMBERS);
        for (const entry of entries.list()) {
          if (entry.member.user_id === String(args['user_id'])) entries.delete(entry.id);
        }
      },
    );
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, { user_id: BEN, role: 'editor' });
      expect(code(await r.call(TOOL, { user_id: BEN, role: 'editor' }))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(team(r)[BEN]).toBe('viewer');
      expect(kept(r)).toEqual([]);
    },
  );

  it('other arguments are a new card, and a team that changed after the card is a new card', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, { user_id: BEN, role: 'editor' });
    const other = await r.call(TOOL, { user_id: BEN, role: 'owner' });
    expect(other.text).toContain('this is a new one');
    const ben = r.fake.store.collection<StoredMember>(TEAM_MEMBERS).require('m-ben');
    r.fake.store
      .collection<StoredMember>(TEAM_MEMBERS)
      .update('m-ben', { member: { ...ben.member, role: 'editor' } });
    const same = await r.call(TOOL, { user_id: BEN, role: 'owner' });
    expect(same.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('the model has no argument that confirms: confirm, consent and token are refused', async () => {
    const r = await rig();
    for (const extra of [{ confirm: true }, { consent: 'given' }, { token: 'abc' }]) {
      const result = await r.call(TOOL, { user_id: BEN, role: 'editor', ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('a client that cannot ask anyone gets consent_missing and no card', async () => {
    const r = await rig({ who: null });
    for (let call = 0; call < 2; call += 1) {
      const refused = await r.call(TOOL, { user_id: BEN, role: 'editor' });
      expect(code(refused)).toBe('consent_missing');
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });
});

describe('project_save_member: arguments and the backend', () => {
  it('refuses arguments outside the catalog before any request', async () => {
    const r = await rig();
    for (const args of [
      { user_id: 'x', role: 'editor' },
      { user_id: BEN, role: 'admin' },
      { user_id: BEN },
      { role: 'editor' },
      { email: 'a@b.test', role: 'editor' },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
  });

  it('a refusal of the backend (not allowed to manage the team) reaches the model as the error, no card kept', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/projects/{project_id}/team', {
      status: 403,
      body: { detail: 'Forbidden' },
    });
    const result = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(result.isError).toBe(true);
    expect(kept(r)).toEqual([]);
    expect(writes(r)).toEqual([]);
  });
});

describe('project_save_member: secrets', () => {
  it('a secret in a role of the team (a foreign text) is masked on the card, in the answer and in the log', async () => {
    const r = await rig({
      seed: (fake) => {
        const members = fake.store.collection<StoredMember>(TEAM_MEMBERS);
        const ben = members.require('m-ben');
        members.update('m-ben', {
          member: { ...ben.member, role: `viewer password=${BACKEND_CANARY}` },
        });
      },
    });
    const card = await r.call(TOOL, { user_id: BEN, role: 'editor', format: 'data' });
    const done = await r.call(TOOL, { user_id: BEN, role: 'editor' });
    expect(done.isError, done.text).toBe(false);
    for (const text of [card.text, done.text, JSON.stringify(loggedCalls(r))]) {
      expect(text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    }
  });
});
