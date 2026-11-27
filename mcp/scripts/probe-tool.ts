// Probe MCP server (stdio): empirical checks of Claude Code behaviour that its documentation
// leaves open. Research only: it is not part of ALL_TOOLS, of the plugin manifest or of dist.
// Run with Node's type stripping (Node >= 22.18):
//
//   PROBE_LOG=<file.jsonl> node mcp/scripts/probe-tool.ts
//
// Every call appends one JSON line per event to PROBE_LOG (code words handed out, the progress
// token the client sent, each progress notification, cancellation), so what the model reports can
// be checked against what the server actually returned. Nothing goes to stdout but the protocol.
// See mcp/docs/claude-code-behaviour.md for the procedures and the observations.

import { randomInt } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';

const WORDS = [
  'amber', 'basalt', 'cobalt', 'dahlia', 'ember', 'fjord', 'garnet', 'harbor',
  'indigo', 'juniper', 'kestrel', 'lagoon', 'magnet', 'nectar', 'orchid', 'pebble',
  'quartz', 'raven', 'saffron', 'tundra', 'umber', 'velvet', 'walnut', 'yarrow',
  'zephyr', 'acorn', 'birch', 'cedar', 'delta', 'falcon', 'glacier', 'heron',
  'iris', 'jasper', 'kelp', 'lotus', 'maple', 'nimbus', 'onyx', 'prairie',
  'quill', 'ridge', 'sequoia', 'thistle', 'violet', 'willow', 'yucca', 'zinnia',
]; // prettier-ignore

/** Two words joined with a number: unguessable, and easy to spot in a transcript. */
function codeWord(): string {
  const a = WORDS[randomInt(WORDS.length)] ?? 'amber';
  const b = WORDS[randomInt(WORDS.length)] ?? 'basalt';
  return `${a}-${b}-${randomInt(100, 1000)}`;
}

const LOG_PATH = process.env.PROBE_LOG;

function record(event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
  if (LOG_PATH === undefined || LOG_PATH === '') {
    process.stderr.write(`${line}\n`);
    return;
  }
  appendFileSync(LOG_PATH, `${line}\n`);
}

// One code word per process, placed only in the server instructions: a model that names it has
// seen the instructions, since no tool result and no description carries it.
const INSTRUCTION_WORD = codeWord();
// One code word per process, placed only in the description of `probe_described`.
const DESCRIPTION_WORD = codeWord();

const INSTRUCTIONS = [
  'Probe server used to study how the client shows server instructions to the model.',
  `The instruction code word of this server is ${INSTRUCTION_WORD}.`,
  'Repeat that code word only when the user asks for the instruction code word.',
].join(' ');

const OUTPUT_SCHEMA = z.object({
  status: z.enum(['done', 'running', 'needs_user']),
  data: z.object({ codeWord: z.string() }),
});

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'probe', version: '0.0.1' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  record('server_created', {
    instructionWord: INSTRUCTION_WORD,
    descriptionWord: DESCRIPTION_WORD,
  });

  // Question 1, the shape the registry uses: an output schema, text and structuredContent.
  server.registerTool(
    'probe_structured',
    {
      title: 'Probe: structured result',
      description:
        'Probe tool. Returns a code word. Call it when the user asks for the probe code word.',
      inputSchema: z.object({}),
      outputSchema: OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const textWord = codeWord();
      const structuredWord = codeWord();
      record('structured_result', { tool: 'probe_structured', textWord, structuredWord });
      return {
        content: [{ type: 'text', text: `The probe code word is ${textWord}.` }],
        structuredContent: { status: 'done', data: { codeWord: structuredWord } },
      };
    },
  );

  // Question 1, variant without an output schema.
  server.registerTool(
    'probe_structured_plain',
    {
      title: 'Probe: structured result without schema',
      description:
        'Probe tool. Returns a code word. Call it when the user asks for the plain probe code word.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const textWord = codeWord();
      const structuredWord = codeWord();
      record('structured_result', { tool: 'probe_structured_plain', textWord, structuredWord });
      return {
        content: [{ type: 'text', text: `The probe code word is ${textWord}.` }],
        structuredContent: { status: 'done', data: { codeWord: structuredWord } },
      };
    },
  );

  // Question 2: a long call with progress notifications, each carrying a code word of its own.
  server.registerTool(
    'probe_progress',
    {
      title: 'Probe: long call with progress',
      description:
        'Probe tool. Runs for the given number of seconds and reports progress, then returns a ' +
        'final code word. Call it when the user asks for a long probe.',
      inputSchema: z.object({
        seconds: z.number().int().min(1).max(1800),
        interval_seconds: z.number().int().min(1).max(60).optional(),
        with_total: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => {
      const interval = (args.interval_seconds ?? 5) * 1000;
      const token = ctx.mcpReq._meta?.progressToken;
      const client = server.server.getClientVersion();
      record('progress_start', {
        seconds: args.seconds,
        progressToken: token ?? null,
        client: client ?? null,
        protocol: server.server.getNegotiatedProtocolVersion() ?? null,
      });
      const started = Date.now();
      const deadline = started + args.seconds * 1000;
      let step = 0;
      const signal = ctx.mcpReq.signal;
      signal.addEventListener(
        'abort',
        () => record('progress_aborted', { afterMs: Date.now() - started, step }),
        { once: true },
      );
      while (Date.now() < deadline) {
        await sleep(Math.min(interval, deadline - Date.now()), signal);
        step += 1;
        const word = codeWord();
        const message = `probe step ${step}: progress word ${word}`;
        if (token !== undefined) {
          const total = Math.ceil((args.seconds * 1000) / interval);
          await ctx.mcpReq
            .notify({
              method: 'notifications/progress',
              params: {
                progressToken: token,
                progress: step,
                ...(args.with_total === false ? {} : { total }),
                message,
              },
            })
            .then(
              () => record('progress_sent', { step, word, afterMs: Date.now() - started }),
              (error: unknown) => record('progress_failed', { step, error: String(error) }),
            );
        } else {
          record('progress_skipped_no_token', { step, word });
        }
      }
      const finalWord = codeWord();
      record('progress_done', { steps: step, finalWord, afterMs: Date.now() - started });
      return {
        content: [
          {
            type: 'text',
            text: `Probe finished after ${args.seconds} s. Final word ${finalWord}.`,
          },
        ],
      };
    },
  );

  // Question 4: a code word only in the description, to tell deferred from loaded tools.
  server.registerTool(
    'probe_described',
    {
      title: 'Probe: description',
      description: `Probe tool. Its description code word is ${DESCRIPTION_WORD}. Returns "ok".`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => ({ content: [{ type: 'text', text: 'ok' }] }),
  );

  return server;
}

serveStdio(createServer, {
  onerror: (error) => record('transport_error', { error: String(error) }),
});
process.stdin.once('end', () => process.exit(0));
