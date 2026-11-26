import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { toToolError } from '../src/http/errors.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { noopSecretScope } from './helpers/scope.js';
import { createLogger } from '../src/log.js';
import { readBinding, readProjectBinding, writeBinding } from '../src/workspace/binding.js';
import { loadConfig } from '../src/config.js';
import { createStateCache } from '../src/workspace/cache.js';

const URL_A = 'https://loadcraft.example.com';
const URL_B = 'https://other.example.com';
const PROJECT = { id: 'p-1', name: 'Sklep' };

let root: string;
let lines: string[];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-state-')));
  lines = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function cache(now: () => number = Date.now) {
  const logger = createLogger({ level: 'debug', sink: (l) => lines.push(l) });
  return createStateCache(root, { logger, secrets: noopSecretScope(), clock: { now } });
}

async function rejectionOf(fn: () => Promise<unknown>): Promise<ToolError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('expected ToolError');
}

function errorOf(fn: () => unknown): ToolError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('expected ToolError');
}

describe('binding', () => {
  it('returns null when nothing is bound', () => {
    expect(readBinding(root, URL_A)).toBeNull();
  });

  it('writes a pretty-printed file with schema 1 and a trailing newline, and reads it back', () => {
    writeBinding(root, { url: URL_A, project: PROJECT });
    const raw = readFileSync(join(root, 'loadcraft', 'project.json'), 'utf8');
    expect(raw).toBe(`${JSON.stringify({ schema: 1, url: URL_A, project: PROJECT }, null, 2)}\n`);
    expect(readBinding(root, URL_A)).toEqual({ schema: 1, url: URL_A, project: PROJECT });
  });

  it('rejects a binding made for another instance', () => {
    writeBinding(root, { url: URL_A, project: PROJECT });
    expect(errorOf(() => readBinding(root, URL_B)).code).toBe('binding_other_instance');
  });

  it('treats a trailing slash and host case as the same instance', () => {
    writeBinding(root, { url: URL_A, project: PROJECT });
    expect(readBinding(root, 'https://LoadCraft.example.com/')).not.toBeNull();
  });

  it('identifies the instance of the tool call by the app URL, not the API URL', () => {
    writeBinding(root, { url: URL_A, project: PROJECT });
    const call = (env: NodeJS.ProcessEnv) => ({ config: loadConfig(env, root) });
    const ownApi = call({
      LOADCRAFT_URL: URL_A,
      LOADCRAFT_API_URL: 'https://api.internal.example.com',
    });
    expect(readProjectBinding(ownApi)?.project).toEqual(PROJECT);
    const otherApp = call({ LOADCRAFT_URL: URL_B, LOADCRAFT_API_URL: `${URL_A}/api/v1` });
    expect(errorOf(() => readProjectBinding(otherApp)).code).toBe('binding_other_instance');
  });

  it('rejects an unknown schema version with an update hint', () => {
    mkdirSync(join(root, 'loadcraft'));
    writeFileSync(
      join(root, 'loadcraft', 'project.json'),
      JSON.stringify({ schema: 2, url: URL_A, project: PROJECT }),
    );
    const error = errorOf(() => readBinding(root, URL_A));
    expect(error.code).toBe('binding_schema_unsupported');
    expect(error.params).toEqual({ schema: '2' });
    expect(toToolError(error, createTranslator('en')).hint).toMatch(/update/i);
  });

  it('rejects a malformed binding file', () => {
    mkdirSync(join(root, 'loadcraft'));
    writeFileSync(join(root, 'loadcraft', 'project.json'), '{not json');
    expect(errorOf(() => readBinding(root, URL_A)).code).toBe('binding_invalid');
  });

  it('leaves no temporary file behind after parallel writes', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          writeBinding(root, { url: URL_A, project: { id: `p-${i}`, name: 'Sklep' } }),
        ),
      ),
    );
    expect(readdirSync(join(root, 'loadcraft'))).toEqual(['project.json']);
  });
});

describe('state cache', () => {
  it('stores and reads values per section', async () => {
    const c = cache(() => 1000);
    await c.set('suggestions', 'k', { a: 1 });
    expect(c.get('suggestions', 'k')).toEqual({ savedAt: 1000, value: { a: 1 } });
    expect(c.get('drafts', 'k')).toBeUndefined();
  });

  it('persists between instances and writes the sections the spec names', async () => {
    await cache().set('harSessions', 'h', 'x');
    expect(cache().get('harSessions', 'h')?.value).toBe('x');
    const file = JSON.parse(
      readFileSync(join(root, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(
      expect.arrayContaining(['schema', 'process', 'suggestions', 'harSessions', 'drafts']),
    );
    expect(file['schema']).toBe(3);
  });

  it('creates .cache/.gitignore with * on first write only', async () => {
    const ignore = join(root, 'loadcraft/.cache/.gitignore');
    expect(existsSync(ignore)).toBe(false);
    await cache().set('drafts', 'd', 1);
    expect(readFileSync(ignore, 'utf8')).toBe('*\n');
  });

  it('lists the entries of one section in insertion order', async () => {
    const c = cache(() => 1000);
    const op = (id: string) => ({ kind: 'refine', id, startedAt: 500, saved: {} });
    await c.set('operations', 'refine:a', op('a'));
    await c.set('operations', 'refine:b', op('b'));
    await c.set('drafts', 'd', 3);
    expect(cache().entries('operations')).toEqual([
      ['refine:a', { savedAt: 1000, value: op('a') }],
      ['refine:b', { savedAt: 1000, value: op('b') }],
    ]);
  });

  it('lists nothing and writes no file when the state file does not exist', () => {
    expect(cache().entries('operations')).toEqual([]);
    expect(existsSync(join(root, 'loadcraft'))).toBe(false);
  });

  it('deletes entries', async () => {
    const c = cache();
    await c.set('drafts', 'o', 1);
    await c.delete('drafts', 'o');
    expect(cache().get('drafts', 'o')).toBeUndefined();
  });

  it('writes the entries of suggestions, harSessions and drafts as {savedAt: ISO, value}', async () => {
    const at = Date.parse('2026-11-26T10:00:00.000Z');
    const c = cache(() => at);
    await c.set('suggestions', 's', { a: 1 });
    await c.set('harSessions', 'h', 'x');
    await c.set('drafts', 'd', [1]);
    const file = JSON.parse(
      readFileSync(join(root, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    const iso = new Date(at).toISOString();
    expect(file['suggestions']).toEqual({ s: { savedAt: iso, value: { a: 1 } } });
    expect(file['harSessions']).toEqual({ h: { savedAt: iso, value: 'x' } });
    expect(file['drafts']).toEqual({ d: { savedAt: iso, value: [1] } });
    // the tools still see milliseconds
    expect(cache(() => at).get('drafts', 'd')).toEqual({ savedAt: at, value: [1] });
  });

  it('keeps the series of account provisioning in accountSeries, keyed by the dataset, never in drafts', async () => {
    const at = Date.parse('2026-11-26T10:00:00.000Z');
    const c = cache(() => at);
    await c.set('accountSeries', 'ds-1', { baseline: 3, count: 10 });
    const file = JSON.parse(
      readFileSync(join(root, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    expect(file['accountSeries']).toEqual({
      'ds-1': { savedAt: new Date(at).toISOString(), value: { baseline: 3, count: 10 } },
    });
    expect(file['drafts']).toEqual({});
    expect(cache(() => at).get('accountSeries', 'ds-1')?.value).toEqual({ baseline: 3, count: 10 });
    await c.delete('accountSeries', 'ds-1');
    expect(cache(() => at).get('accountSeries', 'ds-1')).toBeUndefined();
  });

  it('refuses a key of operations that is not a handle, instead of hiding it in drafts', async () => {
    const c = cache();
    const error = await rejectionOf(() =>
      c.set('operations', 'provision:ds-1', { baseline: 1, count: 2 }),
    );
    expect(error.code).toBe('internal_error');
    expect(existsSync(join(root, 'loadcraft/.cache/state.json'))).toBe(false);
    expect(c.get('operations', 'provision:ds-1')).toBeUndefined();
  });

  it.each([
    ['suggestions', 24 * 3_600_000],
    ['harSessions', 24 * 3_600_000],
    ['drafts', 7 * 24 * 3_600_000],
    ['accountSeries', 7 * 24 * 3_600_000],
  ] as const)(
    '%s: an entry past its time to live is not read and the next write drops it',
    async (section, ttl) => {
      let t = Date.parse('2026-11-20T10:00:00.000Z');
      const value = section === 'accountSeries' ? { baseline: 0, count: 1 } : 1;
      await cache(() => t).set(section, 'old', value);
      t += ttl - 1000;
      await cache(() => t).set(section, 'young', value);
      expect(cache(() => t).get(section, 'old')).toBeDefined();
      t += 2000;
      expect(cache(() => t).get(section, 'old')).toBeUndefined();
      expect(cache(() => t).get(section, 'young')).toBeDefined();
      await cache(() => t).set('drafts', 'touch', 1);
      const file = JSON.parse(
        readFileSync(join(root, 'loadcraft/.cache/state.json'), 'utf8'),
      ) as Record<string, Record<string, unknown>>;
      expect(Object.keys(file[section] ?? {})).not.toContain('old');
      expect(Object.keys(file[section] ?? {})).toContain('young');
    },
  );

  it.each([
    ['suggestions', 50],
    ['harSessions', 20],
    ['drafts', 50],
    ['accountSeries', 100],
  ] as const)('%s keeps at most %i entries, the oldest dropped', async (section, max) => {
    let t = Date.parse('2026-11-26T10:00:00.000Z');
    const value = section === 'accountSeries' ? { baseline: 0, count: 1 } : 1;
    for (let i = 0; i <= max; i += 1) {
      t += 1000;
      await cache(() => t).set(section, `k${String(i)}`, value);
    }
    const kept = cache(() => t)
      .entries(section)
      .map(([key]) => key);
    expect(kept).toHaveLength(max);
    expect(kept).not.toContain('k0');
    expect(kept).toContain(`k${String(max)}`);
  });

  it('prunes entries older than maxAgeMs and reports the count', async () => {
    let t = 0;
    const c = cache(() => t);
    await c.set('suggestions', 'old', 1);
    t = 5000;
    await c.set('suggestions', 'new', 2);
    t = 6000;
    expect(await c.prune(2000)).toBe(1);
    expect(c.get('suggestions', 'old')).toBeUndefined();
    expect(c.get('suggestions', 'new')).toBeDefined();
  });

  it('moves a corrupted file to state.json.bak, starts empty and warns', async () => {
    mkdirSync(join(root, 'loadcraft/.cache'), { recursive: true });
    writeFileSync(join(root, 'loadcraft/.cache/state.json'), '{broken');
    const c = cache();
    expect(c.get('drafts', 'x')).toBeUndefined();
    expect(readFileSync(join(root, 'loadcraft/.cache/state.json.bak'), 'utf8')).toBe('{broken');
    expect(lines.some((l) => l.includes('"level":"warn"'))).toBe(true);
    await c.set('drafts', 'x', 1);
    expect(cache().get('drafts', 'x')).toBeDefined();
  });

  it('rejects an unknown schema version with an update hint and keeps the file', () => {
    mkdirSync(join(root, 'loadcraft/.cache'), { recursive: true });
    const path = join(root, 'loadcraft/.cache/state.json');
    writeFileSync(path, JSON.stringify({ schema: 9 }));
    const error = errorOf(() => cache().get('drafts', 'x'));
    expect(error.code).toBe('state_schema_unsupported');
    expect(error.params).toEqual({ schema: '9' });
    expect(toToolError(error, createTranslator('en')).hint).toMatch(/update/i);
    expect(existsSync(path)).toBe(true);
  });

  it('refuses to store an object that contains a Secret', async () => {
    class Secret {
      reveal(): string {
        return 'CANARY-SECRET-7f3a';
      }
    }
    const c = cache();
    const error = await rejectionOf(() =>
      c.set('drafts', 'd', { nested: [{ password: new Secret() }] }),
    );
    expect(error.code).toBe('secret_not_storable');
    expect(existsSync(join(root, 'loadcraft/.cache/state.json'))).toBe(false);
    expect(error.message).not.toContain('CANARY-SECRET-7f3a');
  });

  it('leaves no temporary file behind after parallel writes', async () => {
    const c = cache();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() => c.set('drafts', `o${i}`, i)),
      ),
    );
    const names = readdirSync(join(root, 'loadcraft/.cache')).sort();
    expect(names).toEqual(['.gitignore', 'state.json']);
    expect(Object.keys(cache().get('drafts', 'o19') ?? {})).toContain('value');
  });
});

describe('links leaving the workspace', () => {
  let outside: string;

  beforeEach(() => {
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'lc-out-')));
  });

  afterEach(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it('refuses to write the cache through a linked .cache directory', async () => {
    mkdirSync(join(root, 'loadcraft'));
    symlinkSync(outside, join(root, 'loadcraft', '.cache'));
    expect((await rejectionOf(() => cache().set('drafts', 'd', 1))).code).toBe(
      'path_outside_workspace',
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses to read or replace a project.json linked to a file outside', () => {
    mkdirSync(join(root, 'loadcraft'));
    const target = join(outside, 'target.json');
    writeFileSync(target, 'ORIGINAL');
    symlinkSync(target, join(root, 'loadcraft', 'project.json'));
    expect(errorOf(() => readBinding(root, URL_A)).code).toBe('path_outside_workspace');
    expect(errorOf(() => writeBinding(root, { url: URL_A, project: PROJECT })).code).toBe(
      'path_outside_workspace',
    );
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL');
  });

  it('turns invalid binding input into binding_invalid', () => {
    expect(errorOf(() => writeBinding(root, { url: '', project: PROJECT })).code).toBe(
      'binding_invalid',
    );
  });

  it('fills a section missing from an otherwise valid state file', () => {
    mkdirSync(join(root, 'loadcraft/.cache'), { recursive: true });
    writeFileSync(
      join(root, 'loadcraft/.cache/state.json'),
      JSON.stringify({ schema: 1, drafts: { d: { savedAt: Date.now(), value: 'x' } } }),
    );
    const c = cache();
    expect(c.get('drafts', 'd')?.value).toBe('x');
    expect(c.get('operations', 'o')).toBeUndefined();
    expect(existsSync(join(root, 'loadcraft/.cache/state.json.bak'))).toBe(false);
  });
});
