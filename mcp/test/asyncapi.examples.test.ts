// Every example of every message in the contract (and in the fixture) must be valid against the
// message's own payload schema: the examples are what a reader copies, and what the importer
// sends as the generated message body.

import { readFileSync } from 'node:fs';

import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

import type { AsyncApiDocument, Schema } from '../scripts/gen-clients/model.js';

const FILES = {
  'contracts/loadcraft-asyncapi.json': new URL(
    '../../contracts/loadcraft-asyncapi.json',
    import.meta.url,
  ),
  'the generator fixture': new URL('./fixtures/gen-clients/mini.asyncapi.json', import.meta.url),
};

/**
 * The contract profile forbids a literal value on a secret-bearing key, so an example leaves such a
 * key out even where the frame always carries it. The check puts a stand-in there.
 */
const SECRET_KEY = /token|secret|password|cookie|authorization/i;

function withSecretStandIns(schema: Schema, example: unknown): unknown {
  if (typeof example !== 'object' || example === null || Array.isArray(example)) return example;
  const filled: Record<string, unknown> = { ...(example as Record<string, unknown>) };
  for (const key of schema.required ?? []) {
    if (!(key in filled) && SECRET_KEY.test(key)) filled[key] = 'redacted';
  }
  return filled;
}

describe.each(Object.entries(FILES))('examples of %s', (_name, url) => {
  const doc = JSON.parse(readFileSync(url, 'utf8')) as AsyncApiDocument;
  const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });

  it('has at least one example per message', () => {
    const without = Object.entries(doc.components.messages)
      .filter(([, message]) => (message.examples ?? []).length === 0)
      .map(([key]) => key);
    expect(without).toEqual([]);
  });

  it('are all valid against their payload schema', () => {
    const problems: string[] = [];
    for (const [key, message] of Object.entries(doc.components.messages)) {
      const validate = ajv.compile(message.payload);
      for (const [index, example] of (message.examples ?? []).entries()) {
        if (
          !validate(withSecretStandIns(message.payload, (example as { payload: unknown }).payload))
        ) {
          const why = (validate.errors ?? [])
            .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`)
            .join('; ');
          problems.push(`${key} example ${index}: ${why}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // An open object (`additionalProperties: true`) still names every key its examples show: an
  // example key the schema does not describe is a key a reader cannot look up in the contract.
  it('describe in the schema every key the examples carry', () => {
    const problems: string[] = [];
    for (const [key, message] of Object.entries(doc.components.messages)) {
      const validate = ajv.compile(closed(message.payload));
      for (const [index, example] of (message.examples ?? []).entries()) {
        if (
          !validate(withSecretStandIns(message.payload, (example as { payload: unknown }).payload))
        ) {
          const why = (validate.errors ?? [])
            .filter((error) => error.keyword === 'additionalProperties')
            .map((error) => `${error.instancePath || '/'} ${JSON.stringify(error.params)}`)
            .join('; ');
          problems.push(`${key} example ${index}: ${why}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/** The schema with every object that names its keys closed to other keys. */
function closed(schema: Schema): Schema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = key === 'examples' || key === 'example' ? value : walk(value);
    }
    const extra = out['additionalProperties'];
    if (out['properties'] !== undefined && (extra === undefined || typeof extra === 'boolean')) {
      out['additionalProperties'] = false;
    }
    return out;
  };
  return walk(schema) as Schema;
}
