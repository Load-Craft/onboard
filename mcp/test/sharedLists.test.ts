// Lists outside mcp/ that name every tool the server offers, written from the live registry and the
// catalog instead of by hand, so the tasks of two modules never edit them line by line:
//
// - evals/mocks/lc/_tools.json: the `tools/list` answer of the server, sorted by name;
// - the permission blocks of docs/plugin/INSTALL.md and INSTALL.pl.md, between their markers: today's
//   tools keep their entries as written; a tool of a module goes to both variants when the catalog
//   allows it at install (`install_allow`), to variant B only when it is a write that stays inside
//   LoadCraft, and to the generated sentence of the tools left out otherwise.
//
// `npm run update:shared` writes them; this test fails while one differs.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createServer } from '../src/server.js';
import { EXPOSED_MODULE_TOOLS, MODULE_TOOLS } from '../src/tools/_generated/modules.js';
import { catalogEntry } from './helpers/moduleContract.js';

const UPDATE = process.env['UPDATE_SHARED'] === '1';
const ROOT = resolve(import.meta.dirname, '..', '..');
const EVALS_TOOLS = join(ROOT, 'evals', 'mocks', 'lc', '_tools.json');
const INSTALL = {
  en: join(ROOT, 'docs', 'plugin', 'INSTALL.md'),
  pl: join(ROOT, 'docs', 'plugin', 'INSTALL.pl.md'),
};
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const HOW = 'run npm run update:shared (from mcp/) and commit the files';

async function liveTools(): Promise<unknown[]> {
  const config = loadConfig({ LOADCRAFT_API_TOKEN: 'shared-lists-token' }, '/work/shop');
  const log = createLogger({ level: 'error', sink: () => undefined });
  const server = createServer({ config, log });
  const client = new Client({ name: 'shared-lists', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return JSON.parse(
      JSON.stringify([...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
    ) as unknown[];
  } finally {
    await client.close();
    await server.close();
  }
}

// ---- the permission blocks -----------------------------------------------------------------

type Variant = 'reads' | 'inside';

/** Where a tool of a module goes: both variants, variant B only, or the sentence of the left out. */
function placeOf(name: string): 'both' | 'inside' | 'left_out' {
  const entry = catalogEntry(name)?.entry;
  if (entry === undefined) return 'left_out';
  if (entry.install_allow === true) return 'both';
  return entry.class === 'write' && entry.consent.target_traffic === null ? 'inside' : 'left_out';
}

const MODULE_NAMES = new Set(MODULE_TOOLS.map((tool) => tool.name));
const OFFERED = EXPOSED_MODULE_TOOLS.map((tool) => tool.name).sort();

function block(text: string, variant: Variant): { start: number; end: number; body: string } {
  const begin = new RegExp(`<!-- allow:${variant} begin[^>]*-->\\n`, 'u').exec(text);
  const endAt = text.indexOf(`<!-- allow:${variant} end -->`);
  if (begin === null || endAt === -1) throw new Error(`allow:${variant} markers missing: ${HOW}`);
  const start = begin.index + begin[0].length;
  return { start, end: endAt, body: text.slice(start, endAt) };
}

function entriesOf(body: string): string[] {
  return [...body.matchAll(/"mcp__plugin_loadcraft_lc__([a-z_]+)"/gu)].map(
    (match) => match[1] ?? '',
  );
}

function blockText(names: readonly string[]): string {
  const lines = names.map(
    (name, at) => `      "${PREFIX}${name}"${at < names.length - 1 ? ',' : ''}`,
  );
  return [
    '```json',
    '{',
    '  "permissions": {',
    '    "allow": [',
    ...lines,
    '    ]',
    '  }',
    '}',
    '```',
    '',
  ].join('\n');
}

const LEFT_OUT = {
  en: (names: string) =>
    `Left out as well, as the catalog does not allow them at install: ${names}.`,
  pl: (names: string) =>
    `Pominięte są też, bo katalog nie dopuszcza ich przy instalacji: ${names}.`,
};

/** The text of an install guide with its generated parts written from the registry and the catalog. */
function installText(text: string, language: 'en' | 'pl'): string {
  let out = text;
  for (const variant of ['reads', 'inside'] as const) {
    const { start, end, body } = block(out, variant);
    const today = entriesOf(body).filter((name) => !MODULE_NAMES.has(name));
    const modules = OFFERED.filter((name) =>
      variant === 'reads' ? placeOf(name) === 'both' : placeOf(name) !== 'left_out',
    );
    out = `${out.slice(0, start)}${blockText([...today, ...modules])}${out.slice(end)}`;
  }
  const open = '<!-- left-out begin: npm run update:shared -->';
  const close = '<!-- left-out end -->';
  const from = out.indexOf(open);
  const to = out.indexOf(close);
  if (from === -1 || to === -1) throw new Error(`left-out markers missing: ${HOW}`);
  const left = OFFERED.filter((name) => placeOf(name) === 'left_out');
  const sentence =
    left.length === 0 ? '' : LEFT_OUT[language](left.map((name) => `\`${name}\``).join(', '));
  return `${out.slice(0, from + open.length)}${sentence}${out.slice(to)}`;
}

// ---- the lists -----------------------------------------------------------------------------

const live = await liveTools();
const evalsText = `${JSON.stringify({ tools: live }, null, 2)}\n`;
const install = {
  en: installText(readFileSync(INSTALL.en, 'utf8'), 'en'),
  pl: installText(readFileSync(INSTALL.pl, 'utf8'), 'pl'),
};
if (UPDATE) {
  writeFileSync(EVALS_TOOLS, evalsText);
  writeFileSync(INSTALL.en, install.en);
  writeFileSync(INSTALL.pl, install.pl);
}

describe('shared lists of the offered tools', () => {
  it('evals/mocks/lc/_tools.json is the tools/list of the server', () => {
    expect(readFileSync(EVALS_TOOLS, 'utf8') === evalsText, HOW).toBe(true);
  });

  it.each(['en', 'pl'] as const)(
    'the permission blocks of the %s install guide follow the catalog',
    (language) => {
      expect(readFileSync(INSTALL[language], 'utf8') === install[language], HOW).toBe(true);
    },
  );

  it('a tool of a module the catalog allows at install is in both variants', () => {
    const reads = entriesOf(block(install.en, 'reads').body);
    const inside = entriesOf(block(install.en, 'inside').body);
    for (const name of OFFERED.filter((one) => placeOf(one) === 'both')) {
      expect(reads, name).toContain(name);
      expect(inside, name).toContain(name);
    }
    expect(reads).toContain('project_list_notes');
  });
});
