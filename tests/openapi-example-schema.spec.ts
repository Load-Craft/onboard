// An example is checked against the schema of its own place: a value that breaks its declared
// type, enum, bounds, length, strict format, pattern, or (in a request) a required property or a
// readOnly field is a warning. Anything the validator cannot decide unambiguously is left alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT, runValidator, withTempDir, type RunResult } from './helpers';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi';

const SKILL_DIR = join(PACK_ROOT, 'skills', 'loadcraft-openapi');
const FAMILY = /example does not match its schema|readOnly property|writeOnly property/;
const POST = '/paths/~1api~1orders/post';
const REQUEST = `${POST}/requestBody/content/application~1json`;
const RESPONSE = `${POST}/responses/201/content/application~1json`;

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

/** The pointers of the example-schema warnings, in output order. */
function flagged(document: JsonObject): string[] {
  return run(document)
    .stderr.split('\n')
    .filter((line) => line.startsWith('WARN ') && FAMILY.test(line))
    .map((line) => line.slice('WARN '.length, line.indexOf(': ')));
}

function schemas(document: JsonObject): JsonObject {
  return at(document, 'components', 'schemas');
}

function requestMedia(document: JsonObject): JsonObject {
  return at(document, 'paths', '/api/orders', 'post', 'requestBody', 'content', 'application/json');
}

function responseMedia(document: JsonObject): JsonObject {
  return at(document, 'paths', '/api/orders', 'post', 'responses', '201', 'content');
}

describe('ExampleMatchesSchemaTestCase', () => {
  it('the valid document has no example-schema warning', () => {
    expect(flagged(validOpenapi())).toEqual([]);
  });

  it('warns on a property example of the wrong type and fails under --strict', () => {
    const document = validOpenapi();
    at(schemas(document), 'CreateOrder', 'properties')['quantity'] = {
      type: 'integer',
      minimum: 1,
      example: 'one',
    };
    expect(flagged(document)).toEqual([
      '/components/schemas/CreateOrder/properties/quantity/example',
    ]);
    const line =
      run(document)
        .stderr.split('\n')
        .find((text) => FAMILY.test(text)) ?? '';
    expect(line).toContain('expected integer');
    expect(run(document, '--strict').status).not.toBe(0);
  });

  it('warns on a body example key outside its enum, behind $ref and inside items', () => {
    const document = validOpenapi();
    schemas(document)['Line'] = {
      type: 'object',
      required: ['sku', 'size'],
      properties: { sku: { type: 'string' }, size: { type: 'string', enum: ['S', 'M'] } },
    };
    Object.assign(at(schemas(document), 'CreateOrder', 'properties'), {
      lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
    });
    requestMedia(document)['example'] = {
      item_id: 'item-example',
      quantity: 1,
      lines: [
        { sku: 'sku-example', size: 'M' },
        { sku: 'sku-example', size: 'xl' },
      ],
    };
    expect(flagged(document)).toEqual([`${REQUEST}/example/lines/1/size`]);
  });

  it('checks bounds, lengths and allOf members together', () => {
    const document = validOpenapi();
    schemas(document)['Named'] = {
      type: 'object',
      properties: { label: { type: 'string', maxLength: 5 } },
    };
    schemas(document)['CreateOrder'] = {
      allOf: [
        { $ref: '#/components/schemas/Named' },
        {
          type: 'object',
          required: ['item_id', 'quantity'],
          properties: {
            item_id: { type: 'string', minLength: 3 },
            quantity: { type: 'integer', minimum: 1, maximum: 10 },
          },
        },
      ],
    };
    requestMedia(document)['example'] = { item_id: 'ab', quantity: 11, label: 'too long' };
    expect(flagged(document)).toEqual([
      `${REQUEST}/example/item_id`,
      `${REQUEST}/example/label`,
      `${REQUEST}/example/quantity`,
    ]);
  });

  it('checks strict formats only', () => {
    const document = validOpenapi();
    Object.assign(at(schemas(document), 'Order', 'properties'), {
      day: { type: 'string', format: 'date', example: '2026-02-30' },
      at: { type: 'string', format: 'date-time', example: '2026-01-05T10:00:00Z' },
      ref: { type: 'string', format: 'uuid', example: 'not-a-uuid' },
      mail: { type: 'string', format: 'email', example: 'user.example.com' },
      link: { type: 'string', format: 'uri', example: 'whatever' },
      code: { type: 'string', format: 'password' },
    });
    expect(flagged(document)).toEqual([
      '/components/schemas/Order/properties/day/example',
      '/components/schemas/Order/properties/mail/example',
      '/components/schemas/Order/properties/ref/example',
    ]);
  });

  it('checks a pattern only when it is plain ECMAScript', () => {
    const document = validOpenapi();
    Object.assign(at(schemas(document), 'Order', 'properties'), {
      sku: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{2}$', example: 'abc-12' },
      good: { type: 'string', pattern: '^[A-Z]{3}$', example: 'ABC' },
      inline: { type: 'string', pattern: '(?i)^[a-z]+$', example: 'ABC' },
      anchor: { type: 'string', pattern: '\\A[a-z]+\\z', example: 'ABC' },
      broken: { type: 'string', pattern: '[a-', example: 'x' },
    });
    expect(flagged(document)).toEqual(['/components/schemas/Order/properties/sku/example']);
  });

  it('a request example misses a required property, a response example may', () => {
    const document = validOpenapi();
    at(schemas(document), 'CreateOrder')['required'] = ['item_id', 'quantity', 'password'];
    at(schemas(document), 'CreateOrder', 'properties')['password'] = { type: 'string' };
    requestMedia(document)['example'] = { item_id: 'item-example' };
    at(responseMedia(document), 'application/json')['example'] = { id: 'order-example' };
    expect(flagged(document), 'a secret cannot be in an example, so it is not asked for').toEqual([
      `${REQUEST}/example`,
    ]);
  });

  it('readOnly in a request example and writeOnly in a response example', () => {
    const document = validOpenapi();
    schemas(document)['CreateOrder'] = {
      type: 'object',
      required: ['item_id', 'quantity'],
      properties: {
        id: { type: 'string', readOnly: true },
        item_id: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        coupon: { type: 'string', writeOnly: true },
      },
    };
    at(responseMedia(document), 'application/json')['schema'] = {
      $ref: '#/components/schemas/CreateOrder',
    };
    requestMedia(document)['example'] = { id: 'order-example', item_id: 'i', quantity: 1 };
    at(responseMedia(document), 'application/json')['example'] = {
      id: 'order-example',
      item_id: 'i',
      quantity: 1,
      coupon: 'coupon-example',
    };
    expect(flagged(document)).toEqual([`${REQUEST}/example/id`, `${RESPONSE}/example/coupon`]);
  });

  it('checks parameter examples, with the string form of a scalar accepted', () => {
    const document = validOpenapi();
    at(document, 'paths', '/api/orders', 'post')['parameters'] = [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, example: 0 } },
      { name: 'size', in: 'query', example: '20', schema: { type: 'integer' } },
      { name: 'mode', in: 'query', example: 'fast', schema: { type: 'string', enum: ['slow'] } },
      {
        name: 'tags',
        in: 'query',
        example: 'a,b',
        schema: { type: 'array', items: { type: 'string' } },
      },
    ];
    expect(flagged(document)).toEqual([
      `${POST}/parameters/query-mode/example`,
      `${POST}/parameters/query-page/schema/example`,
    ]);
  });

  it('named examples are not checked: one may show an error branch on purpose', () => {
    const document = validOpenapi();
    at(document, 'components')['examples'] = {
      zeroQuantity: { value: { item_id: 'item-example', quantity: 0 } },
    };
    requestMedia(document)['examples'] = {
      missingQuantity: { value: { item_id: 'item-example' } },
      zeroQuantity: { $ref: '#/components/examples/zeroQuantity' },
    };
    at(document, 'paths', '/api/orders', 'post')['parameters'] = [
      {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1 },
        example: 1,
        examples: { belowRange: { value: 0 } },
      },
    ];
    expect(flagged(document)).toEqual([]);
  });

  it('an exclusive bound says so', () => {
    const document = validOpenapi();
    at(schemas(document), 'CreateOrder', 'properties')['quantity'] = {
      type: 'integer',
      minimum: 0,
      exclusiveMinimum: true,
    };
    requestMedia(document)['example'] = { item_id: 'item-example', quantity: 0 };
    const lines = run(document)
      .stderr.split('\n')
      .filter((line) => FAMILY.test(line));
    expect(lines).toEqual([expect.stringContaining('0 is not above the exclusive minimum 0')]);
  });

  it('leaves undecidable schemas and placeholder values alone', () => {
    const document = validOpenapi();
    Object.assign(at(schemas(document), 'Order', 'properties'), {
      note: { type: 'string', nullable: true, example: null },
      free: { example: 42 },
      bag: {
        type: 'object',
        additionalProperties: { type: 'string' },
        example: { any: 1 },
      },
      token_hint: { type: 'string', format: 'uuid', example: '<order id>' },
      templated: { type: 'integer', example: '{{quantity}}' },
      shell: { type: 'integer', example: '${QUANTITY}' },
      whole: { type: 'integer', example: 2.0 },
    });
    expect(flagged(document)).toEqual([]);
  });
});

describe('ExampleSchemaRuleTestCase', () => {
  const pattern =
    /The bundled validator checks every example against the schema of its own place[^.]*and warns when it breaks one/;

  it('the contract says the validator checks an example against its schema', () => {
    expect(readFileSync(join(SKILL_DIR, 'references', 'loadcraft-contract.md'), 'utf8')).toMatch(
      pattern,
    );
  });

  it('inverting the rule turns its test red', () => {
    const text = readFileSync(join(SKILL_DIR, 'references', 'loadcraft-contract.md'), 'utf8');
    expect(text).toContain('and warns when it breaks one');
    expect(pattern.test(text.split('and warns when it breaks one').join('and ignores it'))).toBe(
      false,
    );
  });
});
