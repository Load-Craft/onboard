// The contract of a module tool with the catalog, read from catalog/katalog.json on disk (not from
// the generated meta the tool was built from): the module, the description, the MCP annotations,
// the marker of a person's approval, the consent level and card, the log templates, the undo, the
// operations and the arguments the catalog fixes. Used by the test of each tool and by the test of
// every module tool at once (test/genTools/contract.test.ts).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as z from 'zod';
import { expect } from 'vitest';

import type { ModuleTool } from '../../src/tools/moduleTool.js';

export interface RawArgument {
  readonly name: string;
  readonly type: string;
  readonly from_state: string | null;
  readonly required?: boolean;
  readonly default?: unknown;
}

/** The catalog marks required arguments (`required` on at least one): then the others are optional. */
let marksRequired: boolean | undefined;

/**
 * Whether a call must give the argument: its `required`; in a catalog that marks none, when the
 * state gives no default. A default makes it optional either way.
 */
export function isRequired(argument: RawArgument): boolean {
  if (argument.default !== undefined) return false;
  if (argument.required !== undefined) return argument.required;
  marksRequired ??= CATALOG.modules.some((module) =>
    module.tools.some((tool) => (tool.arguments ?? []).some((one) => one.required !== undefined)),
  );
  return marksRequired ? false : argument.from_state === null;
}

export interface RawEntry {
  readonly name: string;
  readonly class: string;
  readonly description: string;
  readonly consent: {
    readonly level: number;
    readonly cost: string | null;
    readonly target_traffic: string | null;
    readonly level3_reason: string | null;
    readonly card: unknown;
    readonly by_argument: unknown;
    readonly escalate_to_3: readonly string[];
  };
  readonly undo: unknown;
  readonly log: { readonly args: string; readonly result: string };
  readonly operations: readonly { readonly operationId: string }[];
  readonly arguments?: readonly RawArgument[] | null;
  readonly requires_user_interaction?: boolean | null;
  readonly install_allow?: boolean | null;
  readonly annotations?: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
  } | null;
}

interface RawCatalog {
  readonly modules: readonly { readonly name: string; readonly tools: readonly RawEntry[] }[];
}

const CATALOG = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', 'catalog', 'katalog.json'), 'utf8'),
) as RawCatalog;

/** The module and the raw catalog entry of a tool name; undefined when the catalog has no such tool. */
export function catalogEntry(name: string): { module: string; entry: RawEntry } | undefined {
  for (const module of CATALOG.modules) {
    const entry = module.tools.find((tool) => tool.name === name);
    if (entry !== undefined) return { module: module.name, entry };
  }
  return undefined;
}

/**
 * The annotations the catalog entry calls for: `readOnlyHint` only for a read of level 1 that costs
 * nothing and sends nothing to the target; `destructiveHint` for a deletion; `openWorldHint` for
 * traffic to the target or an effect outside LoadCraft.
 */
export function expectedAnnotations(entry: RawEntry): Record<string, boolean> {
  const effect = entry.class.split('+')[0];
  const { consent } = entry;
  const openWorld =
    consent.target_traffic !== null || consent.level3_reason === 'external'
      ? { openWorldHint: true }
      : {};
  // a catalog that fixes the hints is the source of them
  if (entry.annotations !== undefined && entry.annotations !== null) {
    return entry.annotations.readOnlyHint
      ? { readOnlyHint: true }
      : { readOnlyHint: false, destructiveHint: entry.annotations.destructiveHint, ...openWorld };
  }
  if (
    effect === 'read' &&
    consent.level === 1 &&
    consent.cost === null &&
    consent.target_traffic === null &&
    consent.level3_reason === null
  ) {
    return { readOnlyHint: true };
  }
  return {
    readOnlyHint: false,
    destructiveHint: effect === 'destructive',
    ...(consent.target_traffic !== null || consent.level3_reason === 'external'
      ? { openWorldHint: true }
      : {}),
  };
}

/**
 * Whether only a person may approve a call: the catalog's yes; a deletion, traffic to the target or
 * an effect outside LoadCraft whatever the catalog says; with no word of the catalog, a cost too.
 */
export function expectedUserInteraction(entry: RawEntry): boolean {
  const { consent } = entry;
  const reachesOut =
    consent.target_traffic !== null ||
    consent.level3_reason === 'traffic' ||
    consent.level3_reason === 'external';
  if (entry.requires_user_interaction === true) return true;
  if (entry.class.split('+')[0] === 'destructive' || reachesOut) return true;
  return entry.requires_user_interaction === null && consent.cost !== null;
}

/** A tool that never asks: level 1, no level by argument, no escalation to level 3. */
export function asksNothing(entry: RawEntry): boolean {
  return (
    entry.consent.level === 1 &&
    entry.consent.by_argument === null &&
    entry.consent.escalate_to_3.length === 0
  );
}

interface JsonSchemaObject {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: unknown;
}

/** The input schema of a tool as a client receives it. */
export function inputSchemaOf(tool: ModuleTool): JsonSchemaObject {
  return z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
}

/**
 * Fails when the tool differs from its catalog entry. `tools/list` fields are compared as the
 * registry hands them to the SDK (`description`, `annotations`, `meta`, the input schema).
 */
export function expectCatalogEntry(tool: ModuleTool): void {
  const found = catalogEntry(tool.name);
  expect(found, `${tool.name} is not in catalog/katalog.json`).toBeDefined();
  if (found === undefined) return;
  const { module, entry } = found;
  expect(tool.module, `${tool.name}: module`).toBe(module);
  expect(tool.description, `${tool.name}: description`).toBe(entry.description);
  expect(tool.annotations, `${tool.name}: annotations`).toEqual(expectedAnnotations(entry));
  expect(
    tool.meta?.['anthropic/requiresUserInteraction'] === true,
    `${tool.name}: anthropic/requiresUserInteraction`,
  ).toBe(expectedUserInteraction(entry));
  expect(tool.catalog.class, `${tool.name}: class`).toBe(entry.class);
  expect(tool.catalog.consent.level, `${tool.name}: consent level`).toBe(entry.consent.level);
  expect(tool.catalog.consent.card, `${tool.name}: card template`).toEqual(entry.consent.card);
  expect(tool.catalog.log, `${tool.name}: log templates`).toEqual(entry.log);
  expect(tool.catalog.undo, `${tool.name}: undo`).toEqual(entry.undo);
  expect(
    tool.catalog.operations.map((operation) => operation.operationId),
    `${tool.name}: operations`,
  ).toEqual(entry.operations.map((operation) => operation.operationId));
  const schema = inputSchemaOf(tool);
  expect(schema.additionalProperties, `${tool.name}: the input is strict`).toBe(false);
  // the names are the catalog's, exactly, and `format`; none named by the catalog: only `format`
  const named = entry.arguments ?? [];
  expect(
    Object.keys(schema.properties ?? {}).sort(),
    `${tool.name}: the arguments of the catalog`,
  ).toEqual([...named.map((argument) => argument.name), 'format'].sort());
  for (const argument of named) {
    expect(
      (schema.required ?? []).includes(argument.name),
      `${tool.name}: ${argument.name} is required exactly when the catalog requires it`,
    ).toBe(isRequired(argument));
  }
}
