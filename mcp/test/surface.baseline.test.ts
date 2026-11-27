// Pins the surface of the server as tools/list reports it today: names, titles, descriptions,
// annotations and the whole input schema (parameter names, types, enums, required, parameter
// descriptions) of every tool. The fixtures are the expected list: today's tools in
// `fixtures/surface-baseline.json`, the tools of a module in `fixtures/surface/<module>.json` (so
// that the tasks of two modules never change one file). The test reads the live registry (the same
// server the stdio entry builds, over an in-memory transport) and compares. An unintended change of
// any of these fields fails here. A deliberate change means regenerating the fixtures with
// `npm run update:surface` in the same commit, so the diff shows the new surface for review.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createServer } from '../src/server.js';
import { MODULE_TOOLS } from '../src/tools/_generated/modules.js';

const FIXTURE = resolve(import.meta.dirname, 'fixtures', 'surface-baseline.json');
const MODULE_FIXTURES = resolve(import.meta.dirname, 'fixtures', 'surface');
const MODULE_OF = new Map(MODULE_TOOLS.map((tool) => [tool.name, tool.module]));
const UPDATE = process.env['UPDATE_SURFACE'] === '1';
const HOW_TO_UPDATE =
  'Powierzchnia narzędzi się zmieniła; jeśli zmiana jest zamierzona, uruchom npm run update:surface i zacommituj fixture.';

interface SurfaceTool {
  name: string;
  title: string | undefined;
  description: string | undefined;
  annotations: Record<string, unknown> | undefined;
  inputSchema: unknown;
}

interface Surface {
  tools: SurfaceTool[];
}

async function liveSurface(): Promise<Surface> {
  const config = loadConfig({ LOADCRAFT_API_TOKEN: 'surface-token' }, '/work/sklep');
  const log = createLogger({ level: 'error', sink: () => undefined });
  const server = createServer({ config, log });
  const client = new Client({ name: 'surface-baseline', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const rows: SurfaceTool[] = tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
    }));
    rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Round trip through JSON: the fixture holds exactly what a client receives over the wire.
    return JSON.parse(JSON.stringify({ tools: rows })) as Surface;
  } finally {
    await client.close();
    await server.close();
  }
}

const live = await liveSurface();

/** The live tools split by fixture: `''` for today's tools, the module's name for a module's. */
function byFixture(surface: Surface): Map<string, SurfaceTool[]> {
  const split = new Map<string, SurfaceTool[]>();
  for (const tool of surface.tools) {
    const key = MODULE_OF.get(tool.name) ?? '';
    split.set(key, [...(split.get(key) ?? []), tool]);
  }
  return split;
}

const fixtureFile = (key: string): string =>
  key === '' ? FIXTURE : join(MODULE_FIXTURES, `${key}.json`);

if (UPDATE) {
  if (existsSync(MODULE_FIXTURES)) rmSync(MODULE_FIXTURES, { recursive: true });
  mkdirSync(MODULE_FIXTURES, { recursive: true });
  for (const [key, tools] of byFixture(live)) {
    writeFileSync(fixtureFile(key), `${JSON.stringify({ tools }, null, 2)}\n`);
  }
}

const read = (file: string): SurfaceTool[] =>
  (JSON.parse(readFileSync(file, 'utf8')) as Surface).tools;
const moduleFiles = existsSync(MODULE_FIXTURES)
  ? readdirSync(MODULE_FIXTURES).filter((name) => name.endsWith('.json'))
  : [];
const expected: Surface = {
  tools: [FIXTURE, ...moduleFiles.map((name) => join(MODULE_FIXTURES, name))]
    .flatMap(read)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
};

describe('surface baseline: tools/list of the server', () => {
  it('exposes exactly the tools of the fixtures: the 36 of today and the written ones of the modules', () => {
    expect(live.tools.filter((tool) => !MODULE_OF.has(tool.name))).toHaveLength(36);
    expect(
      live.tools.map((tool) => tool.name),
      HOW_TO_UPDATE,
    ).toEqual(expected.tools.map((tool) => tool.name));
  });

  for (const pinned of expected.tools) {
    it(`${pinned.name}: title, description, annotations and input schema match the fixture`, () => {
      const current = live.tools.find((tool) => tool.name === pinned.name);
      expect(current, HOW_TO_UPDATE).toEqual(pinned);
    });
  }
});
