// `project_set_http_settings` (module project) on a consent card, level 2 (3 when an env file sets the
// default headers): the first call reads the settings and makes the card, nothing is sent; the repeat
// with the same arguments asks the person, and only their yes sends the PUT (or the setup of a project
// with no settings yet). The fake backend is compared (the settings it holds), not only the answer.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectSetHttpSettings } from '../../../src/tools/project/setHttpSettings.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import { httpSettingsOf, seedHttpSettings } from '../../fake-backend/routes/provision.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH, HEADER_CANARY } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';

const TOOL = 'project_set_http_settings';
const PROJECT = SKLEP_IDS.project;
const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});
const HEADERS_FILE = '.env.headers';
const HEADERS = `X-Api-Key=${HEADER_CANARY}\nX-Tenant=acme\n`;
const BASE = 'https://api.perf.example.com';

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly files?: Record<string, string>;
  readonly seed?: (fake: Fake) => void;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: [projectSetHttpSettings],
    world: (fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      [HEADERS_FILE]: HEADERS,
      ...options.files,
    },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

const writes = (r: ToolRig) => writesOf(r, PROJECT);
const stored = (r: ToolRig) => httpSettingsOf(r.fake.store, PROJECT);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;

const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

describe('project_set_http_settings: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(projectSetHttpSettings);
    expect(projectSetHttpSettings.implemented).toBe(true);
  });

  it('a base URL and options show from -> to; nothing is sent, nobody asked, one card kept', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, {
      base_url: 'https://shop.example.test/api',
      protocol: { http2_enabled: true, request_timeout_ms: 30000 },
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Set the HTTP settings of generated tests',
        `  base URL: ${BASE} -> https://shop.example.test/api`,
        '  http2_enabled: false -> true',
        '  request_timeout_ms: none -> 30000',
        '  the rest of the settings stays as it is',
        'Can be undone: project_set_http_settings with the previous base URL and options (header values are not kept: put them in the env file again)',
        'Nothing was done yet. Tell the user what this card says. To go on, call project_set_http_settings again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(stored(r)).toEqual({});
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'queued',
      args: 'Set the HTTP settings of generated tests',
    });
    expect(kept(r)).toHaveLength(1);
  });

  it('an env file raises the card to level 3 and shows the names, the size and the hash, never a value', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { headers_env_file: HEADERS_FILE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain(
      'Consent needed (level 3) · Set the HTTP settings of generated tests',
    );
    expect(result.text).toMatch(
      /default headers: 2 from \.env\.headers \(\d+ bytes, sha256 [0-9a-f]{12}\): X-Api-Key, X-Tenant; the values are never shown/u,
    );
    expect(result.text).toContain('they replace the default headers now set (0)');
    expect(result.text).toContain('Asked on its own: the call names a file that may hold secrets.');
    expect(result.text).not.toContain(HEADER_CANARY);
    expect(writes(r)).toEqual([]);
  });

  it('settings already as given: nothing to ask, nothing sent, no card', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { base_url: BASE, protocol: { http2_enabled: false } });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe('The HTTP settings are already as given; nothing to change.');
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('a project with no settings yet: the card says they are created', async () => {
    const r = await rig({
      seed: (fake) => seedHttpSettings(fake.store, PROJECT, {}, { missing: true }),
    });
    const result = await r.call(TOOL, { base_url: 'https://shop.example.test' });
    expect(result.text.split('\n').slice(0, 4)).toEqual([
      'Consent needed (level 2) · Set the HTTP settings of generated tests',
      '  the project has no HTTP settings yet: they are created with the defaults of LoadCraft and the values below',
      '  base URL: none -> https://shop.example.test',
      '  the rest of the settings stays as it is',
    ]);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const args = { base_url: 'https://shop.example.test', protocol: { disable_caching: true } };
    const card = await r.call(TOOL, args);
    expect(card.text.split('\n').slice(0, 5)).toEqual([
      'Potrzebna zgoda (poziom 2) · Ustawienia HTTP generowanych testów',
      `  adres bazowy: ${BASE} -> https://shop.example.test`,
      '  disable_caching: false -> true',
      '  reszta ustawień zostaje bez zmian',
      'Da się cofnąć: project_set_http_settings z poprzednim adresem bazowym i opcjami (wartości nagłówków nie są zachowane: trzeba je znów wpisać do pliku env)',
    ]);
    const done = await r.call(TOOL, args);
    expect(done.text).toBe(
      [
        'Ustawienia HTTP zapisane: adres bazowy, opcje protokołu.',
        'adres bazowy teraz: https://shop.example.test',
        'opcje teraz: disable_caching=true',
        'Cofnięcie: project_set_http_settings z poprzednimi wartościami (znów pyta o zgodę).',
      ].join('\n'),
    );
  });
});

describe('project_set_http_settings: the decision', () => {
  it("the person's yes sends one PUT of what changed; the entry carries the dialog and the undo, and the undo runs", async () => {
    const who = person();
    const r = await rig({ who });
    const args = { base_url: 'https://shop.example.test', protocol: { http2_enabled: true } };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(
      [
        'HTTP settings saved: base URL, protocol options.',
        'base URL now: https://shop.example.test',
        'options now: http2_enabled=true',
        'To undo: project_set_http_settings with the previous values (it asks for consent again).',
      ].join('\n'),
    );
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain(`base URL: ${BASE} -> https://shop.example.test`);
    expect(writes(r)).toEqual(['PUT /gatling/project']);
    expect(stored(r)).toMatchObject({
      base_url: 'https://shop.example.test',
      protocol_config: { http2_enabled: true, proxy_type: 'http' },
    });
    const entry = loggedCalls(r).at(-1) as ReturnType<typeof loggedCalls>[number] & {
      consent?: { via: string };
    };
    expect(entry).toMatchObject({
      tool: TOOL,
      status: 'ok',
      args: 'Set the HTTP settings of generated tests',
      result: 'HTTP settings saved',
      consent: { via: 'client_dialog' },
      undo: { tool: TOOL, args: { base_url: BASE, protocol: { http2_enabled: false } } },
    });
    expect(kept(r)).toEqual([]);
    // the undo, run for real: a second card and a second yes
    const undo = entry.undo;
    if (undo === undefined) throw new Error('no undo');
    await r.call(undo.tool, undo.args);
    const undone = await r.call(undo.tool, undo.args);
    expect(undone.isError, undone.text).toBe(false);
    expect(stored(r)).toMatchObject({
      base_url: BASE,
      protocol_config: { http2_enabled: false },
    });
  });

  it('an env file sets the default headers: the values reach the backend, never the card, the question, the data or the log', async () => {
    const who = person();
    const r = await rig({ who });
    const args = { headers_env_file: HEADERS_FILE };
    const card = await r.call(TOOL, { ...args, format: 'data' });
    const done = await r.call(TOOL, { ...args, format: 'data' });
    expect(done.isError, done.text).toBe(false);
    expect(stored(r).default_headers).toEqual({ 'X-Api-Key': HEADER_CANARY, 'X-Tenant': 'acme' });
    expect(writes(r)).toEqual(['PUT /gatling/project']);
    for (const text of [card.text, done.text, ...who.asked, JSON.stringify(loggedCalls(r))]) {
      expect(text).not.toContain(HEADER_CANARY);
    }
    expect(JSON.parse(card.text)).toMatchObject({
      consent: 'needed',
      level: 3,
      why: 'secret_ref',
      card: { headers: { path: HEADERS_FILE, count: 2, names: ['X-Api-Key', 'X-Tenant'] } },
    });
    // no way back for headers: their values are masked by the backend
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    expect(JSON.parse(done.text)).toMatchObject({ changed: ['headers'], undo: 'none' });
  });

  it('a project with no settings gets them from one setup call, with the defaults and the given values', async () => {
    const r = await rig({
      seed: (fake) => seedHttpSettings(fake.store, PROJECT, {}, { missing: true }),
    });
    const args = { base_url: 'https://shop.example.test', protocol: { http2_enabled: true } };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    expect(writes(r)).toEqual(['POST /gatling/setup']);
    expect(stored(r)).toMatchObject({
      base_url: 'https://shop.example.test',
      think_time_ms: 1000,
      pause_distribution: 'uniform',
      protocol_config: { http2_enabled: true, disable_caching: false, proxy_type: 'http' },
    });
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    expect(done.text.split('\n').at(-1)).toBe('No undo is kept for this change.');
  });

  it('a file that changed after the card is a new card, also when it changes while the person is asked; nothing is sent', async () => {
    const who = person();
    const r = await rig({ who });
    const args = { headers_env_file: HEADERS_FILE };
    await r.call(TOOL, args);
    who.during = () => writeFileSync(join(r.workspace, HEADERS_FILE), 'X-Api-Key=other\n');
    const next = await r.call(TOOL, args);
    expect(next.isError, next.text).toBe(false);
    expect(next.text).toContain('Consent needed (level 3)');
    expect(next.text).toContain('default headers: 1 from .env.headers');
    expect(who.asked).toHaveLength(1);
    expect(writes(r)).toEqual([]);
    expect(stored(r)).toEqual({});
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer) });
      const args = { base_url: 'https://shop.example.test' };
      await r.call(TOOL, args);
      expect(code(await r.call(TOOL, args))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(stored(r)).toEqual({});
      expect(kept(r)).toEqual([]);
    },
  );

  it('other arguments are a new card, and nobody is asked', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, { base_url: 'https://shop.example.test' });
    const next = await r.call(TOOL, { base_url: 'https://other.example.test' });
    expect(next.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('the model has no argument that confirms: confirm, consent and token are refused', async () => {
    const r = await rig();
    for (const extra of [{ confirm: true }, { consent: 'given' }, { token: 'abc' }]) {
      const result = await r.call(TOOL, { base_url: 'https://shop.example.test', ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('a client that cannot ask anyone gets consent_missing and no card', async () => {
    const r = await rig({ who: null });
    for (let call = 0; call < 2; call += 1) {
      expect(code(await r.call(TOOL, { base_url: 'https://shop.example.test' }))).toBe(
        'consent_missing',
      );
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });
});

describe('project_set_http_settings: arguments', () => {
  it('refuses what does not fit, before any request', async () => {
    const r = await rig({
      files: {
        '.env.empty': '# nothing\n',
        '.env.reserved': 'Authorization=abc\n',
        '.env.name': 'X_Api_Key=abc\n',
        '.env.value': `X-Long=${'x'.repeat(8193)}\n`,
        '.env.many': Array.from({ length: 21 }, (_, i) => `X-H${String(i)}=v`).join('\n'),
      },
    });
    const refused: [Record<string, unknown>, string][] = [
      [{}, 'pass at least one of: base_url, protocol, headers_env_file'],
      [{ base_url: 'ftp://x.test' }, 'http or https address'],
      [{ base_url: 'https://user:pw@x.test' }, 'without a user name or password'],
      [{ base_url: 'not a url' }, 'http or https address'],
      [{ protocol: {} }, 'pass at least one of'],
      [{ headers_env_file: '.env.empty' }, 'no KEY=VALUE line'],
      [{ headers_env_file: '.env.reserved' }, 'letters, digits and hyphens'],
      [{ headers_env_file: '.env.name' }, 'letters, digits and hyphens'],
      [{ headers_env_file: '.env.value' }, 'at most 8192 characters'],
      [{ headers_env_file: '.env.many' }, 'more than 20 headers'],
    ];
    for (const [args, reason] of refused) {
      const result = await r.call(TOOL, args);
      expect(code(result), JSON.stringify(args)).toBe('invalid_arguments');
      expect(result.text, JSON.stringify(args)).toContain(reason);
    }
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('refuses arguments outside the catalog: proxy options, other keys, other types', async () => {
    const r = await rig();
    for (const args of [
      { protocol: { proxy_host: 'proxy.test' } },
      { protocol: { proxy_password: 'x' } },
      { protocol: { http2_enabled: 'yes' } },
      { protocol: { request_timeout_ms: 0 } },
      { base_url: '' },
      { think_time_ms: 5 },
      { headers: { a: 'b' } },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(writes(r)).toEqual([]);
  });

  it('a file that is not an env file is refused, and a missing one too', async () => {
    const r = await rig({ files: { 'headers.txt': 'X-A=b\n' } });
    expect(code(await r.call(TOOL, { headers_env_file: 'headers.txt' }))).toBe(
      'env_file_not_allowed',
    );
    expect(code(await r.call(TOOL, { headers_env_file: '.env.nothing' }))).toBeDefined();
    expect(kept(r)).toEqual([]);
  });
});

describe('project_set_http_settings: secrets', () => {
  it('a secret in the settings the backend holds (user agent, previous base URL) is masked and kept out of the undo', async () => {
    const r = await rig({
      seed: (fake) =>
        seedHttpSettings(fake.store, PROJECT, {
          base_url: `https://svc:${BACKEND_CANARY}@api.perf.example.com/v1?token=${BACKEND_CANARY}`,
          protocol_config: {
            async_name_resolution: false,
            disable_auto_referer: false,
            disable_caching: false,
            disable_warm_up: false,
            http2_enabled: false,
            http2_prior_knowledge: false,
            infer_html_resources: false,
            per_user_name_resolution: false,
            proxy_type: 'http',
            share_connections: false,
            silent_resources: false,
            user_agent_header: `agent password=${BACKEND_CANARY}`,
          },
        }),
    });
    const args = {
      protocol: { user_agent_header: 'plain-agent' },
      base_url: 'https://new.example.test',
    };
    const card = await r.call(TOOL, { ...args, format: 'data' });
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    for (const text of [card.text, done.text, JSON.stringify(loggedCalls(r))]) {
      expect(text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    }
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
    expect(done.text.split('\n').at(-1)).toBe(
      'No undo is kept: a previous value would carry a secret.',
    );
  });
});
