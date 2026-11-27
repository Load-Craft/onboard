// Individual enforced rules of the OpenAPI validator.
//
// Every rejected-input fixture starts from the shared valid document and is mutated in
// exactly one spot, so an asserted error message can only come from the rule under test.

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

function runTarget(target: string): RunResult {
  return runValidator('openapi', [target]);
}

function runDocument(document: JsonObject): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'openapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runTarget(target);
  });
}

function runRaw(filename: string, content: Buffer | string): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, filename);
    writeFileSync(target, content);
    return runTarget(target);
  });
}

function operation(document: JsonObject): JsonObject {
  return at(document, 'paths', '/api/orders', 'post');
}

function validGetOperation(): JsonObject {
  return {
    operationId: 'getOrder',
    summary: 'Read an order',
    description: 'Returns a single order by its identifier.',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'order_id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': {
        description: 'Order returned',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
      },
    },
  };
}

function documentWithSecret(secret: string): JsonObject {
  const document = validOpenapi();
  operation(document)['description'] = `Creates an order. Debug note: ${secret}`;
  return document;
}

function expectRejected(result: RunResult, message: string): void {
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(message);
}

describe('OpenapiRuleTestCase', () => {
  // -- SECRET_PATTERNS in string values -------------------------------------

  it('rejects jwt shaped secret literal', () => {
    const result = runDocument(
      documentWithSecret(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
          '.eyJzdWIiOiJvcmRlci1leGFtcGxlIn0' +
          '.synthetic0signature0value',
      ),
    );
    expectRejected(result, 'secret-like value must not be embedded');
  });

  it('rejects aws access key literal', () => {
    const result = runDocument(documentWithSecret('AKIAIOSFODNN7EXAMPLE'));
    expectRejected(result, 'secret-like value must not be embedded');
  });

  it('rejects stripe live key literal', () => {
    const result = runDocument(documentWithSecret('sk_live_0123456789abcdefEXAMPLE'));
    expectRejected(result, 'secret-like value must not be embedded');
  });

  it('rejects pem private key header literal', () => {
    const result = runDocument(documentWithSecret('-----BEGIN RSA PRIVATE KEY-----'));
    expectRejected(result, 'secret-like value must not be embedded');
  });

  // -- main() I/O guards ----------------------------------------------------

  it('rejects non json suffix', () => {
    const result = runRaw('openapi.txt', Buffer.from(JSON.stringify(validOpenapi()), 'utf8'));
    expectRejected(result, 'must be a .json file');
  });

  it('rejects nonexistent file', () => {
    const result = withTempDir((dir) => runTarget(join(dir, 'missing.json')));
    expectRejected(result, 'file not found');
  });

  it('rejects invalid json', () => {
    const result = runRaw('openapi.json', Buffer.from('{ not valid json ', 'utf8'));
    expectRejected(result, 'invalid JSON at line');
  });

  it('rejects non utf8 bytes', () => {
    const result = runRaw(
      'openapi.json',
      Buffer.from([0xff, 0xfe, 0xfa, ...Buffer.from(' not utf-8')]),
    );
    expectRejected(result, 'file must be UTF-8');
  });

  // -- info -----------------------------------------------------------------

  it('rejects missing info title', () => {
    const document = validOpenapi();
    delete at(document, 'info')['title'];
    expectRejected(runDocument(document), '/info/title');
  });

  it('rejects missing info version', () => {
    const document = validOpenapi();
    delete at(document, 'info')['version'];
    expectRejected(runDocument(document), '/info/version');
  });

  it('rejects info not an object', () => {
    const document = validOpenapi();
    document['info'] = 'Orders API';
    expectRejected(runDocument(document), '/info: must be an object');
  });

  // -- servers --------------------------------------------------------------

  it('rejects missing servers', () => {
    const document = validOpenapi();
    delete document['servers'];
    expectRejected(runDocument(document), 'must contain at least one server URL');
  });

  it('rejects first server without url', () => {
    const document = validOpenapi();
    document['servers'] = [{}];
    expectRejected(runDocument(document), '/servers/0/url');
  });

  // -- security schemes -----------------------------------------------------

  it('rejects http scheme without scheme', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = { type: 'http' };
    expectRejected(runDocument(document), 'securitySchemes/bearerAuth/scheme');
  });

  it('rejects apikey without name', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = { type: 'apiKey', in: 'header' };
    expectRejected(runDocument(document), 'securitySchemes/bearerAuth/name');
  });

  it('rejects apikey not in header', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = {
      type: 'apiKey',
      name: 'X-Api-Key',
      in: 'query',
    };
    expectRejected(runDocument(document), 'apiKey security must use a header');
  });

  it('rejects oauth2 without flows', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = { type: 'oauth2' };
    expectRejected(runDocument(document), 'oauth2 flows are required');
  });

  it('rejects openidconnect without url', () => {
    const document = validOpenapi();
    at(document, 'components', 'securitySchemes')['bearerAuth'] = { type: 'openIdConnect' };
    expectRejected(runDocument(document), 'openIdConnectUrl');
  });

  // -- parameters -----------------------------------------------------------

  it('rejects parameters not an array', () => {
    const document = validOpenapi();
    operation(document)['parameters'] = { order_id: 'path' };
    expectRejected(runDocument(document), 'parameters must be an array');
  });

  it('rejects parameter with empty name', () => {
    const document = validOpenapi();
    operation(document)['parameters'] = [{ name: '', in: 'query', schema: { type: 'string' } }];
    expectRejected(runDocument(document), 'parameters/operation-0/name');
  });

  it('rejects parameter with invalid in', () => {
    const document = validOpenapi();
    operation(document)['parameters'] = [{ name: 'state', in: 'body', schema: { type: 'string' } }];
    expectRejected(runDocument(document), 'must be path, query, header, or cookie');
  });

  it('rejects parameter without schema', () => {
    const document = validOpenapi();
    operation(document)['parameters'] = [{ name: 'state', in: 'query' }];
    expectRejected(runDocument(document), 'parameter schema is required');
  });

  // -- path variables -------------------------------------------------------

  it('rejects path variable without parameter', () => {
    const document = validOpenapi();
    const getOperation = validGetOperation();
    delete getOperation['parameters'];
    at(document, 'paths')['/api/orders/{order_id}'] = { get: getOperation };
    expectRejected(runDocument(document), 'has no path parameter');
  });

  it('rejects path parameter not required', () => {
    const document = validOpenapi();
    const getOperation = validGetOperation();
    const parameters = getOperation['parameters'];
    if (!Array.isArray(parameters)) throw new Error('parameters is not an array');
    (parameters[0] as JsonObject)['required'] = false;
    at(document, 'paths')['/api/orders/{order_id}'] = { get: getOperation };
    expectRejected(runDocument(document), 'must set required=true');
  });

  // -- responses ------------------------------------------------------------

  it('rejects non three digit status', () => {
    const document = validOpenapi();
    const responses = at(operation(document), 'responses');
    responses['2XX'] = responses['201'] as Json;
    delete responses['201'];
    expectRejected(runDocument(document), 'explicit three-digit code');
  });

  it('rejects response without description', () => {
    const document = validOpenapi();
    delete at(operation(document), 'responses', '201')['description'];
    expectRejected(runDocument(document), 'responses/201/description');
  });

  it('rejects success response without content', () => {
    const document = validOpenapi();
    const responses = at(operation(document), 'responses');
    responses['200'] = { description: 'Order read' };
    delete responses['201'];
    expectRejected(runDocument(document), 'successful response content is required');
  });

  it('rejects no success response', () => {
    const document = validOpenapi();
    delete at(operation(document), 'responses')['201'];
    expectRejected(
      runDocument(document),
      'at least one explicit 2xx (or 3xx redirect) response is required',
    );
  });

  it('rejects response media without schema', () => {
    const document = validOpenapi();
    delete at(operation(document), 'responses', '201', 'content', 'application/json')['schema'];
    expectRejected(runDocument(document), 'response schema is required');
  });

  // -- requestBody ----------------------------------------------------------

  it('rejects multiple request media types', () => {
    const document = validOpenapi();
    at(operation(document), 'requestBody', 'content')['text/plain'] = {
      schema: { type: 'string' },
    };
    expectRejected(runDocument(document), 'exactly one request media type');
  });

  it('rejects request media without schema', () => {
    const document = validOpenapi();
    delete at(operation(document), 'requestBody', 'content', 'application/json')['schema'];
    expectRejected(runDocument(document), 'request schema is required');
  });

  // -- schema object --------------------------------------------------------

  it('rejects boolean schema', () => {
    const document = validOpenapi();
    at(document, 'components', 'schemas', 'CreateOrder', 'properties')['item_id'] = true;
    expectRejected(runDocument(document), 'boolean schemas are not supported');
  });

  it('rejects unsupported schema type', () => {
    const document = validOpenapi();
    at(document, 'components', 'schemas', 'Order', 'properties', 'quantity')['type'] = 'decimal';
    expectRejected(runDocument(document), 'unsupported schema type: decimal');
  });

  it('rejects required not an array', () => {
    const document = validOpenapi();
    at(document, 'components', 'schemas', 'CreateOrder')['required'] = 'item_id';
    expectRejected(runDocument(document), 'required must be an array');
  });

  it('rejects required entry not in properties', () => {
    const document = validOpenapi();
    const required = at(document, 'components', 'schemas', 'CreateOrder')['required'];
    if (!Array.isArray(required)) throw new Error('required is not an array');
    required.push('nonexistent');
    expectRejected(runDocument(document), "required property 'nonexistent' is not declared");
  });

  it('rejects unsupported request media type', () => {
    // A wildcard range names no concrete type; the importer cannot send it.
    const document = validOpenapi();
    const content = at(operation(document), 'requestBody', 'content');
    content['*/*'] = content['application/json'] as Json;
    delete content['application/json'];
    expectRejected(runDocument(document), 'unsupported request media type');
  });

  // -- operations -----------------------------------------------------------

  it('rejects missing operation id', () => {
    const document = validOpenapi();
    delete operation(document)['operationId'];
    expectRejected(runDocument(document), 'post/operationId');
  });

  it('rejects missing summary and description', () => {
    const document = validOpenapi();
    const post = operation(document);
    delete post['summary'];
    delete post['description'];
    expectRejected(runDocument(document), 'summary or description is required');
  });

  it('rejects trace method', () => {
    const document = validOpenapi();
    at(document, 'paths', '/api/orders')['trace'] = {
      operationId: 'traceOrder',
      summary: 'Trace',
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'ok' } },
    };
    expectRejected(runDocument(document), 'HTTP method is not consumed by LoadCraft');
  });

  it('rejects path not starting with slash', () => {
    const document = validOpenapi();
    at(document, 'paths')['api/orders-bad'] = {};
    expectRejected(runDocument(document), 'path key must start with /');
  });

  it('rejects security referencing undefined scheme', () => {
    const document = validOpenapi();
    operation(document)['security'] = [{ undefinedScheme: [] }];
    expectRejected(runDocument(document), 'references an undefined security scheme');
  });

  // -- plural output --------------------------------------------------------

  it('reports plural operation count', () => {
    const document = validOpenapi();
    at(document, 'paths')['/api/orders/{order_id}'] = { get: validGetOperation() };
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('2 operations');
  });
});
