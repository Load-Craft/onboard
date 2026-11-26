// Secret detection on camelCase names, TODO markers and the nesting depth limit of the OpenAPI validator.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers.ts';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi.ts';

function at(root: JsonObject, ...keys: string[]): JsonObject {
  let current: Json | undefined = root;
  for (const key of keys) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`not an object before ${key}`);
    }
    current = current[key];
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`not an object at ${keys.join('/')}`);
  }
  return current;
}

function runDocument(document: JsonObject): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runValidator('openapi', [target]);
  });
}

function withProperty(name: string, schema: JsonObject): JsonObject {
  const document = validOpenapi();
  at(document, 'components', 'schemas', 'CreateOrder', 'properties')[name] = schema;
  return document;
}

describe('OpenapiSecretAndDepthFixTestCase', () => {
  it('camelcase api key example is rejected', () => {
    const result = runDocument(
      withProperty('apiKey', { type: 'string', example: 'order-example' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('camelcase access token example is rejected', () => {
    const result = runDocument(
      withProperty('accessToken', { type: 'string', example: 'order-example' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('camelcase client secret example is rejected', () => {
    const result = runDocument(
      withProperty('clientSecret', { type: 'string', example: 'order-example' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('snake case access token example still rejected', () => {
    const result = runDocument(
      withProperty('access_token', { type: 'string', example: 'order-example' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('camelcase embedded secret literal is rejected', () => {
    const document = validOpenapi();
    at(document, 'info')['bearerToken'] = 'order-example-token';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  it('innocent camelcase field with example is accepted', () => {
    const result = runDocument(withProperty('orderTotal', { type: 'integer', example: 1 }));
    expect(result.status, result.stderr).toBe(0);
  });

  it('todo marker with inner space is rejected', () => {
    const document = validOpenapi();
    at(document, 'info')['title'] = '[ TODO ] fill in';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  it('deeply nested document fails cleanly', () => {
    const raw = `{"x":${'['.repeat(3000)}${']'.repeat(3000)}}`;
    const result = withTempDir((dir) => {
      const target = join(dir, 'openapi.json');
      writeFileSync(target, raw, 'utf8');
      return runValidator('openapi', [target]);
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('document nesting exceeds the supported depth');
    expect(result.stderr).not.toContain('Traceback');
  });
});
