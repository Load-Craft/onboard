// `contracts/ws-frames.json` lists what the plugin reads and sends on six channels. The backend's
// own description of those channels is `contracts/loadcraft-asyncapi.json`. Every channel, frame
// and key of the first must be in the second, with the same type, and the plugin may not demand
// more than the backend promises of its frames (a key it requires must be required there; null must be accepted
// wherever the backend can send it).

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  baseType,
  bodyOf,
  isNullable,
  readChannels,
  type AsyncApiDocument,
  type ChannelModel,
  type Schema,
} from '../scripts/gen-clients/model.js';

interface KeySpec {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  items?: KeySpec[];
}
interface FrameSpec {
  type: string;
  envelope?: 'payload' | 'flat';
  keys: KeySpec[];
}
interface ChannelSpec {
  path: string;
  envelope: 'payload' | 'flat';
  requires: 'none' | 'identity' | 'identity_and_origin';
  server: FrameSpec[];
  client: FrameSpec[];
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../contracts/${name}`, import.meta.url), 'utf8'));
const frames = read('ws-frames.json') as { channels: Record<string, ChannelSpec> };
const asyncapi = read('loadcraft-asyncapi.json') as AsyncApiDocument;
const channels = readChannels(asyncapi);

const shape = (path: string): string => path.replace(/\{[^}]+\}/g, '{}');

/** Differences between what the plugin expects of a nested object and what the document says. */
function compare(
  where: string,
  keys: KeySpec[],
  schema: Schema,
  side: 'server' | 'client',
): string[] {
  const problems: string[] = [];
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  for (const key of keys) {
    const at = `${where}.${key.name}`;
    const property = properties[key.name];
    if (property === undefined) {
      problems.push(`${at}: not in the AsyncAPI frame`);
      continue;
    }
    const type = baseType(property, at);
    if (type !== undefined && type !== key.type) {
      problems.push(`${at}: plugin says ${key.type}, AsyncAPI says ${type}`);
    }
    // The plugin may send more than the backend needs, so the rule on required keys is the server's.
    if (side === 'server' && key.required && !required.has(key.name)) {
      problems.push(`${at}: plugin requires it, AsyncAPI does not`);
    }
    if (isNullable(property) && key.nullable !== true) {
      problems.push(`${at}: AsyncAPI allows null, plugin does not accept it`);
    }
    if (key.items !== undefined) {
      const inner = key.type === 'array' ? property.items : property;
      if (inner === undefined) problems.push(`${at}: AsyncAPI has no items`);
      else problems.push(...compare(at, key.items, inner, side));
    }
  }
  return problems;
}

function channelOf(id: string): ChannelModel {
  const found = channels.find((channel) => channel.id === id);
  if (found === undefined) throw new Error(`channel ${id} is not in the AsyncAPI document`);
  return found;
}

describe('ws-frames.json agrees with the AsyncAPI document', () => {
  it('has all 17 channels of the backend, each with an address and an operation', () => {
    expect(channels).toHaveLength(17);
    for (const channel of channels) {
      expect(channel.address, channel.id).toMatch(/^\/ws\//);
      expect(channel.server.length, channel.id).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(frames.channels))('channel %s', (id, spec) => {
    const channel = channelOf(id);
    expect(shape(channel.address)).toBe(shape(spec.path));

    const problems: string[] = [];
    for (const [side, listed] of [
      ['server', spec.server],
      ['client', spec.client],
    ] as const) {
      const messages = channel[side];
      for (const frame of listed) {
        const message = messages.find((m) => m.kind === 'json' && m.type === frame.type);
        if (message === undefined) {
          problems.push(`${side} frame ${frame.type}: not in the AsyncAPI channel`);
          continue;
        }
        const envelope = frame.envelope ?? spec.envelope;
        if (message.envelope !== envelope) {
          problems.push(
            `${frame.type}: plugin says ${envelope}, AsyncAPI says ${String(message.envelope)}`,
          );
        }
        problems.push(...compare(frame.type, frame.keys, bodyOf(message) ?? {}, side));
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(Object.entries(frames.channels))(
    'channel %s: a connection that presents an identity is declared as such',
    (id, spec) => {
      const security = channelOf(id).security;
      if (spec.requires === 'none') expect(security).toEqual([]);
      else expect(security).toContain('bearerToken');
    },
  );
});
