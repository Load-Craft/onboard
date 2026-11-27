// A tool that gives the arguments of its undo (`log.undo_args`) for a catalog entry with two ways
// (flows_save: restore the previous version, or delete the flow it created) names the way with
// `undo_tool`; without it the first way is taken, and a name that is no way leaves no undo.

import { describe, expect, it } from 'vitest';

import { buildLogEntry } from '../src/workspace/logEntry.js';

const secrets = { scrub: (text: string): string => text, scrubDeep: <T>(value: T): T => value };

function entry(undoArgs: Record<string, unknown>) {
  return buildLogEntry({
    tool: 'flows_save',
    catalogTool: 'flows_save',
    args: { name: 'checkout' },
    end: { kind: 'done', data: { name: 'checkout', version: 1 } },
    startedAt: Date.parse('2026-11-27T10:00:00Z'),
    ms: 5,
    secrets,
    newId: () => '00000001',
    undoArgs,
  });
}

describe('log entry: the undo way is the one the tool names', () => {
  it('without undo_tool the first way of the entry is taken', () => {
    expect(entry({ flow_id: 'f', version: 2 }).undo).toMatchObject({
      tool: 'flows_restore_version',
      args: { flow_id: 'f', version: 2 },
    });
  });

  it('a named way is taken, and the name is not among the arguments', () => {
    const { undo } = entry({ undo_tool: 'flows_delete', kind: 'flow', ids: ['f'] });
    expect(undo).toMatchObject({ tool: 'flows_delete', args: { kind: 'flow', ids: ['f'] } });
    expect(undo?.args).not.toHaveProperty('undo_tool');
  });

  it('a name that is none of the ways of the entry leaves no undo', () => {
    expect(entry({ undo_tool: 'flows_get', ids: ['f'] }).undo).toBeUndefined();
  });
});
