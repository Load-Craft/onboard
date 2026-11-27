// Catalog <-> contract guard on types. The catalog (catalog/katalog.json) ties tools to the backend by
// operationId and channel name. gen-catalog emits CATALOG_OPERATION_IDS and CATALOG_CHANNEL_IDS in
// src/catalog.generated.ts with `satisfies readonly OperationId[]` / `ChannelId[]`, so `tsc --noEmit`
// (and with it every task gate) fails when the catalog names an operation or a channel the generated
// clients do not have. This file covers the opposite direction and the type-level equality.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EXCLUDED_OPERATIONS } from '../scripts/sync-api/excluded.js';
import { CATALOG_CHANNEL_IDS, CATALOG_OPERATION_IDS } from '../src/catalog.generated.js';
import type { operations } from '../src/http/generated/api.js';
import { OPERATIONS, type OperationId } from '../src/http/generated/operations.js';
import { CHANNELS, type ChannelId } from '../src/ws/generated/channels.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Catalog {
  modules: Array<{
    tools: Array<{ operations?: Array<{ operationId: string }>; channels?: string[] }>;
  }>;
  excluded: { operations: Array<{ operationId: string }>; channels: Array<{ channel: string }> };
}
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as Catalog;
/** Operations the public snapshot leaves out: no client type, so no generated id either. */
const leftOut = new Set(EXCLUDED_OPERATIONS.map((entry) => entry.operationId));

describe('catalog.contract.types: the catalog and the generated clients name the same things', () => {
  it('the catalog operation ids are exactly the keys of operations, the channel ids exactly ChannelId (types)', () => {
    expectTypeOf<(typeof CATALOG_OPERATION_IDS)[number]>().toEqualTypeOf<OperationId>();
    expectTypeOf<(typeof CATALOG_OPERATION_IDS)[number]>().toEqualTypeOf<keyof operations>();
    expectTypeOf<(typeof CATALOG_CHANNEL_IDS)[number]>().toEqualTypeOf<ChannelId>();
  });

  it('every operation of the client is named by the catalog, list of the missing', () => {
    const named = new Set<string>(CATALOG_OPERATION_IDS);
    expect(Object.keys(OPERATIONS).filter((id) => !named.has(id))).toEqual([]);
  });

  it('every channel of the client is named by the catalog, list of the missing', () => {
    const named = new Set<string>(CATALOG_CHANNEL_IDS);
    expect(Object.keys(CHANNELS).filter((id) => !named.has(id))).toEqual([]);
  });

  it('the generated lists equal the catalog (tools and excluded)', () => {
    const operationIds = [
      ...catalog.modules.flatMap((m) =>
        m.tools.flatMap((t) => (t.operations ?? []).map((o) => o.operationId)),
      ),
      ...catalog.excluded.operations.map((o) => o.operationId),
    ].filter((id) => !leftOut.has(id));
    const channelIds = [
      ...catalog.modules.flatMap((m) => m.tools.flatMap((t) => t.channels ?? [])),
      ...catalog.excluded.channels.map((c) => c.channel),
    ];
    expect([...CATALOG_OPERATION_IDS]).toEqual([...new Set(operationIds)].sort());
    expect([...CATALOG_CHANNEL_IDS]).toEqual([...new Set(channelIds)].sort());
  });
});
