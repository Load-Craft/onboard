import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { createLogger } from '../src/log.js';
import type { Clock } from '../src/ops/clock.js';
import {
  awaitOperation,
  defineOperationKind,
  resumeOperation,
  viewOperation,
} from '../src/ops/operation.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { defineTool, type Tool } from '../src/registry.js';
import { createServer, INSTRUCTIONS } from '../src/server.js';
import { VERSION } from '../src/version.js';
import { createTestClock } from './helpers/clock.js';

const CANARY = 'CANARY-SECRET-7f3a';

interface Harness {
  client: Client;
  lines: string[];
  close(): Promise<void>;
}

interface ConnectOptions {
  root?: string;
  clock?: Clock;
}

async function connect(
  tools: readonly Tool[],
  env: NodeJS.ProcessEnv = {},
  opts: ConnectOptions = {},
): Promise<Harness> {
  const lines: string[] = [];
  const config = loadConfig({ LOADCRAFT_API_TOKEN: CANARY, ...env }, opts.root ?? '/work/sklep');
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  log.registerSecret(CANARY);
  const server = createServer({
    config,
    log,
    tools,
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
  });
  const client = new Client({ name: 'registry-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    lines,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('\n');
}

const orders = defineTool({
  name: 'list_orders',
  title: 'List orders',
  description: 'Orders: list orders of the shop. Does not modify anything.',
  input: z.object({ shop: z.string().min(1).describe('Shop name') }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  run(ctx, args) {
    return Promise.resolve({
      status: 'done' as const,
      data: { shop: args.shop, count: 3 },
      links: [ctx.services.links.flow('sklep', 'f1'), ctx.services.links.scenario('sklep', 's1')],
    });
  },
  render: (data) => `${data.shop}: ${data.count} orders`,
});

const preview = defineTool({
  name: 'show_preview',
  title: 'Show preview',
  description: 'Preview: show the live preview link. Does not modify anything.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run(ctx) {
    return Promise.resolve({
      status: 'done' as const,
      data: {},
      links: [ctx.services.links.describeRun('sklep', 'r1')],
    });
  },
  render: () => 'preview',
});

const secretLink = defineTool({
  name: 'secret_link',
  title: 'Secret link',
  description: 'Secret: a link whose address carries a registered secret.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run(ctx) {
    return Promise.resolve({
      status: 'done' as const,
      data: {},
      links: [ctx.services.links.flow('sklep', CANARY)],
    });
  },
  render: () => 'x',
});

const longRunning = defineTool({
  name: 'start_import',
  title: 'Start import',
  description: 'Import: start an import that keeps running in LoadCraft.',
  input: z.object({}),
  annotations: { readOnlyHint: false },
  run() {
    return Promise.resolve({
      status: 'running' as const,
      data: { message: 'Importing (10%)', fraction: 0.1 },
      operation: 'import:1234',
    });
  },
  render: (): string => {
    throw new Error('render draws finished data only');
  },
});

const waitingForUser = defineTool({
  name: 'record_journey',
  title: 'Record journey',
  description: 'Record: the agent asks the user for help.',
  input: z.object({}),
  annotations: { readOnlyHint: false },
  run() {
    return Promise.resolve({
      status: 'needs_user' as const,
      data: { message: 'Agent prosi o kod SMS', note: 'Okno logowania czeka' },
      operation: 'record_run:r-1',
    });
  },
  render: (): string => {
    throw new Error('render draws finished data only');
  },
});

/** One REST-only kind; the step it reads is switched by the test. */
let importStep: 'running' | 'done' = 'running';
const importKind = defineOperationKind({
  kind: 'setup_analysis',
  saved: z.object({ shop: z.string() }),
  initial: () => importStep,
  recover: () => Promise.resolve(importStep),
  isTerminal: (step) => step === 'done',
  describe: (step, t) => ({ message: `${t.locale}: ${step}` }),
  finish: (_ctx, id, _step, saved) =>
    Promise.resolve({ status: 'done' as const, data: { id, shop: saved.shop, orders: 3 } }),
  view: (data, t) => `[${t.locale}] ${data.shop}: ${String(data.orders)} orders (${data.id})`,
});

const startAnalysis = defineTool({
  name: 'start_analysis',
  title: 'Start analysis',
  description: 'Analysis: starts the analysis and waits for it.',
  input: z.object({ max_wait_s: z.number() }),
  annotations: { readOnlyHint: false },
  run: (ctx, args) =>
    awaitOperation(ctx, importKind, 'run-1', {
      maxWaitS: args.max_wait_s,
      saved: { shop: 'sklep' },
    }),
  render: importKind.spec.view,
});

const waitTool = defineTool({
  name: 'wait_for',
  title: 'Wait',
  description: 'Wait: continues an operation by its handle.',
  input: z.object({ operation: z.string(), max_wait_s: z.number() }),
  annotations: { readOnlyHint: true },
  run: (ctx, args) =>
    resumeOperation(ctx, [importKind], args.operation, { maxWaitS: args.max_wait_s }),
  render: (data, t, args) => viewOperation([importKind], args.operation, data, t),
});

const failing = defineTool({
  name: 'check_file',
  title: 'Check file',
  description: 'File: check a file in the project.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run() {
    return Promise.reject(new ToolError('x', { hint: 'pass a path inside the project' }));
  },
  render: () => 'unreachable',
});

const unauthorizedCall = defineTool({
  name: 'call_backend',
  title: 'Call backend',
  description: 'Backend: calls the LoadCraft API.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run() {
    return Promise.reject(
      new LoadcraftApiError({ status: 401, code: 'unauthorized', message: 'Invalid token.' }),
    );
  },
  render: () => 'unreachable',
});

const leakyBackend = defineTool({
  name: 'leaky_backend',
  title: 'Leaky backend',
  description: 'Backend: echoes the token in an error.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run() {
    return Promise.reject(
      new LoadcraftApiError({
        status: 409,
        code: 'conflict',
        message: `token ${CANARY} is taken`,
      }),
    );
  },
  render: () => 'unreachable',
});

const FILE_SECRET = 'file-password-of-this-call';

const serverFailure = defineTool({
  name: 'server_failure',
  title: 'Server failure',
  description: 'Backend: fails with a 500 whose text is kept for the log.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run(ctx) {
    ctx.secrets.add(FILE_SECRET);
    return Promise.reject(
      new LoadcraftApiError({
        status: 500,
        code: 'server_error',
        message: 'LoadCraft API answered HTTP 500.',
        logText: `db failed for ${FILE_SECRET} at host db-internal`,
      }),
    );
  },
  render: () => 'unreachable',
});

const crashing = defineTool({
  name: 'crash_now',
  title: 'Crash now',
  description: 'Crash: always throws an unexpected error.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run() {
    return Promise.reject(new Error(`sekret w stosie ${CANARY}`));
  },
  render: () => 'unreachable',
});

function waitingTool(started: () => void) {
  return defineTool({
    name: 'wait_forever',
    title: 'Wait forever',
    description: 'Wait: never finishes on its own.',
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run(ctx) {
      started();
      return new Promise<{ status: 'done'; data: null }>((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          reject(new Error('aborted by client'));
        });
      });
    },
    render: () => 'unreachable',
  });
}

/** Writes `value` (or the API token) to the workspace state; registers it as a secret first if asked. */
const storeValue = defineTool({
  name: 'store_value',
  title: 'Store value',
  description: 'State: stores a value in the workspace state.',
  input: z.object({
    value: z.string().optional(),
    secret: z.boolean().default(false),
  }),
  annotations: { readOnlyHint: false },
  async run(ctx, args) {
    const value = args.value ?? ctx.config.token.reveal();
    if (args.secret) ctx.secrets.add(value);
    await ctx.state.set('drafts', 'value', value);
    return {
      status: 'done' as const,
      data: { now: ctx.clock.now(), savedAt: ctx.state.get('drafts', 'value')?.savedAt ?? null },
    };
  },
  render: (data) => `stored at ${String(data.savedAt)}`,
});

describe('registry', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    vi.restoreAllMocks();
  });

  it('success: render text, done envelope and a ↗ line per link', async () => {
    harness = await connect([orders]);
    const result = await harness.client.callTool({
      name: 'list_orders',
      arguments: { shop: 'sklep' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(
      [
        'sklep: 3 orders',
        '↗ https://app.loadcraft.io/projects/sklep/flows/f1',
        '↗ https://app.loadcraft.io/projects/sklep/gatling/scenarios/s1',
      ].join('\n'),
    );
    expect(result.structuredContent).toBeUndefined();
  });

  it('tools/list declares no output schema: a result with structured content would hide the text from the model', async () => {
    harness = await connect([orders, longRunning]);
    const { tools } = await harness.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['list_orders', 'start_import']);
    for (const tool of tools) expect(tool.outputSchema).toBeUndefined();
  });

  it('a link with showLabel prints the translated label before the address', async () => {
    harness = await connect([preview], { LOADCRAFT_LOCALE: 'pl' });
    const result = await harness.client.callTool({ name: 'show_preview', arguments: {} });
    expect(textOf(result)).toBe(
      [
        'preview',
        '↗ podgląd na żywo: https://app.loadcraft.io/projects/sklep/scenario-from-description/runs/r1',
      ].join('\n'),
    );
    expect(result.structuredContent).toBeUndefined();
  });

  it('a secret inside a link address is masked in the text line', async () => {
    harness = await connect([secretLink]);
    const result = await harness.client.callTool({ name: 'secret_link', arguments: {} });
    expect(textOf(result)).not.toContain(CANARY);
    expect(textOf(result)).toContain('↗ https://');
  });

  it('links are translated in the configured locale and built from the configured appUrl', async () => {
    harness = await connect([orders], {
      LOADCRAFT_LOCALE: 'pl',
      LOADCRAFT_URL: 'https://lc.example.com/',
    });
    const result = await harness.client.callTool({
      name: 'list_orders',
      arguments: { shop: 'sklep' },
    });
    expect(textOf(result)).toBe(
      [
        'sklep: 3 orders',
        '↗ https://lc.example.com/projects/sklep/flows/f1',
        '↗ https://lc.example.com/projects/sklep/gatling/scenarios/s1',
      ].join('\n'),
    );
  });

  it('running outcome: the registry draws progress, the handle and the wait step', async () => {
    harness = await connect([longRunning]);
    const result = await harness.client.callTool({ name: 'start_import', arguments: {} });
    expect(result.isError).toBeFalsy();
    const t = createTranslator('en');
    expect(textOf(result)).toBe(
      [
        'Importing (10%)',
        t('operation.running.state', { operation: 'import:1234' }),
        `→ ${t('operation.running.next', { operation: 'import:1234' })}`,
      ].join('\n'),
    );
    expect(textOf(result)).toMatch(/\bprocess_wait\b/);
    // The handle the next call needs is in the text: nothing else carries it to the model.
    expect(textOf(result)).toContain('import:1234');
    expect(result.structuredContent).toBeUndefined();
  });

  it('needs_user outcome: drawn by the registry in the configured language, note included', async () => {
    harness = await connect([waitingForUser], { LOADCRAFT_LOCALE: 'pl' });
    const result = await harness.client.callTool({ name: 'record_journey', arguments: {} });
    expect(result.isError).toBeFalsy();
    const t = createTranslator('pl');
    expect(textOf(result)).toBe(
      [
        'Agent prosi o kod SMS',
        'Okno logowania czeka',
        t('operation.needs_user.state', { operation: 'record_run:r-1' }),
        `→ ${t('operation.needs_user.next', { operation: 'record_run:r-1' })}`,
      ].join('\n'),
    );
    expect(textOf(result)).toContain('record_run:r-1');
    expect(result.structuredContent).toBeUndefined();
  });

  it('wait shows exactly the result and view of the tool that started the operation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loadcraft-registry-'));
    try {
      harness = await connect([startAnalysis, waitTool], { LOADCRAFT_LOCALE: 'pl' }, { root });
      importStep = 'running';
      const started = await harness.client.callTool({
        name: 'start_analysis',
        arguments: { max_wait_s: 0 },
      });
      expect(started.structuredContent).toBeUndefined();
      expect(textOf(started)).toContain('pl: running');
      expect(textOf(started)).toContain('setup_analysis:run-1');

      importStep = 'done';
      const waited = await harness.client.callTool({
        name: 'wait_for',
        arguments: { operation: 'setup_analysis:run-1', max_wait_s: 0 },
      });
      const direct = await harness.client.callTool({
        name: 'start_analysis',
        arguments: { max_wait_s: 0 },
      });
      expect(waited.isError).toBeFalsy();
      expect(textOf(waited)).toBe('[pl] sklep: 3 orders (run-1)');
      expect(textOf(waited)).toBe(textOf(direct));
      expect(waited.structuredContent).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ToolError: isError with the message and an arrow hint line', async () => {
    harness = await connect([failing]);
    const result = await harness.client.callTool({ name: 'check_file', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('[x] x\n→ pass a path inside the project');
  });

  it('every error text starts with its code in brackets, whatever the language', async () => {
    harness = await connect([unauthorizedCall], { LOADCRAFT_LOCALE: 'pl' });
    const result = await harness.client.callTool({ name: 'call_backend', arguments: {} });
    expect(textOf(result)).toMatch(/^\[unauthorized\] /);
    expect(textOf(result).split('\n')[0]).toMatch(/^\[unauthorized\] \S/);
  });

  it('LoadcraftApiError 401: isError with the catalog message and a /loadcraft:doctor hint', async () => {
    harness = await connect([unauthorizedCall]);
    const result = await harness.client.callTool({ name: 'call_backend', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('/loadcraft:doctor');
    expect(textOf(result)).not.toBe('Invalid token.');
  });

  it('LoadcraftApiError is translated into the configured language', async () => {
    harness = await connect([unauthorizedCall], { LOADCRAFT_LOCALE: 'pl' });
    const result = await harness.client.callTool({ name: 'call_backend', arguments: {} });
    expect(textOf(result)).toContain('/loadcraft:doctor');
    expect(textOf(result)).toMatch(/token/i);
    expect(textOf(result)).toMatch(/[ąęłńóśźż]|nie /);
  });

  it('a translated backend message is scrubbed of registered secrets', async () => {
    harness = await connect([leakyBackend]);
    const result = await harness.client.callTool({ name: 'leaky_backend', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[redacted]');
    expect(textOf(result)).not.toContain(CANARY);
  });

  it('the text of a 500 goes to the log of the call, masked, and not to the model', async () => {
    harness = await connect([serverFailure]);
    const result = await harness.client.callTool({ name: 'server_failure', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('db-internal');
    const records = harness.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.msg === 'backend error text');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'warn', status: 500, code: 'server_error' });
    expect(String(records[0]?.text)).toContain('db-internal');
    expect(harness.lines.join('\n')).not.toContain(FILE_SECRET);
  });

  it('unexpected error: generic sentence with event id, stack only in the log', async () => {
    harness = await connect([crashing]);
    const result = await harness.client.callTool({ name: 'crash_now', arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^\[internal_error\] /);
    expect(text).not.toContain('sekret w stosie');
    expect(text).not.toContain(CANARY);
    const event = /event ([0-9a-f]{8})/.exec(text)?.[1];
    expect(event).toBeDefined();
    const record = harness.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((rec) => rec.level === 'error' && rec.event === event);
    expect(record).toBeDefined();
    const logged = JSON.stringify(record);
    expect(logged).toContain('sekret w stosie');
    expect(logged).toContain('registry.test.ts');
    expect(logged).not.toContain(CANARY);
  });

  it('invalid arguments: SDK validation reports the field', async () => {
    harness = await connect([orders]);
    const result = await harness.client.callTool({ name: 'list_orders', arguments: { shop: 42 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('shop');
  });

  it('config problems: isError listing them, pointing to doctor, run not called', async () => {
    const run = vi.fn(() => Promise.resolve({ status: 'done' as const, data: null }));
    const probe = defineTool({
      name: 'probe',
      title: 'Probe',
      description: 'Probe: records calls.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run,
      render: () => 'ran',
    });
    harness = await connect([probe], { LOADCRAFT_API_TOKEN: '', LOADCRAFT_URL: 'ftp://x' });
    const result = await harness.client.callTool({ name: 'probe', arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/^\[plugin_not_configured\] /);
    expect(text).toContain('LOADCRAFT_API_TOKEN');
    expect(text).toContain('LOADCRAFT_URL');
    expect(text).toContain('/loadcraft:doctor');
    expect(run).not.toHaveBeenCalled();
  });

  it('tools/list: sorted by name, each with title and annotations, none with an output schema', async () => {
    harness = await connect([orders, crashing, longRunning, failing]);
    const { tools } = await harness.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'check_file',
      'crash_now',
      'list_orders',
      'start_import',
    ]);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toBeDefined();
      expect(tool.outputSchema).toBeUndefined();
    }
    expect(tools.find((tool) => tool.name === 'list_orders')?.annotations?.readOnlyHint).toBe(true);
  });

  it('cancellation: the abort propagates and is not logged as a failure', async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    harness = await connect([waitingTool(() => markStarted())]);
    const controller = new AbortController();
    const call = harness.client.callTool(
      { name: 'wait_forever', arguments: {} },
      { signal: controller.signal },
    );
    await started;
    controller.abort(new Error('user cancelled'));
    await expect(call).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const errors = harness.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((rec) => rec.level === 'error');
    expect(errors).toEqual([]);
  });

  describe('tool context state and clock', () => {
    let root = '';

    afterEach(() => {
      if (root !== '') rmSync(root, { recursive: true, force: true });
      root = '';
    });

    const stateFile = (): string => join(root, 'loadcraft', '.cache', 'state.json');

    it('ctx.state writes the workspace state file, stamped by the injected ctx.clock', async () => {
      root = mkdtempSync(join(tmpdir(), 'loadcraft-registry-'));
      harness = await connect([storeValue], {}, { root, clock: createTestClock(42_000) });
      const result = await harness.client.callTool({
        name: 'store_value',
        arguments: { value: 'zamowienie-7' },
      });
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toBe('stored at 42000');
      expect(result.structuredContent).toBeUndefined();
      expect(readFileSync(stateFile(), 'utf8')).toContain('zamowienie-7');
    });

    it('ctx.state refuses the API token: the cache is bound to the call secret scope', async () => {
      root = mkdtempSync(join(tmpdir(), 'loadcraft-registry-'));
      harness = await connect([storeValue], {}, { root });
      const result = await harness.client.callTool({ name: 'store_value', arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        '[internal_secret_in_state] A registered secret value cannot be written to the state file.',
      );
      expect(existsSync(stateFile())).toBe(false);
    });

    it('ctx.state is created per call: a secret of one call does not bind the next one', async () => {
      root = mkdtempSync(join(tmpdir(), 'loadcraft-registry-'));
      harness = await connect([storeValue], {}, { root });
      const guarded = await harness.client.callTool({
        name: 'store_value',
        arguments: { value: 'pin-2024', secret: true },
      });
      expect(guarded.isError).toBe(true);
      expect(textOf(guarded)).toBe(
        '[internal_secret_in_state] A registered secret value cannot be written to the state file.',
      );
      expect(existsSync(stateFile())).toBe(false);
      const plain = await harness.client.callTool({
        name: 'store_value',
        arguments: { value: 'pin-2024' },
      });
      expect(plain.isError).toBeFalsy();
      expect(readFileSync(stateFile(), 'utf8')).toContain('pin-2024');
    });
  });

  it('writes nothing to stdout', async () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const consoleLog = vi.spyOn(console, 'log');
    const consoleDebug = vi.spyOn(console, 'debug');
    const consoleInfo = vi.spyOn(console, 'info');
    harness = await connect([orders, failing, crashing]);
    await harness.client.listTools();
    await harness.client.callTool({ name: 'list_orders', arguments: { shop: 'sklep' } });
    await harness.client.callTool({ name: 'check_file', arguments: {} });
    await harness.client.callTool({ name: 'crash_now', arguments: {} });
    await harness.client.callTool({ name: 'list_orders', arguments: {} });
    await harness.close();
    harness = undefined;
    expect(stdout).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleDebug).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
  });
});

describe('server', () => {
  it('advertises name, version and English instructions of at most 2048 characters', async () => {
    const harness = await connect([]);
    try {
      expect(harness.client.getServerVersion()).toMatchObject({
        name: 'loadcraft',
        version: VERSION,
      });
      const instructions = harness.client.getInstructions() ?? '';
      expect(instructions).toBe(INSTRUCTIONS);
      expect(instructions.length).toBeGreaterThan(200);
      // Claude Code cuts server instructions at 4096 characters since v2.1.296, at 2048 before.
      expect(instructions.length).toBeLessThanOrEqual(2048);
    } finally {
      await harness.close();
    }
  });
});
