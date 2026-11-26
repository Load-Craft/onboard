import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers';
import type { Json, JsonObject } from './valid-openapi';

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

/** A minimal AsyncAPI 3.0 document that passes every LoadCraft rule. */
function validAsyncapi(): JsonObject {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Orders Events API', version: '1.0.0' },
    defaultContentType: 'application/json',
    servers: {
      production: { host: 'app.example.com', pathname: '/ws', protocol: 'ws' },
    },
    channels: {
      ordersEvents: {
        address: 'orders-events',
        messages: {
          orderCreated: { $ref: '#/components/messages/OrderCreated' },
        },
      },
    },
    operations: {
      receiveOrderCreated: {
        action: 'receive',
        channel: { $ref: '#/channels/ordersEvents' },
      },
      sendOrderCreated: {
        action: 'send',
        channel: { $ref: '#/channels/ordersEvents' },
      },
    },
    components: {
      messages: {
        OrderCreated: {
          contentType: 'application/json',
          payload: {
            type: 'object',
            required: ['messageType', 'orderId'],
            properties: {
              messageType: {
                type: 'string',
                const: 'orderCreated',
              },
              orderId: { type: 'string' },
            },
          },
          examples: [
            {
              name: 'order-example',
              payload: {
                messageType: 'orderCreated',
                orderId: 'order-example',
              },
            },
          ],
        },
      },
    },
  };
}

function runPath(target: string): RunResult {
  return runValidator('asyncapi', [target]);
}

function runDocument(document: JsonObject): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'asyncapi.json');
    writeFileSync(target, JSON.stringify(document), 'utf8');
    return runPath(target);
  });
}

function runRaw(filename: string, content: Buffer | string): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, filename);
    writeFileSync(target, content);
    return runPath(target);
  });
}

function message(document: JsonObject): JsonObject {
  return at(document, 'components', 'messages', 'OrderCreated');
}

// Cover individual enforced rules in validate_asyncapi. Every rejected-input fixture starts from
// the shared valid document and is mutated in exactly one spot, so an asserted error message can
// only come from the rule under test.
describe('AsyncapiRuleTestCase', () => {
  // -- accept ---------------------------------------------------------------

  it('accepts a self contained loadcraft document', () => {
    const result = runDocument(validAsyncapi());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('2 operations');
    expect(result.stdout).toContain('structural preflight');
  });

  it('accepts valid provenance stamp', () => {
    const document = validAsyncapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      method: 'static-trace',
    };
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts per message content type without default', () => {
    const document = validAsyncapi();
    delete document['defaultContentType'];
    message(document)['contentType'] = 'application/json';
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
  });

  // -- main() I/O guards ----------------------------------------------------

  it('rejects non json suffix', () => {
    const result = runRaw('asyncapi.txt', Buffer.from(JSON.stringify(validAsyncapi()), 'utf8'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must be a .json file');
  });

  it('rejects nonexistent file', () => {
    const result = withTempDir((dir) => runPath(join(dir, 'missing.json')));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('file not found');
  });

  it('rejects invalid json', () => {
    const result = runRaw('asyncapi.json', Buffer.from('{ not valid json ', 'utf8'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid JSON at line');
  });

  it('rejects non utf8 bytes', () => {
    const result = runRaw(
      'asyncapi.json',
      Buffer.concat([Buffer.from([0xff, 0xfe, 0xfa]), Buffer.from(' not utf-8', 'utf8')]),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('file must be UTF-8');
  });

  it('rejects excessive nesting with clean message', () => {
    const depth = 2000;
    const blob = '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
    const result = runRaw('asyncapi.json', Buffer.from(blob, 'utf8'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('nesting exceeds the supported depth');
  });

  // -- document version -----------------------------------------------------

  it('rejects asyncapi 2x version', () => {
    const document = validAsyncapi();
    document['asyncapi'] = '2.6.0';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('zero channels');
  });

  it('rejects missing asyncapi version', () => {
    const document = validAsyncapi();
    delete document['asyncapi'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('3.0.0');
  });

  // -- info -----------------------------------------------------------------

  it('rejects non object info', () => {
    const document = validAsyncapi();
    document['info'] = 'Orders Events API';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/info');
    expect(result.stderr).toContain('must be an object');
  });

  it('rejects empty info title', () => {
    const document = validAsyncapi();
    at(document, 'info')['title'] = '';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/info/title');
    expect(result.stderr).toContain('non-empty string');
  });

  it('rejects empty info version', () => {
    const document = validAsyncapi();
    at(document, 'info')['version'] = '';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/info/version');
    expect(result.stderr).toContain('non-empty string');
  });

  // -- content type ---------------------------------------------------------

  it('rejects missing content type everywhere', () => {
    const document = validAsyncapi();
    delete document['defaultContentType'];
    delete message(document)['contentType'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('defaultContentType');
    expect(result.stderr).toContain('contentType');
  });

  // -- servers --------------------------------------------------------------

  it('rejects empty servers', () => {
    const document = validAsyncapi();
    document['servers'] = {};
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/servers');
    expect(result.stderr).toContain('non-empty object');
  });

  it('rejects server without host', () => {
    const document = validAsyncapi();
    delete at(document, 'servers', 'production')['host'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/servers/production/host: server host is required');
  });

  it('rejects the 2.x server url, which the official parser refuses', () => {
    // Regression: `servers.backend.url` in a 3.0 document.
    const document = validAsyncapi();
    at(document, 'servers', 'production')['url'] = 'ws://app.example.com/ws';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      '/servers/production/url: server url does not exist in AsyncAPI 3.0',
    );
  });

  it('rejects a server field AsyncAPI 3.0 does not define and accepts an extension', () => {
    const document = validAsyncapi();
    at(document, 'servers', 'production')['x-note'] = 'free';
    expect(runDocument(document).status).toBe(0);
    at(document, 'servers', 'production')['mode'] = 'x';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/servers/production/mode: mode is not a field');
  });

  it('rejects server without protocol', () => {
    const document = validAsyncapi();
    delete at(document, 'servers', 'production')['protocol'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('protocol is required');
  });

  // -- channels -------------------------------------------------------------

  it('rejects empty channels', () => {
    const document = validAsyncapi();
    document['channels'] = {};
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/channels');
    expect(result.stderr).toContain('non-empty object');
  });

  it('rejects channel without address', () => {
    const document = validAsyncapi();
    delete at(document, 'channels', 'ordersEvents')['address'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('address is required');
    expect(result.stderr).toContain('silently dropped');
  });

  it('rejects channel message not a components ref', () => {
    const document = validAsyncapi();
    at(document, 'channels', 'ordersEvents', 'messages')['orderCreated'] = {
      payload: { type: 'object' },
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('channel message must reference #/components/messages/');
  });

  it('rejects channel message ref that does not resolve', () => {
    const document = validAsyncapi();
    at(document, 'channels', 'ordersEvents', 'messages')['orderCreated'] = {
      $ref: '#/components/messages/Missing',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved $ref');
  });

  // -- operations -----------------------------------------------------------

  it('rejects empty operations', () => {
    const document = validAsyncapi();
    document['operations'] = {};
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/operations');
    expect(result.stderr).toContain('non-empty object');
  });

  it('rejects invalid operation action', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['action'] = 'publish';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("action must be exactly 'send' or 'receive'");
  });

  it('rejects operation channel not a channel ref', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['channel'] = { address: 'x' };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('operation channel must be a $ref to #/channels/');
  });

  it('rejects operation channel ref that does not resolve', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['channel'] = {
      $ref: '#/channels/missing',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved $ref');
    expect(result.stderr).toContain('no resolvable message');
  });

  it('rejects operation messages that point at components instead of their channel', () => {
    // Regression: messages `#/components/messages/...` on an operation.
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['messages'] = [
      { $ref: '#/components/messages/OrderCreated' },
    ];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'operation message must reference a message of its own channel (#/channels/<channel>/messages/<key>)',
    );
  });

  it('accepts operation messages of its own channel', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['messages'] = [
      { $ref: '#/channels/ordersEvents/messages/orderCreated' },
    ];
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects an operation message of another channel or a missing key', () => {
    const document = validAsyncapi();
    at(document, 'channels')['other'] = {
      address: 'other',
      messages: { orderCreated: { $ref: '#/components/messages/OrderCreated' } },
    };
    at(document, 'operations', 'receiveOrderCreated')['messages'] = [
      { $ref: '#/channels/other/messages/orderCreated' },
    ];
    expect(runDocument(document).stderr).toContain('of its own channel');
    at(document, 'operations', 'receiveOrderCreated')['messages'] = [
      { $ref: '#/channels/ordersEvents/messages/missing' },
    ];
    expect(runDocument(document).stderr).toContain(
      'operation message missing is not a message of channel ordersEvents',
    );
  });

  it('rejects an operation whose channel does not exist and a field it does not define', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['channel'] = { $ref: '#/channels/nope' };
    expect(runDocument(document).stderr).toContain(
      'operation channel nope does not exist in channels',
    );
    const another = validAsyncapi();
    at(another, 'operations', 'receiveOrderCreated')['mode'] = 'x';
    expect(runDocument(another).stderr).toContain(
      '/operations/receiveOrderCreated/mode: mode is not a field',
    );
  });

  it('rejects operation with no resolvable message', () => {
    const document = validAsyncapi();
    delete at(document, 'channels', 'ordersEvents')['messages'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no resolvable message');
  });

  // -- messages -------------------------------------------------------------

  it('rejects non object message payload', () => {
    const document = validAsyncapi();
    message(document)['payload'] = 'OrderCreated';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('payload must be an object schema');
  });

  it('rejects message without example payload', () => {
    const document = validAsyncapi();
    message(document)['examples'] = [{ name: 'order-example' }];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('first example verbatim');
  });

  it('rejects message without any examples', () => {
    const document = validAsyncapi();
    delete message(document)['examples'];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('first example verbatim');
  });

  // -- schema subset --------------------------------------------------------

  it('rejects one of schema', () => {
    const document = validAsyncapi();
    message(document)['payload'] = {
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'string' } } },
      ],
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('oneOf/anyOf');
  });

  it('rejects type array schema', () => {
    const document = validAsyncapi();
    at(message(document), 'payload', 'properties')['orderId'] = {
      type: ['string', 'null'],
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('single string');
  });

  it('rejects boolean schema', () => {
    const document = validAsyncapi();
    at(message(document), 'payload', 'properties')['flag'] = true;
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('boolean schemas');
  });

  it('rejects unsupported schema type', () => {
    const document = validAsyncapi();
    at(message(document), 'payload', 'properties')['orderId'] = { type: 'null' };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsupported schema type');
  });

  // -- refs -----------------------------------------------------------------

  it('rejects external ref', () => {
    const document = validAsyncapi();
    at(document, 'channels', 'ordersEvents', 'messages')['orderCreated'] = {
      $ref: './messages.json#/OrderCreated',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('external $ref');
  });

  it('rejects cyclic ref chain', () => {
    const document = validAsyncapi();
    at(document, 'components')['schemas'] = {
      Loop: { $ref: '#/components/schemas/Loop' },
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cyclic $ref');
  });

  it('rejects ref chain exceeding depth', () => {
    const document = validAsyncapi();
    const schemas: JsonObject = {};
    for (let index = 0; index < 25; index += 1) {
      schemas[`S${index}`] = { $ref: `#/components/schemas/S${index + 1}` };
    }
    schemas['S25'] = { type: 'object' };
    at(document, 'components')['schemas'] = schemas;
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('reference chain exceeds');
  });

  // -- unresolved markers ---------------------------------------------------

  it('rejects x todo marker', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['x-todo'] = 'confirm direction';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  it('rejects x loadcraft blocker marker', () => {
    const document = validAsyncapi();
    at(document, 'info')['x-loadcraft-blocker'] = 'unknown schema';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  it('rejects todo text marker', () => {
    const document = validAsyncapi();
    message(document)['summary'] = '[ TODO confirm payload shape ]';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  // -- secrets --------------------------------------------------------------

  it('rejects jwt shaped secret literal', () => {
    const document = validAsyncapi();
    message(document)['summary'] =
      'Debug token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiJvcmRlci1leGFtcGxlIn0' +
      '.synthetic0signature0value';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('rejects secret bearing property literal', () => {
    const document = validAsyncapi();
    at(message(document), 'payload', 'properties')['password'] = {
      type: 'string',
      example: 'sample-password',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });

  it('rejects secret bearing field literal', () => {
    const document = validAsyncapi();
    const examples = message(document)['examples'];
    if (!Array.isArray(examples)) throw new Error('examples must be a list');
    at(examples[0], 'payload')['authorization'] = 'Token abc';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing field');
  });

  // -- provenance -----------------------------------------------------------

  it('rejects malformed provenance stamp', () => {
    const document = validAsyncapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '',
      dirty: 'no',
      method: 'guesswork',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('commit must be a git object hash');
    expect(result.stderr).toContain('dirty must be a boolean');
    expect(result.stderr).toContain('method must be');
  });

  it('rejects provenance with unsupported keys', () => {
    const document = validAsyncapi();
    at(document, 'info')['x-loadcraft-source'] = {
      commit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      method: 'native-export',
      note: 'extra',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsupported keys');
  });
});

describe('AsyncapiReviewRegressionTestCase', () => {
  it('rejects first example without payload', () => {
    const document = validAsyncapi();
    const target = message(document);
    const examples = target['examples'];
    if (!Array.isArray(examples)) throw new Error('examples must be a list');
    const realPayload = at(examples[0], 'payload');
    target['examples'] = [{ name: 'placeholder' }, { name: 'real', payload: realPayload }];
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('first example');
  });

  it('rejects null payload in first example', () => {
    const document = validAsyncapi();
    const examples = message(document)['examples'];
    if (!Array.isArray(examples)) throw new Error('examples must be a list');
    at(examples[0])['payload'] = null;
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('first example');
  });

  it('accepts operation with empty messages list', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['messages'] = [];
    const result = runDocument(document);
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects properties that are not an object', () => {
    const document = validAsyncapi();
    message(document)['payload'] = {
      type: 'object',
      properties: [{ orderId: { type: 'string' } }],
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('properties must be an object');
  });

  it('rejects pem private key literal', () => {
    const document = validAsyncapi();
    at(document, 'info')['description'] = '-----BEGIN RSA PRIVATE KEY-----';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('rejects aws key literal', () => {
    const document = validAsyncapi();
    at(document, 'info')['description'] = 'uses key AKIAABCDEFGHIJKLMNOP';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('rejects stripe key literal', () => {
    const document = validAsyncapi();
    at(document, 'info')['description'] = 'sk_live_abcdefghijklmnop';
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('rejects camel case secret property example', () => {
    const document = validAsyncapi();
    at(message(document), 'payload', 'properties')['apiKey'] = {
      type: 'string',
      example: 'sample-value',
    };
    const result = runDocument(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-bearing property');
  });
});

describe('AsyncAPI 3.0 structure the official parser enforces', () => {
  const message = (document: JsonObject): JsonObject =>
    at(document, 'components', 'messages', 'OrderCreated');

  it('rejects an unknown field and a wrong type on a message', () => {
    const unknown = validAsyncapi();
    message(unknown)['channel'] = 'x';
    expect(runDocument(unknown).stderr).toContain(
      '/components/messages/OrderCreated/channel: channel is not a field',
    );
    const wrongType = validAsyncapi();
    message(wrongType)['contentType'] = 5;
    expect(runDocument(wrongType).stderr).toContain('contentType must be of type string');
    const extension = validAsyncapi();
    message(extension)['x-note'] = 'free';
    expect(runDocument(extension).status).toBe(0);
  });

  it('rejects a channel field it does not define', () => {
    const document = validAsyncapi();
    at(document, 'channels', 'ordersEvents')['url'] = 'x';
    expect(runDocument(document).stderr).toContain(
      '/channels/ordersEvents/url: url is not a field',
    );
  });

  it('checks the address parameters both ways', () => {
    const missing = validAsyncapi();
    at(missing, 'channels', 'ordersEvents')['address'] = 'orders/{orderId}';
    expect(runDocument(missing).stderr).toContain(
      'address parameter orderId is not described under parameters',
    );
    const described = validAsyncapi();
    at(described, 'channels', 'ordersEvents')['address'] = 'orders/{orderId}';
    at(described, 'channels', 'ordersEvents')['parameters'] = { orderId: { description: 'id' } };
    expect(runDocument(described).status).toBe(0);
    const redundant = validAsyncapi();
    at(redundant, 'channels', 'ordersEvents')['parameters'] = { extra: {} };
    expect(runDocument(redundant).stderr).toContain(
      'channel parameter extra does not appear in the address',
    );
  });

  it('rejects an operation field of the wrong type', () => {
    const document = validAsyncapi();
    at(document, 'operations', 'receiveOrderCreated')['security'] = 'x';
    expect(runDocument(document).stderr).toContain('security must be of type array');
  });
});
