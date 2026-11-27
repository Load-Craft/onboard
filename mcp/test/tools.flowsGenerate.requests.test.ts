// Building flows in three tools asks LoadCraft for exactly what the single build tool they replaced
// asked for. `fixtures/flows-generate-requests.json` holds what the fake backend saw from that tool
// at c856d6a (ids as `:id`, the random basket tag as `mcp-:tag`) in five ways: from proposals, from
// endpoints, from a recording as one flow, split, and split after the recording was imported. Each
// new tool, given the same arguments, must send the same requests in the same order with the same
// bodies, reads included, and the same messages over the HAR channel.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CURRENT_TO_TOOLS, TOOL_NAMES, type ToolName } from '../src/catalog.generated.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { flowsGenerateFromEndpoints } from '../src/tools/flowsGenerateFromEndpoints.js';
import { flowsGenerateFromHar } from '../src/tools/flowsGenerateFromHar.js';
import { flowsGenerateFromSuggestions } from '../src/tools/flowsGenerateFromSuggestions.js';
import { flowsImportHar } from '../src/tools/flowsImportHar.js';
import { flowsSuggestJourneys } from '../src/tools/flowsSuggestJourneys.js';
import { processWait } from '../src/tools/processWait.js';
import { requestsOf, WAYS, type Way, type WayRecord } from './helpers/flowsGenerate.js';

const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/flows-generate-requests.json', import.meta.url), 'utf8'),
) as Readonly<Record<Way, WayRecord>>;

const THREE: readonly ToolName[] = [
  'flows_generate_from_suggestions',
  'flows_generate_from_endpoints',
  'flows_generate_from_har',
];

const TOOL_OF: Readonly<Record<Way, ToolName>> = {
  suggestions: 'flows_generate_from_suggestions',
  endpoints: 'flows_generate_from_endpoints',
  'har-one': 'flows_generate_from_har',
  'har-split': 'flows_generate_from_har',
  'har-split-imported': 'flows_generate_from_har',
};

const TOOLS = [
  flowsSuggestJourneys,
  flowsImportHar,
  flowsGenerateFromSuggestions,
  flowsGenerateFromEndpoints,
  flowsGenerateFromHar,
  processWait,
];

describe('flows in three tools: the requests of the single build tool', () => {
  it('names the three tools of the migration map, all in the catalog and on the server', () => {
    const split = Object.entries(CURRENT_TO_TOOLS).find(
      ([, tools]) => tools.length === THREE.length && THREE.every((name) => tools.includes(name)),
    );
    expect(split?.[1]).toEqual(THREE);
    const listed = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of THREE) {
      expect(TOOL_NAMES).toContain(name);
      expect(listed.has(name)).toBe(true);
    }
    // the old name of the split (the key of its map entry) is not served any more
    expect(listed.has(split?.[0] ?? '')).toBe(false);
    expect(split?.[0]).toBeTruthy();
  });

  it('recorded every way of the old tool', () => {
    expect(Object.keys(RECORDED).sort()).toEqual([...WAYS].sort());
    for (const way of WAYS) expect(RECORDED[way].requests.length).toBeGreaterThan(0);
  });

  it.each(WAYS)('%s: the same requests and channel messages in the same order', async (way) => {
    const { result, record } = await requestsOf(way, TOOL_OF[way], TOOLS);
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome?.status, result.text).toBe('done');
    expect(record.requests).toEqual(RECORDED[way].requests);
    expect(record.channel).toEqual(RECORDED[way].channel);
  });
});
