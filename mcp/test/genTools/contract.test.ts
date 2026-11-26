// Every tool of the modules against the catalog, and what the server offers of them. A tool lives in
// the module the catalog puts it in, carries its catalog entry (description, annotations, the marker
// of a person's approval, level, card and log templates, undo, operations, arguments) and has a
// strict input. The live `tools/list` of the server holds the written tools of the modules with the
// catalog's description, annotations and arguments, and none of the tools that are registered but
// not implemented yet: a call of those answers `not_implemented`. The dictionaries of the modules
// keep to their own keys.

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { CURRENT_TO_TOOLS, MODULE_NAMES, TOOL_NAMES } from '../../src/catalog.generated.js';
import { loadConfig } from '../../src/config.js';
import type { ToolContext } from '../../src/context.js';
import { ToolError } from '../../src/errors.js';
import { createLogger } from '../../src/log.js';
import { en } from '../../src/render/i18n/en.js';
import { MODULE_DICTIONARIES } from '../../src/render/i18n/_generated/modules.js';
import { createServer } from '../../src/server.js';
import * as dataMeta from '../../src/tools/data/meta.generated.js';
import * as flowsMeta from '../../src/tools/flows/meta.generated.js';
import * as functionalMeta from '../../src/tools/functional/meta.generated.js';
import * as githubMeta from '../../src/tools/github/meta.generated.js';
import {
  annotationsOf,
  exposedTools,
  moduleTool,
  requiresUserInteraction,
  toolMetaOf,
  type QuietMeta,
  type ToolMeta,
} from '../../src/tools/moduleTool.js';
import * as processMeta from '../../src/tools/process/meta.generated.js';
import { projectListNotes } from '../../src/tools/project/listNotes.js';
import * as projectMeta from '../../src/tools/project/meta.generated.js';
import {
  PROJECT_CREATE,
  PROJECT_LIST,
  PROJECT_LIST_NOTES,
} from '../../src/tools/project/meta.generated.js';
import { RUN_START } from '../../src/tools/run/meta.generated.js';
import * as resultsMeta from '../../src/tools/results/meta.generated.js';
import * as runMeta from '../../src/tools/run/meta.generated.js';
import * as scenarioMeta from '../../src/tools/scenario/meta.generated.js';
import * as trafficMeta from '../../src/tools/traffic/meta.generated.js';
import { CallSecretScope } from '../../src/workspace/secrets.js';
import {
  EXPOSED_MODULE_TOOLS,
  MODULE_INDEX,
  MODULE_TOOLS,
} from '../../src/tools/_generated/modules.js';
import { ALL_TOOLS, LEGACY_TOOLS } from '../../src/tools/index.js';
import {
  asksNothing,
  catalogEntry,
  expectCatalogEntry,
  expectedAnnotations,
  expectedUserInteraction,
} from '../helpers/moduleContract.js';

/** The generated entry of every tool of the catalog, of every module. */
const MODULE_META: readonly Readonly<Record<string, ToolMeta>>[] = [
  processMeta,
  projectMeta,
  flowsMeta,
  scenarioMeta,
  dataMeta,
  runMeta,
  resultsMeta,
  trafficMeta,
  functionalMeta,
  githubMeta,
];
const ALL_META: readonly ToolMeta[] = MODULE_META.flatMap((module) => Object.values(module));

interface ListedTool {
  readonly name: string;
  readonly description?: string;
  readonly annotations?: Record<string, unknown>;
  readonly inputSchema: {
    readonly properties?: Record<string, unknown>;
    readonly required?: string[];
  };
  readonly _meta?: Record<string, unknown>;
}

async function listed(): Promise<ListedTool[]> {
  const config = loadConfig({ LOADCRAFT_API_TOKEN: 'contract-token' }, '/work/shop');
  const log = createLogger({ level: 'error', sink: () => undefined });
  const server = createServer({ config, log });
  const client = new Client({ name: 'module-contract', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return JSON.parse(JSON.stringify((await client.listTools()).tools)) as ListedTool[];
  } finally {
    await client.close();
    await server.close();
  }
}

describe('module tools: the catalog', () => {
  it('every tool of the catalog has its generated entry', () => {
    expect(ALL_META.map((meta) => meta.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('every module of the catalog has its list of tools', () => {
    expect(Object.keys(MODULE_INDEX).sort()).toEqual([...MODULE_NAMES].sort());
  });

  it('a tool is listed by the module the catalog puts it in, once', () => {
    for (const [module, tools] of Object.entries(MODULE_INDEX)) {
      for (const tool of tools) expect(catalogEntry(tool.name)?.module, tool.name).toBe(module);
    }
    const names = MODULE_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(MODULE_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s carries its catalog entry',
    (_name, tool) => {
      expectCatalogEntry(tool);
    },
  );

  it('no tool of a module shadows a tool of today', () => {
    const today = new Set(LEGACY_TOOLS.map((tool) => tool.name));
    expect(MODULE_TOOLS.filter((tool) => today.has(tool.name)).map((tool) => tool.name)).toEqual(
      [],
    );
  });
});

describe('module tools: registered, implemented or not', () => {
  // A scaffold as `gen:tools --scaffold` writes it: a title and an input, no run and no render.
  const scaffold = moduleTool(PROJECT_LIST, { title: 'List projects', input: {} });

  it('the server offers the written tools of the modules and none of the others', () => {
    const offered = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const tool of MODULE_TOOLS) {
      expect(offered.has(tool.name), tool.name).toBe(tool.implemented);
    }
    expect(scaffold.implemented).toBe(false);
    expect(exposedTools([scaffold, projectListNotes]).map((tool) => tool.name)).toEqual([
      'project_list_notes',
    ]);
    expect(EXPOSED_MODULE_TOOLS).toEqual(exposedTools(MODULE_TOOLS));
  });

  it('a tool not implemented yet answers not_implemented, before it reads anything', async () => {
    const pending = [scaffold, ...MODULE_TOOLS.filter((tool) => !tool.implemented)];
    for (const tool of pending) {
      // the handler refuses before it reads anything of the call but its secret scope
      const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
      const call = tool.invoke({ secrets } as unknown as ToolContext, {});
      await expect(call, tool.name).rejects.toBeInstanceOf(ToolError);
      await expect(call, tool.name).rejects.toMatchObject({ code: 'not_implemented' });
    }
  });

  it.each(ALL_META.map((meta) => [meta.name, meta] as const))(
    '%s: the generated entry gives the annotations and the marker the catalog calls for',
    (name, meta) => {
      const found = catalogEntry(name);
      expect(found?.module).toBe(meta.module);
      if (found === undefined) return;
      expect(annotationsOf(meta)).toEqual(expectedAnnotations(found.entry));
      expect(toolMetaOf(meta)?.['anthropic/requiresUserInteraction'] === true).toBe(
        expectedUserInteraction(found.entry),
      );
      expect(meta.description).toBe(found.entry.description);
    },
  );

  it('the live tools/list matches the catalog for every written tool of a module', async () => {
    const tools = await listed();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const tool of MODULE_TOOLS) {
      const wire = byName.get(tool.name);
      if (!tool.implemented) {
        expect(wire, `${tool.name} is not implemented and must not be offered`).toBeUndefined();
        continue;
      }
      const found = catalogEntry(tool.name);
      expect(wire, tool.name).toBeDefined();
      expect(found, tool.name).toBeDefined();
      if (wire === undefined || found === undefined) continue;
      const { entry } = found;
      expect(wire.description, tool.name).toBe(entry.description);
      expect(wire.annotations, tool.name).toEqual(expectedAnnotations(entry));
      expect(wire._meta?.['anthropic/requiresUserInteraction'] === true, tool.name).toBe(
        expectedUserInteraction(entry),
      );
      expect(Object.keys(wire.inputSchema.properties ?? {}).sort(), tool.name).toEqual(
        [...(entry.arguments ?? []).map((argument) => argument.name), 'format'].sort(),
      );
    }
  });
});

describe('module tools: fail-closed on consent', () => {
  it('no tool of a module the server offers would need a consent card', () => {
    for (const tool of EXPOSED_MODULE_TOOLS) {
      const found = catalogEntry(tool.name);
      expect(found !== undefined && asksNothing(found.entry), `${tool.name} asks`).toBe(true);
    }
  });

  it('a tool that asks stays a scaffold, even when a cast gives it run', async () => {
    const spec = {
      title: 'Create a project',
      input: {},
      run: () => Promise.resolve({ status: 'done' as const, data: { written: true } }),
      render: () => 'written',
    };
    // @ts-expect-error a tool of level 2 takes no run: this layer has no consent card for it yet
    const typed = moduleTool(PROJECT_CREATE, spec);
    const cast = moduleTool(PROJECT_CREATE as unknown as QuietMeta, spec);
    for (const tool of [typed, cast]) {
      expect(tool.implemented).toBe(false);
      expect(exposedTools([tool])).toEqual([]);
      const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
      await expect(tool.invoke({ secrets } as unknown as ToolContext, {})).rejects.toMatchObject({
        code: 'not_implemented',
      });
    }
  });
});

describe('module tools: today’s tools', () => {
  const today = new Set(LEGACY_TOOLS.map((tool) => tool.name));
  const ways = CURRENT_TO_TOOLS as Readonly<Record<string, readonly string[]>>;

  it('no offered tool of a module takes over a tool of today that is still registered', () => {
    const taken = Object.entries(ways).filter(([current]) => today.has(current));
    for (const tool of EXPOSED_MODULE_TOOLS) {
      const over = taken.filter(
        ([current, next]) => current !== tool.name && next.includes(tool.name),
      );
      expect(
        over.map(([current]) => current),
        tool.name,
      ).toEqual([]);
    }
  });

  it('the tool that takes over one of today keeps its marker of a person’s approval', () => {
    const byName = new Map(ALL_META.map((meta) => [meta.name as string, meta]));
    const marked = LEGACY_TOOLS.filter(
      (tool) => tool.meta?.['anthropic/requiresUserInteraction'] === true,
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const tool of marked) {
      const main = (ways[tool.name] ?? [tool.name])[0] ?? tool.name;
      const meta = byName.get(main);
      expect(meta, `${tool.name} -> ${main}`).toBeDefined();
      if (meta === undefined) continue;
      expect(requiresUserInteraction(meta), `${tool.name} -> ${main}`).toBe(true);
    }
    expect(requiresUserInteraction(RUN_START)).toBe(true);
  });
});

describe('module tools: annotations and the marker by case', () => {
  // Each row: what the catalog says, what the client is told. Written out, not computed.
  // the hints follow the class here; the row of the catalog's own hints sets them
  const base: ToolMeta = { ...PROJECT_LIST_NOTES, annotations: null };
  const consent = PROJECT_LIST_NOTES.consent;
  const cases: readonly [string, ToolMeta, Record<string, boolean>, boolean][] = [
    ['a read of level 1', base, { readOnlyHint: true }, false],
    [
      'a costly read',
      { ...base, class: 'costly', consent: { ...consent, level: 2, cost: 'LLM' } },
      { readOnlyHint: false, destructiveHint: false },
      false,
    ],
    [
      'a write of level 1',
      { ...base, class: 'write' },
      { readOnlyHint: false, destructiveHint: false },
      false,
    ],
    [
      'a deletion',
      { ...base, class: 'destructive', consent: { ...consent, level: 3, level3_reason: 'delete' } },
      { readOnlyHint: false, destructiveHint: true },
      true,
    ],
    [
      'traffic to the target, the catalog saying no',
      {
        ...base,
        class: 'write',
        requires_user_interaction: false,
        consent: { ...consent, level: 3, level3_reason: 'traffic', target_traffic: 'run' },
      },
      { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      true,
    ],
    [
      'a cost, the catalog silent',
      {
        ...base,
        class: 'costly',
        requires_user_interaction: null,
        consent: { ...consent, level: 2, cost: 'LLM' },
      },
      { readOnlyHint: false, destructiveHint: false },
      true,
    ],
    [
      'the hints of the catalog over the class (a read that writes a local file)',
      {
        ...base,
        annotations: { readOnlyHint: false, destructiveHint: false, override_reason: 'local file' },
      },
      { readOnlyHint: false, destructiveHint: false },
      false,
    ],
    [
      'the catalog saying yes',
      { ...base, requires_user_interaction: true },
      { readOnlyHint: true },
      true,
    ],
  ];

  it.each(cases)('%s', (_label, meta, annotations, marker) => {
    expect(annotationsOf(meta)).toEqual(annotations);
    expect(requiresUserInteraction(meta)).toBe(marker);
  });
});

describe('module tools: the dictionaries', () => {
  it('a key of a module starts with a tool of the module, the module or error.<module>_, and is nobody else’s', () => {
    const base = new Set(Object.keys(en));
    const seen = new Map<string, string>();
    for (const [module, parts] of Object.entries(MODULE_DICTIONARIES)) {
      const own = new Set(
        (MODULE_INDEX[module as keyof typeof MODULE_INDEX] ?? []).map((t) => t.name),
      );
      expect(Object.keys(parts.pl).sort(), module).toEqual(Object.keys(parts.en).sort());
      for (const key of Object.keys(parts.en)) {
        const prefix = key.split('.')[0] ?? '';
        // the text of an error code of the module: `error.<module>_<what>.message` / `.hint`
        const ownError = new RegExp(`^error\\.${module}_[a-z0-9_]+\\.`, 'u').test(key);
        expect(prefix === module || own.has(prefix) || ownError, `${module}: ${key}`).toBe(true);
        expect(base.has(key), `${module}: ${key} is a key of en.ts`).toBe(false);
        expect(seen.get(key), `${key} in ${module} and ${seen.get(key) ?? ''}`).toBeUndefined();
        seen.set(key, module);
      }
    }
  });
});
