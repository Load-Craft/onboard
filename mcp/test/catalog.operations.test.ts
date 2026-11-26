// The catalog names the backend operations each tool calls; the generated client types come from the
// committed contract snapshot. Every operation the catalog mentions (tools and excluded) must exist
// in the snapshot with the same method and path, and the snapshot must be the described version:
// every operation has a summary, declares its security and the token-pinned 403 where it needs one.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

interface CatalogOperation {
  operationId: string;
  method: string;
  path: string;
}
interface Catalog {
  modules: Array<{ tools: Array<{ operations?: CatalogOperation[] }> }>;
  excluded: { operations: CatalogOperation[] };
}
interface OpenApiOperation {
  operationId: string;
  summary?: string;
  security?: unknown[];
  responses?: Record<string, unknown>;
}
interface OpenApi {
  paths: Record<string, Partial<Record<(typeof METHODS)[number], OpenApiOperation>>>;
}

const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as Catalog;
const contract = JSON.parse(
  readFileSync(join(root, '..', 'contracts', 'loadcraft-openapi.json'), 'utf8'),
) as OpenApi;

const snapshot = new Map<string, { method: string; path: string; op: OpenApiOperation }>();
for (const [path, item] of Object.entries(contract.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (op) snapshot.set(op.operationId, { method: method.toUpperCase(), path, op });
  }
}

const inTools = catalog.modules.flatMap((m) => m.tools.flatMap((t) => t.operations ?? []));
const excluded = catalog.excluded.operations;

describe('catalog.operations: katalog ⊆ migawka kontraktu', () => {
  it('migawka ma co najmniej 387 operacji', () => {
    expect(snapshot.size).toBeGreaterThanOrEqual(387);
  });

  it('każdy operationId narzędzi i wykluczonych istnieje w migawce (lista brakujących)', () => {
    const missing = [...new Set([...inTools, ...excluded].map((o) => o.operationId))].filter(
      (id) => !snapshot.has(id),
    );
    expect(missing).toEqual([]);
  });

  it('metoda i ścieżka operacji w katalogu zgadzają się z migawką (lista rozbieżności)', () => {
    const differs = [...inTools, ...excluded]
      .filter((o) => {
        const s = snapshot.get(o.operationId);
        return s !== undefined && (s.method !== o.method.toUpperCase() || s.path !== o.path);
      })
      .map(
        (o) =>
          `${o.operationId}: katalog ${o.method} ${o.path}, migawka ${snapshot.get(o.operationId)?.method} ${snapshot.get(o.operationId)?.path}`,
      );
    expect(differs).toEqual([]);
  });

  it('zbiór operationId katalogu (narzędzia i wykluczone) równa się zbiorowi migawki', () => {
    const fromCatalog = new Set([...inTools, ...excluded].map((o) => o.operationId));
    const fromSnapshot = new Set(snapshot.keys());
    expect([...fromSnapshot].filter((id) => !fromCatalog.has(id))).toEqual([]);
    expect([...fromCatalog].filter((id) => !fromSnapshot.has(id))).toEqual([]);
  });

  it('katalog liczy 390 operacji: 328 w narzędziach i 62 wykluczone, bez powtórzeń między nimi', () => {
    const toolIds = new Set(inTools.map((o) => o.operationId));
    const excludedIds = new Set(excluded.map((o) => o.operationId));
    expect(toolIds.size).toBe(328);
    expect(excludedIds.size).toBe(62);
    expect([...toolIds].filter((id) => excludedIds.has(id))).toEqual([]);
  });
});

describe('catalog.operations: migawka w wersji opisanej', () => {
  it('każda operacja ma summary i jawną deklarację security (lista, także pusta)', () => {
    const bare = [...snapshot.entries()]
      .filter(([, s]) => !s.op.summary || !Array.isArray(s.op.security))
      .map(([id]) => id);
    expect(bare).toEqual([]);
  });

  it('operacje z przypiętym tokenem opisują odpowiedź 403', () => {
    const withForbidden = [...snapshot.values()].filter(
      (s) => s.op.responses && '403' in s.op.responses,
    );
    expect(withForbidden.length).toBeGreaterThanOrEqual(100);
  });
});
