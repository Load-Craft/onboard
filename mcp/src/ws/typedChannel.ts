/**
 * The typed client of the channels generated from `contracts/loadcraft-asyncapi.json`: the address
 * of a channel with its path parameters, a received frame typed by its wire type, a frame to send
 * typed by the channel. It checks the shape of the envelope only; the keys of a frame are typed, not
 * validated. Reading a frame the plugin depends on goes through the Zod readers of `frames.ts`.
 */
import {
  CHANNELS,
  type ChannelId,
  type ClientFrames,
  type ServerFrames,
} from './generated/channels.js';

type ParamName<C extends ChannelId> = (typeof CHANNELS)[C]['params'][number];

/** The path parameters of a channel, by name. */
export type TypedChannelParams<C extends ChannelId> = Readonly<Record<ParamName<C>, string>>;

const PLACEHOLDER = /\{([^}]+)\}/g;
// A dot segment would be resolved by the URL parser and move the address to another route.
const DOT_SEGMENT = /^\.{1,2}$/;

/** The path of a channel (`/ws/...`) with its parameters filled in and encoded. */
export function channelAddress<C extends ChannelId>(
  channel: C,
  params: TypedChannelParams<C>,
): string {
  const given: Readonly<Record<string, unknown>> = params;
  const expected: readonly string[] = CHANNELS[channel].params;
  for (const name of Object.keys(given)) {
    if (!expected.includes(name)) {
      throw new Error(`Channel "${channel}" has no path parameter "${name}".`);
    }
  }
  return CHANNELS[channel].address.replace(PLACEHOLDER, (_match, name: string) => {
    const value = given[name];
    if (typeof value !== 'string' || value === '' || DOT_SEGMENT.test(value)) {
      throw new Error(`Channel path parameter "${name}" must be a non-empty identifier.`);
    }
    return encodeURIComponent(value);
  });
}

/** A frame the server sent on `C`, one member per wire type, with its keys as `body`. */
export type ReceivedFrame<C extends keyof ServerFrames> = {
  [T in keyof ServerFrames[C] & string]: {
    kind: 'frame';
    type: T;
    frame: ServerFrames[C][T] extends { frame: infer F } ? F : never;
    body: ServerFrames[C][T] extends { body: infer B } ? B : never;
  };
}[keyof ServerFrames[C] & string];

export interface UnknownTypedFrame {
  kind: 'unknown';
  type: string;
}

/** A text or binary message of the channel that is not a JSON frame (a pong, a picture). */
export interface RawFrame {
  kind: 'raw';
  /** The message under `components.messages`. */
  key: string;
  /** The text of a text message. */
  text?: string;
  /** The bytes of a binary message. */
  data?: Uint8Array;
}

interface RawEntry {
  readonly key: string;
  readonly kind: 'text' | 'binary';
  readonly text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesOf(raw: unknown): Uint8Array | undefined {
  if (raw instanceof Uint8Array) return raw;
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : undefined;
}

/**
 * Reads one message of `channel`: JSON text, an already parsed object, or a raw text or binary
 * message the channel lists (`{kind: 'raw'}`). A wire type the document does not list gives
 * `{kind: 'unknown'}`; anything else that is not a frame throws.
 *
 * `isBinary` is what the socket says the message was: the `ws` library hands a text message over
 * as bytes too (`isBinary` false), and those bytes are read as UTF-8 text. Without it, bytes are a
 * binary message and a string is text.
 */
export function parseServerFrame<C extends keyof ServerFrames>(
  channel: C,
  raw: unknown,
  isBinary?: boolean,
): ReceivedFrame<C> | UnknownTypedFrame | RawFrame {
  const info = CHANNELS[channel];
  const rawServer: readonly RawEntry[] = info.rawServer;
  const bytes = bytesOf(raw);
  if (isBinary === true || (bytes !== undefined && isBinary !== false)) {
    const entry = rawServer.find((candidate) => candidate.kind === 'binary');
    if (entry === undefined) throw new Error(`Channel "${channel}" sends no binary message.`);
    if (bytes === undefined)
      throw new Error(`Channel "${channel}": a binary message is not bytes.`);
    return { kind: 'raw', key: entry.key, data: bytes };
  }
  let value = bytes === undefined ? raw : new TextDecoder().decode(bytes);
  if (typeof value === 'string') {
    const text = value;
    try {
      value = JSON.parse(text);
    } catch {
      const entry = rawServer.find(
        (candidate) => candidate.kind === 'text' && candidate.text === text,
      );
      if (entry !== undefined) return { kind: 'raw', key: entry.key, text };
      throw new Error(`Channel "${channel}": the text is not valid JSON.`);
    }
  }
  if (!isRecord(value)) throw new Error(`Channel "${channel}": a frame must be a JSON object.`);
  const type = value['type'];
  if (typeof type !== 'string' || type === '') {
    throw new Error(`Channel "${channel}": the frame has no string "type".`);
  }
  const envelope = (info.envelopes as Readonly<Record<string, string | null>>)[type];
  if (!(info.serverTypes as readonly string[]).includes(type)) return { kind: 'unknown', type };
  let body: unknown;
  if (envelope === 'payload') {
    body = value['payload'];
    if (!isRecord(body)) {
      throw new Error(`Channel "${channel}", frame "${type}": payload is not an object.`);
    }
  } else {
    body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'type'));
  }
  return { kind: 'frame', type, frame: value, body } as ReceivedFrame<C>;
}

type ClientUnion<C extends keyof ClientFrames> = {
  [T in keyof ClientFrames[C]]: ClientFrames[C][T] extends { frame: infer F } ? F : never;
}[keyof ClientFrames[C]];

/** The texts the channel receives as raw messages (`"ping"`). */
type ClientText<C extends ChannelId> = (typeof CHANNELS)[C]['rawClient'][number] extends infer E
  ? E extends { kind: 'text'; text: infer T }
    ? T
    : never
  : never;

/**
 * A message the plugin may send on `C`, as what to put on the socket: JSON text for a frame, the
 * text itself for a raw text message the channel receives.
 */
export function encodeClientFrame<C extends keyof ClientFrames & ChannelId>(
  channel: C,
  frame: ClientUnion<C> | ClientText<C>,
): string {
  if (typeof frame === 'string') {
    const texts: readonly RawEntry[] = CHANNELS[channel].rawClient;
    if (!texts.some((entry) => entry.kind === 'text' && entry.text === frame)) {
      throw new Error(`Channel "${channel}" does not receive the text "${frame}".`);
    }
    return frame;
  }
  const type = (frame as { type: string }).type;
  if (!(CHANNELS[channel].clientTypes as readonly string[]).includes(type)) {
    throw new Error(`Channel "${channel}" does not receive a frame of type "${type}".`);
  }
  return JSON.stringify(frame);
}
