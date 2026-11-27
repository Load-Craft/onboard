// A slot of the result template of a log entry that no value fills (FIX-69). The entry used to put
// the fields of the call's data in place of the sentence (`key=value, …`, the data of the call in
// the log); it now keeps the sentence with `none` in the slot. Under the tests the registry refuses
// a slot no value fills unless it is a listed debt (`src/workspace/logSlotDebt.ts`): a tool whose
// data may lack a slot gives its value in `log.values`. Here `results_get_request` (result template
// "{request}: p95 {p95} ms") is made to answer without a p95.

import { describe, expect, it } from 'vitest';

import type { Tool } from '../src/registry.js';
import { resultsGetRequest } from '../src/tools/results/getRequest.js';
import { buildLogEntry, unfilledSlots } from '../src/workspace/logEntry.js';
import { UNFILLED_RESULT_SLOTS } from '../src/workspace/logSlotDebt.js';
import { LOG_META } from '../src/catalog.generated.js';
import { seedRequestDetail } from './fake-backend/routes/results.js';
import { REQUEST_FULL, RUN, RUN_HANDLE } from './tools/results/fixtures.js';
import { resultsRig } from './tools/results/rig.js';

const DATA_CANARY = 'payload-canary-7f31';

function withoutP95(logValues: Record<string, string | number> = {}): Tool {
  return {
    ...resultsGetRequest,
    async invoke(ctx, args) {
      const result = await resultsGetRequest.invoke(ctx, args);
      const { outcome } = result;
      if (outcome.status !== 'done') return result;
      const data = { ...(outcome.data as Record<string, unknown>), p95: null, note: DATA_CANARY };
      return {
        ...result,
        outcome: {
          ...outcome,
          data,
          // the tool's own log.values carry the p95; here they lack it unless the test gives one
          update: { log: { values: { run_id: RUN_HANDLE, ...logValues } } },
        },
      };
    },
  };
}

async function call(tool: Tool) {
  const r = await resultsRig({
    tools: [tool],
    seed: (fake) => seedRequestDetail(fake.store, RUN, 'POST /checkout', REQUEST_FULL),
  });
  return r.call('results_get_request', { run_id: RUN_HANDLE, request: 'POST /checkout' });
}

describe('registry: a slot of the result no value fills', () => {
  it('fails the call under the tests when it is not a listed debt', async () => {
    const result = await call(withoutP95());
    expect(result.isError).toBe(true);
  });

  it('passes when the tool gives the slot in log.values', async () => {
    const result = await call(withoutP95({ p95: 'none' }));
    expect(result.isError, result.text).toBe(false);
  });
});

describe('log entry: the sentence of the template, none in an empty slot, no fields of the data', () => {
  const secrets = { scrub: (text: string) => text, scrubDeep: <T>(value: T) => value };
  const entry = (data: Record<string, unknown>) =>
    buildLogEntry({
      tool: 'results_get_request',
      catalogTool: 'results_get_request',
      args: { run_id: RUN_HANDLE, request: 'POST /checkout' },
      end: { kind: 'done', data },
      startedAt: 0,
      ms: 1,
      secrets,
      newId: () => '00000000',
    });

  it('prints none where the data has no value, and none of the data itself', () => {
    const made = entry({ p95: null, note: DATA_CANARY, rows: [1, 2] });
    expect(made.result).toBe('POST /checkout: p95 none ms');
    expect(JSON.stringify(made)).not.toContain(DATA_CANARY);
    expect(made.result).not.toContain('=');
  });

  it('fills the sentence as before when every slot has a value', () => {
    expect(entry({ p95: 410 }).result).toBe('POST /checkout: p95 410 ms');
  });

  it('names the slots no value fills, an alternative once', () => {
    expect(unfilledSlots('{a} and {b|c} of {d}', new Map([['d', 1]]))).toEqual(['a', 'b|c']);
  });
});

describe('the list of unfilled result slots', () => {
  it('names only tools of the catalog and slots of their result templates', () => {
    for (const [tool, slots] of Object.entries(UNFILLED_RESULT_SLOTS)) {
      const template = (LOG_META as Record<string, { log: { result: string } } | undefined>)[tool]
        ?.log.result;
      expect(template, tool).toBeDefined();
      for (const slot of slots) expect(template, `${tool}: ${slot}`).toContain(`{${slot}}`);
    }
  });
});
