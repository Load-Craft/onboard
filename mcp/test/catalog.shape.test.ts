import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, '..', 'catalog');
const catalogPath = join(catalogDir, 'katalog.json');
const statePath = join(catalogDir, 'stan-procesu.ts');
const shaPath = join(catalogDir, 'stan-procesu.sha256');

interface CatalogTool {
  name: string;
  full_name: string;
  description: string;
  class: string;
  tier: string;
  operations: Array<{ operationId: string }>;
  consent: { level: number; card: unknown; resolve: unknown[] };
  undo: unknown;
}

interface Catalog {
  server: { prefix: string; max_full_name: number };
  numbers: {
    operations_total: number;
    channels_total: number;
    tools_total: number;
    tools_default_mode: number;
  };
  excluded: {
    operations: Array<{ operationId: string }>;
    channels: Array<{ channel: string }>;
  };
  modules: Array<{ name: string; tools: CatalogTool[] }>;
}

const catalogText = readFileSync(catalogPath, 'utf8');
const catalog = JSON.parse(catalogText) as Catalog;
const tools = catalog.modules.flatMap((m) => m.tools);
const NAME_PATTERN = /^[a-z]+(_[a-z]+)+$/;
const FORBIDDEN_KEYS = new Set(['note', 'evidence', 'replaces_current']);

function forbiddenKeysIn(value: unknown, path: string, found: string[]): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => forbiddenKeysIn(item, `${path}[${i}]`, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
      forbiddenKeysIn(child, `${path}.${key}`, found);
    }
  }
  return found;
}

describe('katalog narzędzi: pliki eksportu', () => {
  it('zawiera katalog.json, stan-procesu.ts i stan-procesu.sha256', () => {
    expect(catalogText.length).toBeGreaterThan(0);
    expect(readFileSync(statePath, 'utf8').length).toBeGreaterThan(0);
    expect(readFileSync(shaPath, 'utf8').trim().length).toBeGreaterThan(0);
  });

  it('odcisk stan-procesu.sha256 zgadza się z treścią stan-procesu.ts', () => {
    const line = readFileSync(shaPath, 'utf8').trim();
    const match = /^([0-9a-f]{64})\s+stan-procesu\.ts$/.exec(line);
    expect(match).not.toBeNull();
    const actual = createHash('sha256').update(readFileSync(statePath)).digest('hex');
    expect(match?.[1]).toBe(actual);
  });

  it('nie zawiera kluczy note, evidence ani replaces_current na żadnym poziomie', () => {
    expect(forbiddenKeysIn(catalog, '$', [])).toEqual([]);
  });
});

describe('katalog narzędzi: kształt i liczby', () => {
  it('liczba narzędzi i trybu domyślnego zgadza się z numbers', () => {
    expect(tools).toHaveLength(catalog.numbers.tools_total);
    expect(tools.filter((t) => t.tier !== 'extended')).toHaveLength(
      catalog.numbers.tools_default_mode,
    );
  });

  it('sekcja excluded: operacje i kanały pokrywają całość', () => {
    expect(catalog.excluded.operations.length).toBeGreaterThan(0);
    expect(catalog.excluded.channels.length).toBeGreaterThan(0);
    const toolOperationIds = new Set(tools.flatMap((t) => t.operations.map((o) => o.operationId)));
    expect(toolOperationIds.size + catalog.excluded.operations.length).toBe(
      catalog.numbers.operations_total,
    );
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s: nazwa, pełna nazwa i opis', (_name, t) => {
    expect(t.name).toMatch(NAME_PATTERN);
    expect(t.full_name.length).toBeLessThanOrEqual(catalog.server.max_full_name);
    expect(t.full_name.startsWith(catalog.server.prefix)).toBe(true);
    expect(t.description.trim().length).toBeGreaterThan(0);
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s: klasa i poziom zgody 1–3', (_name, t) => {
    expect(t.class.length).toBeGreaterThan(0);
    expect([1, 2, 3]).toContain(t.consent.level);
  });

  it.each(tools.filter((t) => t.consent.level >= 2).map((t) => [t.name, t] as const))(
    '%s: poziom 2/3 ma szablon karty',
    (_name, t) => {
      expect(t.consent.card).not.toBeNull();
      expect(t.consent.card).toBeDefined();
    },
  );

  it.each(tools.filter((t) => t.class !== 'read').map((t) => [t.name, t] as const))(
    '%s: narzędzie nieodczytowe ma undo',
    (_name, t) => {
      expect(t.undo).toBeDefined();
      expect(t.undo).not.toBeNull();
    },
  );
});
