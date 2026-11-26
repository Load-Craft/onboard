// Guard: what a tool declares to the client (MCP annotations and _meta) must not contradict what the
// catalog says about it. A client may run a tool marked readOnlyHint without asking, so a tool that
// costs a model call, writes, deletes or sends traffic to the target app must never carry that hint.
// Reads the catalog and the live tool list of the server; no hand-written list of names.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../src/tools/index.js';
import { toolRig } from './helpers/rig.js';

interface CatalogTool {
  name: string;
  class: string;
  consent: { level: number; level3_reason: string | null; target_traffic: string | null };
}
interface Catalog {
  modules: Array<{ tools: CatalogTool[] }>;
  migration: Array<{ current: string; new: string[] }>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as Catalog;
const byName = new Map(catalog.modules.flatMap((m) => m.tools).map((t) => [t.name, t]));

/** Catalog entries a live tool answers to: itself, or the tools a not yet renamed tool turns into. */
function entriesOf(name: string): CatalogTool[] {
  const own = byName.get(name);
  if (own) return [own];
  const moved = catalog.migration.find((m) => m.current === name)?.new ?? [];
  return moved.flatMap((n) => byName.get(n) ?? []);
}

/** Why the catalog forbids readOnlyHint for a tool, or null when it may be read-only. */
function notReadOnlyBecause(entry: CatalogTool): string | null {
  const bare = entry.class.split('+')[0];
  if (bare !== 'read') return `class ${entry.class}`;
  if (entry.consent.level >= 2) return `consent level ${entry.consent.level}`;
  if (entry.consent.level3_reason) return `level 3 reason ${entry.consent.level3_reason}`;
  if (entry.consent.target_traffic)
    return `traffic to the target (${entry.consent.target_traffic})`;
  return null;
}

async function liveTools() {
  const rig = await toolRig({ tools: ALL_TOOLS, world: () => undefined });
  return rig.session.listTools();
}

describe('tool annotations agree with the catalog', () => {
  it('every live tool is known to the catalog, by name or by migration', async () => {
    const unknown = (await liveTools()).filter((t) => entriesOf(t.name).length === 0);
    expect(unknown.map((t) => t.name)).toEqual([]);
  });

  it('no tool the catalog marks as costly, writing, destructive or sending traffic is readOnlyHint', async () => {
    const offenders: string[] = [];
    for (const tool of await liveTools()) {
      if (tool.annotations?.readOnlyHint !== true) continue;
      for (const entry of entriesOf(tool.name)) {
        const why = notReadOnlyBecause(entry);
        if (why) offenders.push(`${tool.name}: readOnlyHint true, catalog says ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a destructive tool declares destructiveHint and the human-interaction mark', async () => {
    const offenders: string[] = [];
    for (const tool of await liveTools()) {
      const destructive = entriesOf(tool.name).some((e) => e.class.split('+')[0] === 'destructive');
      if (!destructive) continue;
      if (tool.annotations?.destructiveHint !== true)
        offenders.push(`${tool.name}: no destructiveHint`);
      if (tool.meta?.['anthropic/requiresUserInteraction'] !== true) {
        offenders.push(`${tool.name}: no anthropic/requiresUserInteraction`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
