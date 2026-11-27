// The operations the plugin's public snapshot of the backend contract leaves out
// (`scripts/sync-api/excluded.ts`): the snapshot holds none of them, and the import drops them.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXCLUDED_OPERATIONS, withoutExcludedOperations } from '../scripts/sync-api/excluded.js';
import type { Spec } from '../scripts/sync-api/diff.js';

const SNAPSHOT = resolve(import.meta.dirname, '..', '..', 'contracts', 'loadcraft-openapi.json');

describe('the public snapshot', () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Spec;

  it('holds no excluded operation and no schema only one of them used', () => {
    for (const entry of EXCLUDED_OPERATIONS) {
      expect(snapshot.paths?.[entry.path]?.[entry.method], entry.path).toBeUndefined();
    }
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain('dev-login');
    expect(text).not.toContain('DevLoginBody');
  });

  it('keeps the API token routes: that is how a user makes the token of the plugin', () => {
    expect(snapshot.paths?.['/api/v1/auth/api-tokens']?.['post']).toBeDefined();
  });

  it('says why for every exclusion', () => {
    for (const entry of EXCLUDED_OPERATIONS) expect(entry.why.length).toBeGreaterThan(40);
  });
});

describe('withoutExcludedOperations', () => {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const spec: Spec = {
    openapi: '3.1.0',
    paths: {
      '/api/v1/auth/dev-login': {
        post: { requestBody: { content: { 'application/json': { schema: ref('DevLoginBody') } } } },
        get: {
          responses: { '200': { content: { 'application/json': { schema: ref('Shared') } } } },
        },
      },
      '/api/v1/items': {
        get: {
          responses: { '200': { content: { 'application/json': { schema: ref('Shared') } } } },
        },
      },
    },
    components: {
      schemas: {
        DevLoginBody: { type: 'object', properties: { inner: ref('OnlyDevLogin') } },
        OnlyDevLogin: { type: 'string' },
        Shared: { type: 'object' },
        Unused: { type: 'string' },
      },
    },
  };

  it('drops the operation and the schemas only it reached, keeps the rest as written', () => {
    const next = withoutExcludedOperations(spec);
    expect(Object.keys(next.paths?.['/api/v1/auth/dev-login'] ?? {})).toEqual(['get']);
    expect(next.paths?.['/api/v1/items']).toEqual(spec.paths?.['/api/v1/items']);
    expect(Object.keys(next.components?.['schemas'] ?? {}).sort()).toEqual(['Shared', 'Unused']);
  });

  it('drops a path item that holds nothing else, and leaves a spec without one untouched', () => {
    const only: Spec = {
      paths: { '/api/v1/auth/dev-login': { post: {} }, '/api/v1/items': { get: {} } },
    };
    expect(Object.keys(withoutExcludedOperations(only).paths ?? {})).toEqual(['/api/v1/items']);
    const clean: Spec = { paths: { '/api/v1/items': { get: {} } } };
    expect(withoutExcludedOperations(clean)).toBe(clean);
  });
});
