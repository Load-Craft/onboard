// The registry refuses, under the tests only, a call whose `log.values` fill a slot of the result
// other than the data of the same name: the entry would say one thing and the data another. Here
// `results_get_request` (result template "{request}: p95 {p95} ms") is made to log a p95 the data
// does not carry.

import { describe, expect, it } from 'vitest';

import type { Tool } from '../src/registry.js';
import { resultsGetRequest } from '../src/tools/results/getRequest.js';
import { seedRequestDetail } from './fake-backend/routes/results.js';
import { REQUEST_FULL, RUN, RUN_HANDLE } from './tools/results/fixtures.js';
import { resultsRig } from './tools/results/rig.js';

function loggingP95(p95: number): Tool {
  return {
    ...resultsGetRequest,
    async invoke(ctx, args) {
      const result = await resultsGetRequest.invoke(ctx, args);
      const { outcome } = result;
      if (outcome.status !== 'done') return result;
      return {
        ...result,
        outcome: { ...outcome, update: { log: { values: { run_id: RUN_HANDLE, p95 } } } },
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

describe('registry: log.values that disagree with the data fail under the tests', () => {
  it('a p95 the data does not carry fails the call', async () => {
    const result = await call(loggingP95(999));
    expect(result.isError).toBe(true);
  });

  it('the data p95 in whole ms is the same value and passes', async () => {
    const result = await call(loggingP95(410));
    expect(result.isError, result.text).toBe(false);
  });
});
