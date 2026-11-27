// Planning and starting a run, split into `run_plan` and `run_start`, ask LoadCraft for the same
// things as the two tools they replaced. `fixtures/run-test-requests.json` holds the requests the
// fake backend saw from the old run tool and the old profiles tool for every way through them (ids as
// `:id`, polls of a run collapsed into `times`): the profiles of a composition, of a scenario, with
// the data check and on a protected environment; a start of a composition with thresholds, of a
// scenario, with the default profile, left running, refused for consent, confirmed, refused for
// short data, joining a run of the same load and refused for another. The new tools must send
// the same requests in the same order with the same bodies, reads included. Since FIX-72 the client
// the tools share asks `/meta` once, before the first request of a path: a plan now asks it too
// (the old profiles tool never checked the backend) and a second start no longer asks it again.
// Since DOKTOR-02 a plan with the data check of a scenario sends the scenario's data check once per
// profile; the old profiles tool checked compositions only.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../src/tools/index.js';
import { runPlan } from '../src/tools/runPlan.js';
import { runStart } from '../src/tools/runStart.js';
import { RUN_PATHS, recordRunPaths, type RecordedRequest } from './helpers/runRequests.js';

const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/run-test-requests.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, readonly RecordedRequest[]>>;

const writes = (requests: readonly RecordedRequest[]): RecordedRequest[] =>
  requests.filter((request) => request.method !== 'GET' && !request.path.endsWith('/preflight'));

describe('run_plan and run_start against the recording of the tools they replaced', () => {
  it('replace both old tools', () => {
    const names: string[] = ALL_TOOLS.map((tool) => tool.name);
    expect(names).toContain('run_plan');
    expect(names).toContain('run_start');
    expect(names).not.toContain(['run', 'test'].join('_'));
    expect(names).not.toContain(['list', 'profiles'].join('_'));
  });

  it('the recording covers every path', () => {
    expect(Object.keys(RECORDED).sort()).toEqual(Object.keys(RUN_PATHS).sort());
  });

  it('every path sends the recorded requests in the recorded order', async () => {
    const now = await recordRunPaths([runStart, runPlan], { plan: 'run_plan', start: 'run_start' });
    for (const [name, recorded] of Object.entries(RECORDED)) {
      expect(now[name], name).toEqual(recorded);
    }
  }, 120_000);

  it('run_plan sends no request that saves anything or starts a run', async () => {
    const now = await recordRunPaths([runStart, runPlan], { plan: 'run_plan', start: 'run_start' });
    for (const name of Object.keys(RUN_PATHS).filter((path) => path.startsWith('plan-'))) {
      expect(writes(now[name] ?? []), name).toEqual([]);
    }
  }, 120_000);

  it('a start asks for consent and sends nothing that starts load', async () => {
    const now = await recordRunPaths([runStart, runPlan], { plan: 'run_plan', start: 'run_start' });
    const asked = now['start-protected-asks-consent'] ?? [];
    expect(writes(asked)).toEqual([]);
    expect(asked.some((request) => request.path.endsWith('/execute'))).toBe(false);
  }, 120_000);
});
