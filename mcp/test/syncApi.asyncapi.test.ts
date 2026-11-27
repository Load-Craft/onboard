// Diff of two AsyncAPI documents (`scripts/sync-api/asyncDiff.ts`): which frames and keys were
// added, removed or changed, and which of those the plugin uses (the surface of ws-frames.json).

import { describe, expect, it } from 'vitest';

import {
  carryChannelMetadata,
  diffAsyncApi,
  type AsyncChange,
  type PluginSurface,
} from '../scripts/sync-api/asyncDiff.js';
import type { AsyncApiDocument, Schema } from '../scripts/gen-clients/model.js';
import mini from './fixtures/gen-clients/mini.asyncapi.json' with { type: 'json' };

const OLD = mini as unknown as AsyncApiDocument;

/** The plugin reads orders:progress (order_id, progress, stage, eta_seconds), sends say. */
const SURFACE: PluginSurface = {
  orders: {
    server: {
      'orders:progress': [
        { name: 'order_id', required: true },
        { name: 'progress', required: true },
        { name: 'stage', required: false },
        { name: 'eta_seconds', required: false },
      ],
      'orders:done': [{ name: 'order_id', required: true }],
    },
    client: {},
  },
  chat: { server: {}, client: { say: [{ name: 'text', required: true }] } },
};

function edit(change: (doc: AsyncApiDocument) => void): AsyncApiDocument {
  const doc = structuredClone(OLD);
  change(doc);
  return doc;
}

function payloadOf(doc: AsyncApiDocument, message: string): Record<string, Schema> {
  const schema = doc.components.messages[message]?.payload;
  const inner = schema?.properties?.['payload']?.properties ?? schema?.properties;
  if (inner === undefined) throw new Error(`no payload of ${message}`);
  return inner;
}

function find(changes: readonly AsyncChange[], text: string): AsyncChange {
  const found = changes.find((c) => `${c.where}: ${c.message}`.includes(text));
  if (found === undefined) {
    throw new Error(`no change with "${text}" in ${JSON.stringify(changes.map((c) => c.where))}`);
  }
  return found;
}

describe('diffAsyncApi', () => {
  it('reports nothing for identical documents', () => {
    expect(diffAsyncApi(OLD, structuredClone(OLD), SURFACE)).toEqual([]);
  });

  it('calls a removed key of a frame the plugin reads breaking and used', () => {
    const next = edit((doc) => delete payloadOf(doc, 'OrdersProgress')['eta_seconds']);
    const change = find(diffAsyncApi(OLD, next, SURFACE), 'eta_seconds');
    expect(change).toMatchObject({
      kind: 'breaking',
      channel: 'orders',
      frame: 'orders:progress',
      usedByPlugin: true,
    });
  });

  it('calls a removed key nobody reads breaking but not used', () => {
    const next = edit((doc) => delete payloadOf(doc, 'OrdersProgress')['labels']);
    expect(find(diffAsyncApi(OLD, next, SURFACE), 'labels')).toMatchObject({
      kind: 'breaking',
      usedByPlugin: false,
    });
  });

  it('calls a changed type breaking', () => {
    const next = edit((doc) => {
      const progress = payloadOf(doc, 'OrdersProgress')['progress'];
      if (progress !== undefined) progress.type = 'string';
    });
    const change = find(diffAsyncApi(OLD, next, SURFACE), 'progress');
    expect(change).toMatchObject({ kind: 'breaking', usedByPlugin: true });
    expect(change.message).toMatch(/integer.*string/);
  });

  it('calls null newly allowed breaking on a server frame, and null no longer allowed additive', () => {
    const allowed = edit((doc) => {
      const stage = payloadOf(doc, 'OrdersProgress')['stage'];
      if (stage !== undefined) stage.type = ['string', 'null'];
    });
    expect(find(diffAsyncApi(OLD, allowed, SURFACE), 'stage')).toMatchObject({ kind: 'breaking' });
    const refused = edit((doc) => {
      const eta = payloadOf(doc, 'OrdersProgress')['eta_seconds'];
      if (eta !== undefined) eta.type = 'number';
    });
    expect(find(diffAsyncApi(OLD, refused, SURFACE), 'eta_seconds')).toMatchObject({
      kind: 'additive',
    });
  });

  it('keeps null allowed when the type list goes and null stays among the enum values', () => {
    const before = edit((doc) => {
      payloadOf(doc, 'OrdersProgress')['stage'] = {
        type: ['string', 'null'],
        enum: ['packing', 'shipping', null],
      };
    });
    const after = edit((doc) => {
      payloadOf(doc, 'OrdersProgress')['stage'] = { enum: ['packing', 'shipping', null] };
    });
    const messages = diffAsyncApi(before, after, SURFACE).map((c) => `${c.where}: ${c.message}`);
    expect(messages.filter((m) => m.includes('null'))).toEqual([]);
  });

  it('calls a key that stopped being required breaking on a server frame', () => {
    const next = edit((doc) => {
      const schema = doc.components.messages['OrdersProgress']?.payload.properties?.['payload'];
      if (schema !== undefined) schema.required = ['order_id', 'stage'];
    });
    expect(find(diffAsyncApi(OLD, next, SURFACE), 'progress')).toMatchObject({
      kind: 'breaking',
      usedByPlugin: true,
    });
  });

  it('calls a key the server started to require on a client frame breaking', () => {
    const next = edit((doc) => {
      const say = doc.components.messages['ChatSay'];
      if (say !== undefined) say.payload.required = ['type', 'text', 'reply_to'];
    });
    expect(find(diffAsyncApi(OLD, next, SURFACE), 'reply_to')).toMatchObject({ kind: 'breaking' });
  });

  it('calls a removed frame type breaking and an added one additive', () => {
    const next = edit((doc) => {
      delete doc.components.messages['OrdersFailed'];
      const op = doc.operations['ordersSend'];
      if (op !== undefined)
        op.messages = (op.messages ?? []).filter((m) => !m.$ref.endsWith('OrdersFailed'));
      doc.components.messages['OrdersQueued'] = {
        summary: 'Queued.',
        payload: {
          type: 'object',
          required: ['type', 'payload'],
          properties: {
            type: { type: 'string', const: 'orders:queued' },
            payload: { type: 'object', properties: { position: { type: 'integer' } } },
          },
        },
      };
      op?.messages?.push({ $ref: '#/components/messages/OrdersQueued' });
    });
    const changes = diffAsyncApi(OLD, next, SURFACE);
    expect(find(changes, 'frame removed')).toMatchObject({
      kind: 'breaking',
      frame: 'orders:failed',
    });
    expect(find(changes, 'frame added')).toMatchObject({
      kind: 'additive',
      frame: 'orders:queued',
    });
  });

  it('calls a removed channel and a moved address breaking', () => {
    const removed = edit((doc) => {
      delete doc.channels['orders'];
      delete doc.operations['ordersSend'];
    });
    expect(find(diffAsyncApi(OLD, removed, SURFACE), 'channel removed')).toMatchObject({
      kind: 'breaking',
      usedByPlugin: true,
    });
    const moved = edit((doc) => {
      const orders = doc.channels['orders'];
      if (orders !== undefined) orders.address = '/ws/v2/orders/{order_id}';
    });
    expect(find(diffAsyncApi(OLD, moved, SURFACE), 'address')).toMatchObject({ kind: 'breaking' });
  });

  it('calls an added key and an added channel additive', () => {
    const next = edit((doc) => {
      payloadOf(doc, 'OrdersProgress')['warehouse'] = { type: 'string' };
      doc.channels['audit'] = { address: '/ws/audit', messages: {} };
    });
    const changes = diffAsyncApi(OLD, next, SURFACE);
    expect(find(changes, 'warehouse')).toMatchObject({ kind: 'additive', usedByPlugin: false });
    expect(find(changes, 'channel added')).toMatchObject({ kind: 'additive' });
  });

  describe('security schemes are alternatives', () => {
    const withSchemes = (doc: AsyncApiDocument, op: string, schemes: string[]): void => {
      const operation = doc.operations[op];
      if (operation === undefined) throw new Error(op);
      operation.security = schemes.map((name) => ({
        $ref: `#/components/securitySchemes/${name}`,
      }));
    };

    it('an added alternative is additive', () => {
      const next = edit((doc) => withSchemes(doc, 'ordersSend', ['bearerToken', 'sessionCookie']));
      expect(find(diffAsyncApi(OLD, next, SURFACE), 'sessionCookie added')).toMatchObject({
        kind: 'additive',
      });
    });

    it('a removed alternative is breaking', () => {
      const two = edit((doc) => withSchemes(doc, 'ordersSend', ['bearerToken', 'sessionCookie']));
      const back = diffAsyncApi(two, OLD, SURFACE);
      expect(find(back, 'sessionCookie removed')).toMatchObject({ kind: 'breaking' });
    });

    it('from none to some is breaking: credentials are now needed', () => {
      const next = edit((doc) => withSchemes(doc, 'chatSend', ['bearerToken']));
      expect(find(diffAsyncApi(OLD, next, SURFACE), 'credentials now required')).toMatchObject({
        kind: 'breaking',
      });
    });

    it('from some to none is additive', () => {
      const next = edit((doc) => withSchemes(doc, 'ordersSend', []));
      expect(find(diffAsyncApi(OLD, next, SURFACE), 'no credentials needed')).toMatchObject({
        kind: 'additive',
      });
    });
  });
});

describe('carryChannelMetadata', () => {
  it('leaves the backend commit out of the snapshot and keeps how it was traced', () => {
    const next = structuredClone(mini) as unknown as AsyncApiDocument;
    (next as unknown as { info: Record<string, unknown> }).info = {
      ...(next as unknown as { info?: Record<string, unknown> }).info,
      'x-loadcraft-source': { commit: 'f'.repeat(40), dirty: false, method: 'static-trace' },
    };
    const { document } = carryChannelMetadata(undefined, next);
    expect(
      (document as unknown as { info: Record<string, unknown> }).info['x-loadcraft-source'],
    ).toEqual({
      method: 'static-trace',
    });
    expect(JSON.stringify(document)).not.toContain('f'.repeat(40));
  });
});
