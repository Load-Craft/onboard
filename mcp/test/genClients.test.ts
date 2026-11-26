// The AsyncAPI side of `npm run gen:clients` (`scripts/gen-clients/`): reading the channels of a
// document and writing the TypeScript types of their frames. The documents here are small made-up
// ones; the committed contract is checked in `ws.asyncapi.test.ts` and `ws.generated.test.ts`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { emitChannelTypes } from '../scripts/gen-clients/emit.js';
import {
  isNullable,
  readChannels,
  standardNullable,
  type AsyncApiDocument,
  type Schema,
} from '../scripts/gen-clients/model.js';
import mini from './fixtures/gen-clients/mini.asyncapi.json' with { type: 'json' };

const DOC = mini as unknown as AsyncApiDocument;

function clone(): AsyncApiDocument {
  return structuredClone(DOC);
}

describe('readChannels', () => {
  const channels = readChannels(DOC);
  const byId = (id: string) => {
    const found = channels.find((channel) => channel.id === id);
    if (found === undefined) throw new Error(`no channel ${id}`);
    return found;
  };

  it('lists channels in document order with address and path parameters', () => {
    expect(channels.map((channel) => channel.id)).toEqual(['orders', 'chat']);
    expect(byId('orders').address).toBe('/ws/orders/{order_id}');
    expect(byId('orders').params).toEqual(['order_id']);
    expect(byId('chat').params).toEqual(['shop_id', 'room']);
  });

  it('puts messages the server sends and receives apart, by operation', () => {
    expect(byId('orders').server.map((m) => m.key)).toEqual([
      'OrdersProgress',
      'OrdersDone',
      'OrdersFailed',
    ]);
    expect(byId('orders').client).toEqual([]);
    expect(byId('chat').server.map((m) => m.key)).toEqual(['ChatLine', 'ChatPong', 'ChatImage']);
    expect(byId('chat').client.map((m) => m.key)).toEqual(['ChatSay', 'ChatPing']);
  });

  it('reads the wire type of a JSON frame from the const of its type property', () => {
    expect(byId('orders').server.map((m) => m.type)).toEqual([
      'orders:progress',
      'orders:done',
      'orders:failed',
    ]);
  });

  it('tells enveloped frames from flat ones, also when a flat frame has a payload key', () => {
    expect(byId('orders').server.map((m) => m.envelope)).toEqual(['payload', 'payload', 'payload']);
    const line = byId('chat').server.find((m) => m.key === 'ChatLine');
    expect(line?.envelope).toBe('flat');
    expect(byId('chat').client.find((m) => m.key === 'ChatSay')?.envelope).toBe('flat');
  });

  it('classifies messages as json, text or binary by content type', () => {
    expect(byId('chat').server.map((m) => m.kind)).toEqual(['json', 'text', 'binary']);
    expect(byId('chat').client.map((m) => m.kind)).toEqual(['json', 'text']);
  });

  it('reads the security schemes of the operations that send', () => {
    expect(byId('orders').security).toEqual(['bearerToken']);
    expect(byId('chat').security).toEqual([]);
  });

  it('writes a message several channels share once', () => {
    const doc = clone();
    doc.channels['orders_again'] = {
      address: '/ws/orders-again/{order_id}',
      messages: { OrdersDone: { $ref: '#/components/messages/OrdersDone' } },
    };
    doc.operations['ordersAgainSend'] = {
      action: 'send',
      channel: { $ref: '#/channels/orders_again' },
      messages: [{ $ref: '#/components/messages/OrdersDone' }],
    };
    const again = emitChannelTypes(readChannels(doc), 'x');
    expect(again.match(/export type OrdersDone =/g)).toHaveLength(1);
    expect(again).toContain('orders_again: {');
    expect(again).toContain('export type Orders_againServerFrame = OrdersDone;');
  });

  it('refuses an operation message that does not resolve', () => {
    const doc = clone();
    const op = doc.operations['ordersSend'];
    if (op === undefined) throw new Error('fixture');
    op.messages = [{ $ref: '#/components/messages/Nope' }];
    expect(() => readChannels(doc)).toThrow(/Nope/);
  });

  it('refuses a JSON frame without a const type', () => {
    const doc = clone();
    const message = doc.components.messages['OrdersDone'];
    if (message === undefined) throw new Error('fixture');
    delete (message.payload.properties as Record<string, unknown>)['type'];
    expect(() => readChannels(doc)).toThrow(/OrdersDone.*type/);
  });

  it('refuses two frames of one channel and direction with the same wire type', () => {
    const doc = clone();
    const message = doc.components.messages['OrdersFailed'];
    if (message === undefined) throw new Error('fixture');
    const props = message.payload.properties as Record<string, { const?: string }>;
    const typeProp = props['type'];
    if (typeProp === undefined) throw new Error('fixture');
    typeProp.const = 'orders:done';
    expect(() => readChannels(doc)).toThrow(/orders:done/);
  });
});

describe('emitChannelTypes', () => {
  const text = emitChannelTypes(readChannels(DOC), 'contracts/mini.json');

  it('starts with a do-not-edit header naming the source', () => {
    expect(text.startsWith('/**\n * Generated file - do not edit.')).toBe(true);
    expect(text).toContain('contracts/mini.json');
  });

  it('is deterministic', () => {
    expect(emitChannelTypes(readChannels(DOC), 'contracts/mini.json')).toBe(text);
  });

  it('carries descriptions as doc comments', () => {
    expect(text).toContain('/** Percent, 0-100. */');
    expect(text).toContain('/** Each time the order moves to a new stage. */');
  });

  it('refuses a schema with oneOf, a type list or an unknown type', () => {
    for (const bad of [
      { oneOf: [{ type: 'string' }] },
      { type: ['string', 'number'] },
      { type: 'date' },
    ]) {
      const doc = clone();
      const message = doc.components.messages['OrdersFailed'];
      if (message === undefined) throw new Error('fixture');
      const body = message.payload.properties?.['payload'] as {
        properties: Record<string, unknown>;
      };
      body.properties['error'] = bad;
      expect(() => emitChannelTypes(readChannels(doc), 'x'), JSON.stringify(bad)).toThrow(
        /OrdersFailed/,
      );
    }
  });

  it('reads a type list with null like x-nullable, and refuses a list of other types', () => {
    const standard = clone();
    const legacy = clone();
    const wire = (doc: AsyncApiDocument): Record<string, Schema> => {
      const body = doc.components.messages['OrdersProgress']?.payload.properties?.['payload'];
      if (body?.properties === undefined) throw new Error('fixture');
      return body.properties;
    };
    wire(legacy)['eta_seconds'] = { type: 'number', 'x-nullable': true };
    wire(standard)['eta_seconds'] = { type: ['number', 'null'] };
    wire(legacy)['stage'] = { type: 'string', enum: ['packing', 'shipping'], 'x-nullable': true };
    wire(standard)['stage'] = { type: ['string', 'null'], enum: ['packing', 'shipping', null] };
    expect(emitChannelTypes(readChannels(standard), 'x')).toBe(
      emitChannelTypes(readChannels(legacy), 'x'),
    );
    expect(emitChannelTypes(readChannels(standard), 'x')).toContain('eta_seconds?: number | null;');
    wire(standard)['eta_seconds'] = { type: ['number', 'string'] };
    expect(() => emitChannelTypes(readChannels(standard), 'x')).toThrow(
      /OrdersProgress.*eta_seconds/,
    );
  });

  it('reads null among the enum values or a null const of a schema without a type as nullable', () => {
    const doc = clone();
    const body = doc.components.messages['OrdersProgress']?.payload.properties?.['payload'];
    if (body?.properties === undefined) throw new Error('fixture');
    body.properties['stage'] = { enum: ['packing', 'shipping', null] };
    body.properties['cleared'] = { const: null };
    expect(isNullable({ enum: ['a', null] })).toBe(true);
    expect(isNullable({ const: null })).toBe(true);
    expect(isNullable({ type: 'string', enum: ['a', null] })).toBe(false);
    const types = emitChannelTypes(readChannels(doc), 'x');
    expect(types).toContain('stage: ("packing" | "shipping") | null;');
    expect(types).toContain('cleared?: null;');
  });

  it('writes x-nullable the standard way, and leaves example data and fields named like examples', () => {
    const doc = {
      payload: {
        type: 'object',
        properties: {
          examples: { type: 'string', 'x-nullable': true },
          example: { type: 'integer', enum: [1, 2], 'x-nullable': true },
        },
      },
      examples: [{ payload: { note: { 'x-nullable': true } } }],
    };
    expect(standardNullable(doc)).toEqual({
      payload: {
        type: 'object',
        properties: {
          examples: { type: ['string', 'null'] },
          example: { type: ['integer', 'null'], enum: [1, 2, null] },
        },
      },
      examples: [{ payload: { note: { 'x-nullable': true } } }],
    });
  });

  describe('as TypeScript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-clients-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    /** Compiler errors of `generated + probe`, with the options of the plugin. */
    function errors(probe: string): string[] {
      const file = join(dir, `probe-${Math.random().toString(36).slice(2)}.ts`);
      writeFileSync(file, `${text}\n${probe}\n`);
      const program = ts.createProgram([file], {
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2023,
        lib: ['lib.es2023.d.ts'],
        types: [],
        skipLibCheck: true,
      });
      return ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    }

    it('compiles', () => {
      expect(errors('')).toEqual([]);
    });

    it('types a valid frame of every kind', () => {
      expect(
        errors(`
const a: OrdersProgress = { type: 'orders:progress', payload: { order_id: 'o', progress: 1, stage: 'packing', eta_seconds: null, labels: ['x'] } };
const b: OrdersDone = { type: 'orders:done', payload: { order_id: 'o', lines: [{ sku: 'a', qty: 1, note: null }], totals: { x: 1 }, extra: { any: 1 } } };
const c: OrdersFailed = { type: 'orders:failed', payload: { error: null } };
const d: ChatLine = { type: 'line', text: 't', payload_size: 1, payload: { who: 'w' } };
const e: ChatSay = { type: 'say', text: 't', reply_to: null };
const f: OrdersServerFrame = a;
const g: ChatClientFrame = e;
const h: ChatPing = 'ping';
const i: ChatImage = new Uint8Array();
void [a, b, c, d, e, f, g, h, i];
`),
      ).toEqual([]);
    });

    it.each([
      [
        'an enum value outside the list',
        `const x: OrdersProgress = { type: 'orders:progress', payload: { order_id: 'o', progress: 1, stage: 'idle' } }; void x;`,
      ],
      [
        'a missing required key',
        `const x: OrdersProgress = { type: 'orders:progress', payload: { order_id: 'o', stage: 'packing' } }; void x;`,
      ],
      [
        'a null where the key is not nullable',
        `const x: OrdersProgress = { type: 'orders:progress', payload: { order_id: null, progress: 1, stage: 'packing' } }; void x;`,
      ],
      [
        'a wrong wire type',
        `const x: OrdersProgress = { type: 'orders:done', payload: { order_id: 'o', progress: 1, stage: 'packing' } }; void x;`,
      ],
      ['a text frame with another text', `const x: ChatPing = 'pong'; void x;`],
      [
        'a client frame in the server union',
        `const x: ChatServerFrame = { type: 'say', text: 't' }; void x;`,
      ],
    ])('rejects %s', (_name, probe) => {
      expect(errors(probe).length).toBeGreaterThan(0);
    });

    it('gives each channel a table of its address, parameters and frames', () => {
      expect(
        errors(`
const address: '/ws/orders/{order_id}' = CHANNELS.orders.address;
const params: readonly ['shop_id', 'room'] = CHANNELS.chat.params;
const types: readonly ['line'] = CHANNELS.chat.serverTypes;
type Body = ServerBody<'orders', 'orders:progress'>['stage'];
const body: Body = 'shipping';
type Flat = ServerBody<'chat', 'line'>['payload_size'];
const flat: Flat = 3;
void [address, params, types, body, flat];
`),
      ).toEqual([]);
    });
  });
});
