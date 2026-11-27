// The validator rejects an OpenAPI document that the official tooling (Redocly's `struct` rule on the
// OpenAPI 3.0 type tree) rejects: a field the 3.0 object does not define, a value of the wrong type,
// a missing required field. Every case starts from the valid document and breaks it in one spot.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir } from './helpers.ts';
import { validOpenapi, type JsonObject } from './valid-openapi.ts';

function run(document: JsonObject): { status: number; stderr: string } {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document));
    const result = runValidator('openapi', [target]);
    return { status: result.status, stderr: result.stderr };
  });
}

const operation = (document: JsonObject): JsonObject =>
  ((document['paths'] as JsonObject)['/api/orders'] as JsonObject)['post'] as JsonObject;
const schemas = (document: JsonObject): JsonObject =>
  (document['components'] as JsonObject)['schemas'] as JsonObject;

const BROKEN: [string, (document: JsonObject) => void, string][] = [
  [
    'an unknown field on an operation',
    (d) => (operation(d)['foo'] = 1),
    'Property `foo` is not expected here.',
  ],
  [
    'an unknown field on info',
    (d) => ((d['info'] as JsonObject)['foo'] = 1),
    'Property `foo` is not expected here.',
  ],
  [
    'an unknown field on a server',
    (d) => (((d['servers'] as JsonObject[])[0] as JsonObject)['urll'] = 'x'),
    'Property `urll` is not expected here.',
  ],
  [
    'tags that are not an array',
    (d) => (operation(d)['tags'] = 'a'),
    'Expected type `array` but got `string`.',
  ],
  [
    'deprecated as a string',
    (d) => (operation(d)['deprecated'] = 'yes'),
    'Expected type `boolean` but got `string`.',
  ],
  [
    'a version that is not a string',
    (d) => ((d['info'] as JsonObject)['version'] = 1),
    'Expected type `string` but got `integer`.',
  ],
  [
    'a schema type that does not exist',
    (d) =>
      (((schemas(d)['Order'] as JsonObject)['properties'] as JsonObject)['id'] = { type: 'strng' }),
    '`type` can be one of the following only',
  ],
  [
    'minLength as a string',
    (d) =>
      (((schemas(d)['Order'] as JsonObject)['properties'] as JsonObject)['id'] = {
        type: 'string',
        minLength: 'x',
      }),
    'Expected type `integer` but got `string`.',
  ],
  [
    'required as a string',
    (d) => ((schemas(d)['Order'] as JsonObject)['required'] = 'id'),
    'Expected type `array`',
  ],
  [
    'a security requirement that is an array',
    (d) => (operation(d)['security'] = [['bearerAuth']]),
    'Expected type `SecurityRequirement`',
  ],
  [
    'additionalProperties as a string',
    (d) => ((schemas(d)['Order'] as JsonObject)['additionalProperties'] = 'x'),
    'Expected type `Schema` (object) but got `string`',
  ],
  [
    'a missing info title',
    (d) => delete (d['info'] as JsonObject)['title'],
    'The field `title` must be present on this level.',
  ],
];

describe('OpenAPI structure', () => {
  it('accepts the valid document and x- extensions', () => {
    const document = validOpenapi();
    operation(document)['x-owner'] = 'orders';
    expect(run(document)).toMatchObject({ status: 0 });
  });

  for (const [name, mutate, expected] of BROKEN) {
    it(`rejects ${name}`, () => {
      const document = validOpenapi();
      mutate(document);
      const result = run(document);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('not valid OpenAPI 3.0');
      expect(result.stderr).toContain(expected);
    });
  }
});
