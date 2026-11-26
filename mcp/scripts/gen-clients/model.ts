// Reads the channels of the backend's AsyncAPI 3.0 document (contracts/loadcraft-asyncapi.json) in
// the profile of the plugin's contract: standard JSON Schema, a key that may be null typed
// `[T, "null"]`, every message under `components.messages`, operations that name the messages by
// `$ref`, JSON frames with a `const` wire type; the official AsyncAPI parser accepts the document
// (test/asyncapi.parser.test.ts). This is not the profile of the `loadcraft-asyncapi` skill, which
// governs documents of the applications under test for the LoadCraft importer (one type per
// schema, no type lists). Used by the generator, the contract tests and `npm run sync:api`, so all
// three read the document the same way.

export interface Schema {
  type?: unknown;
  const?: unknown;
  enum?: unknown;
  format?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: Schema | boolean;
  'x-nullable'?: boolean;
  [key: string]: unknown;
}

export interface Ref {
  $ref: string;
}

export interface MessageDocument {
  name?: string;
  summary?: string;
  contentType?: string;
  payload: Schema;
  examples?: unknown[];
}

export interface OperationDocument {
  action: 'send' | 'receive';
  channel: Ref;
  messages?: Ref[];
  security?: Ref[];
}

export interface ChannelDocument {
  address: string;
  title?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  messages?: Record<string, Ref>;
  'x-close-codes'?: Record<string, string>;
  'x-terminal-frames'?: string[];
  'x-replay'?: Replay;
  'x-requires-origin'?: boolean;
  'x-started-by'?: StartedBy[];
}

/** What a socket sends right after the handshake: nothing, the stored state, or past events. */
export interface Replay {
  mode: 'none' | 'state' | 'events';
  /** The replay is handed to one connect only. */
  once?: true;
}

/** A REST operation that starts the run and the response (or request) field that names it. */
export interface StartedBy {
  operationId: string;
  /** The path parameter of the channel the field fills. */
  parameter: string;
  field: string;
  source: 'response' | 'request';
}

export interface AsyncApiDocument {
  asyncapi?: string;
  defaultContentType?: string;
  channels: Record<string, ChannelDocument>;
  operations: Record<string, OperationDocument>;
  components: {
    messages: Record<string, MessageDocument>;
    securitySchemes?: Record<string, unknown>;
  };
}

export type MessageKind = 'json' | 'text' | 'binary';
export type Envelope = 'payload' | 'flat';

export interface MessageModel {
  /** Key under `components.messages`; also the name of the generated type. */
  key: string;
  /** The wire `type` of a JSON frame; the const text of a text message; the key otherwise. */
  type: string;
  kind: MessageKind;
  /** `payload`: `{type, payload: {...}}`; `flat`: keys next to `type`. `null` for text and binary. */
  envelope: Envelope | null;
  summary: string | undefined;
  schema: Schema;
}

export interface ChannelModel {
  id: string;
  address: string;
  /** Path parameters in the order of the address. */
  params: string[];
  description: string | undefined;
  /** Names of the security schemes the sending operations accept (alternatives). */
  security: string[];
  /** Messages the server sends. */
  server: MessageModel[];
  /** Messages the server receives. */
  client: MessageModel[];
  /** Wire types of the server frames that end a run (the first of a twin pair first). */
  terminalFrames: string[];
  replay: Replay;
  /** Close codes of the server and what each means. */
  closeCodes: Record<string, string>;
  /** The handshake needs an `Origin` header with the host of the `Host` header. */
  requiresOrigin: boolean;
  startedBy: StartedBy[];
}

function refName(ref: Ref, prefix: string, where: string): string {
  if (typeof ref.$ref !== 'string' || !ref.$ref.startsWith(prefix)) {
    throw new Error(`${where}: reference "${String(ref.$ref)}" must start with ${prefix}`);
  }
  return ref.$ref.slice(prefix.length);
}

/**
 * The key under `components.messages` an operation message points at. AsyncAPI 3 points at the
 * channel's own entry (`#/channels/<id>/messages/<name>`, which refers on to the component); a
 * direct `#/components/messages/<name>` is read too.
 */
function componentKey(doc: AsyncApiDocument, ref: Ref, where: string): string {
  const text = typeof ref.$ref === 'string' ? ref.$ref : '';
  const viaChannel = /^#\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(text);
  if (viaChannel === null) return refName(ref, '#/components/messages/', where);
  const entry = doc.channels[viaChannel[1] ?? '']?.messages?.[viaChannel[2] ?? ''];
  if (entry === undefined) throw new Error(`${where}: "${text}" is not a message of that channel`);
  return refName(entry, '#/components/messages/', where);
}

function kindOf(contentType: string): MessageKind {
  if (contentType === 'application/json' || contentType.endsWith('+json')) return 'json';
  return contentType.startsWith('text/') ? 'text' : 'binary';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageModel(doc: AsyncApiDocument, key: string): MessageModel {
  const message = doc.components.messages[key];
  if (message === undefined) throw new Error(`message "${key}" is not under components.messages`);
  const contentType = message.contentType ?? doc.defaultContentType ?? 'application/json';
  const kind = kindOf(contentType);
  const schema = message.payload;
  const base = { key, kind, summary: message.summary, schema };
  if (kind !== 'json') {
    const text = schema.const;
    return { ...base, type: typeof text === 'string' ? text : key, envelope: null };
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const wire = properties['type']?.const;
  if (typeof wire !== 'string' || wire === '') {
    throw new Error(
      `message "${key}": a JSON frame needs a "type" property with a const wire type`,
    );
  }
  const names = Object.keys(properties).sort();
  const enveloped =
    names.length === 2 && names[1] === 'type' && names[0] === 'payload'
      ? properties['payload']?.type === 'object'
      : false;
  return { ...base, type: wire, envelope: enveloped ? 'payload' : 'flat' };
}

function pathParams(address: string): string[] {
  return [...address.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '');
}

/** Channels of the document with the messages of the operations that send and receive on them. */
export function readChannels(doc: AsyncApiDocument): ChannelModel[] {
  return Object.entries(doc.channels).map(([id, channel]) => {
    const params = pathParams(channel.address);
    for (const declared of Object.keys(channel.parameters ?? {})) {
      if (!params.includes(declared)) {
        throw new Error(`channel "${id}": parameter "${declared}" is not in ${channel.address}`);
      }
    }
    const direction = { send: [] as MessageModel[], receive: [] as MessageModel[] };
    const security: string[] = [];
    for (const [opId, op] of Object.entries(doc.operations)) {
      if (refName(op.channel, '#/channels/', `operation "${opId}"`) !== id) continue;
      const refs = op.messages ?? Object.values(channel.messages ?? {});
      for (const ref of refs) {
        const key = componentKey(doc, ref, `operation "${opId}"`);
        const list = direction[op.action];
        if (!list.some((m) => m.key === key)) list.push(messageModel(doc, key));
      }
      if (op.action === 'send') {
        for (const ref of op.security ?? []) {
          const scheme = refName(ref, '#/components/securitySchemes/', `operation "${opId}"`);
          if (!security.includes(scheme)) security.push(scheme);
        }
      }
    }
    for (const [name, list] of Object.entries(direction)) {
      const seen = new Set<string>();
      for (const m of list) {
        if (m.kind !== 'json') continue;
        if (seen.has(m.type)) {
          throw new Error(`channel "${id}" (${name}): wire type "${m.type}" appears twice`);
        }
        seen.add(m.type);
      }
    }
    const terminalFrames = channel['x-terminal-frames'] ?? [];
    const sent = direction.send.filter((m) => m.kind === 'json').map((m) => m.type);
    for (const type of terminalFrames) {
      if (!sent.includes(type)) {
        throw new Error(
          `channel "${id}": terminal frame "${type}" is not a frame the server sends`,
        );
      }
    }
    const startedBy = channel['x-started-by'] ?? [];
    for (const start of startedBy) {
      if (!params.includes(start.parameter)) {
        throw new Error(
          `channel "${id}": "${start.operationId}" fills "${start.parameter}", which is not a path parameter of ${channel.address}`,
        );
      }
    }
    return {
      id,
      address: channel.address,
      params,
      description: channel.description,
      security,
      server: direction.send,
      client: direction.receive,
      terminalFrames,
      replay: channel['x-replay'] ?? { mode: 'none' },
      closeCodes: channel['x-close-codes'] ?? {},
      requiresOrigin: channel['x-requires-origin'] ?? false,
      startedBy,
    };
  });
}

/**
 * The keys a frame carries: the schema of `payload` for an enveloped frame, the frame's own
 * properties without `type` for a flat one. `null` for a text or binary message.
 */
export function bodyOf(message: MessageModel): Schema | null {
  if (message.kind !== 'json') return null;
  const properties = message.schema.properties ?? {};
  if (message.envelope === 'payload') return properties['payload'] ?? {};
  const keys = Object.entries(properties).filter(([name]) => name !== 'type');
  return {
    type: 'object',
    properties: Object.fromEntries(keys),
    required: (message.schema.required ?? []).filter((name) => name !== 'type'),
  };
}

/**
 * Whether a schema allows `null`: a type list with `"null"` (the standard form), the older
 * `x-nullable: true`, or, in a schema without a type, `null` among the `enum` values or a `const`
 * of `null`.
 */
export function isNullable(schema: Schema): boolean {
  if (schema['x-nullable'] === true) return true;
  if (Array.isArray(schema.type)) return schema.type.includes('null');
  if (schema.type !== undefined) return false;
  return (
    schema.const === null ||
    (Array.isArray(schema.enum) && (schema.enum as unknown[]).includes(null))
  );
}

/**
 * The document with every `x-nullable` written the standard way: `true` becomes `"null"` in the
 * type list (and `null` among `enum` values, a `const` an `enum` of it and `null`), `false` is
 * dropped. Example payloads are data and stay as they are. `sync:api` writes the contract in
 * this form, so the snapshot says nullability one way only.
 */
export function standardNullable<T>(document: T): T {
  // `fields`: `node` maps field names to schemas (`properties`), so its keys are names, not keywords.
  const walk = (node: unknown, fields = false): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        !fields && (key === 'examples' || key === 'example')
          ? value
          : walk(value, !fields && key === 'properties');
    }
    if (fields || !('x-nullable' in out)) return out;
    const nullable = out['x-nullable'] === true;
    delete out['x-nullable'];
    if (!nullable) return out;
    const { type } = out;
    if (typeof type === 'string') out['type'] = type === 'null' ? type : [type, 'null'];
    else if (Array.isArray(type) && !type.includes('null')) out['type'] = [...type, 'null'];
    if ('const' in out) {
      out['enum'] = [out['const']];
      delete out['const'];
    }
    if (Array.isArray(out['enum']) && !out['enum'].includes(null))
      out['enum'] = [...out['enum'], null];
    return out;
  };
  return walk(document) as T;
}

/**
 * The one non-null type of a schema, `undefined` when it names none; throws when a type list
 * names more than one (the contract profile allows one type per schema, plus `null`).
 */
export function baseType(schema: Schema, where: string): string | undefined {
  const { type } = schema;
  if (type === undefined) return undefined;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    const named = type.filter((t): t is string => typeof t === 'string' && t !== 'null');
    if (named.length === 1) return named[0];
    if (named.length === 0) return undefined;
  }
  throw new Error(`${where}: "type" must be one type, or that type and "null"`);
}
