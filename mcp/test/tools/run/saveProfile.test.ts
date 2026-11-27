// `run_save_profile` (module run): a stored load profile created or changed, written through the
// fake backend over HTTP (docs/tools/run/save.md). The object in the fake is compared, not only the
// answer; the undo is taken from the log entry the write left.

import { describe, expect, it } from 'vitest';

import { runSaveProfile } from '../../../src/tools/run/saveProfile.js';
import { seedProfiles, storedProfiles, type ProfileBody } from '../../fake-backend/routes/run.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import { expectUndoRestores, loggedCalls } from '../../helpers/undo.js';
import { dataOf, errorCode, readsOf, runRig } from './rig.js';

const TOOL = 'run_save_profile';
const SMOKE_ID = '5a1b2c3d-0001-4a00-8000-000000000001';
const SPIKE_ID = '5a1b2c3d-0002-4a00-8000-000000000002';

const SMOKE: ProfileBody = {
  id: SMOKE_ID,
  name: 'Smoke',
  description: null,
  injection_profile: 'constant',
  users: 5,
  duration_seconds: 60,
  ramp_duration_seconds: null,
  is_default: true,
  created_at: '2026-11-20T10:00:00Z',
  injection_steps: [],
};
const SPIKE: ProfileBody = {
  id: SPIKE_ID,
  name: 'Spike',
  description: 'Short and sharp',
  injection_profile: 'spike',
  users: 400,
  duration_seconds: 900,
  ramp_duration_seconds: 120,
  is_default: false,
  created_at: '2026-11-21T10:00:00Z',
  injection_steps: [],
};

function rig(
  profiles: readonly ProfileBody[] = [SMOKE, SPIKE],
  locale: 'en' | 'pl' = 'en',
): Promise<ToolRig> {
  return runRig({
    tools: [runSaveProfile],
    locale,
    seed: (fake) => {
      seedProfiles(fake.store, profiles);
    },
  });
}

const writes = (r: ToolRig) =>
  r.fake.calls.filter((call) => call.method === 'POST' || call.method === 'PUT');
const spike = (r: ToolRig) => storedProfiles(r.fake.store).find((item) => item.id === SPIKE_ID);

interface SaveData {
  readonly id: string;
  readonly name: string;
  readonly created: boolean;
  readonly changed: readonly string[];
  readonly previous: Record<string, unknown>;
  readonly undoable: boolean;
  readonly notUndoable: string | null;
}

describe('run_save_profile', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(runSaveProfile);
    expect(runSaveProfile.implemented).toBe(true);
  });

  it('creates a profile with one POST; the object holds what was sent and the backend defaults', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { name: 'Soak', type: 'soak', users: 50 });
    expect(result.isError, result.text).toBe(false);
    // the way back of a creation is the deletion of the profile, named in the view (DOKTOR-09)
    expect(result.text).toBe(
      [
        'Load profile "Soak" created: soak, 50 users, 60 s.',
        'Undo: run_delete with kind=profile removes it again; it asks for consent first (level 3).',
      ].join('\n'),
    );
    expect(writes(r).map((call) => `${call.method} ${call.path.split('/gatling')[1]}`)).toEqual([
      'POST /configurations',
    ]);
    expect(writes(r)[0]?.body).toEqual({ name: 'Soak', injection_profile: 'soak', users: 50 });
    const stored = storedProfiles(r.fake.store).find((item) => item.name === 'Soak');
    expect(stored).toMatchObject({ injection_profile: 'soak', users: 50, duration_seconds: 60 });
    expect(readsOf(r).length).toBe(0);
    expect(loggedCalls(r).at(-1)).toMatchObject({ tool: TOOL, result: 'profile Soak saved' });
    // the undo of a creation is the deletion of the new profile: run_delete, level 3, on its own card
    expect(loggedCalls(r).at(-1)?.undo).toMatchObject({
      tool: 'run_delete',
      args: { kind: 'profile', item_id: stored?.id },
      level: 3,
    });
    const data = dataOf<SaveData>(
      await r.call(TOOL, { name: 'Soak 2', type: 'soak', format: 'data' }),
    );
    expect(data).toMatchObject({ created: true, undoable: true, notUndoable: null });
  });

  it('a creation needs a name and a type: refused before any request', async () => {
    const r = await rig();
    for (const args of [{ users: 5 }, { name: 'x' }, { type: 'ramp' }]) {
      const result = await r.call(TOOL, args);
      expect(errorCode(result), JSON.stringify(args)).toBe('invalid_arguments');
      expect(result.text).toContain('a new profile needs a name and a type');
    }
    expect(r.fake.calls.filter((call) => call.path.includes('/gatling/'))).toEqual([]);
  });

  it('changes a profile found by name: only the changed fields are sent, undo restores the object', async () => {
    const r = await rig();
    const undo = await expectUndoRestores(
      r,
      { tool: TOOL, args: { profile: 'spike', users: 800, description: 'Doubled' } },
      () => spike(r),
    );
    expect(undo.tool).toBe(TOOL);
    expect(undo.args).toEqual({ profile: SPIKE_ID, users: 400, description: 'Short and sharp' });
    const put = writes(r).filter((call) => call.method === 'PUT');
    expect(put[0]?.body).toEqual({ users: 800, description: 'Doubled' });
  });

  it('shows what changed with the previous values, and the data names them', async () => {
    const r = await rig();
    const text = await r.call(TOOL, { profile: SPIKE_ID, users: 800 });
    expect(text.text).toBe(
      ['Load profile "Spike" updated: users (spike, 800 users, 900 s).', 'users was: 400'].join(
        '\n',
      ),
    );
    const data = dataOf<SaveData>(
      await r.call(TOOL, { profile: SPIKE_ID, name: 'Spike 2', format: 'data' }),
    );
    expect(data).toMatchObject({
      id: SPIKE_ID,
      name: 'Spike 2',
      created: false,
      changed: ['name'],
      previous: { name: 'Spike' },
      undoable: true,
    });
    // the write with format=data keeps its entry and its undo too (DOKTOR-09)
    const entries = loggedCalls(r);
    expect(entries.map((entry) => entry.result)).toEqual([
      'profile Spike saved',
      'profile Spike 2 saved',
    ]);
    expect(entries.at(-1)?.undo).toBeDefined();
  });

  it('writes nothing when the values are already as given: no PUT, no undo', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { profile: 'Spike', users: 400, name: 'Spike' });
    expect(result.text).toBe(
      'Load profile "Spike": nothing to change, the values are already as given.',
    );
    expect(writes(r)).toEqual([]);
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('a change that cannot be restored says so and declares no undo: a ramp never set, a default taken over, a secret text', async () => {
    const r = await rig([SMOKE, { ...SPIKE, description: `password=${BACKEND_CANARY}` }]);
    const ramp = await r.call(TOOL, { profile: 'Smoke', ramp_duration_seconds: 10 });
    expect(ramp.text).toContain('a ramp cannot be cleared');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    const def = await r.call(TOOL, { profile: 'Spike', is_default: true });
    expect(def.text).toContain('moved from another profile');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    const secret = await r.call(TOOL, { profile: SPIKE_ID, description: 'clean' });
    expect(secret.text).toContain('held a secret');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    expect(JSON.stringify(loggedCalls(r))).not.toContain(BACKEND_CANARY);
  });

  it('refuses a change with no field, and a profile the project lacks is not_found', async () => {
    const r = await rig();
    const empty = await r.call(TOOL, { profile: 'Spike' });
    expect(errorCode(empty)).toBe('invalid_arguments');
    expect(empty.text).toContain('send at least one field to change');
    const unknown = await r.call(TOOL, { profile: 'Soak', users: 5 });
    expect(errorCode(unknown)).toBe('not_found');
    expect(writes(r)).toEqual([]);
  });

  it('refuses arguments outside the catalog before any request', async () => {
    const r = await rig();
    for (const args of [
      { name: 'x', type: 'bogus' },
      { name: 'x', type: 'ramp', users: 0 },
      { name: 'x', type: 'ramp', users: 1_000_001 },
      { name: 'x', type: 'ramp', duration_seconds: 86_401 },
      { name: 'x', type: 'ramp', ramp_duration_seconds: -1 },
      { name: 'x', type: 'ramp', description: 'd'.repeat(501) },
      { name: '', type: 'ramp' },
      { name: 'x', type: 'ramp', injection_steps: [] },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(writes(r)).toEqual([]);
  });

  it('a backend refusal is the error of the call and changes nothing', async () => {
    const r = await rig();
    r.fake.faults.next('PUT', '/api/v1/projects/{project_id}/gatling/configurations/{config_id}', {
      status: 422,
      body: {
        detail: [
          {
            loc: ['body', 'ramp_duration_seconds'],
            msg: 'ramp longer than duration',
            type: 'value_error',
          },
        ],
      },
    });
    const before = storedProfiles(r.fake.store);
    const result = await r.call(TOOL, { profile: 'Spike', ramp_duration_seconds: 5000 });
    expect(result.isError).toBe(true);
    expect(storedProfiles(r.fake.store)).toEqual(before);
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig([SMOKE, SPIKE], 'pl');
    expect((await r.call(TOOL, { name: 'Soak', type: 'soak' })).text).toBe(
      [
        'Profil obciążenia „Soak” utworzony: soak, 10 użytkowników, 60 s.',
        'Cofnięcie: run_delete z kind=profile usunie go z powrotem; najpierw pyta o zgodę (poziom 3).',
      ].join('\n'),
    );
    const changed = await r.call(TOOL, { profile: 'Spike', users: 1 });
    expect(changed.text).toContain('zmieniony: użytkownicy');
    expect(changed.text).toContain('użytkownicy było: 400');
    expect((await r.call(TOOL, { profile: 'Spike', users: 1 })).text).toContain('nic do zmiany');
  });
});
