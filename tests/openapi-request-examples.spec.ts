// Examples in a request body are input to the test-data generator. An example on an optional field
// is legitimate when a journey sends the field and the value is grounded in code, so the validator
// does not warn about it; the skill rules say when such an example belongs and what it must satisfy.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT, runValidator, withTempDir } from './helpers';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi';

const SKILL_DIR = join(PACK_ROOT, 'skills', 'loadcraft-openapi');

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

function warnLines(document: JsonObject): { status: number; warns: string[] } {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    const result = runValidator('openapi', [target]);
    return {
      status: result.status,
      warns: result.stderr.split('\n').filter((line) => line.startsWith('WARN ')),
    };
  });
}

describe('OptionalRequestBodyExampleTestCase', () => {
  it('the validator does not warn about examples on optional fields or in named examples', () => {
    const baseline = warnLines(validOpenapi());
    const document = validOpenapi();
    const schemas = at(document, 'components', 'schemas');
    schemas['Address'] = {
      type: 'object',
      properties: {
        city: { type: 'string', example: 'Example City' },
        postcode: { type: 'string', example: '00-001' },
      },
    };
    Object.assign(at(schemas, 'CreateOrder', 'properties'), {
      note: { type: 'string', example: 'leave at the door' },
      shipping: { $ref: '#/components/schemas/Address' },
      currency: { type: 'string', example: 'XXX' },
    });
    at(document, 'paths', '/api/orders', 'post', 'requestBody', 'content')['application/json'] = {
      schema: { $ref: '#/components/schemas/CreateOrder' },
      example: { item_id: 'item-example', quantity: 1, note: 'leave at the door' },
      examples: {
        otherCurrency: {
          value: {
            item_id: 'item-example',
            quantity: 1,
            currency: 'XXX',
            shipping: { city: 'Example City' },
          },
        },
      },
    };
    const result = warnLines(document);
    expect(result.status).toBe(0);
    expect(result.warns).toEqual(baseline.warns);
  });
});

function readSkill(name: string): string {
  return readFileSync(join(SKILL_DIR, name), 'utf8');
}

type Rule = {
  name: string;
  file: string;
  pattern: RegExp;
  inversions: [string, string][];
};

const RULES: Rule[] = [
  {
    name: 'an example is generator input and must be valid for the code',
    file: 'references/loadcraft-contract.md',
    pattern:
      /An example is input to the test-data generator: it may be read as a format pattern and repeated in every row, so it must be valid for the code, not merely plausible/,
    inversions: [['must be valid for the code', 'may be merely plausible']],
  },
  {
    name: 'fields describing one thing have consistent examples in one convention',
    file: 'references/loadcraft-contract.md',
    pattern:
      /Fields that together describe one thing[^.]*get examples that agree with each other and follow one convention, the one the code expects/,
    inversions: [['agree with each other', 'vary independently']],
  },
  {
    name: 'an unvalidated field says so and its example does not look like a standard code',
    file: 'references/loadcraft-contract.md',
    pattern:
      /A field the code does not validate says so in its description \(free text, not validated\)[^.]*must not look like a code from a standard vocabulary the code does not enforce/,
    inversions: [['must not look like', 'should look like']],
  },
  {
    name: 'a vocabulary-validated field names the vocabulary and the exact form',
    file: 'references/loadcraft-contract.md',
    pattern:
      /A field validated against a vocabulary names that vocabulary and the exact form of a value \(letter case, separator, standard\) in its description, and its example belongs to it/,
    inversions: [['and its example belongs to it', 'and its example may come from elsewhere']],
  },
  {
    name: 'an example on a field a journey sends is allowed when grounded and consistent',
    file: 'references/loadcraft-contract.md',
    pattern:
      /An example on a property, an optional one included, is allowed when a user journey sends that field and the value is grounded in code and consistent with its related fields/,
    inversions: [['when a user journey sends that field', 'on any field']],
  },
  {
    name: 'an optional field no journey needs and that cannot be grounded has no example',
    file: 'references/loadcraft-contract.md',
    pattern:
      /An optional field that no journey needs and whose value cannot be grounded stays without an example/,
    inversions: [['stays without an example', 'gets an illustrative example']],
  },
  {
    name: 'a branch selector may sit in a named example, other fields follow the same rule',
    file: 'references/loadcraft-contract.md',
    pattern:
      /A branch selector may be set in a named example even when it is optional; the other fields of the branch get examples only under the same rule \(the branch sends them and the value is grounded\)/,
    inversions: [['get examples only under the same rule', 'get examples freely']],
  },
  {
    name: 'synthetic examples: an optional field without a journey or grounding has none',
    file: 'references/endpoint-evidence.md',
    pattern:
      /An optional field gets one only when a journey sends it and you can ground the value; otherwise leave it without an example/,
    inversions: [['otherwise leave it without an example', 'otherwise invent a plausible one']],
  },
  {
    name: 'synthetic examples: valid for the code and consistent',
    file: 'references/endpoint-evidence.md',
    pattern:
      /A synthetic example is input to the test-data generator, which may repeat it as a format pattern in every row: make it valid for the code and consistent with the fields that describe the same thing/,
    inversions: [['make it valid for the code', 'make it look plausible']],
  },
  {
    name: 'trace depth: follow calls and dependency packages until each emitted fact has evidence',
    file: 'references/endpoint-evidence.md',
    pattern:
      /Follow each value through further calls and files, including dependency packages at the version in the lockfile, until every type, constraint, default and branch you emit has evidence in code/,
    inversions: [['until every type', 'until the first type']],
  },
  {
    name: 'trace depth: an unresolved fact is a blocker, not a guess',
    file: 'references/endpoint-evidence.md',
    pattern: /What you could not establish, report as a blocker in your findings; do not guess it/,
    inversions: [['do not guess it', 'guess it']],
  },
  {
    name: 'skill: trace depth reaches dependency packages',
    file: 'SKILL.md',
    pattern:
      /follows the value through further calls and files, including dependency packages at the version in the lockfile, until every type, constraint, default and branch it emits has evidence in code/,
    inversions: [['until every type', 'until the first type']],
  },
  {
    name: 'skill: an unresolved fact is reported as a blocker',
    file: 'SKILL.md',
    pattern:
      /What it could not establish it reports as a blocker in its findings instead of guessing/,
    inversions: [['instead of guessing', 'or guesses']],
  },
];

describe('ExampleAndTraceDepthRuleTestCase', () => {
  it('no trace of the withdrawn optional-property warning is left in the skill', () => {
    for (const file of [
      'SKILL.md',
      'references/loadcraft-contract.md',
      'references/endpoint-evidence.md',
    ]) {
      const text = readSkill(file);
      expect(text, file).not.toMatch(/optional request-body property/);
      expect(text, file).not.toMatch(/[Vv]alidator accepts such a selector/);
      expect(text, file).not.toMatch(/only when a required value cannot be derived/);
    }
  });

  it('every rule binds its condition to its action', () => {
    for (const rule of RULES) expect(readSkill(rule.file), rule.name).toMatch(rule.pattern);
  });

  it('inverting or dropping a rule turns its test red', () => {
    for (const rule of RULES) {
      const text = readSkill(rule.file);
      for (const [old, replacement] of rule.inversions) {
        const label = `${rule.name}: '${old}' -> '${replacement}'`;
        expect(text, label).toContain(old);
        expect(rule.pattern.test(text.split(old).join(replacement)), label).toBe(false);
      }
    }
  });
});
