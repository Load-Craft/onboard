// The profile of a project: `project_get` shows it field by field; `project_set_profile` asks for
// consent with a card (current and new values, nothing written), writes only on the repeat with the
// card's token while the stored profile is still the one shown, keeps every other field, refuses a
// value outside the contract, and leaves its previous values in the log for the undo. The warning
// `profile_fields_uncertain` is opened by the analysis, shown by the status and by `project_get`,
// and closed by applying the setup or by setting the fields.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { provenanceOf } from '../src/contract/setupGate.js';
import { PROFILE_DEFAULTS } from '../src/tools/project/profile.js';
import { unsureAfterApply } from '../src/tools/project/setup.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { projectGet } from '../src/tools/projectGet.js';
import { projectSetProfile } from '../src/tools/projectSetProfile.js';
import { registerAnalysisReadRoute } from './fake-backend/routes/analysis.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import {
  planSetup,
  registerSetupRoutes,
  seedProvenance,
  SETUP_PROFILE_DEFAULTS,
  SETUP_SUGGESTIONS,
} from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import { registerTelemetryRoutes } from './fake-backend/routes/telemetry.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { settleClock } from './helpers/clock.js';
import { analysisHandle, SETUP_TOOLS, type SetupEnvironment } from './helpers/projectSetup.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

/** A profile as an analysis and a person left it: guidance and a description the tool never sets. */
const STORED_PROFILE = {
  ...SETUP_PROFILE_DEFAULTS,
  app_architecture: 'mobile',
  auth_method: 'bearer_jwt',
  auth_token_endpoint: 'POST /auth/login',
  has_pagination: true,
  idp_domains: ['login.example.com'],
  additional_notes: 'orders are paged by 20',
  app_description: { summary: 'a shop with orders' },
  agent_guidance: [{ id: 'g-1', text: 'skip the newsletter popup' }],
};

/** The text with its wrapped lines joined. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ');

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writes = (calls: readonly FakeCall[]): string[] =>
  calls.filter((call) => WRITES.has(call.method)).map((call) => `${call.method} ${call.path}`);

interface StateFile {
  process: Record<
    string,
    {
      problems: { code: string; severity: string; field_paths?: string[] }[];
      log: {
        tool: string;
        status: string;
        undo?: { tool: string; args: Record<string, unknown>; level: number };
      }[];
    }
  >;
}

function processOf(r: ToolRig, id: string = SKLEP_IDS.project): StateFile['process'][string] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as StateFile;
  const found = state.process[id];
  if (found === undefined) throw new Error(`no process for ${id}`);
  return found;
}

const uncertainOf = (r: ToolRig, id?: string): string[] | undefined =>
  processOf(r, id).problems.find((problem) => problem.code === 'profile_fields_uncertain')
    ?.field_paths;

function storedProfile(r: ToolRig, id: string = SKLEP_IDS.project): Record<string, unknown> {
  const project = r.fake.store
    .collection<{ id: string; project_profile?: Record<string, unknown> | null }>(
      SKLEP_COLLECTIONS.projects,
    )
    .require(id);
  return project.project_profile ?? {};
}

function setStoredProfile(r: ToolRig, profile: Record<string, unknown>): void {
  r.fake.store
    .collection<{ id: string; project_profile?: unknown }>(SKLEP_COLLECTIONS.projects)
    .update(SKLEP_IDS.project, { project_profile: profile });
}

function world(stage: 'empty' | 'project') {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    registerFlowRoutes(fake);
    registerAnalysisReadRoute(fake);
    registerTelemetryRoutes(fake);
    seedSklep(fake.store, { stage });
  };
}

const TOOLS = [...SETUP_TOOLS, processGetStatus, projectGet, projectSetProfile];

async function boundRig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  const r = await toolRig({
    tools: TOOLS,
    world: world('project'),
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
  setStoredProfile(r, STORED_PROFILE);
  return r;
}

interface CardView {
  readonly needsConfirmation: true;
  readonly scope: string;
  readonly changes: readonly { field: string; current: unknown; value: unknown }[];
  readonly unchanged: readonly string[];
  readonly confirm: string;
}

async function card(r: ToolRig, fields: Record<string, unknown>): Promise<RigCallResult> {
  const result = await r.call('project_set_profile', { fields });
  expect(result.isError, result.text).toBe(false);
  return result;
}

const tokenOf = (result: RigCallResult): string => (result.outcome?.data as CardView).confirm;

describe('project_set_profile: a consent card first, the write on its repeat', () => {
  it('the first call is a card with the current and the new values and writes nothing', async () => {
    const r = await boundRig();
    const before = r.fake.calls.length;
    const result = await card(r, { app_architecture: 'spa', has_pagination: true });
    const data = result.outcome?.data as CardView;

    expect(data.needsConfirmation).toBe(true);
    expect(data.scope).toBe('project:profile');
    expect(data.changes).toEqual([{ field: 'app_architecture', current: 'mobile', value: 'spa' }]);
    expect(data.unchanged).toEqual(['has_pagination']);
    expect(data.confirm).toMatch(/^[0-9a-f]{16}$/u);
    expect(result.text).toContain('app_architecture: mobile → spa');
    expect(result.text).toContain('project:profile');
    expect(result.text).toContain(`confirm: "${data.confirm}"`);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(storedProfile(r)['app_architecture']).toBe('mobile');
  });

  it('the repeat with the token writes the fields once and keeps every other field', async () => {
    const r = await boundRig();
    const first = await card(r, { app_architecture: 'spa', auth_method: 'session_cookie' });
    const before = r.fake.calls.length;
    const done = await r.call('project_set_profile', {
      fields: { app_architecture: 'spa', auth_method: 'session_cookie' },
      confirm: tokenOf(first),
    });
    expect(done.isError, done.text).toBe(false);

    const calls = r.fake.calls.slice(before);
    expect(writes(calls)).toEqual([`PUT /api/v1/projects/${SKLEP_IDS.project}`]);
    const sent = calls.find((call) => call.method === 'PUT')?.body as {
      project_profile: Record<string, unknown>;
    };
    // the whole profile is sent: the backend replaces the stored one with it
    expect(sent.project_profile).toMatchObject({
      app_architecture: 'spa',
      auth_method: 'session_cookie',
      auth_token_endpoint: 'POST /auth/login',
      has_pagination: true,
      idp_domains: ['login.example.com'],
      additional_notes: 'orders are paged by 20',
      app_description: { summary: 'a shop with orders' },
    });
    const stored = storedProfile(r);
    expect(stored).toMatchObject({
      app_architecture: 'spa',
      auth_method: 'session_cookie',
      has_pagination: true,
      idp_domains: ['login.example.com'],
      app_description: { summary: 'a shop with orders' },
      agent_guidance: [{ id: 'g-1', text: 'skip the newsletter popup' }],
    });
    expect(done.text).toContain('2 profile fields set in project "sklep"');
    expect(done.text).toContain('auth_method: bearer_jwt → session_cookie');
  });

  it('a profile changed after the card gets a new card and nothing is written', async () => {
    const r = await boundRig();
    const first = await card(r, { app_architecture: 'spa' });
    setStoredProfile(r, { ...STORED_PROFILE, has_pagination: false });
    const before = r.fake.calls.length;
    const result = await r.call('project_set_profile', {
      fields: { app_architecture: 'spa' },
      confirm: tokenOf(first),
    });
    expect(result.isError, result.text).toBe(false);
    const renewed = result.outcome?.data as CardView & { renewed?: string };
    expect(renewed.needsConfirmation).toBe(true);
    expect(renewed.renewed).toBe('changed');
    expect(renewed.confirm).not.toBe(tokenOf(first));
    expect(result.text).toContain('Nothing was written: the profile or the fields differ');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(storedProfile(r)['app_architecture']).toBe('mobile');
  });

  it('a token of a card for other fields gets a new card and nothing is written', async () => {
    const r = await boundRig();
    const first = await card(r, { app_architecture: 'spa' });
    const result = await r.call('project_set_profile', {
      fields: { app_architecture: 'ssr' },
      confirm: tokenOf(first),
    });
    expect(result.isError, result.text).toBe(false);
    const renewed = result.outcome?.data as CardView & { renewed?: string };
    expect(renewed.renewed).toBe('changed');
    expect(renewed.changes).toEqual([
      { field: 'app_architecture', current: 'mobile', value: 'ssr' },
    ]);
    expect(storedProfile(r)['app_architecture']).toBe('mobile');
  });

  it('a value outside the contract is refused before anything is sent', async () => {
    const r = await boundRig();
    const before = r.fake.calls.length;
    const result = await r.call('project_set_profile', {
      fields: { app_architecture: 'desktop' },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('app_architecture');
    expect(result.text).toContain('spa');
    expect(r.fake.calls.slice(before)).toEqual([]);
  });

  it('the log entry keeps the previous values, and the undo restores them through a new card', async () => {
    const r = await boundRig();
    const fields = { app_architecture: 'spa', idp_domains: [] };
    const first = await card(r, fields);
    await r.call('project_set_profile', { fields, confirm: tokenOf(first) });

    const entry = processOf(r).log.find(
      (item) => item.tool === 'project_set_profile' && item.undo !== undefined,
    );
    expect(entry?.undo).toEqual({
      tool: 'project_set_profile',
      args: { fields: { app_architecture: 'mobile', idp_domains: ['login.example.com'] } },
      level: 2,
      note: expect.any(String) as unknown,
    });
    // the card of the undo shows the way back; its repeat writes the previous values
    const undo = await card(r, entry?.undo?.args['fields'] as Record<string, unknown>);
    expect((undo.outcome?.data as CardView).changes).toEqual([
      { field: 'app_architecture', current: 'spa', value: 'mobile' },
      { field: 'idp_domains', current: [], value: ['login.example.com'] },
    ]);
    await r.call('project_set_profile', {
      fields: entry?.undo?.args['fields'],
      confirm: tokenOf(undo),
    });
    expect(storedProfile(r)).toMatchObject({
      app_architecture: 'mobile',
      idp_domains: ['login.example.com'],
      additional_notes: 'orders are paged by 20',
    });
  });

  it('a token serves one write: after the write and its undo the old token only gets a new card', async () => {
    const r = await boundRig();
    const fields = { app_architecture: 'spa' };
    const first = await card(r, fields);
    const done = await r.call('project_set_profile', { fields, confirm: tokenOf(first) });
    expect(done.isError, done.text).toBe(false);
    // the same call again finds the value set: nothing is sent
    const sent = r.fake.calls.length;
    const twice = await r.call('project_set_profile', { fields, confirm: tokenOf(first) });
    expect(twice.text).toContain('nothing to change');
    expect(writes(r.fake.calls.slice(sent))).toEqual([]);

    const back = { app_architecture: 'mobile' };
    const undo = await card(r, back);
    await r.call('project_set_profile', { fields: back, confirm: tokenOf(undo) });
    expect(storedProfile(r)['app_architecture']).toBe('mobile');

    // the profile is again what the first card showed, yet its token no longer writes
    const before = r.fake.calls.length;
    const stale = await r.call('project_set_profile', { fields, confirm: tokenOf(first) });
    expect(stale.isError, stale.text).toBe(false);
    expect((stale.outcome?.data as CardView & { renewed?: string }).renewed).toBe('missing');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(storedProfile(r)['app_architecture']).toBe('mobile');
    // a new card for the same change gives another token
    expect(tokenOf(await card(r, fields))).not.toBe(tokenOf(first));
  });

  it('only the confirmed write leaves an undo; the card leaves none', async () => {
    const r = await boundRig();
    await card(r, { app_architecture: 'spa' });
    expect(processOf(r).log.filter((item) => item.undo !== undefined)).toEqual([]);
  });
});

describe('project_get: the profile under the names project_set_profile takes', () => {
  it('shows a field the backend does not store with the default of the contract', () => {
    const contract = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'contracts', 'loadcraft-openapi.json'),
        'utf8',
      ),
    ) as {
      components: {
        schemas: { ProjectProfile: { properties: Record<string, { default?: unknown }> } };
      };
    };
    const properties = contract.components.schemas.ProjectProfile.properties;
    for (const [field, value] of Object.entries(PROFILE_DEFAULTS)) {
      const declared = properties[field];
      expect(declared, field).toBeDefined();
      // a field without a default in the contract is empty when not stored: null, or no items
      const expected = declared?.default ?? (Array.isArray(value) ? [] : null);
      expect(value, field).toEqual(expected);
    }
  });

  it('lists the fields and, on request, the statistics, the setup and the log server', async () => {
    const r = await boundRig();
    const result = await r.call('project_get', { include: ['stats', 'setup', 'telemetry'] });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('profile of project "sklep":');
    expect(result.text).toContain('app_architecture: mobile');
    expect(result.text).toContain('auth_token_endpoint: POST /auth/login');
    expect(result.text).toMatch(/on: [^\n]*has_pagination/u);
    expect(result.text).toMatch(/flows \d+ · runs \d+/u);
    expect(result.text).toContain('setup complete');
    expect(result.text).toMatch(/log server: /u);
    expect(writes(r.fake.calls)).toEqual([]);
  });
});

// ---- the warning of the analysis ------------------------------------------------------------

const ENVIRONMENTS: readonly SetupEnvironment[] = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
];

/** The fixture's proposals with a weak guess of the client and a conflict about the login. */
const UNSURE_SUGGESTIONS = SETUP_SUGGESTIONS.map((item) =>
  item.field_path === 'project_profile.app_architecture'
    ? { ...item, value: 'mobile', confidence: 0.6 }
    : item.field_path === 'project_profile.auth_method'
      ? { ...item, status: 'conflicted' as const }
      : item.field_path === 'project_profile.has_async_operations'
        ? { ...item, confidence: 0.9 }
        : { ...item, status: 'suggested' as const },
);

function openapiDocument(): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Sklep API', version: '2.14.0', 'x-loadcraft-source': { commit: 'a41f9c2' } },
    paths: { '/items': { get: { operationId: 'listItems', summary: 'Items' } } },
  });
}

async function analysedRig(
  suggestions: typeof SETUP_SUGGESTIONS = UNSURE_SUGGESTIONS,
): Promise<{ r: ToolRig; id: string; analyze: RigCallResult }> {
  const r = await toolRig({
    tools: TOOLS,
    world: world('empty'),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: { 'loadcraft/openapi.json': openapiDocument() },
  });
  planSetup(r.fake, { suggestions });
  const settle = (call: Promise<RigCallResult>): Promise<RigCallResult> => settleClock(r, call);
  const create = await settle(
    r.call('project_create', {
      name: 'sklep',
      environment: { name: 'perf', api: ENVIRONMENTS[0]?.api },
    }),
  );
  expect(create.isError, create.text).toBe(false);
  const id = (create.outcome?.data as { project: { id: string } }).project.id;
  let analyze = await settle(
    r.call('project_analyze_setup', { openapi: 'loadcraft/openapi.json' }),
  );
  while (!analyze.isError && analyze.outcome?.status === 'running') {
    analyze = await settle(r.call('process_wait', { operation: analyze.outcome.operation }));
  }
  expect(analyze.isError, analyze.text).toBe(false);
  return { r, id, analyze };
}

describe('profile_fields_uncertain: opened by the analysis, closed by apply or by the fix', () => {
  it('the analysis names the unsure fields in its result and opens the warning', async () => {
    const { r, id, analyze } = await analysedRig();
    expect(flat(analyze.text)).toMatch(/2 fields unsure[^\n]*ask the user before applying/u);
    expect(analyze.text).toContain('app_architecture: mobile (confidence 60%)');
    expect(analyze.text).toContain('auth_method: bearer_jwt (sources disagree)');
    expect(analyze.text).toContain('project_set_profile');
    expect(uncertainOf(r, id)).toEqual(['auth_method', 'app_architecture']);
    const problem = processOf(r, id).problems.find(
      (item) => item.code === 'profile_fields_uncertain',
    );
    expect(problem?.severity).toBe('warning');
  });

  it('the status and project_get show it; apply closes it for the fields its result lists', async () => {
    const { r, id, analyze } = await analysedRig();
    const status = await r.call('process_get_status', {});
    expect(flat(status.text)).toMatch(/the analysis was unsure of: auth_method, app_architecture/u);
    const shown = await r.call('project_get', {});
    // nothing is applied yet: the stored value, marked
    expect(shown.text).toContain('app_architecture: spa (unsure)');
    expect(flat(shown.text)).toMatch(/the analysis was unsure of: auth_method, app_architecture/u);

    // apply lists app_architecture to check (a model wrote it), not auth_method (confident, from
    // the documentation): only the field the user was shown leaves the warning
    const handle = analysisHandle(analyze);
    const apply = await settleClock(r, r.call('project_apply_setup', { analysis: handle }));
    expect(apply.isError, apply.text).toBe(false);
    expect(apply.text).toContain('app_architecture: mobile');
    // not among the fields to check; named as still unsure, as the status names it
    expect(apply.text).not.toMatch(/^\s+auth_method:/mu);
    expect(flat(apply.text)).toContain('still unsure after the analysis: auth_method');
    expect(uncertainOf(r, id)).toEqual(['auth_method']);
    const after = await r.call('process_get_status', {});
    expect(flat(after.text)).toMatch(/the analysis was unsure of: auth_method →/u);
  });

  it('the world of the demo: after apply the status still names the field apply did not list', async () => {
    const { r, id, analyze } = await analysedRig(SETUP_SUGGESTIONS);
    expect(uncertainOf(r, id)).toEqual(['has_async_operations', 'uses_csrf']);
    const apply = await settleClock(
      r,
      r.call('project_apply_setup', { analysis: analysisHandle(analyze) }),
    );
    expect(apply.isError, apply.text).toBe(false);
    expect(uncertainOf(r, id)).toEqual(['uses_csrf']);
    const status = await r.call('process_get_status', {});
    expect(flat(status.text)).toContain('the analysis was unsure of: uses_csrf →');
  });

  it('setting a field drops it from the warning; the last one closes it', async () => {
    const { r, id } = await analysedRig();
    // the value the analysis proposed is confirmed as it is: nothing to write, the field is settled
    const confirmed = await r.call('project_set_profile', {
      fields: { auth_method: 'bearer_jwt' },
    });
    expect(confirmed.isError, confirmed.text).toBe(false);
    expect(uncertainOf(r, id)).toEqual(['app_architecture']);
    expect(flat(confirmed.text)).toContain('still unsure after the analysis: app_architecture');

    const first = await card(r, { app_architecture: 'ssr' });
    expect(uncertainOf(r, id)).toEqual(['app_architecture']);
    await r.call('project_set_profile', {
      fields: { app_architecture: 'ssr' },
      confirm: tokenOf(first),
    });
    expect(uncertainOf(r, id)).toBeUndefined();
    expect(storedProfile(r, id)['app_architecture']).toBe('ssr');
  });
});

// ---- an architecture nobody determined and the provenance of the applied profile -------------

describe('app_architecture unknown: read, shown and settable', () => {
  it('a stored unknown architecture is read without an error and shown with what it means', async () => {
    const r = await boundRig();
    setStoredProfile(r, { ...STORED_PROFILE, app_architecture: 'unknown' });
    const result = await r.call('project_get', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toMatch(/app_architecture: unknown \(not determined[^)\n]*\)/u);
    const pl = await boundRig('pl');
    setStoredProfile(pl, { ...STORED_PROFILE, app_architecture: 'unknown' });
    expect((await pl.call('project_get', {})).text).toMatch(
      /app_architecture: unknown \(nieustalona[^)\n]*\)/u,
    );
  });

  it('project_set_profile takes unknown as a value of the contract', async () => {
    const r = await boundRig();
    const result = await card(r, { app_architecture: 'unknown' });
    expect((result.outcome?.data as CardView).changes).toEqual([
      { field: 'app_architecture', current: 'mobile', value: 'unknown' },
    ]);
  });

  it('applying the setup over a stored unknown architecture reads the profile and keeps it', async () => {
    const r = await boundRig();
    setStoredProfile(r, { ...STORED_PROFILE, app_architecture: 'unknown' });
    const apply = await settleClock(r, r.call('project_apply_setup', {}));
    expect(apply.isError, apply.text).toBe(false);
    expect(storedProfile(r)['app_architecture']).toBe('unknown');
  });

  it('an analysis that proposes unknown leaves the field to settle with the user after apply', async () => {
    const proposed = SETUP_SUGGESTIONS.map((item) =>
      item.field_path === 'project_profile.app_architecture'
        ? { ...item, value: 'unknown', confidence: 0.9, source_kinds: ['openapi' as const] }
        : { ...item, status: 'suggested' as const, confidence: 0.95 },
    );
    const { r, id, analyze } = await analysedRig(proposed);
    expect(analyze.text).toMatch(/app_architecture: unknown \(not determined/u);
    const apply = await settleClock(
      r,
      r.call('project_apply_setup', { analysis: analysisHandle(analyze) }),
    );
    expect(apply.isError, apply.text).toBe(false);
    expect(uncertainOf(r, id)).toEqual(['app_architecture']);
  });
});

describe('suggestions that need a confirmation', () => {
  const NEEDS_CONFIRMATION = SETUP_SUGGESTIONS.map((item) =>
    item.field_path === 'project_profile.has_async_operations'
      ? { ...item, status: 'needs_confirmation' as const, confidence: 0.6 }
      : { ...item, status: 'suggested' as const, confidence: 0.95 },
  );

  it('the analysis shows them as waiting for the user and opens the warning', async () => {
    const { r, id, analyze } = await analysedRig(NEEDS_CONFIRMATION);
    expect(flat(analyze.text)).toMatch(
      /has_async_operations: true \(needs the user's confirmation[^)]*\)/u,
    );
    expect(flat(analyze.text)).toMatch(
      /not applied: ask the user, then set it with project_set_profile/u,
    );
    expect(uncertainOf(r, id)).toEqual(['has_async_operations']);
  });

  it('apply leaves an unconfirmed one out of the profile and the field stays unsure', async () => {
    const { r, id, analyze } = await analysedRig(NEEDS_CONFIRMATION);
    const before = r.fake.calls.length;
    const apply = await settleClock(
      r,
      r.call('project_apply_setup', { analysis: analysisHandle(analyze) }),
    );
    expect(apply.isError, apply.text).toBe(false);
    const sent = r.fake.calls
      .slice(before)
      .find((call) => call.method === 'POST' && call.path.endsWith('/setup/apply'))?.body as {
      project_profile: Record<string, unknown>;
      confirmed_fields?: string[];
    };
    expect(sent.project_profile['has_async_operations']).toBe(false);
    expect(sent.confirmed_fields).toBeUndefined();
    expect(storedProfile(r, id)['has_async_operations']).toBe(false);
    expect(uncertainOf(r, id)).toEqual(['has_async_operations']);
  });

  it('apply takes no confirmation from the model: confirmed_fields is refused and the field stays held', async () => {
    const { r, id, analyze } = await analysedRig(NEEDS_CONFIRMATION);
    const before = r.fake.calls.length;
    const refused = await settleClock(
      r,
      r.call('project_apply_setup', {
        analysis: analysisHandle(analyze),
        confirmed_fields: ['has_async_operations'],
      }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('confirmed_fields');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(storedProfile(r, id)['has_async_operations']).not.toBe(true);
    expect(uncertainOf(r, id)).toEqual(['has_async_operations']);
  });

  it('the user settles a held field through the card of project_set_profile, which closes the warning', async () => {
    const { r, id, analyze } = await analysedRig(NEEDS_CONFIRMATION);
    await settleClock(r, r.call('project_apply_setup', { analysis: analysisHandle(analyze) }));
    expect(uncertainOf(r, id)).toEqual(['has_async_operations']);
    const first = await card(r, { has_async_operations: true });
    expect(storedProfile(r, id)['has_async_operations']).toBe(false);
    await r.call('project_set_profile', {
      fields: { has_async_operations: true },
      confirm: tokenOf(first),
    });
    expect(storedProfile(r, id)['has_async_operations']).toBe(true);
    expect(uncertainOf(r, id)).toBeUndefined();
  });
});

describe('nothing unsure is no warning', () => {
  it('a missing or empty provenance names no field, and apply with nothing open lists none', () => {
    expect(provenanceOf(undefined)).toEqual([]);
    expect(provenanceOf({})).toEqual([]);
    expect(
      unsureAfterApply(
        { needsReview: [] },
        { open: [], recorded: [], held: [], unknownArchitecture: false },
      ),
    ).toEqual([]);
  });

  it('an analysis sure of every field leaves no line and no warning after apply', async () => {
    const sure = SETUP_SUGGESTIONS.map((item) => ({
      ...item,
      status: 'suggested' as const,
      confidence: 0.95,
      source_kinds: ['openapi' as const],
    }));
    const { r, id, analyze } = await analysedRig(sure);
    const apply = await settleClock(
      r,
      r.call('project_apply_setup', { analysis: analysisHandle(analyze) }),
    );
    expect(apply.isError, apply.text).toBe(false);
    expect(apply.text).not.toContain('still unsure');
    expect(uncertainOf(r, id)).toBeUndefined();
  });
});

describe('the provenance of the applied profile', () => {
  it('project_get shows where the applied values came from and marks the uncertain ones', async () => {
    const { r, analyze } = await analysedRig(SETUP_SUGGESTIONS);
    await settleClock(r, r.call('project_apply_setup', { analysis: analysisHandle(analyze) }));
    const shown = await r.call('project_get', {});
    expect(shown.isError, shown.text).toBe(false);
    const text = flat(shown.text);
    expect(text).toMatch(/auth_method: openapi · 95% · accepted/u);
    expect(text).toMatch(/uses_csrf: openapi · 93% · conflicted/u);
    expect(shown.text).toMatch(/uses_csrf \(unsure\)/u);
  });

  it('apply without an analysis opens the warning for fields the backend reports as uncertain', async () => {
    const r = await boundRig();
    seedProvenance(r.fake.store, SKLEP_IDS.project, {
      app_architecture: {
        value: 'mobile',
        source_kinds: ['llm'],
        confidence: 0.55,
        rationale: 'The documentation mentions a phone client once.',
        status: 'needs_confirmation',
      },
      auth_method: {
        value: 'bearer_jwt',
        source_kinds: ['openapi'],
        confidence: 0.97,
        status: 'accepted',
      },
    });
    const apply = await settleClock(r, r.call('project_apply_setup', {}));
    expect(apply.isError, apply.text).toBe(false);
    expect(uncertainOf(r)).toEqual(['app_architecture']);
    const shown = await r.call('project_get', {});
    expect(flat(shown.text)).toMatch(
      /app_architecture: llm · 55% · needs_confirmation — The documentation mentions a phone client once\./u,
    );
  });
});
