// Writes TypeScript types for the frames of AsyncAPI channels: one type per message, a union per
// channel and direction, and a table of addresses and wire types. Types only: the file has no
// runtime code besides the `CHANNELS` table, so the generated output pulls in no dependency.

import {
  baseType,
  isNullable,
  type ChannelModel,
  type MessageModel,
  type Schema,
} from './model.ts';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SCALARS: Record<string, string> = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
};

function pascal(id: string): string {
  return id.slice(0, 1).toUpperCase() + id.slice(1);
}

function doc(text: string | undefined, indent: string): string {
  if (text === undefined || text.trim() === '') return '';
  return `${indent}/** ${text.replace(/\s+/g, ' ').trim().replaceAll('*/', '*\\/')} */\n`;
}

function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function literal(value: unknown, where: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  throw new Error(`${where}: only string, number and boolean const and enum values are supported`);
}

function wrap(type: string): string {
  return /[|&]/.test(type) ? `(${type})` : type;
}

/** TypeScript type of a JSON Schema in the contract profile (see model.ts). `where` names the message for errors. */
function typeOf(schema: Schema, where: string, indent: string): string {
  for (const unsupported of ['oneOf', 'anyOf', 'allOf', 'not', '$ref']) {
    if (unsupported in schema) throw new Error(`${where}: "${unsupported}" is not supported`);
  }
  if (schema.const === null) return 'null';
  const body = coreType(schema, where, indent);
  return isNullable(schema) ? `${wrap(body)} | null` : body;
}

function coreType(schema: Schema, where: string, indent: string): string {
  if (schema.const !== undefined) return literal(schema.const, where);
  if (Array.isArray(schema.enum)) {
    const values = (schema.enum as unknown[]).filter((value) => value !== null);
    return values.map((value) => literal(value, where)).join(' | ');
  }
  const type = baseType(schema, where);
  if (type === undefined) {
    return schema.properties === undefined ? 'unknown' : objectType(schema, where, indent);
  }
  if (type === 'string' && schema.format === 'binary') return 'Uint8Array';
  const scalar = SCALARS[type];
  if (scalar !== undefined) return scalar;
  if (type === 'array') {
    const items = schema.items === undefined ? 'unknown' : typeOf(schema.items, where, indent);
    return `${wrap(items)}[]`;
  }
  if (type === 'object') return objectType(schema, where, indent);
  throw new Error(`${where}: unsupported type "${type}"`);
}

function objectType(schema: Schema, where: string, indent: string): string {
  const inner = `${indent}  `;
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const optional = required.has(name) ? '' : '?';
    return `${doc(property.description, inner)}${inner}${key(name)}${optional}: ${typeOf(property, `${where}.${name}`, inner)};\n`;
  });
  const extra = schema.additionalProperties;
  const values =
    typeof extra === 'object' && extra !== null ? typeOf(extra, `${where}[]`, inner) : undefined;
  if (lines.length === 0) return `Record<string, ${values ?? 'unknown'}>`;
  const shape = `{\n${lines.join('')}${indent}}`;
  return values === undefined ? shape : `${shape} & Record<string, ${values}>`;
}

function frameType(message: MessageModel): string {
  const where = `message ${message.key}`;
  const head = doc(message.summary, '');
  if (message.kind === 'binary') return `${head}export type ${message.key} = Uint8Array;\n`;
  if (message.kind === 'text') {
    return `${head}export type ${message.key} = ${typeOf(message.schema, where, '')};\n`;
  }
  const body = `export type ${message.key} = ${typeOf(message.schema, where, '')};\n`;
  const bodyType =
    message.envelope === 'payload' ? `${message.key}["payload"]` : `Omit<${message.key}, "type">`;
  return `${head}${body}export type ${message.key}Body = ${bodyType};\n`;
}

function union(names: string[]): string {
  return names.length === 0 ? 'never' : names.join(' | ');
}

function tuple(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

/** The whole generated module for `channels`; `source` is the contract path named in the header. */
export function emitChannelTypes(channels: ChannelModel[], source: string): string {
  const names = new Set<string>();
  const claim = (name: string): void => {
    if (names.has(name)) throw new Error(`the generated name "${name}" is used twice`);
    names.add(name);
  };
  const parts: string[] = [];
  const serverMap: string[] = [];
  const clientMap: string[] = [];
  const table: string[] = [];
  const written = new Set<string>();

  for (const channel of channels) {
    const id = pascal(channel.id);
    parts.push(`// ---- ${channel.id}: ${channel.address}\n`);
    const messages = [...channel.server, ...channel.client];
    for (const message of messages) {
      // A message several channels share is written once, where it is first used.
      if (written.has(message.key)) continue;
      written.add(message.key);
      claim(message.key);
      if (message.kind === 'json') claim(`${message.key}Body`);
      parts.push(frameType(message));
    }
    const json = (list: MessageModel[]) => list.filter((m) => m.kind === 'json');
    claim(`${id}ServerFrame`);
    claim(`${id}ClientFrame`);
    parts.push(
      `${doc(channel.description, '')}export type ${id}ServerFrame = ${union(json(channel.server).map((m) => m.key))};\n`,
      `export type ${id}ClientFrame = ${union(json(channel.client).map((m) => m.key))};\n`,
    );
    const entries = (list: MessageModel[]) =>
      json(list)
        .map((m) => `    ${JSON.stringify(m.type)}: { frame: ${m.key}; body: ${m.key}Body };\n`)
        .join('');
    serverMap.push(`  ${key(channel.id)}: {\n${entries(channel.server)}  };\n`);
    clientMap.push(`  ${key(channel.id)}: {\n${entries(channel.client)}  };\n`);
    const envelopes = [...json(channel.server), ...json(channel.client)]
      .map((m) => `${JSON.stringify(`${m.type}`)}: ${JSON.stringify(m.envelope)}`)
      .join(', ');
    const raw = (list: MessageModel[]) =>
      `[${list
        .filter((m) => m.kind !== 'json')
        .map((m) =>
          m.kind === 'text'
            ? `{ key: ${JSON.stringify(m.key)}, kind: "text", text: ${JSON.stringify(m.type)} }`
            : `{ key: ${JSON.stringify(m.key)}, kind: "binary" }`,
        )
        .join(', ')}]`;
    table.push(
      `  ${key(channel.id)}: {\n` +
        `    address: ${JSON.stringify(channel.address)},\n` +
        `    params: ${tuple(channel.params)},\n` +
        `    security: ${tuple(channel.security)},\n` +
        `    serverTypes: ${tuple(json(channel.server).map((m) => m.type))},\n` +
        `    clientTypes: ${tuple(json(channel.client).map((m) => m.type))},\n` +
        `    terminalFrames: ${tuple(channel.terminalFrames)},\n` +
        `    replay: ${JSON.stringify(channel.replay)},\n` +
        `    closeCodes: ${JSON.stringify(channel.closeCodes)},\n` +
        `    requiresOrigin: ${JSON.stringify(channel.requiresOrigin)},\n` +
        `    startedBy: ${JSON.stringify(channel.startedBy)},\n` +
        `    envelopes: { ${envelopes} },\n` +
        `    rawServer: ${raw(channel.server)},\n` +
        `    rawClient: ${raw(channel.client)},\n` +
        `  },\n`,
    );
  }

  const header = `/**
 * Generated file - do not edit.
 * Source: ${source}. Regenerate with "npm run gen:ws" (from mcp/).
 */
`;
  return [
    header,
    ...parts,
    `/** Frames the server sends, by channel and wire type: the whole frame and the keys it carries. */\nexport interface ServerFrames {\n${serverMap.join('')}}\n`,
    `/** Frames the server receives, by channel and wire type. */\nexport interface ClientFrames {\n${clientMap.join('')}}\n`,
    `/** The keys of a server frame: the \`payload\` of an enveloped frame, the frame without \`type\` otherwise. */\nexport type ServerBody<C extends keyof ServerFrames, T extends keyof ServerFrames[C]> =\n  ServerFrames[C][T] extends { body: infer B } ? B : never;\n`,
    `/** The keys of a client frame, as \`ServerBody\` for the server's. */\nexport type ClientBody<C extends keyof ClientFrames, T extends keyof ClientFrames[C]> =\n  ClientFrames[C][T] extends { body: infer B } ? B : never;\n`,
    `/** What a channel's metadata must satisfy: a terminal frame is a frame the channel sends. */\nexport type ChannelMetadata = {\n  [C in keyof ServerFrames]: {\n    readonly terminalFrames: readonly (keyof ServerFrames[C])[];\n    readonly [extra: string]: unknown;\n  };\n};\n`,
    `/** Address, path parameters and wire types of every channel; \`terminalFrames\` are the server frames that end a run, \`replay\` what a socket sends on connect, \`closeCodes\` what the server's close codes mean, \`requiresOrigin\` whether the handshake needs an \`Origin\` header, \`startedBy\` the REST operations that start a run and the field that returns the channel parameter; \`rawServer\` and \`rawClient\` list the text and binary messages. */\nexport const CHANNELS = {\n${table.join('')}} as const satisfies ChannelMetadata;\n`,
    `export type ChannelId = keyof typeof CHANNELS;\n`,
  ].join('\n');
}
