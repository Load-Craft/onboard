// DOKTOR-07 pkt 1: the entry of a call in the log of the workspace is never lost in silence. A write
// the lock of another process holds up (`state_locked`) or a writer outside the lock spoils
// (`state_conflict`) is tried once more after a short pause; an entry still not saved, or one refused
// for another reason, leaves a line in the result that says so with its code. The call itself
// succeeded and its answer stays.

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import { defineTool, registerTools, type JournalFactory } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { connect, type McpSession } from './helpers/mcp.js';

const TOOL = 'run_start';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A journal whose writes fail with `code` for the first `times` calls, then write for real. */
function failing(
  code: string,
  times: number,
  params?: Readonly<Record<string, string | number>>,
): { journal: JournalFactory; calls: () => number } {
  let calls = 0;
  const journal: JournalFactory = (root, options) => {
    const real = createProcessStore(root, options);
    return {
      ...real,
      applyUpdate: async (...args: Parameters<typeof real.applyUpdate>) => {
        calls += 1;
        if (calls <= times) {
          throw new ToolError(code, {
            message: `${code} in the test`,
            ...(params === undefined ? {} : { params }),
          });
        }
        return real.applyUpdate(...args);
      },
    };
  };
  return { journal, calls: () => calls };
}

async function bench(
  journal: JournalFactory,
  locale: 'en' | 'pl' = 'en',
): Promise<{ session: McpSession; entries: () => string[]; lines: string[] }> {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-log-not-saved-')));
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    {
      LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1',
      LOADCRAFT_API_TOKEN: CANARY,
      LOADCRAFT_LOCALE: locale,
    },
    workspace,
  );
  const services = createServices(config, log);
  const tool = defineTool({
    name: TOOL,
    title: TOOL,
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: () => Promise.resolve({ status: 'done' as const, data: {} }),
    render: () => 'started',
  });
  const session = await connect(() => {
    const server = new McpServer(
      { name: 'loadcraft', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, [tool], {
      config,
      log,
      services,
      clock: createTestClock(Date.parse('2026-11-27T10:00:00Z')),
      journal,
    });
    return server;
  });
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  cleanups.push(() => session.close());
  const entries = (): string[] => {
    try {
      const state = JSON.parse(
        readFileSync(join(workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
      ) as { process: Record<string, { log: { tool: string }[] }> };
      return (state.process[NEW_KEY]?.log ?? []).map((entry) => entry.tool);
    } catch {
      return [];
    }
  };
  return { session, entries, lines };
}

describe('an entry of the log that could not be saved', () => {
  it.each(['state_locked', 'state_conflict'])(
    '%s once: written on the second try, nothing said',
    async (code) => {
      const { journal, calls } = failing(code, 1);
      const b = await bench(journal);
      const result = await b.session.call(TOOL, {});
      expect(result.text).toBe('started');
      expect(calls()).toBe(2);
      expect(b.entries()).toEqual([TOOL]);
    },
  );

  it.each(['state_locked', 'state_conflict'])(
    '%s twice: the result says the entry was not saved, with the code',
    async (code) => {
      const { journal, calls } = failing(code, 2);
      const b = await bench(journal);
      const result = await b.session.call(TOOL, {});
      expect(result.isError).toBe(false);
      expect(result.text.split('\n')[0]).toBe('started');
      expect(result.text).toContain(
        `The call succeeded, but its entry in the log of the workspace was not saved (${code}).`,
      );
      expect(calls()).toBe(2);
      expect(b.entries()).toEqual([]);
    },
  );

  it('another refusal is not tried again and is said the same way, in Polish too', async () => {
    const { journal, calls } = failing('internal_secret_in_state', 9);
    const b = await bench(journal, 'pl');
    const result = await b.session.call(TOOL, {});
    expect(calls()).toBe(1);
    expect(result.text).toContain(
      'Wywołanie się udało, ale jego wpis w dzienniku obszaru roboczego nie został zapisany (internal_secret_in_state).',
    );
  });
});

describe('an entry the schema of the state refused (DOKTOR-12)', () => {
  it.each([
    [
      'en',
      'The call succeeded, but its entry in the log of the workspace was not saved (state_update_invalid; the state schema refused: process._new.log.3.link, process._new.ids.run_id).',
    ],
    [
      'pl',
      'Wywołanie się udało, ale jego wpis w dzienniku obszaru roboczego nie został zapisany (state_update_invalid; schemat stanu odrzucił: process._new.log.3.link, process._new.ids.run_id).',
    ],
  ] as const)('says which fields of the state were refused (%s)', async (locale, sentence) => {
    const { journal } = failing('state_update_invalid', 9, {
      fields: 'process._new.log.3.link, process._new.ids.run_id',
    });
    const b = await bench(journal, locale);
    const result = await b.session.call(TOOL, {});
    expect(result.isError).toBe(false);
    expect(result.text).toContain(sentence);
  });
});

describe('a writer of another build on the same state file', () => {
  const statePath = (workspace: string): string =>
    join(workspace, 'loadcraft', '.cache', 'state.json');

  async function benchAt(): Promise<{
    session: McpSession;
    workspace: string;
    entries: () => string[];
  }> {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-foreign-writer-')));
    const log = createLogger({ level: 'error', sink: () => undefined });
    const config = loadConfig(
      { LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1', LOADCRAFT_API_TOKEN: CANARY },
      workspace,
    );
    const tool = defineTool({
      name: TOOL,
      title: TOOL,
      description: 'stub',
      input: z.strictObject({}),
      annotations: {},
      run: () => Promise.resolve({ status: 'done' as const, data: {} }),
      render: () => 'started',
    });
    const session = await connect(() => {
      const server = new McpServer(
        { name: 'loadcraft', version: '0.0.0' },
        { capabilities: { tools: {} } },
      );
      registerTools(server, [tool], {
        config,
        log,
        services: createServices(config, log),
        clock: createTestClock(Date.parse('2026-11-27T10:00:00Z')),
        journal: createProcessStore,
      });
      return server;
    });
    cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
    cleanups.push(() => session.close());
    const entries = (): string[] => {
      const state = JSON.parse(readFileSync(statePath(workspace), 'utf8')) as {
        process: Record<string, { log: { id: string }[] }>;
      };
      return (state.process[NEW_KEY]?.log ?? []).map((entry) => entry.id);
    };
    return { session, workspace, entries };
  }

  /** What a build from before the stamp does: rewrites the file without the lock, dropping our entry. */
  function oldBuildDrops(workspace: string): string {
    const raw = JSON.parse(readFileSync(statePath(workspace), 'utf8')) as {
      process: Record<string, { log: { id: string }[] }>;
    };
    const process = raw.process[NEW_KEY];
    if (process === undefined) throw new Error('no process');
    const dropped = process.log.pop();
    writeFileSync(statePath(workspace), `${JSON.stringify(raw, null, 2)}\n`);
    return dropped?.id ?? '';
  }

  it('a build without the stamp rewrote the file: the next call says so and puts our entry back', async () => {
    const b = await benchAt();
    await b.session.call(TOOL, {});
    const dropped = oldBuildDrops(b.workspace);
    expect(b.entries()).not.toContain(dropped);
    const second = await b.session.call(TOOL, {});
    expect(second.text).toContain(
      'Another version of the LoadCraft plugin writes the same state file',
    );
    expect(b.entries()).toContain(dropped);
    expect(b.entries()).toHaveLength(2);
  });

  it('a stamp of another build: said, and nothing of ours is lost', async () => {
    const b = await benchAt();
    await b.session.call(TOOL, {});
    const raw = JSON.parse(readFileSync(statePath(b.workspace), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      statePath(b.workspace),
      `${JSON.stringify({ ...raw, writer: { build: '0.0.1+0123456789ab', pid: 1, seq: 7 } }, null, 2)}\n`,
    );
    const second = await b.session.call(TOOL, {});
    expect(second.text).toContain(
      'Another version of the LoadCraft plugin writes the same state file',
    );
    expect(b.entries()).toHaveLength(2);
  });

  it('only this process writes: nothing is said', async () => {
    const b = await benchAt();
    await b.session.call(TOOL, {});
    const second = await b.session.call(TOOL, {});
    expect(second.text).toBe('started');
    const raw = JSON.parse(readFileSync(statePath(b.workspace), 'utf8')) as {
      writer: { build: string; pid: number };
    };
    expect(raw.writer.pid).toBe(process.pid);
    expect(raw.writer.build).toMatch(/\+[0-9a-f]{12}$|\+unknown$/u);
  });
});
