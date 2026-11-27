// The mask on answers recorded from a real backend (DOKTOR-03, `test/fixtures/real-answers/`,
// neutralised before they were committed). The heuristic that registers the values of fields of a
// secret name took NAMES for values: the `key` of an API-map area and operation, a schema's
// `properties.password`, the `session_variables` of a plan, a file of `modular_files`, a header that
// only refers to a variable (`#{…}`). Registered, each was cut out of every text and every key of the
// call: all operations "[redacted]", `properties: ["email", "[redacted]"]`, an object key turned
// "[redacted]". Names are never registered now, and a scrub never changes the keys of an object.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/log.js';
import { secretFieldValues } from '../../src/security/secretFields.js';
import { maskText } from '../../src/security/traceMask.js';
import { projectGetApimap } from '../../src/tools/project/getApimap.js';
import { CallSecretScope } from '../../src/workspace/secrets.js';
import { registerApiMapRoute } from '../fake-backend/routes/documentation.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { seedSklep } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createTestClock } from '../helpers/clock.js';
import { toolRig } from '../helpers/rig.js';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'real-answers');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;

/** Every key of every object in `value`, and every string, as a flat list. */
function keysAndStrings(value: unknown, keys: string[] = [], strings: string[] = []) {
  if (typeof value === 'string') strings.push(value);
  else if (Array.isArray(value)) for (const item of value) keysAndStrings(item, keys, strings);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      keysAndStrings(item, keys, strings);
    }
  }
  return { keys, strings };
}

const scope = (values: readonly string[]): CallSecretScope => {
  const s = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  for (const value of values) if (value.length >= 4) s.add(value);
  return s;
};

describe('the values registered from a real answer', () => {
  it.each(['api-map', 'endpoint', 'endpoint-binding', 'scenario-contract'])(
    '%s: none, it carries names and descriptions only',
    (name) => {
      expect(secretFieldValues(fixture(name), { ownContract: true })).toEqual([]);
    },
  );

  it('scenario: only the fingerprint of a column, never a name, a description, a file or a reference', () => {
    const body = fixture('scenario');
    const values = secretFieldValues(body, { ownContract: true });
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value, value.slice(0, 20)).toMatch(/^[0-9a-f]{32,}$/u);
  });

  it.each(['api-map', 'endpoint', 'scenario'])(
    '%s scrubbed by its own registered values is the same answer',
    (name) => {
      const body = fixture(name);
      const registered = new Set(secretFieldValues(body, { ownContract: true }));
      const scrubbed = scope([...registered]).scrubDeep(body, { keys: 'keep' });
      const before = keysAndStrings(body);
      const after = keysAndStrings(scrubbed);
      expect(after.keys).toEqual(before.keys);
      // the registered values (column fingerprints) are replaced, nothing else changes
      const expected = before.strings.map((text) => (registered.has(text) ? '[redacted]' : text));
      expect(after.strings).toEqual(expected);
    },
  );
});

describe("the scrub of a tool's data never changes the keys of an object", () => {
  it('keeps every key, scrubs the values, and leaves out an entry whose key is a secret', () => {
    const s = scope(['failure-canary-91', 'secret-key-canary-17']);
    const scrubbed = s.scrubDeep(
      {
        failure: { message: 'saw failure-canary-91' },
        'secret-key-canary-17': 'x',
        password: 'kept as a key',
      },
      { keys: 'keep' },
    ) as Record<string, unknown>;
    expect(Object.keys(scrubbed)).toEqual(['failure', 'password']);
    expect(JSON.stringify(scrubbed)).not.toContain('canary');
  });

  it('the state file keeps its rule: a key that holds a secret is scrubbed', () => {
    const s = scope(['secret-key-canary-17']);
    expect(Object.keys(s.scrubDeep({ 'secret-key-canary-17': 1 }))).toEqual(['[redacted]']);
  });
});

describe('project_get_apimap on the real map', () => {
  it('shows the operations by name, none redacted', async () => {
    const r = await toolRig({
      tools: [projectGetApimap],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerApiMapRoute(fake);
        seedSklep(fake.store, { stage: 'project' });
      },
      clock: createTestClock(Date.parse('2026-11-27T09:00:00Z')),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    r.fake.faults.next('GET', `/api/v1/projects/${SKLEP_IDS.project}/api-map`, {
      status: 200,
      body: fixture('api-map'),
    });
    const text = await r.call('project_get_apimap', {});
    expect(text.isError, text.text).toBe(false);
    expect(text.text).toContain(
      'DELETE /store/carts/{id}/line-items/{line_id}, GET /store/carts/{id}',
    );
    expect(text.text).not.toContain('[redacted]');
    r.fake.faults.next('GET', `/api/v1/projects/${SKLEP_IDS.project}/api-map`, {
      status: 200,
      body: fixture('api-map'),
    });
    const data = await r.call('project_get_apimap', { format: 'data' });
    expect(data.text).toContain('DELETE /store/carts/{id}/line-items/{line_id}');
    expect(data.text).not.toContain('[redacted]');
  });
});

describe('the mask by shape on the words of real documentation', () => {
  it('documentation: every text of the endpoint as written, words after token or password are words', () => {
    const { strings } = keysAndStrings(fixture('endpoint'));
    const changed = strings.filter((text) => maskText(text, { documentation: true }).text !== text);
    expect(changed).toEqual([]);
  });

  it.each([
    ['Your password is hunter2x', 'Your password is [redacted]'],
    ['code 493021 expires', 'code [redacted] expires'],
    ['Authorization: Bearer abcdefghijkl', 'Authorization: Bearer [redacted]'],
  ])('still masks a value: %s', (text, shown) => {
    expect(maskText(text).text).toBe(shown);
  });

  it('a placeholder after the scheme is not a credential', () => {
    expect(maskText('send `Authorization: Bearer <token>` on calls').text).toBe(
      'send `Authorization: Bearer <token>` on calls',
    );
  });
});

describe("defence in depth: a credential under its own name in LoadCraft's answer", () => {
  it.each([
    [{ password: 'hunter2' }, 'hunter2'],
    [{ settings: { api_key: 'abcdefgh' } }, 'abcdefgh'],
    [{ auth: { client_secret: 'plainword' } }, 'plainword'],
    [{ session: { access_token: 'Bearer abcdefghij' } }, 'Bearer abcdefghij'],
  ])('is registered without an x-secret mark: %j', (body, value) => {
    expect(secretFieldValues(body, { ownContract: true })).toContain(value);
  });

  it.each([
    { properties: { password: { type: 'string', description: 'The password of the account' } } },
    { schema: { required: ['password', 'token'] } },
    { contract: { required_inputs: ['token'], locals: ['password'] } },
    { headers: { Authorization: 'Bearer #{token}' } },
    { token: '{{auth_token}}' },
  ])('is not a name, a schema or a reference: %j', (body) => {
    expect(secretFieldValues(body, { ownContract: true })).toEqual([]);
  });
});

describe('the mask by shape on text of a third party keeps the stricter rule', () => {
  it.each([
    ['password=hunter', 'password=[redacted]'],
    ['password: hunter', 'password: [redacted]'],
    ['{"password":"hunter"}', '{"password":"[redacted]"}'],
    ['login failed: password is hunter', 'login failed: password is [redacted]'],
    ['token payload rejected', 'token [redacted] rejected'],
  ])('a log line of the target: %s', (text, shown) => {
    expect(maskText(text).text).toBe(shown);
  });

  it('the same words in documentation stay words', () => {
    expect(maskText('token payload rejected', { documentation: true }).text).toBe(
      'token payload rejected',
    );
    expect(maskText('Password should be a string', { documentation: true }).text).toBe(
      'Password should be a string',
    );
    expect(maskText('password=hunter', { documentation: true }).text).toBe('password=[redacted]');
  });
});

describe('the mask by shape on generated code and text of a third party (DOKTOR-03 S1)', () => {
  it('masks a plain word after a keyword in place but never registers it', () => {
    const masked = maskText('the token passed the gate');
    expect(masked.text).toBe('the token [redacted] the gate');
    expect(masked.secrets).not.toContain('passed');
  });

  it.each([
    '{"email":"#{email}","password":"#{password}"}',
    'Authorization: Bearer {{registration_token}}',
    'password={{customer_password}}',
    'token: ${auth_token}',
  ])('a reference to a variable is not a secret: %s', (text) => {
    expect(maskText(text)).toEqual({ text, secrets: [] });
  });

  it('a property in a path into a document is not a keyword', () => {
    const text = 'jsonPath("$.token").optional.saveAs("registration_token")';
    expect(maskText(text).text).toBe(text);
  });
});
