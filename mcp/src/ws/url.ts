/**
 * Addresses of the WebSocket channels.
 *
 * The one source of an address is the generated table `CHANNELS` (`ws/generated/channels.ts`):
 * its path template, path parameters, security and Origin flag. This module only builds the URL
 * and names what a connection must present. Channels live on the origin of the API, not under its
 * `/api/v1` path.
 */
import { CHANNELS } from './generated/channels.js';

export type ChannelId = keyof typeof CHANNELS;

/** What a connection must present: nothing, the API token, or the token and an `Origin` header. */
export type ChannelRequirement = 'none' | 'identity' | 'identity_and_origin';

/** What the connection to a channel must present, read from its security and Origin flag. */
export function channelRequirement(channel: ChannelId): ChannelRequirement {
  const { security, requiresOrigin } = CHANNELS[channel];
  if (requiresOrigin) return 'identity_and_origin';
  return (security as readonly string[]).includes('bearerToken') ? 'identity' : 'none';
}

type PathParams<P extends string> = P extends `${string}{${infer K}}${infer Rest}`
  ? K | PathParams<Rest>
  : never;

/** Path parameters of a channel, e.g. `{project_id, session_id}` for `har`. */
export type ChannelParams<C extends ChannelId> = Readonly<
  Record<PathParams<(typeof CHANNELS)[C]['address']>, string>
>;

const PLACEHOLDER = /\{([a-z_]+)\}/g;
// A dot segment would be resolved by the URL parser and move the address to another route.
const DOT_SEGMENT = /^\.{1,2}$/;

function encodeSegment(name: string, value: unknown): string {
  if (typeof value !== 'string' || value === '' || DOT_SEGMENT.test(value)) {
    throw new Error(`Channel path parameter "${name}" must be a non-empty identifier.`);
  }
  return encodeURIComponent(value);
}

/** `ws://` or `wss://` address of a channel on the origin of `apiUrl`. */
export function channelUrl<C extends ChannelId>(
  apiUrl: string,
  channel: C,
  params: ChannelParams<C>,
): URL {
  const template: string = CHANNELS[channel].address;
  const given = params as Readonly<Record<string, unknown>>;
  const expected = new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]));
  for (const key of Object.keys(given)) {
    if (!expected.has(key)) {
      throw new Error(`Channel "${channel}" has no path parameter "${key}".`);
    }
  }
  const path = template.replace(PLACEHOLDER, (_match, name: string) =>
    encodeSegment(name, given[name]),
  );

  const api = new URL(apiUrl);
  const scheme = api.protocol === 'https:' ? 'wss:' : 'ws:';
  return new URL(`${scheme}//${api.host}${path}`);
}

/**
 * The `Origin` sent on channels that require one: the http(s) origin of the API address. The
 * backend compares its host and port with the `Host` header and accepts only http(s) schemes.
 */
export function apiOrigin(apiUrl: string): string {
  return new URL(apiUrl).origin;
}

/** Address safe for logs and error texts: origin and path, without credentials, query or fragment. */
export function redactUrl(url: URL | string): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}
