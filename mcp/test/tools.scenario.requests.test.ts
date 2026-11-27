// Building a scenario in two tools asks LoadCraft for exactly what the single tool they replaced
// asked for. `fixtures/scenario-requests.json` holds what the fake backend saw from that tool (ids
// as `:id`) in five ways: the proposal of a split for three flows and for one, the generation after
// a proposal, the generation with the flows named, and the generation for a composition that exists
// (only its weights change). The generation includes the self-check of every scenario. Each new
// tool, given the same arguments, must send the same requests in the same order with the same
// bodies, reads included. One deliberate difference from the first recording: the generation ways
// ask for the requests of a check's run with `order=run` (the order the run made them, for the
// self-check view); the same request, in the same place, with one query parameter more.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CURRENT_TO_TOOLS, TOOL_NAMES, type ToolName } from '../src/catalog.generated.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { processWait } from '../src/tools/processWait.js';
import { scenarioGenerate } from '../src/tools/scenarioGenerate.js';
import { scenarioSuggestSplit } from '../src/tools/scenarioSuggestSplit.js';
import {
  PHASE_OF,
  requestsOf,
  WAYS,
  type Way,
  type WayRecord,
} from './helpers/scenarioRequests.js';

const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/scenario-requests.json', import.meta.url), 'utf8'),
) as Readonly<Record<Way, WayRecord>>;

const TWO: readonly ToolName[] = ['scenario_generate', 'scenario_suggest_split'];
const NAMES = { propose: 'scenario_suggest_split', generate: 'scenario_generate' } as const;
const TOOLS = [scenarioSuggestSplit, scenarioGenerate, processWait];

describe('a scenario in two tools: the requests of the single tool', () => {
  it('names the two tools of the migration map, both in the catalog and on the server', () => {
    const split = Object.entries(CURRENT_TO_TOOLS).find(
      ([, tools]) => tools.length === TWO.length && TWO.every((name) => tools.includes(name)),
    );
    expect(split?.[1]).toEqual(TWO);
    const listed = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of TWO) {
      expect(TOOL_NAMES).toContain(name);
      expect(listed.has(name)).toBe(true);
    }
    // the old name of the split (the key of its map entry) is not served any more
    expect(split?.[0]).toBeTruthy();
    expect(listed.has(split?.[0] ?? '')).toBe(false);
  });

  it('recorded every way of the old tool', () => {
    expect(Object.keys(RECORDED).sort()).toEqual([...WAYS].sort());
    for (const way of WAYS) expect(RECORDED[way].requests.length).toBeGreaterThan(0);
  });

  it.each(WAYS)('%s: the same requests in the same order', async (way) => {
    const { result, record } = await requestsOf(way, NAMES, TOOLS);
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome?.status, result.text).toBe('done');
    expect(PHASE_OF[way]).toMatch(/^(propose|generate)$/u);
    expect(record.requests).toEqual(RECORDED[way].requests);
    expect(record.channel).toEqual(RECORDED[way].channel);
  });
});
