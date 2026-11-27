// Guard (DOKTOR-09): a write, a cost or a deletion asked for with `format=data` keeps its log entry,
// its undo and its detail, for every such tool of the catalog. Only a successful read with
// `format=data` is left out of the log (the mod polls with it); an undo that lives nowhere is lost.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LOG_META, type ToolName } from '../src/catalog.generated.js';
import { createLogger } from '../src/log.js';
import { storesDetail } from '../src/workspace/logDetails.js';
import { buildLogEntry, effectOf } from '../src/workspace/logEntry.js';
import { NEW_KEY, recordCall, type Process } from '../src/workspace/processState.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-format-data-')));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));

/** An empty process, as the store makes it. */
async function emptyProcess(): Promise<Process> {
  const store = createProcessStore(dir, { secrets, clock: { now: () => NOW } });
  let seen: Process | undefined;
  await store.applyUpdate(
    NEW_KEY,
    {},
    {
      tool: 'process_get_status',
      then: (p) => {
        seen = p;
        return p;
      },
    },
  );
  if (seen === undefined) throw new Error('the store gave no process');
  return seen;
}

const tools = Object.keys(LOG_META) as ToolName[];
const changing = tools.filter((tool) => effectOf(LOG_META[tool]) !== 'read');
const reads = tools.filter((tool) => effectOf(LOG_META[tool]) === 'read');

const entryOf = (tool: ToolName) =>
  buildLogEntry({
    tool,
    catalogTool: tool,
    args: { format: 'data' },
    end: { kind: 'done', data: {} },
    startedAt: NOW,
    ms: 1,
    secrets,
    ...(LOG_META[tool].undo.length > 0 ? { undoArgs: { previous: 'value' } } : {}),
  });

describe('format=data in the log', () => {
  it('the catalog has writes and reads to check', () => {
    expect(changing.length).toBeGreaterThan(20);
    expect(reads.length).toBeGreaterThan(20);
  });

  it('every write, cost and deletion keeps its entry, its undo and its detail', async () => {
    const empty = await emptyProcess();
    const lost = changing.filter((tool) => {
      const entry = { ...entryOf(tool), has_detail: true };
      const logged = recordCall(empty, { entry, format: 'data' }, new Date(NOW).toISOString());
      const kept = logged.log.find((one) => one.id === entry.id);
      const undoKept = LOG_META[tool].undo.length === 0 || kept?.undo !== undefined;
      return kept === undefined || !undoKept || !storesDetail(entry, 'data');
    });
    expect(lost).toEqual([]);
  });

  it('a successful read with format=data leaves no entry and no detail', async () => {
    const empty = await emptyProcess();
    const kept = reads.filter((tool) => {
      const entry = entryOf(tool);
      const logged = recordCall(empty, { entry, format: 'data' }, new Date(NOW).toISOString());
      return logged !== empty || storesDetail(entry, 'data');
    });
    expect(kept).toEqual([]);
  });
});
