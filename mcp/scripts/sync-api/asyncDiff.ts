// Diff of two AsyncAPI documents, frame by frame and key by key, for `npm run sync:api`. A change is
// "used by the plugin" when it touches a channel, frame or key of the plugin's surface
// (`contracts/ws-frames.json`). Direction matters: the plugin reads server frames, so a key that
// disappears, changes type, may now be null or is no longer always present breaks its reader; on a
// frame the plugin sends it is the other way round (a key the server now requires).

import {
  baseType,
  bodyOf,
  isNullable,
  readChannels,
  type AsyncApiDocument,
  type ChannelModel,
  type MessageModel,
  type Schema,
} from '../gen-clients/model.ts';

export interface SurfaceKey {
  readonly name: string;
  readonly required?: boolean;
  readonly items?: readonly SurfaceKey[];
}

/** What the plugin uses: channel -> direction -> wire type -> the keys it reads or sends. */
export type PluginSurface = Record<
  string,
  { server: Record<string, readonly SurfaceKey[]>; client: Record<string, readonly SurfaceKey[]> }
>;

export interface AsyncChange {
  readonly kind: 'breaking' | 'additive';
  readonly channel: string;
  readonly frame: string | undefined;
  /** Dotted path of the key, or empty for a change of the channel or the frame. */
  readonly where: string;
  readonly message: string;
  readonly usedByPlugin: boolean;
}

type Side = 'server' | 'client';

function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

class Collector {
  readonly changes: AsyncChange[] = [];
  private readonly channel: string;
  private readonly frame: string | undefined;
  private readonly side: Side;

  constructor(channel: string, frame: string | undefined, side: Side) {
    this.channel = channel;
    this.frame = frame;
    this.side = side;
  }

  add(kind: AsyncChange['kind'], where: string, message: string, usedByPlugin: boolean): void {
    this.changes.push({
      kind,
      channel: this.channel,
      frame: this.frame,
      where,
      message,
      usedByPlugin,
    });
  }

  /** Breaking for the reader of a server frame, additive for the sender; or the other way round. */
  forReader(): AsyncChange['kind'] {
    return this.side === 'server' ? 'breaking' : 'additive';
  }

  forSender(): AsyncChange['kind'] {
    return this.side === 'server' ? 'additive' : 'breaking';
  }
}

function compareSchema(
  out: Collector,
  path: string,
  before: Schema,
  after: Schema,
  used: readonly SurfaceKey[] | undefined,
): void {
  const oldProps = before.properties ?? {};
  const newProps = after.properties ?? {};
  const oldRequired = new Set(before.required ?? []);
  const newRequired = new Set(after.required ?? []);
  const at = (name: string): string => (path === '' ? name : `${path}.${name}`);
  const listed = (name: string): SurfaceKey | undefined => used?.find((key) => key.name === name);

  for (const name of Object.keys(oldProps)) {
    if (!(name in newProps))
      out.add('breaking', at(name), 'key removed', listed(name) !== undefined);
  }
  for (const [name, next] of Object.entries(newProps)) {
    const previous = oldProps[name];
    if (previous === undefined) {
      const needed = newRequired.has(name);
      out.add(
        needed ? out.forSender() : 'additive',
        at(name),
        needed ? 'key added and required' : 'key added',
        needed && listed(name) !== undefined,
      );
      continue;
    }
    const mine = listed(name);
    const usedHere = mine !== undefined;
    const [was, now] = [baseType(previous, at(name)), baseType(next, at(name))];
    if (was !== now) {
      out.add(
        'breaking',
        at(name),
        `type changed from ${was ?? 'any'} to ${now ?? 'any'}`,
        usedHere,
      );
    }
    const wasNull = isNullable(previous);
    const isNull = isNullable(next);
    if (wasNull !== isNull) {
      out.add(
        isNull ? out.forReader() : out.forSender(),
        at(name),
        isNull ? 'null now allowed' : 'null no longer allowed',
        usedHere,
      );
    }
    const wasRequired = oldRequired.has(name);
    const isRequired = newRequired.has(name);
    if (wasRequired !== isRequired) {
      out.add(
        isRequired ? out.forSender() : out.forReader(),
        at(name),
        isRequired ? 'now required' : 'no longer required',
        usedHere,
      );
    }
    if (previous.items !== undefined && next.items !== undefined) {
      compareSchema(out, `${at(name)}[]`, previous.items, next.items, mine?.items);
    } else if (previous.properties !== undefined && next.properties !== undefined) {
      compareSchema(out, at(name), previous, next, mine?.items);
    }
  }
}

function frames(channel: ChannelModel, side: Side): Map<string, MessageModel> {
  return new Map(
    (side === 'server' ? channel.server : channel.client)
      .filter((message) => message.kind === 'json')
      .map((message) => [message.type, message]),
  );
}

/** Changes from `before` to `after`; breaking ones first within a channel. */
export function diffAsyncApi(
  before: AsyncApiDocument,
  after: AsyncApiDocument,
  surface: PluginSurface,
): AsyncChange[] {
  const oldChannels = new Map(readChannels(before).map((channel) => [channel.id, channel]));
  const newChannels = new Map(readChannels(after).map((channel) => [channel.id, channel]));
  const changes: AsyncChange[] = [];
  const channelNote = (kind: AsyncChange['kind'], id: string, message: string): void => {
    changes.push({
      kind,
      channel: id,
      frame: undefined,
      where: '',
      message,
      usedByPlugin: id in surface,
    });
  };

  for (const [id, old] of oldChannels) {
    const next = newChannels.get(id);
    if (next === undefined) {
      channelNote('breaking', id, `channel removed (${old.address})`);
      continue;
    }
    if (old.address !== next.address) {
      channelNote('breaking', id, `address changed from ${old.address} to ${next.address}`);
    }
    // The security schemes of a channel are alternatives: any one of them lets a client in.
    if (old.security.length === 0 && next.security.length > 0) {
      channelNote('breaking', id, `credentials now required (${next.security.join(' or ')})`);
    } else if (old.security.length > 0 && next.security.length === 0) {
      channelNote('additive', id, 'no credentials needed any more');
    } else {
      for (const scheme of old.security.filter((name) => !next.security.includes(name))) {
        channelNote('breaking', id, `security scheme ${scheme} removed`);
      }
      for (const scheme of next.security.filter((name) => !old.security.includes(name))) {
        channelNote('additive', id, `security scheme ${scheme} added`);
      }
    }
    for (const side of ['server', 'client'] as const) {
      const wasFrames = frames(old, side);
      const nowFrames = frames(next, side);
      const mine = surface[id]?.[side] ?? {};
      for (const [type, message] of wasFrames) {
        const out = new Collector(id, type, side);
        const now = nowFrames.get(type);
        if (now === undefined) {
          out.add('breaking', '', `${side} frame removed`, type in mine);
        } else {
          const a = bodyOf(message);
          const b = bodyOf(now);
          if (message.envelope !== now.envelope) {
            out.add(
              'breaking',
              '',
              `envelope changed from ${shown(message.envelope)} to ${shown(now.envelope)}`,
              type in mine,
            );
          }
          if (a !== null && b !== null) compareSchema(out, '', a, b, mine[type]);
        }
        changes.push(...out.changes);
      }
      for (const type of nowFrames.keys()) {
        if (!wasFrames.has(type)) {
          const out = new Collector(id, type, side);
          out.add('additive', '', `${side} frame added`, false);
          changes.push(...out.changes);
        }
      }
    }
  }
  for (const [id, next] of newChannels) {
    if (!oldChannels.has(id)) channelNote('additive', id, `channel added (${next.address})`);
  }
  return changes;
}

/** The plugin surface of a `ws-frames.json` document. */
export function surfaceOf(contract: {
  channels: Record<
    string,
    {
      server: { type: string; keys: SurfaceKey[] }[];
      client: { type: string; keys: SurfaceKey[] }[];
    }
  >;
}): PluginSurface {
  const table = (list: { type: string; keys: SurfaceKey[] }[]) =>
    Object.fromEntries(list.map((frame) => [frame.type, frame.keys]));
  return Object.fromEntries(
    Object.entries(contract.channels).map(([id, spec]) => [
      id,
      { server: table(spec.server), client: table(spec.client) },
    ]),
  );
}

/** The extensions of a channel that no AsyncAPI source of the backend carries yet. */
export const CHANNEL_METADATA = [
  'x-terminal-frames',
  'x-replay',
  'x-requires-origin',
  'x-started-by',
  'x-close-codes',
] as const;

/**
 * `next` with the channel metadata of `previous` for every channel of the same id that lacks it; a
 * value `next` has wins. `bare` lists the channels that still have none of the extensions.
 */
export function carryChannelMetadata(
  previous: AsyncApiDocument | undefined,
  next: AsyncApiDocument,
): { document: AsyncApiDocument; bare: string[] } {
  const document = structuredClone(next);
  const bare: string[] = [];
  for (const [id, channel] of Object.entries(document.channels)) {
    const target = channel as unknown as Record<string, unknown>;
    const old = previous?.channels[id] as unknown as Record<string, unknown> | undefined;
    for (const name of CHANNEL_METADATA) {
      if (!(name in target) && old !== undefined && name in old) target[name] = old[name];
    }
    if (!CHANNEL_METADATA.some((name) => name in target)) bare.push(id);
  }
  return { document, bare };
}
