// The secret fields of the contract reach the mask. The generator collects, for every operation, the
// paths of the fields the snapshot marks secret (`writeOnly`, `format: password`, `x-secret`) and the
// ones `contracts/secret-fields.json` adds while the snapshot does not mark them yet; `callOperation`
// registers what it sends and receives at those paths with the secret scope of the tool call, so
// every output of the call masks it.
//
// The adversary: for every operation of the catalog tools with `secret: true`, a sentinel in each of
// those fields (sent by the tool, or answered by the fake backend in a body the snapshot accepts)
// never reaches the result of the tool, the state file (log entry and its detail) or the server log,
// even when the tool copies it into every field its log entry reads. The same check run on a table
// generated with the marking removed from a copy finds the sentinel.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { createHttp } from '../src/http/client.js';
import { OPERATIONS, type OperationId } from '../src/http/generated/operations.js';
import { SECRET_PATHS, type SecretPaths } from '../src/http/generated/secrets.js';
import { callOperation, operationCaller, type CallOperation } from '../src/http/operation.js';
import { createLogger, type Logger } from '../src/log.js';
import { defineTool, registerTools, type Tool } from '../src/registry.js';
import { REDACTED, secretValuesAt } from '../src/secret.js';
import { isSecretField } from '../src/security/secretFields.js';
import { createServices } from '../src/server.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import {
  emitSecrets,
  markedPaths,
  publicPathsOf,
  secretPathsOf,
  type SecretFieldsFile,
  type SecretPathTable,
} from '../scripts/gen-operations/secretPaths.ts';
import { startFake, type Fake } from './fake-backend/server.js';
import { assertNoCanary, BACKEND_CANARY, FILE_CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { pathSegments, sample, type SampleDocument } from './helpers/contractSample.js';
import { connect, type McpSession } from './helpers/mcp.js';

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(import.meta.dirname, '..');
const CONTRACT_FILE = join(ROOT, '..', 'contracts', 'loadcraft-openapi.json');
const FIELDS_FILE = join(ROOT, '..', 'contracts', 'secret-fields.json');
const START = Date.parse('2026-11-26T10:00:00Z');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

type Json = Record<string, unknown>;

interface ContractParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly schema?: unknown;
}
interface ContractOperation {
  readonly operationId: string;
  readonly parameters?: readonly ContractParameter[];
  readonly requestBody?: { readonly content?: Readonly<Record<string, { schema?: unknown }>> };
  readonly responses?: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { schema?: unknown }>> }>
  >;
}
interface ContractDocument extends SampleDocument {
  readonly paths: Readonly<
    Record<string, Partial<Record<(typeof METHODS)[number], ContractOperation>> & Json>
  >;
}
interface Catalog {
  modules: {
    tools: {
      name: string;
      secret: boolean;
      log: { args: string; result: string };
      operations: { operationId: string }[];
    }[];
  }[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const contract = readJson<ContractDocument>(CONTRACT_FILE);
const fields = readJson<SecretFieldsFile>(FIELDS_FILE);
const catalog = readJson<Catalog>(join(ROOT, 'catalog', 'katalog.json'));
const copy = <T>(value: T): T => structuredClone(value);

const SECRET_TOOLS = catalog.modules.flatMap((m) => m.tools).filter((t) => t.secret);

/** Every operation of a tool with `secret: true`, with the tool it belongs to. */
const SECRET_OPERATIONS = SECRET_TOOLS.flatMap((tool) =>
  tool.operations.map((o) => ({ tool: tool.name, operationId: o.operationId })),
);

function contractOperation(id: string): {
  operation: ContractOperation;
  shared: readonly ContractParameter[];
} {
  for (const item of Object.values(contract.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation?.operationId === id) {
        const shared = Array.isArray(item.parameters)
          ? (item.parameters as ContractParameter[])
          : [];
        return { operation, shared };
      }
    }
  }
  throw new Error(`${id} is not in the snapshot`);
}

const secretPathsAt = (id: string): SecretPaths | undefined =>
  Object.hasOwn(SECRET_PATHS, id) ? SECRET_PATHS[id as OperationId] : undefined;

const tableObject = (table: SecretPathTable): Record<string, SecretPaths> =>
  Object.fromEntries(
    [...table].map(([id, row]) => [id, { request: row.request, response: row.response }]),
  );

// ---- the generator -----------------------------------------------------------------------------

const MINI = {
  openapi: '3.1.0',
  paths: {
    '/a/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'op_a',
        parameters: [
          { name: 'key', in: 'query', schema: { type: 'string', 'x-secret': true } },
          { name: 'x-api-key', in: 'header', 'x-secret': true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } },
        },
        responses: {
          '201': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Answer' } } },
          },
          '422': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { password: { type: 'string', format: 'password' } },
                },
              },
            },
          },
        },
      },
    },
    '/b': {
      get: {
        operationId: 'op_b',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    extra: { type: 'object' },
                    pairs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { name: { type: 'string' }, value: { type: 'string' } },
                      },
                    },
                    vars: { type: 'object', additionalProperties: { type: 'string' } },
                    plain: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Login: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          password: { type: 'string', format: 'password', writeOnly: true },
        },
      },
      Answer: {
        type: 'object',
        properties: {
          token: { anyOf: [{ type: 'string', 'x-secret': true }, { type: 'null' }] },
          accounts: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/Account' }] } },
          headers: { type: 'object', additionalProperties: { type: 'string', 'x-secret': true } },
          vault: {
            'x-secret': true,
            type: 'object',
            properties: { inner: { type: 'string', format: 'password' } },
          },
          tree: { $ref: '#/components/schemas/Node' },
        },
      },
      Account: {
        type: 'object',
        properties: { email: { type: 'string' }, pin: { type: 'string', writeOnly: true } },
      },
      Node: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  },
};

const none = (): SecretFieldsFile => ({ fields: {}, without_fields: {} });

describe('the generator: paths of the fields the contract marks secret', () => {
  it('collects writeOnly, format password and x-secret through refs, compositions, lists and maps', () => {
    const table = markedPaths(MINI);
    expect(tableObject(table)).toEqual({
      op_a: {
        request: ['body.password', 'header.x-api-key', 'query.key'],
        response: ['accounts[].pin', 'headers.*', 'token', 'vault'],
      },
    });
  });

  it('reads the answers of success only and stops at a recursive schema', () => {
    const table = markedPaths(MINI);
    expect(table.get('op_a')?.response).not.toContain('password');
    expect(table.has('op_b')).toBe(false);
  });

  it('refuses a marked property whose name cannot be written as a path', () => {
    const doc = copy(MINI);
    const properties: Json = doc.components.schemas.Login.properties;
    properties['a.b'] = { type: 'string', format: 'password' };
    expect(() => markedPaths(doc)).toThrow(/a\.b/);
  });

  it('adds the fields of contracts/secret-fields.json with their reason', () => {
    const table = secretPathsOf(MINI, {
      fields: {
        op_b: {
          reason: 'holds a key',
          response: ['name', 'extra.password', 'pairs[secret].value', 'vars.*secret'],
          shape: { extra: 'Login' },
        },
      },
      without_fields: {},
    });
    expect(table.get('op_b')).toEqual({
      request: [],
      response: ['extra.password', 'name', 'pairs[secret].value', 'vars.*secret'],
      reason: 'holds a key',
    });
  });

  it('a path may end at a map of no declared shape; past it, a part with no schema is said so', () => {
    const at = (response: string[], shape?: SecretFieldsFile['fields'][string]['shape']) =>
      secretPathsOf(MINI, {
        fields: { op_b: { reason: 'r', response, ...(shape === undefined ? {} : { shape }) } },
        without_fields: {},
      }).get('op_b')?.response;
    expect(at(['extra.*'])).toEqual(['extra.*']);
    expect(at(['extra.rows'], { extra: { undescribed: 'kept as stored' } })).toEqual([
      'extra.rows',
    ]);
  });

  it('a public field of the answer is named with its reason and is not a secret path', () => {
    const table = secretPathsOf(MINI, {
      fields: {
        op_b: { reason: 'r', response: ['vars.*secret'], public: { name: 'an identifier' } },
      },
      without_fields: {},
    });
    expect(table.get('op_b')?.response).toEqual(['vars.*secret']);
    expect(
      publicPathsOf(MINI, {
        fields: { op_b: { reason: 'r', public: { name: 'id' } } },
        without_fields: {},
      }).get('op_b'),
    ).toEqual(['name']);
  });

  it.each([
    ['an unknown operation', { fields: { op_x: { reason: 'r', response: ['a'] } } }, /op_x/],
    [
      'a path the schema does not have',
      { fields: { op_b: { reason: 'r', response: ['nope'] } } },
      /nope/,
    ],
    [
      'a request root other than body, query, header or path',
      { fields: { op_b: { reason: 'r', request: ['cookie.a'] } } },
      /cookie\.a/,
    ],
    [
      'a field the contract already marks',
      { fields: { op_a: { reason: 'r', response: ['token'] } } },
      /token/,
    ],
    [
      'an exception without a reason',
      { fields: { op_b: { reason: ' ', response: ['name'] } } },
      /reason/,
    ],
    ['an exception without a path', { fields: { op_b: { reason: 'r' } } }, /op_b/],
    ['no fields for an operation the contract marks', { without_fields: { op_a: 'r' } }, /op_a/],
    [
      'an operation both with and without fields',
      { fields: { op_b: { reason: 'r', response: ['name'] } }, without_fields: { op_b: 'r' } },
      /op_b/,
    ],
    ['no fields without a reason', { without_fields: { op_b: '' } }, /reason/],
    [
      'a field under a part of no declared shape without the schema that describes it',
      { fields: { op_b: { reason: 'r', response: ['extra.password'] } } },
      /extra.*shape/,
    ],
    [
      'a misspelt field under a described part',
      { fields: { op_b: { reason: 'r', response: ['extra.pasword'], shape: { extra: 'Login' } } } },
      /pasword/,
    ],
    [
      'a schema the snapshot does not have',
      { fields: { op_b: { reason: 'r', response: ['extra.password'], shape: { extra: 'Nope' } } } },
      /Nope/,
    ],
    [
      'a schema no path goes through',
      { fields: { op_b: { reason: 'r', response: ['extra.*'], shape: { name: 'Login' } } } },
      /name/,
    ],
    [
      'an undescribed part without a reason',
      {
        fields: {
          op_b: { reason: 'r', response: ['extra.a'], shape: { extra: { undescribed: ' ' } } },
        },
      },
      /reason/,
    ],
    [
      'an item by name in a list whose items have no name',
      { fields: { op_b: { reason: 'r', response: ['plain[secret]'] } } },
      /plain/,
    ],
    [
      'an unknown key of an entry',
      { fields: { op_b: { reason: 'r', reponse: ['name'] } } },
      /reponse/,
    ],
    ['an unknown key of the file', { feilds: {} }, /feilds/],
    [
      'a public field the answer does not have',
      { fields: { op_b: { reason: 'r', public: { nope: 'id' } } } },
      /nope/,
    ],
    [
      'a public field without a reason',
      { fields: { op_b: { reason: 'r', public: { name: '' } } } },
      /reason/,
    ],
    [
      'a public field that is also a secret field',
      { fields: { op_b: { reason: 'r', response: ['name'], public: { name: 'id' } } } },
      /name/,
    ],
  ])('refuses %s', (_label, partial, message) => {
    expect(() => secretPathsOf(MINI, { ...none(), ...partial })).toThrow(message);
  });

  it('the committed src/http/generated/secrets.ts is the table of the snapshot and the exceptions', () => {
    const committed = readFileSync(join(ROOT, 'src', 'http', 'generated', 'secrets.ts'), 'utf8');
    expect(emitSecrets(secretPathsOf(contract, fields))).toBe(committed);
  });

  it('--check goes red when an exception changed and the file was not regenerated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-secret-fields-'));
    try {
      const changed = copy(fields);
      // An exception that names a field changes the table; one that only names a public field does not.
      const first = Object.entries(changed.fields).find(
        ([, entry]) => (entry.request?.length ?? 0) + (entry.response?.length ?? 0) > 0,
      )?.[0];
      if (first === undefined) throw new Error('no exception to drop');
      delete changed.fields[first];
      const file = join(dir, 'secret-fields.json');
      writeFileSync(file, JSON.stringify(changed));
      const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts', 'gen-operations.mjs'), '--check', '--secret-fields', file],
        { encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('secrets.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- x-secret: "by-name" -----------------------------------------------------------------------

/** MINI whose answer of op_b marks its map, its list of {name, value} and a nullable map by name. */
function byNameDocument(): typeof MINI {
  const doc = copy(MINI);
  const answer = doc.paths['/b'].get.responses['200'].content['application/json'].schema;
  const properties: Json = answer.properties;
  properties.vars = { 'x-secret': 'by-name', type: 'object', additionalProperties: true };
  properties.pairs = {
    'x-secret': 'by-name',
    type: 'array',
    items: { $ref: '#/components/schemas/Pair' },
  };
  properties.extra = {
    'x-secret': 'by-name',
    anyOf: [{ type: 'object', additionalProperties: { type: 'string' } }, { type: 'null' }],
  };
  properties.loose = { 'x-secret': 'by-name', type: 'object' };
  const schemas: Json = doc.components.schemas;
  schemas.Pair = {
    type: 'object',
    properties: { name: { type: 'string' }, value: { type: 'string' } },
  };
  return doc;
}

/** The schema of a property of the answer of op_b in `doc`, to change in a test. */
const answerProperty = (doc: typeof MINI, name: string): Json => {
  const answer = doc.paths['/b'].get.responses['200'].content['application/json'].schema;
  const properties: Json = answer.properties;
  return properties[name] as Json;
};

describe('the generator: x-secret "by-name" marks the secret-named values of a map or a list', () => {
  it('a map gives *secret, a list of {name, value} gives [secret].value, beside anyOf and $ref', () => {
    expect(markedPaths(byNameDocument()).get('op_b')).toEqual({
      request: [],
      response: ['extra.*secret', 'loose.*secret', 'pairs[secret].value', 'vars.*secret'],
    });
  });

  it('a parameter marked by name and a request body map marked by name', () => {
    const doc = copy(MINI);
    const op: Json = doc.paths['/a/{id}'].post;
    (op.parameters as Json[]).push({
      name: 'filter',
      in: 'query',
      'x-secret': 'by-name',
      schema: { type: 'object', additionalProperties: { type: 'string' } },
    });
    const login: Json = doc.components.schemas.Login.properties;
    login.extra = { 'x-secret': 'by-name', type: 'object', additionalProperties: true };
    expect(markedPaths(doc).get('op_a')?.request).toEqual([
      'body.extra.*secret',
      'body.password',
      'header.x-api-key',
      'query.filter.*secret',
      'query.key',
    ]);
  });

  it('a map of maps marked by name inside gives *.*secret', () => {
    const doc = copy(MINI);
    answerProperty(doc, 'vars').additionalProperties = {
      'x-secret': 'by-name',
      type: 'object',
      additionalProperties: true,
    };
    expect(markedPaths(doc).get('op_b')?.response).toEqual(['vars.*.*secret']);
  });

  it.each([
    ['the same map path', 'vars.*secret'],
    ['the same item path', 'pairs[secret].value'],
  ])('an exception of %s the contract marks by name already marks it', (_label, path) => {
    expect(() =>
      secretPathsOf(byNameDocument(), {
        fields: { op_b: { reason: 'r', response: [path] } },
        without_fields: {},
      }),
    ).toThrow(/already marks/);
  });

  it.each([
    ['a whole map marked true and an exception *secret under it', 'vars', 'vars.*secret'],
    ['every value of a map marked true and an exception *secret', 'vars.*', 'vars.*secret'],
    [
      'every item of a list marked true and an exception [secret]',
      'pairs[]',
      'pairs[secret].value',
    ],
  ])('%s: the contract already marks the exception', (_label, marked, path) => {
    const doc = byNameDocument();
    if (marked === 'vars') answerProperty(doc, 'vars')['x-secret'] = true;
    if (marked === 'vars.*') {
      delete answerProperty(doc, 'vars')['x-secret'];
      answerProperty(doc, 'vars').additionalProperties = { 'x-secret': true };
    }
    if (marked === 'pairs[]') {
      delete answerProperty(doc, 'pairs')['x-secret'];
      answerProperty(doc, 'pairs').items = {
        $ref: '#/components/schemas/Pair',
        'x-secret': true,
      };
    }
    expect(markedPaths(doc).get('op_b')?.response).toContain(marked);
    expect(() =>
      secretPathsOf(doc, {
        fields: { op_b: { reason: 'r', response: [path] } },
        without_fields: {},
      }),
    ).toThrow(new RegExp(`already marks.*${escapeRegExp(marked)}`));
  });

  it('an exception wider than the mark of the contract is kept (every value of a map marked by name)', () => {
    const table = secretPathsOf(byNameDocument(), {
      fields: { op_b: { reason: 'every value of it', response: ['vars.*'] } },
      without_fields: {},
    });
    expect(table.get('op_b')?.response).toContain('vars.*');
  });

  it('a public field under a field the contract marks is refused', () => {
    const doc = byNameDocument();
    answerProperty(doc, 'pairs')['x-secret'] = true;
    expect(() =>
      secretPathsOf(doc, {
        fields: { op_b: { reason: 'r', public: { 'pairs[].name': 'a name' } } },
        without_fields: {},
      }),
    ).toThrow(/pairs\[\]\.name cannot be both/);
  });

  it.each([
    ['a string', { type: 'string' }],
    ['a list of strings', { type: 'array', items: { type: 'string' } }],
    [
      'a list whose items have no value',
      { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    ],
    [
      'an object of declared properties only',
      { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
    ],
    [
      'a map or a list',
      {
        anyOf: [
          { type: 'object', additionalProperties: true },
          { type: 'array', items: { $ref: '#/components/schemas/Pair' } },
        ],
      },
    ],
    ['only null', { type: 'null' }],
  ])('refuses "by-name" on %s', (_label, schema) => {
    const doc = byNameDocument();
    const answer = doc.paths['/b'].get.responses['200'].content['application/json'].schema;
    const properties: Json = answer.properties;
    properties.odd = { ...schema, 'x-secret': 'by-name' };
    expect(() => markedPaths(doc)).toThrow(/op_b.*odd.*by-name/);
  });

  it.each([
    ['a string other than "by-name"', 'by-key'],
    ['false', false],
    ['a number', 1],
  ])('refuses an x-secret value that is %s, in a schema and in a parameter', (_label, value) => {
    const inSchema = byNameDocument();
    answerProperty(inSchema, 'vars')['x-secret'] = value;
    expect(() => markedPaths(inSchema)).toThrow(/op_b.*vars.*x-secret/);
    const inParameter = copy(MINI);
    const parameters: Json[] = inParameter.paths['/a/{id}'].post.parameters;
    const page = parameters[2];
    if (page === undefined) throw new Error('MINI has no third parameter');
    page['x-secret'] = value;
    expect(() => markedPaths(inParameter)).toThrow(/op_a.*query\.page.*x-secret/);
  });
});

// ---- the mask by path --------------------------------------------------------------------------

describe('secretValuesAt: the values at the paths of a value', () => {
  const answer = {
    token: 'tok-12345',
    items: [
      { auth: { password: 'pw-1', user: 'anna' }, headers: { 'x-api-key': 'k-1', accept: 'json' } },
      { auth: { password: 'pw-2', user: 'jan' }, headers: {} },
    ],
    nested: { deep: { list: [['a-1', 'a-2'], ['a-3']] } },
    vault: { inner: { a: 'v-1', b: [1234, true, null] } },
  };

  const valuesAt = (value: unknown, paths: readonly string[]): string[] =>
    secretValuesAt(value, paths, isSecretField);

  it('follows properties, items of lists and values of maps', () => {
    expect(valuesAt(answer, ['token', 'items[].auth.password', 'items[].headers.*'])).toEqual([
      'tok-12345',
      'pw-1',
      'pw-2',
      'k-1',
      'json',
    ]);
  });

  it('*secret takes the values under keys that name a secret, [secret] the items whose name does', () => {
    const effective = {
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer h-1' },
      ],
      auth: {
        auth_config: {
          username: 'anna',
          password: 'pw-9',
          token_endpoint: 'https://id.example.com/t',
        },
      },
    };
    expect(valuesAt(effective, ['headers[secret].value', 'auth.auth_config.*secret'])).toEqual([
      'Bearer h-1',
      'pw-9',
    ]);
    expect(valuesAt(answer, ['items[].headers.*secret'])).toEqual(['k-1']);
  });

  it('a list of lists and a root list', () => {
    expect(valuesAt(answer, ['nested.deep.list[][]'])).toEqual(['a-1', 'a-2', 'a-3']);
    expect(valuesAt([{ a: 's-1' }, { a: 's-2' }], ['[].a'])).toEqual(['s-1', 's-2']);
  });

  it('a field that holds an object or a list gives every string and number under it', () => {
    expect(valuesAt(answer, ['vault'])).toEqual(['v-1', '1234']);
  });

  it('a missing field, a null and a value of another shape give nothing', () => {
    expect(
      valuesAt({ token: null, items: 'x', nested: [] }, [
        'token',
        'items[].a',
        'nested.deep',
        'gone',
      ]),
    ).toEqual([]);
  });

  it('the fields of a multipart form', () => {
    const form = new FormData();
    form.set('password', 'form-pw');
    form.set('file', new Blob(['data']), 'a.txt');
    expect(valuesAt({ body: form }, ['body.password', 'body.file'])).toEqual(['form-pw']);
  });
});

describe('callOperation and the secret fields of an operation', () => {
  it('refuses to call an operation with secret fields without the secret scope of the call', async () => {
    const log = createLogger({ level: 'error', sink: () => undefined });
    const config = loadConfig(
      { LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1', LOADCRAFT_API_TOKEN: 'tok-test-1' },
      tmpdir(),
    );
    const id = Object.keys(SECRET_PATHS)[0] as OperationId | undefined;
    if (id === undefined) throw new Error('no operation with secret fields');
    const call = callOperation as (...args: unknown[]) => Promise<unknown>;
    await expect(call(createHttp(config, log), id, {})).rejects.toThrow(
      new TypeError(
        `${id}: the contract marks secret fields of this operation; pass the secret scope of the call (options.secrets)`,
      ),
    );
  });

  it('refuses every operation whose request carries a field marked by name, without the secret scope', async () => {
    const log = createLogger({ level: 'error', sink: () => undefined });
    const config = loadConfig(
      { LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1', LOADCRAFT_API_TOKEN: 'tok-test-1' },
      tmpdir(),
    );
    const http = createHttp(config, log);
    const byName = Object.entries(SECRET_PATHS).filter(([, paths]) =>
      paths.request.some((path) => path.includes('*secret') || path.includes('[secret]')),
    );
    expect(byName.length).toBeGreaterThan(5);
    const call = callOperation as (...args: unknown[]) => Promise<unknown>;
    for (const [id] of byName) {
      // The refusal comes before any request: a call without the scope would send a secret nobody masks.
      await expect(call(http, id, {}), id).rejects.toThrow(/pass the secret scope of the call/u);
    }
  });
});

// ---- the 14 tools with secret: true ------------------------------------------------------------

describe('the operations of the tools with secret: true', () => {
  it('the catalog has 14 such tools', () => {
    expect(SECRET_TOOLS).toHaveLength(14);
  });

  it('every operation has secret fields in the table or a reason why it has none', () => {
    const neither = SECRET_OPERATIONS.filter(
      ({ operationId }) =>
        secretPathsAt(operationId) === undefined &&
        !Object.hasOwn(fields.without_fields, operationId),
    );
    expect(neither).toEqual([]);
  });

  it('a reason for no fields names an operation of those tools that has no fields', () => {
    const ids = new Set(SECRET_OPERATIONS.map((o) => o.operationId));
    const stale = Object.keys(fields.without_fields).filter(
      (id) => !ids.has(id) || secretPathsAt(id) !== undefined,
    );
    expect(stale).toEqual([]);
  });
});

interface Probe {
  readonly tool: string;
  readonly operationId: string;
  readonly side: 'request' | 'response';
  readonly path: string;
}

const probesOf = (tool: string, operationId: string, paths: SecretPaths | undefined): Probe[] => [
  ...(paths?.request ?? []).map((path) => ({ tool, operationId, side: 'request' as const, path })),
  ...(paths?.response ?? []).map((path) => ({
    tool,
    operationId,
    side: 'response' as const,
    path,
  })),
];

const MARKED = SECRET_OPERATIONS.filter(
  ({ operationId }) => secretPathsAt(operationId) !== undefined,
);

/** The fields of the log templates of a catalog tool (`{count} environments` → `count`). */
function templateFields(tool: string): string[] {
  const entry = SECRET_TOOLS.find((t) => t.name === tool);
  const text = `${entry?.log.args ?? ''} ${entry?.log.result ?? ''}`;
  return [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? '');
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The input of the call: path and required query parameters, the body, the sentinel on a request path. */
function inputOf(probe: Probe, document: ContractDocument): Json {
  const { operation, shared } = contractOperation(probe.operationId);
  const segments = probe.side === 'request' ? pathSegments(probe.path) : [];
  const [root, ...rest] = segments;
  const input: Record<string, Json> = {};
  let n = 0;
  for (const parameter of [...shared, ...(operation.parameters ?? [])]) {
    const place = parameter.in;
    const secret = root === place && rest[0] === parameter.name;
    if (place !== 'path' && parameter.required !== true && !secret) continue;
    const group = (input[place] ??= {});
    n += 1;
    group[parameter.name] = secret
      ? FILE_CANARY
      : place === 'path'
        ? (parameter.schema as Json | undefined)?.type === 'integer'
          ? 1
          : uuid(n)
        : sample(document, parameter.schema ?? true);
  }
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  if (schema !== undefined) {
    input.body = (
      root === 'body' ? sample(document, schema, rest, FILE_CANARY) : sample(document, schema)
    ) as Json;
  }
  return input;
}

function successOf(operationId: string): { status: number; schema: unknown } {
  const { operation } = contractOperation(operationId);
  const status = Object.keys(operation.responses ?? {})
    .filter((s) => /^2\d\d$/.test(s))
    .sort()[0];
  if (status === undefined) throw new Error(`${operationId} has no success answer`);
  const schema = operation.responses?.[status]?.content?.['application/json']?.schema;
  return { status: Number(status), schema };
}

const HEAD_LENGTHS = [10, 11, 12] as const;

/** Where in `text` a sentinel shows: whole, encoded, or its head of 8, 10, 11 or 12 characters. */
function leakIn(text: string): boolean {
  try {
    assertNoCanary(text);
  } catch {
    return true;
  }
  return [BACKEND_CANARY, FILE_CANARY].some((canary) =>
    HEAD_LENGTHS.some((length) => text.includes(canary.slice(0, length))),
  );
}

interface ProbeResult {
  /** The outputs in which a sentinel showed. */
  readonly leaks: string[];
  /** The result text of the call that succeeded has the redaction marker: the sentinel was there. */
  readonly masked: boolean;
  /** The state file holds an entry of the tool and a detail of the failed call. */
  readonly logged: boolean;
  /** The request the fake saw, and the answer it sent, held the sentinel. */
  readonly fed: boolean;
  /** Every public field of the answer (secret-fields.json `public`) is shown in the result. */
  readonly shown: boolean;
}

interface Bench {
  readonly session: McpSession;
  /** Lines of the server log, in order. */
  readonly lines: string[];
  /** The logger of the process (secrets registered by any call stay in it). */
  readonly log: Logger;
  readonly fake: Fake;
  stateText(): string;
  close(): Promise<void>;
}

type Answers = readonly (readonly [operationId: string, body: unknown])[];

/** The fake answers each operation with its body; the real registry with the log on serves `tools`. */
async function bench(answers: Answers, tools: readonly Tool[]): Promise<Bench> {
  const clock = createTestClock(START);
  const fake = await startFake({ clock });
  const route = fake.route.bind(fake) as (
    method: string,
    path: string,
    handler: () => unknown,
  ) => void;
  for (const [operationId, body] of answers) {
    const row = OPERATIONS[operationId as OperationId];
    route(row.method, row.path, () => ({ status: successOf(operationId).status, body }));
  }
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-secret-contract-')));
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: fake.token },
    workspace,
  );
  log.registerSecret(config.token.reveal());
  const services = createServices(config, log);
  const session = await connect(() => {
    const server = new McpServer(
      { name: 'loadcraft', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, tools, { config, log, services, clock, journal: createProcessStore });
    return server;
  });
  return {
    session,
    lines,
    log,
    fake,
    stateText: () => readFileSync(join(workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    async close() {
      await session.close();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

/** How many characters of a token its public prefix shows. */
const PUBLIC_HEAD = 14;

/** The public fields of an operation, as secret-fields.json names them. */
const publicFieldsOf = (operationId: string): string[] =>
  Object.keys(fields.fields[operationId]?.public ?? {});

/** `value` with `leaf` written at a path of plain property names. */
function placeAt(value: unknown, path: string, leaf: string): void {
  const names = path.split('.');
  let node = value;
  for (const name of names.slice(0, -1)) node = (node as Json)[name];
  (node as Json)[names.at(-1) ?? ''] = leaf;
}

/**
 * One call that succeeds and one that fails of a tool named after the catalog tool, through the real
 * registry with the log on, against the fake backend. The tool is careless on purpose: it returns the
 * whole answer and what it sent, copies the sentinel into every field its log entry reads and into the
 * text of its error. A public field of the answer holds the head of the sentinel, as a token prefix
 * does; it is excluded from the leak check by name, and must be shown.
 */
async function probe(p: Probe, call: CallOperation, document = contract): Promise<ProbeResult> {
  const success = successOf(p.operationId);
  const answer =
    p.side === 'response'
      ? sample(document, success.schema, pathSegments(p.path), BACKEND_CANARY)
      : sample(document, success.schema);
  const publicHead = BACKEND_CANARY.slice(0, PUBLIC_HEAD);
  const publics = p.side === 'response' ? publicFieldsOf(p.operationId) : [];
  for (const path of publics) placeAt(answer, path, publicHead);
  const input = inputOf(p, document);
  const sentinel = p.side === 'response' ? BACKEND_CANARY : FILE_CANARY;
  const send = call as (...args: unknown[]) => Promise<unknown>;
  const tool = defineTool({
    name: p.tool,
    title: p.tool,
    description: 'Probe of the secret fields of one operation.',
    input: z.strictObject({ mode: z.enum(['done', 'fail']) }),
    annotations: { readOnlyHint: true },
    async run(ctx, { mode }) {
      const body = await send(ctx.services.http, p.operationId, input, { secrets: ctx.secrets });
      if (mode === 'fail') {
        throw new ToolError('probe_refused', {
          message: `the backend refused ${sentinel}`,
          details: { body, sent: input },
        });
      }
      const copied = Object.fromEntries(templateFields(p.tool).map((name) => [name, sentinel]));
      return {
        status: 'done' as const,
        data: { ...copied, body, sent: input },
        update: { log: { values: { leaked: sentinel } } },
      };
    },
    render: (data) => JSON.stringify(data),
  });
  const b = await bench([[p.operationId, answer]], [tool]);
  try {
    const done = await b.session.call(p.tool, { mode: 'done' });
    const failed = await b.session.call(p.tool, { mode: 'fail' });
    const stateText = b.stateText();
    const state = JSON.parse(stateText) as {
      logDetails?: Record<string, unknown>;
      process?: Record<string, { log?: unknown; reads?: unknown }>;
    };
    const entries = Object.values(state.process ?? {}).map((p) => [p.log, p.reads]);
    const outputs: Record<string, string> = {
      'result of the call': done.text,
      'error of the call': failed.text,
      'log entries': JSON.stringify(entries),
      'log details': JSON.stringify(state.logDetails ?? {}),
      'state file': stateText,
      'server log': b.lines.join('\n'),
    };
    // the public prefix is the head of the secret by design: taken out by name, never the whole secret
    const rest = BACKEND_CANARY.slice(PUBLIC_HEAD);
    const publicValue = new RegExp(`${escapeRegExp(publicHead)}(?!${escapeRegExp(rest)})`, 'g');
    const checked = (text: string): string =>
      publics.length === 0 ? text : text.replace(publicValue, '<public>');
    const sent = JSON.stringify(b.fake.calls.at(-1)?.body ?? null);
    return {
      leaks: Object.entries(outputs)
        .filter(([, text]) => leakIn(checked(text)))
        .map(([name]) => name),
      masked: done.text.includes(REDACTED) && failed.isError,
      logged: stateText.includes(p.tool) && Object.keys(state.logDetails ?? {}).length > 0,
      fed:
        p.side === 'response'
          ? JSON.stringify(answer).includes(BACKEND_CANARY)
          : sent.includes(FILE_CANARY) ||
            p.path.startsWith('query.') ||
            p.path.startsWith('header.'),
      shown: publics.every(() => done.text.includes(publicHead)),
    };
  } finally {
    await b.close();
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `callOperation` over the table generated from a changed copy (no module is replaced). */
const callOperationWith = (table: Record<string, SecretPaths>): CallOperation =>
  operationCaller(table);

describe('the adversary: a sentinel in a secret field of every operation of those tools', () => {
  it('there are operations to probe', () => {
    expect(MARKED.length).toBeGreaterThan(0);
  });

  it.each(MARKED)('$tool · $operationId', async ({ tool, operationId }) => {
    for (const p of probesOf(tool, operationId, secretPathsAt(operationId))) {
      const result = await probe(p, callOperation);
      expect({ path: `${p.side} ${p.path}`, ...result }).toEqual({
        path: `${p.side} ${p.path}`,
        leaks: [],
        masked: true,
        logged: true,
        fed: true,
        shown: true,
      });
    }
  });

  it('a cell the contract marks by name is masked whole where the exception says so, under any key', async () => {
    const operationId =
      'get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get';
    const entry = SECRET_OPERATIONS.find((o) => o.operationId === operationId);
    expect(entry, 'the operation of the exception').toBeDefined();
    const paths = fields.fields[operationId]?.response ?? [];
    expect(paths).toEqual(
      expect.arrayContaining(['config_snapshot.flow_rows.*.*', 'config_snapshot.rerun_rows.*.*']),
    );
    for (const path of paths) {
      const concrete = path.replaceAll('*', 'cell');
      const result = await probe(
        { tool: entry?.tool ?? '', operationId, side: 'response', path: concrete },
        callOperation,
      );
      expect({ path: concrete, ...result }).toEqual({
        path: concrete,
        leaks: [],
        masked: true,
        logged: true,
        fed: true,
        shown: true,
      });
    }
  });

  it('the public prefix of a push token is named in secret-fields.json, with its reason', () => {
    const token = SECRET_OPERATIONS.find((o) => o.tool === 'traffic_create_token');
    expect(token && publicFieldsOf(token.operationId)).toEqual(['prefix']);
  });

  it('with the exception of an operation removed from a copy, the sentinel in its fields leaks', async () => {
    let probed = 0;
    for (const { tool, operationId } of MARKED) {
      const exception = fields.fields[operationId];
      if (exception === undefined) continue;
      const without = copy(fields);
      delete without.fields[operationId];
      const call = callOperationWith(tableObject(secretPathsOf(contract, without)));
      // A cell or a value under a key that names no secret: a mark by name leaves it alone, so only the
      // exception can hide it.
      const plain = (path: string): string =>
        path.replaceAll('*secret', 'k1').replaceAll('*', 'k1');
      const own = {
        request: (exception.request ?? []).map(plain),
        response: (exception.response ?? []).map(plain),
      };
      for (const p of probesOf(tool, operationId, own)) {
        // A field that holds a map of lists of cells: a cell under plain keys is what the exception hides.
        const deeper = [p.path, `${p.path}.k1`, `${p.path}.k1[].k1`];
        const leaked: string[] = [];
        for (const path of deeper) {
          try {
            leaked.push(...(await probe({ ...p, path }, call)).leaks);
          } catch {
            // the contract has no such path under this field: the other variants say it
          }
        }
        expect(leaked, `${operationId} ${p.side} ${p.path}`).toContain('result of the call');
        probed += 1;
      }
    }
    expect(probed).toBeGreaterThan(0);
  });

  it.each([
    [
      'x-secret: true',
      'traffic_create_token',
      'create_ingest_token',
      'IssuedIngestToken',
      'secret',
      'secret',
    ],
    [
      'x-secret: "by-name"',
      'project_get_envs',
      'get_effective_environment',
      'EffectiveEnvironmentResponse',
      'headers',
      'headers[secret].value',
    ],
  ])(
    'a field the snapshot marks with %s is masked with no exception, and leaks once a copy drops the mark',
    async (_label, tool, fragment, schema, property, path) => {
      const operationId = opOf(tool, fragment);
      expect(fields.fields[operationId]?.response ?? []).not.toContain(path);
      const fromContract = secretPathsOf(contract, fields);
      expect(fromContract.get(operationId)?.response).toContain(path);
      const p: Probe = { tool, operationId, side: 'response', path };
      const masked = await probe(p, callOperationWith(tableObject(fromContract)));
      expect(masked.leaks).toEqual([]);
      expect(masked.masked).toBe(true);

      const unmarked = copy(contract) as ContractDocument & {
        components: { schemas: Record<string, { properties: Record<string, Json> }> };
      };
      const field = unmarked.components.schemas[schema]?.properties[property];
      if (field?.['x-secret'] === undefined) throw new Error(`${schema}.${property} is not marked`);
      delete field['x-secret'];
      const leaked = await probe(
        p,
        callOperationWith(tableObject(secretPathsOf(unmarked, fields))),
        unmarked,
      );
      expect(leaked.leaks).toContain('result of the call');
    },
  );
});

// ---- what the mask leaves readable -------------------------------------------------------------

const ID_A = '00000000-0000-4000-8000-0000000000a1';
const ID_B = '00000000-0000-4000-8000-0000000000b2';
const ID_C = '00000000-0000-4000-8000-0000000000c3';

/** A body of the answer of `operationId` the snapshot accepts, changed by `edit`. */
function answerOf(operationId: string, path: string, edit: (body: Json) => void): Json {
  const body = sample(contract, successOf(operationId).schema, pathSegments(path), 'x') as Json;
  edit(body);
  return body;
}

const opOf = (tool: string, fragment: string): string => {
  const found = SECRET_OPERATIONS.find(
    (o) => o.tool === tool && o.operationId.startsWith(fragment),
  );
  if (found === undefined) throw new Error(`${tool} has no operation ${fragment}`);
  return found.operationId;
};

/** One call of a tool that reads `answers` in order and returns every body; the text and the log. */
async function readAll(
  tool: string,
  answers: Answers,
): Promise<{ text: string; lines: string[]; log: Logger }> {
  const send = callOperation as (...args: unknown[]) => Promise<unknown>;
  const reader = defineTool({
    name: tool,
    title: tool,
    description: 'Reads the answers of a test.',
    input: z.strictObject({}),
    annotations: { readOnlyHint: true },
    async run(ctx) {
      const bodies: unknown[] = [];
      for (const [operationId] of answers) {
        const { operation, shared } = contractOperation(operationId);
        const path = Object.fromEntries(
          [...shared, ...(operation.parameters ?? [])]
            .filter((parameter) => parameter.in === 'path')
            .map((parameter, n) => [parameter.name, uuid(n + 1)]),
        );
        bodies.push(await send(ctx.services.http, operationId, { path }, { secrets: ctx.secrets }));
      }
      return { status: 'done' as const, data: { bodies } };
    },
    render: (data) => JSON.stringify(data),
  });
  const b = await bench(answers, [reader]);
  try {
    const result = await b.session.call(tool, {});
    expect(result.isError, result.text).toBe(false);
    return { text: result.text, lines: b.lines, log: b.log };
  } finally {
    await b.close();
  }
}

describe('what the mask leaves readable', () => {
  it('the effective environment: secret headers, variables and auth values go, the target and Accept stay', async () => {
    const id = opOf('project_get_envs', 'get_effective_environment');
    const body = answerOf(id, 'headers[].value', (b) => {
      b.targets = { api: 'https://shop.example.com/api', proxy: null, ui: null };
      b.headers = [
        { name: 'Accept', value: 'application/json', masked: false, inherited: false },
        {
          name: 'Authorization',
          value: `Bearer ${BACKEND_CANARY}`,
          masked: false,
          inherited: false,
        },
      ];
      b.variables = [
        { name: 'BASE_PATH', value: '/api/orders-v2', masked: false, inherited: false },
        { name: 'API_TOKEN', value: FILE_CANARY, masked: false, inherited: false },
      ];
      b.auth = {
        auth_type: 'basic',
        auth_config: { username: 'anna@example.com', password: `pw-${BACKEND_CANARY}` },
      };
    });
    const { text } = await readAll('project_get_envs', [[id, body]]);
    assertNoCanary(text);
    for (const kept of [
      'https://shop.example.com/api',
      'application/json',
      '/api/orders-v2',
      'anna@example.com',
    ]) {
      expect(text).toContain(kept);
    }
  });

  it('the run configuration: data rows go, the identifiers of the environment and the flows stay', async () => {
    const id = opOf('functional_get_results', 'get_execution_with_results');
    const body = answerOf(id, 'config_snapshot.flow_rows', (b) => {
      b.config_snapshot = {
        environment_id: ID_A,
        flow_ids: [ID_B],
        flow_rows: { [ID_B]: { email: 'anna@example.com', password: BACKEND_CANARY } },
        rerun_rows: { [ID_B]: { password: FILE_CANARY } },
        rerun_inputs: { [ID_C]: [{ password: `in-${BACKEND_CANARY}` }] },
      };
      b.runtime_params = { environment_id: ID_A, api_token: `tok-${BACKEND_CANARY}` };
    });
    const { text } = await readAll('functional_get_results', [[id, body]]);
    assertNoCanary(text);
    expect(text).toContain(ID_A);
    expect(text).toContain(ID_B);
    expect(text).toContain(ID_C);
  });

  it('after list_flow_results the log stays readable: plain header values, ids and short values are not secrets', async () => {
    const id = opOf('functional_get_results', 'list_flow_results');
    const body = answerOf(id, 'results[].block_results[].request_headers.*', (b) => {
      const result = (b.results as Json[])[0] as Json;
      const block = (result.block_results as Json[])[0] as Json;
      block.request_headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${BACKEND_CANARY}`,
      };
      block.response_headers = {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': 'req-7f3e2a91c4',
        'set-cookie': `sid=${FILE_CANARY}; HttpOnly`,
      };
      result.final_variables = { order_id: ID_C, qty: 'abc', access_token: `at-${BACKEND_CANARY}` };
    });
    const { text, lines, log } = await readAll('functional_get_results', [[id, body]]);
    assertNoCanary(text);
    for (const kept of [ID_C, 'req-7f3e2a91c4', 'application/json; charset=utf-8']) {
      expect(text).toContain(kept);
    }
    const plain = `seen ${ID_C} req-7f3e2a91c4 application/json; charset=utf-8 abc`;
    log.info(plain);
    expect(lines.join('\n')).toContain(plain);
    assertNoCanary(lines.join('\n'));
  });

  it('a dataset: the cells of its credential columns are masked one by one, in the CSV and in the preview', async () => {
    const id = opOf('data_get_dataset', 'get_feeder_api');
    const preview = opOf('data_get_dataset', 'get_feeder_preview');
    const body = answerOf(id, 'content', (b) => {
      b.feeder_type = 'csv';
      b.separator = ',';
      b.columns = ['email', 'password', 'pin'];
      b.column_semantics = { email: 'identity', password: 'credential', pin: 'credential' };
      b.content = `email,password,pin\nalice@example.com,${BACKEND_CANARY},${FILE_CANARY}\n`;
      b.audit_metadata = {
        sample_rows_preview: [{ email: 'bob@example.com', password: `${FILE_CANARY}-2` }],
      };
    });
    const rows = answerOf(preview, 'rows[].*', (b) => {
      b.columns = ['email', 'password'];
      b.rows = [
        { email: 'alice@example.com', password: BACKEND_CANARY },
        { email: 'bob@example.com', password: `${FILE_CANARY}-2` },
      ];
    });
    const { text } = await readAll('data_get_dataset', [
      [id, body],
      [preview, rows],
    ]);
    assertNoCanary(text);
    expect(text).toContain('alice@example.com');
    expect(text).toContain('bob@example.com');
    expect(text).toContain(REDACTED);
  });
});

describe('the cells of a dataset beyond the secret fields of the table', () => {
  const feederOf = (operationId: string, rows: number): Json =>
    answerOf(operationId, 'content', (b) => {
      b.feeder_type = 'csv';
      b.separator = ',';
      b.columns = ['email', 'password'];
      b.column_semantics = { email: 'identity', password: 'credential' };
      b.content = [
        'email,password',
        ...Array.from(
          { length: rows },
          (_, n) => `user${String(n + 1)}@example.com,pw-${String(n + 1)}-${BACKEND_CANARY}`,
        ),
        '',
      ].join('\n');
    });

  it('every cell of a credential column is masked, also in a dataset of 1200 accounts', async () => {
    const id = opOf('data_get_dataset', 'get_feeder_api');
    const preview = opOf('data_get_dataset', 'get_feeder_preview');
    const late = `pw-1100-${BACKEND_CANARY}`;
    const rows = answerOf(preview, 'rows[].*', (b) => {
      b.columns = ['email', 'password'];
      b.rows = [{ email: 'user1100@example.com', password: late }];
    });
    const { text } = await readAll('data_get_dataset', [
      [id, feederOf(id, 1200)],
      [preview, rows],
    ]);
    assertNoCanary(text);
    expect(text).toContain('user1100@example.com');
  });

  it('an answer that carries a dataset with credential columns is refused without the secret scope of the call, also for an operation with no secret field in the table', async () => {
    const id = 'update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put';
    // the contract marks the connection passwords of a dataset; a table without them leaves the cells
    const table = tableObject(secretPathsOf(contract, fields));
    expect(table[id]).toBeDefined();
    delete table[id];
    const b = await bench([[id, feederOf(id, 2)]], []);
    try {
      const config = loadConfig(
        { LOADCRAFT_API_URL: `${b.fake.url}/api/v1`, LOADCRAFT_API_TOKEN: b.fake.token },
        tmpdir(),
      );
      const { operation } = contractOperation(id);
      const body = sample(contract, operation.requestBody?.content?.['application/json']?.schema);
      const call = callOperationWith(table) as (...args: unknown[]) => Promise<unknown>;
      await expect(
        call(createHttp(config, b.log), id, { path: { project_id: ID_A, feeder_id: ID_B }, body }),
      ).rejects.toThrow(
        new TypeError(
          `${id}: the answer carries a dataset with credential columns; pass the secret scope of the call (options.secrets)`,
        ),
      );
    } finally {
      await b.close();
    }
  });
});
