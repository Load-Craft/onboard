import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { PACK_ROOT, runValidator, withTempDir, type RunResult } from './helpers';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi';

const SKILL_DIR = join(PACK_ROOT, 'skills', 'loadcraft-openapi');

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

function runDocument(document: JsonObject, ...flags: string[]): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runValidator('openapi', [target, ...flags]);
  });
}

/** A token-only login: the one response whose single field is a secret. */
function loginDocument(): JsonObject {
  const document = validOpenapi();
  at(document, 'paths')['/auth/login'] = {
    post: {
      operationId: 'login',
      summary: 'Log in',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string', example: 'user@example.com' } },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Session token',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: { token: { type: 'string', description: 'Bearer token' } },
              },
              example: { token: '<token>' },
            },
          },
        },
      },
    },
  };
  return document;
}

describe('SecretPlaceholderTestCase', () => {
  it('placeholder on secret field in response example is accepted', () => {
    const result = runDocument(loginDocument());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr, 'the token-only response needs no warning either').not.toContain(
      '~1auth~1login',
    );
  });

  it('placeholder in request example is rejected', () => {
    const document = loginDocument();
    const body = at(
      document,
      'paths',
      '/auth/login',
      'post',
      'requestBody',
      'content',
      'application/json',
    );
    body['example'] = { email: 'user@example.com', password: '<password>' };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  it('real looking literal in response example is rejected', () => {
    const document = loginDocument();
    const response = at(document, 'paths', '/auth/login', 'post', 'responses', '200');
    at(response, 'content', 'application/json')['example'] = { token: 'abc123' };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  it('placeholder on schema property is rejected', () => {
    const document = loginDocument();
    const response = at(document, 'paths', '/auth/login', 'post', 'responses', '200');
    at(response, 'content', 'application/json', 'schema', 'properties', 'token')['example'] =
      '<token>';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('placeholder in named response examples map is rejected', () => {
    const document = loginDocument();
    const media = at(
      document,
      'paths',
      '/auth/login',
      'post',
      'responses',
      '200',
      'content',
      'application/json',
    );
    media['examples'] = { ok: { value: { token: '<token>' } } };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
  });
});

describe('SecuritySchemeNameTestCase', () => {
  function withScheme(name: string): JsonObject {
    const document = validOpenapi();
    at(document, 'components')['securitySchemes'] = {
      [name]: { type: 'apiKey', name: 'x-app-key', in: 'header' },
    };
    document['security'] = [{ [name]: [] }];
    at(document, 'paths', '/api/orders', 'post')['security'] = [{ [name]: [] }];
    return document;
  }

  it('scheme named with a sensitive last word is accepted', () => {
    for (const name of ['storeApiKey', 'apiToken', 'bearerToken', 'clientSecret']) {
      const result = runDocument(withScheme(name));
      expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    }
  });

  it('literal under a sensitive key next to the requirement is still rejected', () => {
    const document = withScheme('storeApiKey');
    at(document, 'paths', '/api/orders', 'post')['security'] = [
      { storeApiKey: ['literal'], apiToken: 'x' },
    ];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  it('sensitive key with a list value outside security is still rejected', () => {
    const document = validOpenapi();
    at(document, 'info')['apiToken'] = [];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });
});

describe('ProvenanceDependenciesTestCase', () => {
  function stamped(extra: JsonObject): JsonObject {
    const document = validOpenapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      method: 'static-trace',
      ...extra,
    };
    return document;
  }

  it('dependencies map of name to version is accepted', () => {
    const result = runDocument(
      stamped({ dependencies: { 'web-framework': '2.4.1', '@acme/core': '1.0.0' } }),
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('stamp without dependencies is still accepted', () => {
    const result = runDocument(stamped({}));
    expect(result.status, result.stderr).toBe(0);
  });

  it('dependencies must be an object', () => {
    const result = runDocument(stamped({ dependencies: ['web-framework@2.4.1'] }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dependencies');
  });

  it('dependency version must be a non empty string', () => {
    const bads: Json[] = [2, '', null];
    for (const bad of bads) {
      const result = runDocument(stamped({ dependencies: { 'web-framework': bad } }));
      expect(result.status, JSON.stringify(bad)).not.toBe(0);
      expect(result.stderr).toContain('dependencies');
    }
  });

  it('other unknown stamp keys are still rejected', () => {
    const result = runDocument(stamped({ environment: 'staging' }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsupported keys');
  });
});

function bigObject(fields: number): JsonObject {
  const properties: JsonObject = {};
  for (let index = 0; index < fields; index += 1) {
    properties[`field_${index}`] = { type: 'string', description: 'd'.repeat(60) };
  }
  return { type: 'object', properties };
}

describe('ExpandedSizeBudgetTestCase', () => {
  // The backend expands every $ref at every use, so the file size is not the cost.
  function budgetDocument(fields: number, uses: number): JsonObject {
    const document = validOpenapi();
    const schemas = at(document, 'components', 'schemas');
    schemas['Big'] = bigObject(fields);
    const parts: JsonObject = {};
    for (let index = 0; index < uses; index += 1) {
      parts[`part_${index}`] = { $ref: '#/components/schemas/Big' };
    }
    const order = at(schemas, 'Order');
    order['properties'] = parts;
    order['required'] = [];
    return document;
  }

  it('small operation has no size warning', () => {
    const result = runDocument(budgetDocument(5, 2));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('expanded');
  });

  it('reference reuse multiplies the size and warns', () => {
    const document = budgetDocument(40, 12);
    const fileSize = JSON.stringify(document).length;
    expect(fileSize, 'the file itself must be small, only the expansion is large').toBeLessThan(
      40_000,
    );
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(
      /WARN \/paths\/~1api~1orders\/post: expanded operation is [\d,]+ characters/,
    );
    expect(result.stderr).toContain('40,000');
  });

  it('success schema is counted twice', () => {
    // Backend builds the record with the success schema in the response list and
    // again as the operation's response_schema; one use is already half the cost.
    const once = budgetDocument(40, 3);
    const result = runDocument(once, '--measure');
    expect(result.status, result.stderr).toBe(0);
    const tokens = (result.stdout.split('POST /api/orders')[0] ?? '')
      .split(/\s+/)
      .filter((t) => t !== '');
    const measured = Number((tokens.at(-1) ?? '').replaceAll(',', ''));
    const schemaSize = JSON.stringify(at(once, 'components', 'schemas', 'Big')).length * 3;
    expect(measured).toBeGreaterThan(2 * schemaSize);
  });

  it('strict turns the size warning into an error', () => {
    const result = runDocument(budgetDocument(40, 12), '--strict');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERROR /paths/~1api~1orders/post: expanded operation');
  });

  it('budget flag overrides the threshold', () => {
    const document = budgetDocument(5, 2);
    const quiet = runDocument(document);
    const loud = runDocument(document, '--budget-chars', '500');
    expect(quiet.stderr).not.toContain('expanded');
    expect(loud.stderr).toContain('expanded operation');
  });

  it('measure lists every operation with its size', () => {
    const result = runDocument(loginDocument(), '--measure');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('POST /api/orders');
    expect(result.stdout).toContain('POST /auth/login');
  });

  it('cyclic schema does not hang or crash', () => {
    const document = validOpenapi();
    at(document, 'components', 'schemas', 'Order', 'properties')['parent'] = {
      $ref: '#/components/schemas/Order',
    };
    const result = runDocument(document, '--measure');
    expect(result.status, result.stderr).toBe(0);
  });

  it('explosive reference graph is reported not expanded forever', () => {
    const document = validOpenapi();
    const schemas = at(document, 'components', 'schemas');
    const depth = 14;
    for (let level = 0; level < depth; level += 1) {
      const child = `Level${level + 1}`;
      schemas[`Level${level}`] = {
        type: 'object',
        properties: {
          a: { $ref: `#/components/schemas/${child}` },
          b: { $ref: `#/components/schemas/${child}` },
          c: { $ref: `#/components/schemas/${child}` },
        },
      };
    }
    schemas[`Level${depth}`] = { type: 'object', properties: { leaf: { type: 'string' } } };
    at(schemas, 'Order', 'properties')['tree'] = { $ref: '#/components/schemas/Level0' };
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('expanded operation is at least');
  });

  it('contract reference states the same threshold as the validator', () => {
    const text = readSkill('references/loadcraft-contract.md');
    expect(text).toContain('40,000');
    expect(text).toContain('400,000');
  });
});

function readSkill(relative: string): string {
  return readFileSync(join(SKILL_DIR, relative), 'utf8');
}

type Rule = {
  name: string;
  file: string;
  /** Pattern binding the condition to the action. */
  pattern: RegExp;
  /** Inversions that turn the rule around or drop its condition; the pattern must then fail. */
  inversions: [string, string][];
};

const RULES: Rule[] = [
  {
    name: 'secret-only response keeps its example with a placeholder',
    file: 'SKILL.md',
    pattern:
      /In a response example, and only there, write the secret-bearing field as an angle-bracket placeholder/,
    inversions: [
      ['and only there, ', ''],
      ['angle-bracket placeholder', 'real value'],
    ],
  },
  {
    name: 'request side never carries a value, not even a placeholder',
    file: 'SKILL.md',
    pattern:
      /request body, a schema property and a parameter never carry a value on such a field, not even a placeholder/,
    inversions: [
      ['never carry', 'may carry'],
      [', not even a placeholder', ''],
    ],
  },
  {
    name: 'descriptions use one language, English unless the user names another',
    file: 'SKILL.md',
    pattern: /one language, English by default; use another language only when the user names it/,
    inversions: [
      ['English by default', "the repository's language"],
      ['only when the user names it', 'freely'],
    ],
  },
  {
    name: 'oversized operation is trimmed to correlation fields',
    file: 'SKILL.md',
    pattern:
      /When an operation exceeds the budget, trim the response schema to the fields a journey correlates or asserts on/,
    inversions: [
      ['trim the response schema', 'keep the response schema whole'],
      ['When an operation exceeds the budget', 'Always'],
    ],
  },
  {
    name: 'budget threshold is the one the validator enforces',
    file: 'SKILL.md',
    pattern: /Keep every operation's expanded size under 40,000 characters/,
    inversions: [['under 40,000', 'under 400,000']],
  },
  {
    name: 'routes from a dependency are read at the locked version without installing',
    file: 'SKILL.md',
    pattern:
      /registered by a framework package[^.]*\.\s*Read that package there as evidence, read-only and at the version the lockfile pins, without installing/,
    inversions: [
      ['Read that package there', 'Do not read that package'],
      ['without installing', 'installing it first'],
    ],
  },
  {
    name: 'dependency versions go into the stamp',
    file: 'SKILL.md',
    pattern: /Write the package name and version into the stamp's `dependencies`/,
    inversions: [['Write the package name', 'Omit the package name']],
  },
  {
    name: 'a changed dependency version invalidates the operations it contributes',
    file: 'SKILL.md',
    pattern:
      /changed manifest or lockfile entry for a package recorded in the stamp's `dependencies`[^.]*counts as a shared-layer change/,
    inversions: [['counts as a shared-layer change', 'can be ignored']],
  },
  {
    name: 'shared objects are merged by the written procedure',
    file: 'SKILL.md',
    pattern:
      /When several operations describe the same domain object, merge them with the procedure in \[references\/schema-merging.md\]/,
    inversions: [['merge them with the procedure in', 'keep one variant per operation, ignoring']],
  },
  {
    name: "workers do not read each other's output",
    file: 'SKILL.md',
    pattern:
      /Give each worker its own working directory for findings and forbid it to read any other worker's output/,
    inversions: [['forbid it to read', 'let it read']],
  },
  {
    name: 'a branch differing only in a secret value is reported, not a blocker',
    file: 'SKILL.md',
    pattern:
      /differs from another only in the value of a secret or externally provisioned field[^.]*cannot be exemplified by design: state the trigger/,
    inversions: [['cannot be exemplified by design', 'is a blocker']],
  },
  {
    name: 'an inexpressible optional parameter is a reported omission',
    file: 'SKILL.md',
    pattern:
      /is a reported omission when the parameter is optional and no material branch depends on it/,
    inversions: [['is a reported omission', 'is a blocker']],
  },
  {
    name: 'a step names what it hands to the next',
    file: 'SKILL.md',
    pattern:
      /say in the operation `description` what the result is good for and which operations accept it/,
    inversions: [
      ['say in the operation `description`', 'leave out of the operation `description`'],
    ],
  },
  {
    name: 'placeholder allowed only in a response example',
    file: 'references/loadcraft-contract.md',
    pattern:
      /only as an angle-bracket placeholder.{0,400}The same placeholder in a request example, a schema property, a parameter or a named `examples` map is still rejected/s,
    inversions: [['only as an angle-bracket placeholder', 'as any literal']],
  },
  {
    name: 'scheme name with a sensitive last word is accepted',
    file: 'references/loadcraft-contract.md',
    pattern:
      /the validator skips the heuristic for it and a scheme called `storeApiKey` or `bearerToken` is accepted/,
    inversions: [
      ['skips the heuristic for it', 'applies the heuristic to it'],
      ['is accepted', 'is rejected'],
    ],
  },
  {
    name: 'size budget trims to correlated fields and names the backend limit',
    file: 'references/loadcraft-contract.md',
    pattern: /\*\*40,000 characters per expanded operation\*\*/,
    inversions: [['40,000', '400,000']],
  },
  {
    name: 'oversized responses are reduced to correlation fields',
    file: 'references/loadcraft-contract.md',
    pattern:
      /reduce a large response object to the fields a journey correlates \(identifiers, totals, states\) or asserts on/,
    inversions: [['reduce a large response object', 'keep a large response object whole']],
  },
  {
    name: 'dependency directory is readable only for the listed packages, never installed or written',
    file: 'references/repository-discovery.md',
    pattern: /Do not install, upgrade or run anything, and do not write into that directory/,
    inversions: [['Do not install', 'Install']],
  },
  {
    name: 'merge never silently picks between variants',
    file: 'references/schema-merging.md',
    pattern: /Never merge silently, and decide on evidence/,
    inversions: [['Never merge silently', 'Merge silently']],
  },
  {
    name: 'merge keeps enums inlined',
    file: 'references/schema-merging.md',
    pattern: /Enums and other leaf constraints stay inlined at every use site/,
    inversions: [['stay inlined', 'move into components']],
  },
  {
    name: 'workers return findings and do not merge',
    file: 'references/schema-merging.md',
    pattern: /Workers never merge; they return findings only/,
    inversions: [['Workers never merge', 'Workers merge']],
  },
];

describe('SkillRuleTestCase', () => {
  it('every rule binds its condition to its action', () => {
    for (const rule of RULES) {
      expect(readSkill(rule.file), rule.name).toMatch(rule.pattern);
    }
  });

  it('inverting or dropping a rule turns its test red', () => {
    for (const rule of RULES) {
      const text = readSkill(rule.file);
      for (const [old, replacement] of rule.inversions) {
        const label = `${rule.name}: '${old}' -> '${replacement}'`;
        expect(text, label).toContain(old);
        const mutated = text.split(old).join(replacement);
        expect(rule.pattern.test(mutated), `${label}: mutation did not break the rule test`).toBe(
          false,
        );
      }
    }
  });

  it('deleting the rule sentence turns its test red', () => {
    for (const rule of RULES) {
      const text = readSkill(rule.file);
      const match = rule.pattern.exec(text);
      expect(match, rule.name).not.toBeNull();
      if (match === null) continue;
      const cut = text.slice(0, match.index) + text.slice(match.index + match[0].length);
      expect(rule.pattern.test(cut), rule.name).toBe(false);
    }
  });

  it('schema merging reference is linked and exists', () => {
    expect(readSkill('SKILL.md')).toContain('references/schema-merging.md');
    expect(readSkill('references/schema-merging.md').length).toBeGreaterThan(0);
  });
});
