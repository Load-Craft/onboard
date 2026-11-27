// Cover the rules that protect what survives a LoadCraft import.
//
// Two families live here. Referenced leaf enums are an ERROR, because the canonical property model
// does not follow a `$ref` for a leaf and the enum silently disappears. Missing examples, unusable
// parameters and dropped `examples` maps are WARNINGS, because the importer accepts them while
// generating measurably worse flows and feeder data; `--strict` promotes them.
//
// Every fixture starts from the shared valid document and is mutated in exactly one spot, so an
// asserted message can only come from the rule under test.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi';

const ENUM_INLINE_MESSAGE = 'enum-bearing schema must be inlined here';
const ARRAY_WRAPPER_MESSAGE = 'referenced array schema hides an enum in its items';
const RESPONSE_EXAMPLE_MESSAGE = 'body-bearing response has no example';
const PARAMETER_VALUE_MESSAGE = 'parameter has no example, enum or default';
const RESPONSE_EXAMPLES_MAP_MESSAGE = 'a named examples map on a response is dropped on import';
const PARAMETER_EXAMPLES_MAP_MESSAGE = 'a named examples map on a parameter is dropped on import';

/** Walks `path` down from `node`, requiring an object at every step. */
function at(node: Json | undefined, ...path: string[]): JsonObject {
  let current: Json | undefined = node;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      throw new Error(`not an object at ${key}`);
    }
    current = current[key];
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error(`not an object at the end of ${path.join('/')}`);
  }
  return current;
}

function run(document: JsonObject, ...flags: string[]): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runValidator('openapi', [target, ...flags]);
  });
}

function operation(document: JsonObject): JsonObject {
  return at(document, 'paths', '/api/orders', 'post');
}

/** The shared fixture plus the one example it is missing. */
function cleanDocument(): JsonObject {
  const document = validOpenapi();
  at(operation(document), 'responses', '400', 'content', 'application/json')['example'] = {
    message: 'quantity must be at least 1',
  };
  return document;
}

function withStatusEnumComponent(document: JsonObject): JsonObject {
  at(document, 'components', 'schemas')['OrderStatus'] = {
    type: 'string',
    enum: ['open', 'shipped'],
  };
  return document;
}

function orderProperties(document: JsonObject): JsonObject {
  return at(document, 'components', 'schemas', 'Order', 'properties');
}

describe('OpenapiImportFidelityTestCase', () => {
  // ---- referenced leaf enums are rejected -------------------------------

  it('rejects enum referenced from a property', () => {
    const document = withStatusEnumComponent(cleanDocument());
    orderProperties(document)['status'] = { $ref: '#/components/schemas/OrderStatus' };
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENUM_INLINE_MESSAGE);
    expect(result.stderr).toContain('Order/properties/status/$ref');
  });

  it('rejects enum reached through a reference chain', () => {
    const document = withStatusEnumComponent(cleanDocument());
    at(document, 'components', 'schemas')['StatusAlias'] = {
      $ref: '#/components/schemas/OrderStatus',
    };
    orderProperties(document)['status'] = { $ref: '#/components/schemas/StatusAlias' };
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENUM_INLINE_MESSAGE);
  });

  it('rejects enum wrapped in all of', () => {
    const document = withStatusEnumComponent(cleanDocument());
    at(document, 'components', 'schemas')['DescribedStatus'] = {
      allOf: [{ $ref: '#/components/schemas/OrderStatus' }],
      description: 'Fulfilment state.',
    };
    orderProperties(document)['status'] = { $ref: '#/components/schemas/DescribedStatus' };
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENUM_INLINE_MESSAGE);
  });

  it('rejects enum referenced from additional properties', () => {
    const document = withStatusEnumComponent(cleanDocument());
    at(document, 'components', 'schemas')['StatusMap'] = {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/OrderStatus' },
    };
    orderProperties(document)['statuses'] = { $ref: '#/components/schemas/StatusMap' };
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENUM_INLINE_MESSAGE);
  });

  it('rejects referenced array that hides an enum', () => {
    const document = cleanDocument();
    at(document, 'components', 'schemas')['StatusList'] = {
      type: 'array',
      items: { type: 'string', enum: ['open', 'shipped'] },
    };
    orderProperties(document)['statuses'] = { $ref: '#/components/schemas/StatusList' };
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ARRAY_WRAPPER_MESSAGE);
  });

  it('rejects enum referenced from a parameter schema', () => {
    const document = withStatusEnumComponent(cleanDocument());
    operation(document)['parameters'] = [
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { $ref: '#/components/schemas/OrderStatus' },
      },
    ];
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ENUM_INLINE_MESSAGE);
    expect(result.stderr).toContain('parameters/query-status/schema/$ref');
  });

  it('accepts a referenced object schema that also declares an enum', () => {
    // An object schema is projected as an object, so its reference is followed.
    const document = cleanDocument();
    at(document, 'components', 'schemas')['Shape'] = {
      type: 'object',
      enum: [{ kind: 'box' }],
    };
    orderProperties(document)['shape'] = { $ref: '#/components/schemas/Shape' };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts an enum as a whole response body', () => {
    // A body schema reference is followed, unlike a leaf property reference.
    const document = withStatusEnumComponent(cleanDocument());
    at(operation(document), 'responses')['200'] = {
      description: 'Current status',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/OrderStatus' },
          example: 'open',
        },
      },
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  // ---- unresolved markers ------------------------------------------------

  it('rejects a tbd marker', () => {
    const document = cleanDocument();
    at(orderProperties(document), 'id')['description'] = 'TBD';
    const result = run(document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved marker');
  });

  // ---- the secret heuristic must not fire on an OAuth2 scope -------------

  it('accepts a sensitively named oauth scope', () => {
    // A scope name comes from the identity provider and cannot be renamed.
    const document = cleanDocument();
    at(document, 'components', 'securitySchemes')['oauth'] = {
      type: 'oauth2',
      flows: {
        clientCredentials: {
          tokenUrl: 'https://app.example.com/oauth/token',
          scopes: { 'read:secret': 'Read protected records' },
        },
      },
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  // ---- warnings: accepted on import, worse in practice -------------------

  it('clean document emits no warning', () => {
    const result = run(cleanDocument(), '--strict');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('WARN');
  });

  it('warns about a response without an example', () => {
    const document = cleanDocument();
    delete at(operation(document), 'responses', '400', 'content', 'application/json')['example'];
    const result = run(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(RESPONSE_EXAMPLE_MESSAGE);
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain('1 warning');
  });

  it('strict promotes a missing response example to an error', () => {
    const document = cleanDocument();
    delete at(operation(document), 'responses', '400', 'content', 'application/json')['example'];
    const result = run(document, '--strict');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR /paths/~1api~1orders/post/responses/400');
    expect(result.stderr).not.toContain('WARN');
  });

  it('does not ask for an example on a binary body', () => {
    const document = cleanDocument();
    at(operation(document), 'responses')['200'] = {
      description: 'The rendered invoice',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not ask for an example on an event stream', () => {
    const document = cleanDocument();
    at(operation(document), 'responses')['200'] = {
      description: 'Progress events',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('warns about a named examples map on a response', () => {
    const document = cleanDocument();
    at(operation(document), 'responses', '400', 'content', 'application/json')['examples'] = {
      belowMinimum: { value: { message: 'quantity must be at least 1' } },
      unknownItem: { value: { message: 'item_id not found' } },
    };
    const result = run(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(RESPONSE_EXAMPLES_MAP_MESSAGE);
  });

  it('warns about a parameter a caller cannot fill', () => {
    const document = cleanDocument();
    operation(document)['parameters'] = [
      { name: 'region', in: 'query', required: false, schema: { type: 'string' } },
    ];
    const result = run(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(PARAMETER_VALUE_MESSAGE);
    expect(result.stderr).toContain('parameters/query-region');
  });

  it('accepts a parameter level example', () => {
    const document = cleanDocument();
    operation(document)['parameters'] = [
      {
        name: 'region',
        in: 'query',
        required: false,
        example: 'eu-west',
        schema: { type: 'string' },
      },
    ];
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts a schema level default instead of an example', () => {
    const document = cleanDocument();
    operation(document)['parameters'] = [
      {
        name: 'region',
        in: 'query',
        required: false,
        schema: { type: 'string', default: 'eu-west' },
      },
    ];
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not ask for a value on a secret named parameter', () => {
    // The profile forbids a literal there, so the warning would be unresolvable.
    const document = cleanDocument();
    operation(document)['parameters'] = [
      { name: 'nextToken', in: 'query', required: false, schema: { type: 'string' } },
    ];
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not ask for a value on a security scheme header', () => {
    const document = cleanDocument();
    at(document, 'components', 'securitySchemes')['tenantHeader'] = {
      type: 'apiKey',
      in: 'header',
      name: 'x-tenant-id',
    };
    operation(document)['parameters'] = [
      { name: 'x-tenant-id', in: 'header', required: true, schema: { type: 'string' } },
    ];
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not ask for a value on a preflight parameter', () => {
    const document = cleanDocument();
    at(document, 'paths')['/api/orders/{order_id}'] = {
      options: {
        operationId: 'preflightOrder',
        summary: 'Cross-origin preflight',
        security: [],
        parameters: [
          {
            name: 'order_id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Preflight accepted',
            content: {
              'application/json': { schema: { type: 'object' }, example: {} },
            },
          },
        },
      },
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  it('warns about a named examples map on a parameter', () => {
    const document = cleanDocument();
    operation(document)['parameters'] = [
      {
        name: 'region',
        in: 'query',
        required: false,
        schema: { type: 'string', example: 'eu-west' },
        examples: { eu: { value: 'eu-west' }, us: { value: 'us-east' } },
      },
    ];
    const result = run(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(PARAMETER_EXAMPLES_MAP_MESSAGE);
  });

  // ---- provenance --------------------------------------------------------

  it('accepts platform export as a provenance method', () => {
    const document = cleanDocument();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '0123abc',
      dirty: false,
      method: 'platform-export',
    };
    const result = run(document, '--strict');
    expect(result.status, result.stderr).toBe(0);
  });

  // ---- input robustness --------------------------------------------------

  it('reports a directory without a traceback', () => {
    const result = withTempDir((dir) => {
      const target = join(dir, 'openapi.json');
      mkdirSync(target);
      return runValidator('openapi', [target]);
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is a directory');
    expect(result.stderr).not.toContain('Traceback');
  });
});
