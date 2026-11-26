// In-process MCP client for tool tests. `current` speaks the 2026-07-28 revision over Streamable HTTP
// with a substituted fetch (what Claude Code negotiates); `legacy` uses the linked in-memory pair.

import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
  type ElicitResult,
  type Transport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';

import { createServer, type ServerDeps } from '../../src/server.js';

export type Era = 'current' | 'legacy';

/** Revision negotiated by Claude Code; the `current` era is pinned to it. */
export const CURRENT_REVISION = '2026-07-28';

export interface ProgressEntry {
  progress: number;
  total?: number;
  message?: string;
}

export interface CallResult {
  text: string;
  structured: unknown;
  isError: boolean;
  progress: ProgressEntry[];
}

/** A tool as `tools/list` announces it (only the fields tests look at). */
export interface ListedTool {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  /** `_meta` of the tool entry. */
  meta?: Record<string, unknown>;
  outputSchema?: unknown;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export interface McpSession {
  /** Protocol revision actually negotiated on this connection. */
  readonly protocolVersion: string;
  /** `instructions` of the server's initialize result. */
  readonly instructions: string | undefined;
  call(name: string, args: Record<string, unknown>, opts?: CallOptions): Promise<CallResult>;
  listTools(): Promise<ListedTool[]>;
  close(): Promise<void>;
}

/** Either the real server dependencies or a factory building any server (for probe tools). */
export type ServerSource = ServerDeps | (() => McpServer);

/** What the person answers to a question of the server (an elicitation), as the client returns it. */
export type Elicitor = (request: {
  readonly message: string;
  readonly requestedSchema?: unknown;
}) => ElicitResult | Promise<ElicitResult>;

export interface ConnectOptions {
  era?: Era;
  /**
   * The client asks the person (declares form elicitation and answers with this). Without it the
   * client cannot ask anyone, like a run without a person.
   */
  elicit?: Elicitor;
}

/** The client of a test: form elicitation answered by `elicit`, when it is given. */
function testClient(options: ConstructorParameters<typeof Client>[1], elicit?: Elicitor): Client {
  const client = new Client(
    { name: 'test-harness', version: '1.0.0' },
    {
      ...options,
      ...(elicit === undefined ? {} : { capabilities: { elicitation: { form: {} } } }),
    },
  );
  if (elicit !== undefined) {
    client.setRequestHandler('elicitation/create', async (request) =>
      elicit({
        message: request.params.message,
        ...('requestedSchema' in request.params
          ? { requestedSchema: request.params.requestedSchema }
          : {}),
      }),
    );
  }
  return client;
}

function buildServer(source: ServerSource): McpServer {
  return typeof source === 'function' ? source() : createServer(source);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block: { type?: string; text?: string }) =>
      block.type === 'text' ? (block.text ?? '') : '',
    )
    .join('\n');
}

export async function connect(
  source: ServerSource,
  opts: ConnectOptions = {},
): Promise<McpSession> {
  const era = opts.era ?? 'current';
  const closers: (() => Promise<void>)[] = [];
  let client: Client;

  if (era === 'legacy') {
    const server = buildServer(source);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = testClient({}, opts.elicit);
    await client.connect(clientTransport);
    closers.push(() => server.close());
  } else {
    const handler = createMcpHandler(() => buildServer(source));
    const transport: Transport = new StreamableHTTPClientTransport(
      new URL('http://test.local/mcp'),
      {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      },
    );
    client = testClient({ versionNegotiation: { mode: { pin: CURRENT_REVISION } } }, opts.elicit);
    await client.connect(transport);
    closers.push(() => handler.close());
  }

  const protocolVersion = client.getNegotiatedProtocolVersion();
  if (protocolVersion === undefined) throw new Error('no protocol version negotiated');
  if ((era === 'current') !== (protocolVersion === CURRENT_REVISION)) {
    throw new Error(`era ${era} negotiated unexpected revision ${protocolVersion}`);
  }

  return {
    protocolVersion,
    instructions: client.getInstructions(),
    async call(name, args, callOpts = {}) {
      const progress: ProgressEntry[] = [];
      const result = await client.callTool(
        { name, arguments: args },
        {
          ...(callOpts.signal === undefined ? {} : { signal: callOpts.signal }),
          ...(callOpts.timeout === undefined ? {} : { timeout: callOpts.timeout }),
          onprogress: (entry) => {
            progress.push({
              progress: entry.progress,
              ...(entry.total === undefined ? {} : { total: entry.total }),
              ...(entry.message === undefined ? {} : { message: entry.message }),
            });
          },
        },
      );
      return {
        text: textOf(result.content),
        structured: result.structuredContent,
        isError: result.isError === true,
        progress,
      };
    },
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        ...(tool.annotations === undefined ? {} : { annotations: { ...tool.annotations } }),
        ...(tool._meta === undefined ? {} : { meta: { ...tool._meta } }),
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      }));
    },
    async close() {
      await client.close();
      for (const close of closers) await close();
    },
  };
}
