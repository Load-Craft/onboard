// The command-line behaviour of the OpenAPI and journey validators on whole documents.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers.ts';
import { validOpenapi, type Json, type JsonObject } from './valid-openapi.ts';

/** Walks `keys` down an object tree and returns the object found there. */
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

function postOperation(document: JsonObject): JsonObject {
  return at(document, 'paths', '/api/orders', 'post');
}

function runOpenapi(document: JsonObject): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runValidator('openapi', [target]);
  });
}

function runJourney(description: string): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'create-order.txt');
    writeFileSync(target, description, 'utf8');
    return runValidator('journeys', [target]);
  });
}

function runJourneyDirectory(files: Record<string, string>): RunResult {
  return withTempDir((dir) => {
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    return runValidator('journeys', [dir]);
  });
}

describe('ValidatorCliTestCase', () => {
  it('openapi accepts a self contained loadcraft document', () => {
    const result = runOpenapi(validOpenapi());

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 operation');
    expect(result.stdout).toContain('structural preflight');
    expect(result.stdout).not.toContain('LoadCraft-ready');
  });

  it('openapi rejects external refs', () => {
    const document = validOpenapi();
    at(postOperation(document), 'requestBody', 'content', 'application/json')['schema'] = {
      $ref: './schemas.json#/CreateOrder',
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('external $ref');
  });

  it('openapi requires operation level security', () => {
    const document = validOpenapi();
    document['security'] = [{ bearerAuth: [] }];
    delete postOperation(document)['security'];

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('operation-level security');
  });

  it('openapi rejects unresolved todos', () => {
    const document = validOpenapi();
    postOperation(document)['x-todo'] = 'guess response';

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  it('openapi rejects duplicate operation ids', () => {
    const document = validOpenapi();
    at(document, 'paths')['/api/orders/{order_id}'] = {
      get: {
        operationId: 'createOrder',
        summary: 'Read an order',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'order_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Order returned' } },
      },
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('duplicate operationId');
  });

  it('openapi rejects 31 union parameter types', () => {
    const document = validOpenapi();
    document['openapi'] = '3.1.0';
    postOperation(document)['parameters'] = [
      { name: 'state', in: 'query', schema: { type: ['string', 'null'] } },
    ];

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OpenAPI 3.0.3 compatibility profile');
    expect(result.stderr).toContain('single string');
  });

  it('openapi rejects numeric parameter enums', () => {
    const document = validOpenapi();
    postOperation(document)['parameters'] = [
      { name: 'priority', in: 'query', schema: { type: 'integer', enum: [1, 2] } },
    ];

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('parameter enum values must all be strings');
  });

  it('openapi rejects lossy unions and get bodies', () => {
    const document = validOpenapi();
    at(document, 'paths', '/api/orders')['get'] = {
      operationId: 'listOrders',
      summary: 'List orders',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { type: 'object', properties: { page: { type: 'integer' } } },
                { type: 'object', properties: { cursor: { type: 'string' } } },
              ],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Orders returned',
          content: {
            'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
            },
          },
        },
      },
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GET/HEAD/DELETE request bodies');
    expect(result.stderr).toContain('oneOf/anyOf');
  });

  it('openapi rejects missing required properties', () => {
    const document = validOpenapi();
    const required = at(document, 'components', 'schemas', 'CreateOrder')['required'];
    if (!Array.isArray(required)) throw new Error('required is not an array');
    required.push('missing');

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("required property 'missing' is not declared");
  });

  it('openapi does not treat example fields as schema keywords', () => {
    const document = validOpenapi();
    at(postOperation(document), 'responses', '201', 'content', 'application/json')['example'] = {
      id: 'order-example',
      type: 'wholesale',
    };

    const result = runOpenapi(document);

    expect(result.status, result.stderr).toBe(0);
  });

  it('openapi rejects undefined security scheme shape', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = {};

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('security scheme type');
  });

  it('openapi requires explicit body required and supported media', () => {
    const document = validOpenapi();
    const requestBody = at(postOperation(document), 'requestBody');
    delete requestBody['required'];
    const content = at(requestBody, 'content');
    const media = content['application/json'] as Json;
    delete content['application/json'];
    content['application/*'] = media;

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requestBody.required');
    expect(result.stderr).toContain('unsupported request media type');
  });

  it('openapi accepts concrete vendor request media types', () => {
    // The importer sends the declared type verbatim (JSON Merge Patch included).
    for (const mediaType of [
      'application/merge-patch+json',
      'application/vnd.orders+json; charset=utf-8',
    ]) {
      const document = validOpenapi();
      const content = at(postOperation(document), 'requestBody', 'content');
      content[mediaType] = content['application/json'] as Json;
      delete content['application/json'];

      const result = runOpenapi(document);

      expect(result.status, result.stderr).toBe(0);
    }
  });

  it('openapi accepts 202 without content', () => {
    const document = validOpenapi();
    const responses = at(postOperation(document), 'responses');
    delete responses['201'];
    responses['202'] = { description: 'Accepted; processed asynchronously, no body' };

    const result = runOpenapi(document);

    expect(result.status, result.stderr).toBe(0);
  });

  it('openapi still requires content on 200 and 201', () => {
    const document = validOpenapi();
    delete at(postOperation(document), 'responses', '201')['content'];

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('except for 202/204/205');
  });

  it('openapi warns but accepts redirect only operation', () => {
    const document = validOpenapi();
    const responses = at(postOperation(document), 'responses');
    delete responses['201'];
    responses['301'] = { description: 'Redirects to GET /api/orders/{id}' };

    const result = runOpenapi(document);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain('redirect-only operation');
  });

  it('openapi rejects operation without success or redirect', () => {
    const document = validOpenapi();
    delete at(postOperation(document), 'responses')['201'];

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('at least one explicit 2xx (or 3xx redirect)');
  });

  it('openapi rejects examples on secret bearing properties', () => {
    const document = validOpenapi();
    at(document, 'components', 'schemas', 'CreateOrder', 'properties')['password'] = {
      type: 'string',
      example: 'sample-password',
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('openapi rejects secret literals in example objects', () => {
    const document = validOpenapi();
    at(postOperation(document), 'requestBody', 'content', 'application/json')['example'] = {
      password: 'sample-password',
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  it('openapi accepts valid provenance stamp', () => {
    const document = validOpenapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      method: 'static-trace',
    };

    const result = runOpenapi(document);

    expect(result.status, result.stderr).toBe(0);
  });

  it('openapi rejects malformed provenance stamp', () => {
    const document = validOpenapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '',
      dirty: 'no',
      method: 'guesswork',
    };

    const result = runOpenapi(document);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('commit must be a git object hash');
    expect(result.stderr).toContain('dirty must be a boolean');
    expect(result.stderr).toContain('method must be');
  });

  it('journey accepts plain grounded description', () => {
    const description = `Use the provided administrator test account and start at https://app.example.com.

Open "Orders". Click "Create order". Type a unique order name into "Name". Click "Save".

Finish when "Order created" is visible and the new order appears in the list.
`;
    const result = runJourney(description);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 journey');
  });

  it('journey rejects markdown and runner dialect', () => {
    const description = `# Create an order

1. Open Orders.
2. Run getByRole('button', { name: 'Create order' }).click().

| Step | Selector |
| 2 | [data-testid="create-order"] |
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Markdown');
    expect(result.stderr).toContain('runner-specific');
  });

  it('journey rejects cross file dependencies and todos', () => {
    const description = `Run JRN-001 first, then open "Orders".

[TODO: find the save button]

Finish when the order is visible.
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cross-file dependency');
    expect(result.stderr).toContain('unresolved marker');
  });

  it('journey rejects secret like values', () => {
    const description = `Use Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature.

Open "Orders" and click "Create order".

Finish when "Order created" is visible.
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('journey rejects literal account email', () => {
    const description = `Use the account customer@acme.test to work with orders.

Open "Orders". Check that the orders list is visible.
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('credential-like value');
  });

  it('journey rejects literal password assignment', () => {
    const description = `Sign in with password: sample-password before continuing.

Open "Orders". Check that the orders list is visible.
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('credential-like value');
  });

  it('journey requires an observable finish condition', () => {
    const description = `Use the provided administrator test account.

Open "Orders" and click "Create order".
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('observable finish condition');
  });

  it('journey requires finish condition as the final instruction', () => {
    const description = `Open "Orders".
Check that the orders list is visible.
Click "Create order".
`;
    const result = runJourney(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('final instruction');
  });

  it('journey directory accepts valid provenance stamp', () => {
    const description = `Open the "Orders" page.

Check that the orders list is visible.
`;
    const result = runJourneyDirectory({
      'list-orders.txt': description,
      '.provenance.json': JSON.stringify({
        commit: '0123456789abcdef0123456789abcdef01234567',
        dirty: false,
      }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 journey');
  });

  it('journey directory rejects malformed provenance stamp', () => {
    const description = `Open the "Orders" page.

Check that the orders list is visible.
`;
    const result = runJourneyDirectory({
      'list-orders.txt': description,
      '.provenance.json': JSON.stringify({ commit: '', dirty: 'no', note: 'x' }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('provenance commit must be a git object hash');
    expect(result.stderr).toContain('provenance dirty must be a boolean');
    expect(result.stderr).toContain('unsupported keys');
  });

  it('journey directory rejects invalid provenance json', () => {
    const description = `Open the "Orders" page.

Check that the orders list is visible.
`;
    const result = runJourneyDirectory({
      'list-orders.txt': description,
      '.provenance.json': '{not json',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('provenance stamp must be valid JSON');
  });

  it('journey directory rejects non text artifacts', () => {
    const description = 'Open "Orders". Check that the orders list is visible.';
    const result = runJourneyDirectory({
      'list-orders.txt': description,
      'README.md': 'journey notes',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('only .txt journey files');
  });

  it('journey rejects duplicate descriptions and source references', () => {
    const description = `Open "Orders" as implemented in src/orders/OrdersPage.tsx:42.

Check that the orders list is visible.
`;
    const result = runJourneyDirectory({
      'list-orders.txt': description,
      'view-orders.txt': description,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('source file reference');
    expect(result.stderr).toContain('duplicates');
  });
});
