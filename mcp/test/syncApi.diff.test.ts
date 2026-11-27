// Diff of two OpenAPI snapshots (`scripts/sync-api/diff.ts`) and the list of routes the plugin calls
// (`scripts/sync-api/routes.ts`): added, removed and changed operations, breaking versus additive,
// and the mark on an operation the plugin uses.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diffSpecs, type OperationChange, type Spec } from '../scripts/sync-api/diff.js';
import { findPluginRoutes } from '../scripts/sync-api/routes.js';
import additive from './fixtures/sync-api/additive.json' with { type: 'json' };
import newSpec from './fixtures/sync-api/new.json' with { type: 'json' };
import oldSpec from './fixtures/sync-api/old.json' with { type: 'json' };

const OLD = oldSpec as Spec;
const NEW = newSpec as Spec;

function find(changes: readonly OperationChange[], op: string): OperationChange {
  const found = changes.find((change) => change.operation === op);
  if (found === undefined) throw new Error(`no change for ${op}`);
  return found;
}

describe('diffSpecs', () => {
  const changes = diffSpecs(OLD, NEW);

  it('reports nothing for identical documents', () => {
    expect(diffSpecs(OLD, structuredClone(OLD))).toEqual([]);
  });

  it('finds an added operation and calls it additive', () => {
    const added = find(changes, 'GET /api/v1/items/{item_id}/tags');
    expect(added.status).toBe('added');
    expect(added.kind).toBe('additive');
  });

  it('finds a removed operation and calls it breaking', () => {
    const removed = find(changes, 'DELETE /api/v1/items/{item_id}');
    expect(removed.status).toBe('removed');
    expect(removed.kind).toBe('breaking');
    expect(find(changes, 'GET /api/v1/reports').status).toBe('removed');
  });

  it('finds a changed operation: an optional parameter and a new response field are additive', () => {
    const list = find(changes, 'GET /api/v1/items');
    expect(list.status).toBe('changed');
    const parameter = list.changes.find((change) => change.message.includes('q'));
    expect(parameter?.kind).toBe('additive');
    expect(parameter?.where).toContain('query');
    const field = list.changes.find((change) => change.message.includes('created_at'));
    expect(field?.kind).toBe('additive');
  });

  it('a response field that disappeared is breaking, and the path says where', () => {
    const list = find(changes, 'GET /api/v1/items');
    const removed = list.changes.find((change) => change.message.includes('price'));
    expect(removed?.kind).toBe('breaking');
    expect(removed?.where).toBe('response 200 application/json items.price');
    expect(list.kind).toBe('breaking');
  });

  it('a new required request field is breaking, an optional one is not', () => {
    const create = find(changes, 'POST /api/v1/items');
    const sku = create.changes.find((change) => change.message.includes('sku'));
    expect(sku?.kind).toBe('breaking');
    expect(sku?.where).toBe('request application/json sku');
  });

  it('a document that only adds optional things has no breaking change', () => {
    const result = diffSpecs(OLD, additive);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((change) => change.kind === 'additive')).toBe(true);
  });

  it('a new required parameter is breaking, a removed one is breaking, an optional one is not', () => {
    const build = (parameters: object[]): Spec => ({
      paths: { '/p': { get: { parameters, responses: { '200': { description: 'ok' } } } } },
    });
    const query = (name: string, required: boolean): object => ({
      name,
      in: 'query',
      required,
      schema: { type: 'string' },
    });
    const kindOf = (a: object[], b: object[]): string | undefined =>
      diffSpecs(build(a), build(b))[0]?.changes[0]?.kind;
    expect(kindOf([], [query('a', true)])).toBe('breaking');
    expect(kindOf([], [query('a', false)])).toBe('additive');
    expect(kindOf([query('a', false)], [])).toBe('breaking');
    expect(kindOf([query('a', false)], [query('a', true)])).toBe('breaking');
  });

  it('survives a schema that refers to itself', () => {
    const tree = (extra: boolean): Spec => ({
      paths: {
        '/t': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
              ...(extra ? { label: { type: 'string' } } : {}),
            },
          },
        },
      },
    });
    const result = diffSpecs(tree(false), tree(true));
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('additive');
  });

  it('a request enum that lost a value is breaking, a response enum that gained one is additive', () => {
    const build = (values: string[]): Spec => ({
      paths: {
        '/e': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { type: 'string', enum: values } } },
            },
            responses: {
              '200': {
                content: { 'application/json': { schema: { type: 'string', enum: values } } },
              },
            },
          },
        },
      },
    });
    const lost = find(diffSpecs(build(['a', 'b']), build(['a'])), 'POST /e');
    expect(lost.changes.find((c) => c.where.startsWith('request'))?.kind).toBe('breaking');
    const gained = find(diffSpecs(build(['a']), build(['a', 'b'])), 'POST /e');
    expect(gained.changes.every((c) => c.kind === 'additive')).toBe(true);
  });
});

describe('findPluginRoutes', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function source(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'lc-sync-routes-'));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) {
      const file = join(dir, name);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, text);
    }
    return dir;
  }

  const PATHS = [
    '/api/v1/items',
    '/api/v1/items/{item_id}',
    '/api/v1/items/{item_id}/tags',
    '/api/v1/reports',
  ];

  it('reads literal paths, constants, template constants and uploads', () => {
    const dir = source({
      'api/items.ts': `
        const ITEM = '/api/v1/items/{item_id}' as const;
        const TAGS = \`\${ITEM}/tags\` as const;
        export const a = (api) => api.services.http.GET('/api/v1/items', {});
        export const b = (api) => api.services.http.DELETE(ITEM, {});
        export const c = (api) => api.services.http.GET(TAGS, {});
        export const d = (api, id) => uploadFile(api.services.http, {
          url: \`/api/v1/items/\${encodeURIComponent(id)}/tags\`, field: 'file' });
      `,
      'http/generated/api.d.ts': `GET('/api/v1/reports'`,
      'api/items.test.ts': `GET('/api/v1/reports'`,
    });
    const routes = findPluginRoutes(dir, PATHS);
    const keys = routes.map((route) => `${route.method} ${route.path}`).sort();
    expect(keys).toEqual([
      'DELETE /api/v1/items/{item_id}',
      'GET /api/v1/items',
      'GET /api/v1/items/{item_id}/tags',
      'POST /api/v1/items/{item_id}/tags',
    ]);
    expect(routes.every((route) => route.files.includes('api/items.ts'))).toBe(true);
  });

  it('maps a tool to the routes of the api files it imports', () => {
    const dir = source({
      'api/items.ts': `export const a = (api) => api.services.http.GET('/api/v1/items', {});`,
      'api/reports.ts': `export const a = (api) => api.services.http.GET('/api/v1/reports', {});`,
      'tools/index.ts': `import { listItems } from './listItems.js';\nimport { other } from './other.js';`,
      'tools/listItems.ts': `import { a } from '../api/items.js';`,
      'tools/other.ts': `import { helper } from './other/helper.js';`,
      'tools/other/helper.ts': `import { a } from '../../api/reports.js';`,
    });
    const routes = findPluginRoutes(dir, PATHS);
    const toolsOf = (path: string): readonly string[] | undefined =>
      routes.find((route) => route.path === path)?.tools;
    expect(toolsOf('/api/v1/items')).toEqual(['list_items']);
    expect(toolsOf('/api/v1/reports')).toEqual(['other']);
  });
});

describe('diffSpecs: compositions', () => {
  const obj = (
    props: Record<string, unknown>,
    required: string[] = [],
  ): Record<string, unknown> => ({
    type: 'object',
    properties: props,
    required,
  });
  const spec = (status: string, schema: unknown, schemas: Record<string, unknown> = {}): Spec => ({
    paths: {
      '/x': {
        post: { responses: { [status]: { content: { 'application/json': { schema } } } } },
      },
    },
    components: { schemas },
  });
  const request = (schema: unknown, schemas: Record<string, unknown> = {}): Spec => ({
    paths: {
      '/x': {
        post: {
          requestBody: { content: { 'application/json': { schema } } },
          responses: {},
        },
      },
    },
    components: { schemas },
  });
  const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
  const kinds = (changes: readonly OperationChange[]): string[] =>
    changes.flatMap((change) => change.changes.map((item) => `${item.kind}: ${item.message}`));
  const E1 = { Err: obj({ detail: { type: 'array', items: { type: 'string' } } }) };
  const E2 = { ...E1, Other: obj({ code: { type: 'string' } }) };

  it('allOf of the same $ref and a new optional field is only an additive field', () => {
    const base = { Item: obj({ id: { type: 'string' } }, ['id']) };
    const before = spec('200', ref('Item'), base);
    const after = spec('200', { allOf: [ref('Item'), obj({ note: { type: 'string' } })] }, base);
    const result = diffSpecs(before, after);
    expect(result).toHaveLength(1);
    expect(kinds(result)).toEqual(['additive: field note added']);
  });

  it('allOf merges required as a sum and a field removed by the merge is still breaking', () => {
    const before = spec('200', obj({ id: { type: 'string' }, price: { type: 'number' } }, ['id']));
    const after = spec('200', {
      allOf: [obj({ id: { type: 'string' } }), obj({ extra: { type: 'string' } }, ['id'])],
    });
    const result = kinds(diffSpecs(before, after));
    expect(result).toContain('breaking: field price removed');
    expect(result.some((line) => line.includes('composition'))).toBe(false);
  });

  it('allOf parts that disagree on a type are left to the direct comparison', () => {
    const before = spec('200', { type: 'string' });
    const after = spec('200', { allOf: [{ type: 'string' }, { type: 'number' }] });
    expect(diffSpecs(before, after)[0]?.kind).toBe('breaking');
  });

  it('a plain schema against anyOf is compared with the matching variant; extra variants are reported', () => {
    const before = spec('200', ref('Item'), { Item: obj({ id: { type: 'string' } }) });
    const after = spec(
      '200',
      { anyOf: [ref('Item'), ref('Gone')] },
      {
        Item: obj({ id: { type: 'string' } }),
        Gone: obj({ code: { type: 'string' } }),
      },
    );
    const result = diffSpecs(before, after);
    expect(kinds(result)).toEqual(['breaking: variant added: Gone']);
    expect(result[0]?.changes.some((item) => item.message.includes('type object -> any'))).toBe(
      false,
    );
  });

  it('a variant added to a request narrows nothing the client sends', () => {
    const items = { Item: obj({ id: { type: 'string' } }), Other: obj({ q: { type: 'string' } }) };
    const result = diffSpecs(
      request(ref('Item'), items),
      request({ oneOf: [ref('Item'), ref('Other')] }, items),
    );
    expect(kinds(result)).toEqual(['additive: variant added: Other']);
    const back = diffSpecs(
      request({ oneOf: [ref('Item'), ref('Other')] }, items),
      request(ref('Item'), items),
    );
    expect(kinds(back)).toEqual(['breaking: variant removed: Other']);
  });

  it('with no same $ref the closest shape is the match', () => {
    const before = spec('200', obj({ id: { type: 'string' }, name: { type: 'string' } }));
    const after = spec('200', {
      anyOf: [
        obj({ code: { type: 'integer' } }),
        obj({ id: { type: 'string' }, name: { type: 'string' } }),
      ],
    });
    const lines = kinds(diffSpecs(before, after));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('variant added');
  });

  it('a field removed from the matched variant is breaking', () => {
    const before = spec('200', ref('Item'), {
      Item: obj({ id: { type: 'string' }, price: { type: 'number' } }),
    });
    const after = spec(
      '200',
      { anyOf: [ref('Item2'), { type: 'null' }] },
      {
        Item2: obj({ id: { type: 'string' } }),
      },
    );
    const lines = kinds(diffSpecs(before, after));
    expect(lines).toContain('breaking: field price removed');
  });

  it('anyOf [X, null] is X that allows null: same as before is no change, a new null is breaking in a response', () => {
    const item = { Item: obj({ id: { type: 'string' } }) };
    const nullable = { anyOf: [ref('Item'), { type: 'null' }] };
    expect(diffSpecs(spec('200', nullable, item), spec('200', nullable, item))).toEqual([]);
    const result = diffSpecs(spec('200', ref('Item'), item), spec('200', nullable, item));
    expect(kinds(result)).toEqual(['breaking: type object -> null|object']);
  });

  it('a nullable that refers to itself does not loop', () => {
    const node = (extra: boolean): Record<string, unknown> => ({
      Node: obj({
        next: { anyOf: [ref('Node'), { type: 'null' }] },
        ...(extra ? { label: { type: 'string' } } : {}),
      }),
    });
    const result = diffSpecs(
      spec('200', ref('Node'), node(false)),
      spec('200', ref('Node'), node(true)),
    );
    expect(kinds(result)).toEqual(['additive: field label added']);
  });

  it('in an error response a widened composition is info, not breaking (422 pattern)', () => {
    const before = spec('422', ref('Err'), E1);
    const after = spec('422', { anyOf: [ref('Err'), ref('Other')] }, E2);
    const result = diffSpecs(before, after);
    expect(result[0]?.kind).toBe('info');
    expect(kinds(result)).toEqual(['info: variant added: Other (error response)']);
    const dflt = diffSpecs(
      spec('default', ref('Err'), E1),
      spec('default', { anyOf: [ref('Err'), ref('Other')] }, E2),
    );
    expect(dflt[0]?.kind).toBe('info');
  });

  it('the same widening in a 2xx response stays breaking', () => {
    const result = diffSpecs(
      spec('200', ref('Err'), E1),
      spec('200', { anyOf: [ref('Err'), ref('Other')] }, E2),
    );
    expect(result[0]?.kind).toBe('breaking');
  });

  it('a field removed from an error response is still breaking', () => {
    const result = diffSpecs(
      spec('422', obj({ detail: { type: 'string' } })),
      spec('422', obj({})),
    );
    expect(result[0]?.kind).toBe('breaking');
  });

  it('two compositions with the same $ref variants see a change inside the shared variant', () => {
    const before = spec(
      '200',
      { anyOf: [ref('A'), ref('B')] },
      { A: obj({ x: { type: 'string' } }), B: obj({}) },
    );
    const after = spec('200', { anyOf: [ref('A'), ref('B')] }, { A: obj({}), B: obj({}) });
    expect(kinds(diffSpecs(before, after))).toEqual(['breaking: field x removed']);
  });

  it('a type change inside the matched variant and inside an allOf is breaking', () => {
    const before = spec('200', obj({ n: { type: 'number' } }));
    const viaAnyOf = spec('200', { anyOf: [obj({ n: { type: 'string' } }), ref('Other')] }, E2);
    expect(kinds(diffSpecs(before, viaAnyOf))).toContain('breaking: type number -> string');
    const viaAllOf = spec('200', { allOf: [obj({ n: { type: 'string' } }), obj({})] });
    expect(kinds(diffSpecs(before, viaAllOf))).toEqual(['breaking: type number -> string']);
  });

  const union = {
    L: obj({ a: { type: 'string' }, gone: { type: 'string' } }),
    R: obj({ b: { type: 'string' } }),
    Opt: { anyOf: [ref('L'), ref('R')] },
  };

  it('anyOf [T, null] where T is itself a union is T plus nullability, not a new variant', () => {
    const nullable = { anyOf: [ref('Opt'), { type: 'null' }] };
    expect(diffSpecs(spec('200', nullable, union), spec('200', nullable, union))).toEqual([]);
    const gained = diffSpecs(spec('200', ref('Opt'), union), spec('200', nullable, union));
    expect(kinds(gained)).toEqual(['breaking: null allowed']);
    const lost = diffSpecs(spec('200', nullable, union), spec('200', ref('Opt'), union));
    expect(kinds(lost)).toEqual(['additive: null no longer allowed']);
  });

  it('a field removed from a variant of a nullable union is shown on its own', () => {
    const next = { ...union, L: obj({ a: { type: 'string' } }) };
    const nullable = { anyOf: [ref('Opt'), { type: 'null' }] };
    expect(kinds(diffSpecs(spec('200', nullable, union), spec('200', nullable, next)))).toEqual([
      'breaking: field gone removed',
    ]);
  });

  it('the match does not depend on the order of the variants and weighs the types of shared fields', () => {
    const plain = obj({ id: { type: 'string' }, extra: { type: 'string' } });
    const num = obj({ id: { type: 'number' } });
    const str = obj({ id: { type: 'string' } });
    const one = diffSpecs(spec('200', plain), spec('200', { anyOf: [num, str] }));
    const two = diffSpecs(spec('200', plain), spec('200', { anyOf: [str, num] }));
    expect(kinds(one)).toEqual(kinds(two));
    expect(kinds(one)).toContain('breaking: field extra removed');
    expect(kinds(one).some((line) => line.includes('type string -> number'))).toBe(false);
  });

  it('equally alike variants are chosen by signature, not by position', () => {
    const plain = obj({ id: { type: 'string' } });
    const x = obj({ id: { type: 'string' }, x: { type: 'string' } });
    const y = obj({ id: { type: 'string' }, y: { type: 'string' } });
    const one = diffSpecs(spec('200', plain), spec('200', { anyOf: [x, y] }));
    const two = diffSpecs(spec('200', plain), spec('200', { anyOf: [y, x] }));
    expect(kinds(one).sort()).toEqual(kinds(two).sort());
  });

  it('a request enum value removed is breaking inside an allOf and inside an anyOf', () => {
    const wide = obj({ kind: { type: 'string', enum: ['a', 'b'] } });
    const narrow = obj({ kind: { type: 'string', enum: ['a'] } });
    const viaAllOf = diffSpecs(request(wide), request({ allOf: [narrow, obj({})] }));
    expect(kinds(viaAllOf)).toContain('breaking: enum value "b" removed');
    const viaAnyOf = diffSpecs(
      request(wide),
      request({ anyOf: [narrow, obj({ z: { type: 'string' } })] }),
    );
    expect(kinds(viaAnyOf)).toContain('breaking: enum value "b" removed');
  });

  it('a new required request field is breaking inside an allOf', () => {
    const before = request(obj({ id: { type: 'string' } }));
    const after = request({
      allOf: [obj({ id: { type: 'string' } }), obj({ k: { type: 'string' } }, ['k'])],
    });
    expect(kinds(diffSpecs(before, after))).toEqual(['breaking: field k added (required)']);
  });

  it('a removed operation stays breaking next to compositions', () => {
    const before = spec('200', ref('Opt'), union);
    const after: Spec = { paths: {}, components: { schemas: union } };
    expect(diffSpecs(before, after)[0]).toMatchObject({ status: 'removed', kind: 'breaking' });
  });

  it('anyOf to oneOf with the same shape reports nothing; with a change it still reports it', () => {
    const items = {
      A: obj({ x: { type: 'string' } }),
      B: obj({ y: { type: 'string' } }),
      C: obj({ z: { type: 'string' } }),
    };
    const any = spec('200', { anyOf: [ref('A'), ref('B')] }, items);
    expect(diffSpecs(any, spec('200', { oneOf: [ref('A'), ref('B')] }, items))).toEqual([]);
    const added = diffSpecs(any, spec('200', { oneOf: [ref('A'), ref('B'), ref('C')] }, items));
    expect(kinds(added)).toEqual(['breaking: variant added: C']);
    const shrunk = { ...items, A: obj({}) };
    expect(kinds(diffSpecs(any, spec('200', { oneOf: [ref('A'), ref('B')] }, shrunk)))).toEqual([
      'breaking: field x removed',
    ]);
  });
});
