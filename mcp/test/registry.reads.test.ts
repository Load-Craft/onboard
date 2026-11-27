// The log must survive being polled: a call made by the mod (`from_panel`) or asking for `format=data`
// writes nothing and does not move `rev`; a plain read goes to the ring `reads`, and the 300 places of
// `log` stay for writes. The server turns the log on and migrates an older file on its first entry.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import { defineTool, type Tool } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { LIMITS, NEW_KEY, State } from '../src/workspace/processState.js';
import { createTestClock } from './helpers/clock.js';
import { connect } from './helpers/mcp.js';

vi.setConfig({ testTimeout: 60_000 });

const START = Date.parse('2026-11-26T10:00:00Z');

const input = z.strictObject({
  from_panel: z.boolean().optional(),
  format: z.enum(['text', 'data']).optional(),
  n: z.number().optional(),
});

/** A read of today's tools (`process_get_status`) and a write (`project_save_env`), standing in for the real ones. */
const READ = defineTool({
  name: 'process_get_status',
  title: 'Status',
  description: 'read',
  input,
  annotations: { readOnlyHint: true },
  run: () => Promise.resolve({ status: 'done' as const, data: { ok: true } }),
  render: () => 'ok',
});
const WRITE = defineTool({
  name: 'project_save_env',
  title: 'Init',
  description: 'write',
  input,
  annotations: {},
  run: () => Promise.resolve({ status: 'done' as const, data: { ok: true } }),
  render: () => 'ok',
});

const CANCEL = defineTool({
  name: 'process_cancel',
  title: 'Cancel',
  description: 'stop',
  input,
  annotations: {},
  run: () => Promise.resolve({ status: 'done' as const, data: { ok: true } }),
  render: () => 'ok',
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Entry {
  id: string;
  tool: string;
  origin: string;
}
interface ProcessFile {
  rev: number;
  log: Entry[];
  reads: Entry[];
  reads_total: number;
}

/** The real server (`createServer`), with the log it turns on itself, over stub tools. */
async function bench(tools: readonly Tool[] = [READ, WRITE]) {
  const clock = createTestClock(START);
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-registry-reads-')));
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    { LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1', LOADCRAFT_API_TOKEN: 'tok-registry-reads' },
    workspace,
  );
  const services = createServices(config, log);
  const session = await connect({ config, log, tools, services, clock });
  cleanups.push(async () => {
    await session.close();
    rmSync(workspace, { recursive: true, force: true });
  });
  const statePath = join(workspace, 'loadcraft', '.cache', 'state.json');
  return {
    session,
    workspace,
    statePath,
    lines,
    text: () => readFileSync(statePath, 'utf8'),
    process(): ProcessFile {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
        process: Record<string, ProcessFile>;
      };
      const process = parsed.process[NEW_KEY];
      if (process === undefined) throw new Error('no process');
      return process;
    },
  };
}

describe('the mod polls', () => {
  it('100 reads from the mod change neither rev nor the log, nor a byte of the file', async () => {
    const b = await bench();
    await b.session.call('project_save_env', {});
    const before = b.text();
    const rev = b.process().rev;
    for (let i = 0; i < 100; i += 1) {
      const result = await b.session.call('process_get_status', { from_panel: true, n: i });
      expect(result.isError).toBe(false);
    }
    expect(b.text()).toBe(before);
    expect(b.process().rev).toBe(rev);
    expect(b.process().log).toHaveLength(1);
    expect(b.process().reads).toHaveLength(0);
  });

  it('a mod read in a workspace without a state file does not create one', async () => {
    const b = await bench();
    await b.session.call('process_get_status', { from_panel: true });
    expect(existsSync(b.statePath)).toBe(false);
  });

  it('a read with format=data leaves no entry and no write', async () => {
    const b = await bench();
    await b.session.call('project_save_env', {});
    const before = b.text();
    for (let i = 0; i < 20; i += 1) await b.session.call('process_get_status', { format: 'data' });
    expect(b.text()).toBe(before);
  });
});

describe('the panel arguments of the real tools', () => {
  it.each(['process_get_status', 'process_cancel'])('%s accepts from_panel, a boolean', (name) => {
    const tool = ALL_TOOLS.find((one) => one.name === name);
    expect(tool?.input.safeParse({ from_panel: true }).success).toBe(true);
    expect(tool?.input.safeParse({ from_panel: 'yes' }).success).toBe(false);
  });

  it('a cancel from the panel is logged with origin panel; one from the model with origin model', async () => {
    const b = await bench([READ, WRITE, CANCEL]);
    await b.session.call('process_cancel', { from_panel: true });
    await b.session.call('process_cancel', {});
    expect(b.process().log.map((entry) => [entry.tool, entry.origin])).toEqual([
      ['process_cancel', 'panel'],
      ['process_cancel', 'model'],
    ]);
  });
});

describe('from_panel is honoured only where the tool declares it', () => {
  it('a model that sends it to a tool without the field is logged as the model, its read in reads', async () => {
    const loose = defineTool({
      name: 'process_get_status',
      title: 'Status',
      description: 'read',
      input: z.looseObject({}),
      annotations: { readOnlyHint: true },
      run: () => Promise.resolve({ status: 'done' as const, data: { ok: true } }),
      render: () => 'ok',
    });
    const b = await bench([loose, WRITE]);
    await b.session.call('project_save_env', {});
    await b.session.call('process_get_status', { from_panel: true });
    const process = b.process();
    expect(process.reads.map((entry) => [entry.tool, entry.origin])).toEqual([
      ['process_get_status', 'model'],
    ]);
  });

  it('a read with format=data that fails leaves its error in log', async () => {
    const failing = defineTool({
      name: 'process_get_status',
      title: 'Status',
      description: 'read',
      input,
      annotations: { readOnlyHint: true },
      run: () => Promise.reject(new ToolError('no_project')),
      render: () => 'ok',
    });
    const b = await bench([failing]);
    const result = await b.session.call('process_get_status', { format: 'data' });
    expect(result.isError).toBe(true);
    expect(b.process().log.map((entry) => entry.tool)).toEqual(['process_get_status']);
  });
});

describe('a plain read', () => {
  it('goes to reads, counts in reads_total and keeps rev moving once per write of the file', async () => {
    const b = await bench();
    await b.session.call('project_save_env', {});
    const rev = b.process().rev;
    for (let i = 0; i < 3; i += 1) await b.session.call('process_get_status', { n: i });
    const process = b.process();
    expect(process.log.map((entry) => entry.tool)).toEqual(['project_save_env']);
    expect(process.reads).toHaveLength(3);
    expect(process.reads_total).toBe(3);
    expect(process.reads.every((entry) => entry.origin === 'model')).toBe(true);
    expect(process.rev).toBe(rev + 3);
  });

  it('the first write of a new process is rev 1', async () => {
    const b = await bench();
    await b.session.call('project_save_env', {});
    expect(b.process().rev).toBe(1);
  });
});

describe('pruning', () => {
  it('the 301st write drops the oldest entry, the file stays valid, reads do not push writes out', async () => {
    const b = await bench();
    for (let i = 0; i < LIMITS.log + 1; i += 1) {
      await b.session.call('project_save_env', { n: i });
      if (i % 3 === 0) await b.session.call('process_get_status', { n: i });
    }
    const process = b.process();
    expect(process.log).toHaveLength(LIMITS.log);
    expect(process.log.every((entry) => entry.tool === 'project_save_env')).toBe(true);
    expect(process.reads).toHaveLength(LIMITS.reads);
    expect(process.reads_total).toBe(Math.floor(LIMITS.log / 3) + 1);
    const parsed = State.safeParse(JSON.parse(b.text()));
    expect(parsed.success).toBe(true);
  });
});

describe('the server turns the log on', () => {
  it('a file in schema 1 becomes schema 3 on the first call, with the entry and the handles kept', async () => {
    const b = await bench();
    const cache = join(b.workspace, 'loadcraft', '.cache');
    mkdirSync(cache, { recursive: true });
    const fixture = new URL('./fixtures/state/schema1-operation-in-flight.json', import.meta.url);
    cpSync(fixture, b.statePath);
    const legacy = JSON.parse(readFileSync(b.statePath, 'utf8')) as { operations: object };
    const handles = Object.keys(legacy.operations).filter((key) => key.startsWith('test_run:'));
    expect(handles.length).toBeGreaterThan(0);

    const result = await b.session.call('project_save_env', {});
    expect(result.isError).toBe(false);

    const written = JSON.parse(b.text()) as { schema: number };
    expect(written.schema).toBe(3);
    expect(State.safeParse(written).success).toBe(true);
    const state = State.parse(written);
    expect(state.process[NEW_KEY]?.log.map((entry) => entry.tool)).toEqual(['project_save_env']);
    expect(state.process[NEW_KEY]?.operations.map((row) => row.handle)).toEqual(handles);
    expect(b.lines.join('\n')).not.toContain('log entry not saved');
  });
});
