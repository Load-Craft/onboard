// The closure of a module against the catalog: every tool of the module is registered and written, or
// named in a list of debts with its reason; no tool the catalog lacks is registered; and every
// operation of the module is called by the tests of its tools, or named in a list of operations left
// unused with its reason. The lists are the tests' own, explicit and checked both ways: a debt for a
// tool that is written, or for one the catalog lacks, fails the test, so a list cannot go stale.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect } from 'vitest';

import { MODULE_INDEX } from '../../src/tools/_generated/modules.js';
import { LEGACY_TOOLS } from '../../src/tools/index.js';
import type { ModuleName } from '../../src/catalog.generated.js';
import { expectCatalogEntry, type RawEntry } from './moduleContract.js';

interface Operation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

interface ToolEntry extends RawEntry {
  readonly operations: readonly Operation[];
  /** Operations the tool reads beside its own (`also_calls` of the catalog): the tests may call them. */
  readonly also_calls?: readonly string[];
}

const CATALOG = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', 'catalog', 'katalog.json'), 'utf8'),
) as { modules: { name: string; tools: ToolEntry[] }[] };

/**
 * Why a tool of the catalog is not a written tool of its module (yet): it asks with a card, it costs,
 * it is deferred, or it is still one of today's tools (`legacy`: registered under the catalog's name
 * outside the module, until its move into the module).
 */
export type DebtReason = 'consent_card' | 'costly' | 'deferred' | 'legacy';

export type ToolDebts = Readonly<Record<string, DebtReason>>;

/** Why an operation of a written tool is not called by any test. */
export type UnusedOperations = Readonly<Record<string, string>>;

export function moduleEntries(module: string): readonly ToolEntry[] {
  return CATALOG.modules.find((entry) => entry.name === module)?.tools ?? [];
}

/**
 * The tools of the module the registry holds, one for one with the catalog: each written tool carries
 * its catalog entry; each tool not written is a debt, and a debt of `consent_card` or `costly` agrees
 * with the catalog (a card, a level above 1, or a cost).
 */
export function expectModuleContract(module: ModuleName, debts: ToolDebts): void {
  const entries = moduleEntries(module);
  const names = entries.map((entry) => entry.name);
  const registered = MODULE_INDEX[module];

  expect(
    registered.map((tool) => tool.name).filter((name) => !names.includes(name)),
    `tools of module ${module} the catalog does not have`,
  ).toEqual([]);
  expect(
    registered.filter((tool) => !tool.implemented).map((tool) => tool.name),
    `tools of module ${module} registered but not written`,
  ).toEqual([]);
  for (const tool of registered) expectCatalogEntry(tool);

  const written = new Set(registered.map((tool) => tool.name));
  expect(
    names.filter((name) => !written.has(name) && debts[name] === undefined),
    `tools of module ${module} neither written nor named as a debt`,
  ).toEqual([]);
  expect(
    Object.keys(debts).filter((name) => written.has(name) || !names.includes(name)),
    `debts of module ${module} that are written or are not in the catalog`,
  ).toEqual([]);
  for (const [name, reason] of Object.entries(debts)) {
    const entry = entries.find((item) => item.name === name);
    if (entry === undefined) continue;
    if (reason === 'consent_card') {
      expect(
        entry.consent.card !== null || entry.consent.level > 1,
        `${name}: a card or a level above 1`,
      ).toBe(true);
    } else if (reason === 'costly') {
      expect(
        entry.class.startsWith('costly') || entry.consent.cost !== null,
        `${name}: a cost`,
      ).toBe(true);
    } else if (reason === 'legacy') {
      expect(
        LEGACY_TOOLS.some((tool) => tool.name === name),
        `${name}: a legacy tool is registered under its catalog name`,
      ).toBe(true);
    } else {
      expect(entry.consent.level, `${name}: a deferred tool is of level 1`).toBe(1);
    }
  }
}

const escape = (text: string): string => text.replace(/[.*+?^$()|[\]\\]/gu, '\\$&');

/** The catalog operation of a request (method and path as the server saw them), the most literal match. */
export function operationOf(module: string, method: string, path: string): string | undefined {
  const matches = moduleEntries(module)
    .flatMap((entry) => entry.operations)
    .filter((operation) => operation.method === method)
    .filter((operation) =>
      new RegExp(
        `^${operation.path
          .split(/\{[^}]+\}/u)
          .map(escape)
          .join('[^/]+')}$`,
        'u',
      ).test(path),
    );
  const literal = (operation: Operation): number =>
    operation.path.split('/').filter((part) => part !== '' && !part.startsWith('{')).length;
  return [...matches].sort((a, b) => literal(b) - literal(a))[0]?.operationId;
}

/**
 * The operations the tests called (`called`: operation ids) equal the operations of the written tools
 * of the module, but those named in `unused`, and the reads a tool lists in `also_calls` (allowed, not
 * required); the operations of the tools not written are never called.
 */
export function expectModuleCoverage(
  module: ModuleName,
  called: ReadonlySet<string>,
  debts: ToolDebts,
  unused: UnusedOperations = {},
): void {
  const entries = moduleEntries(module);
  const written = entries.filter((entry) => debts[entry.name] === undefined);
  const own = (entry: ToolEntry): string[] => entry.operations.map((op) => op.operationId);
  const expected = new Set(written.flatMap(own).filter((id) => unused[id] === undefined));
  const owned = new Set(written.flatMap(own));
  // reads a tool makes beside its own operations (`also_calls`) may be called, none is required
  const allowed = new Set([...expected, ...written.flatMap((entry) => entry.also_calls ?? [])]);
  expect(
    Object.keys(unused).filter((id) => !owned.has(id)),
    'operations named unused that no written tool of the module has',
  ).toEqual([]);
  expect(
    [...expected].filter((id) => !called.has(id)).sort(),
    `operations of module ${module} no test calls`,
  ).toEqual([]);
  expect(
    [...called].filter((id) => !allowed.has(id)).sort(),
    `operations called that are not operations of a written tool of module ${module}`,
  ).toEqual([]);
}
