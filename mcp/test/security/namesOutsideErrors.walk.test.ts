// FIX-77: what the frames of the walk carry into the live view of `flows_record_journeys` (the names of
// the paths, what the browser agent says at each step, its request for help) is a third party's text:
// a credential in it never reaches the progress, the text, the data or the state of the workspace.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { flowsDescribeJourneys } from '../../src/tools/flowsDescribeJourneys.js';
import { flowsRecordJourneys } from '../../src/tools/flowsRecordJourneys.js';
import { processWait } from '../../src/tools/processWait.js';
import {
  registerDescribeRoutes,
  SKLEP_PROPOSAL,
  type DescribeHandles,
} from '../fake-backend/routes/describe.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { seedSklep } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { FILE_CANARY, leakedPieces } from '../helpers/canary.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from '../helpers/rig.js';

const RUN = SKLEP_IDS.recordRun;
const PLAN = `r-${RUN.slice(0, 8)}`;
const HANDLE = `record_run:${RUN}`;
const PROJECT = SKLEP_IDS.project;
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ3YWxrIn0.c2VudGluZWwtd2Fsay1zaWduYXR1cmU';
const SIGNATURE = 'c2VudGluZWwtd2Fsay1zaWduYXR1cmU';
/** Any piece of the token: a view that cuts a long line keeps its start. */
const PAYLOAD = 'eyJzdWIiOiJ3YWxrIn0';
// every piece of a secret counts: a view that cuts or a mask that hides a part leaves one (FIX-79)
const leaks = (text: string): string[] => leakedPieces(text, [JWT, SIGNATURE, PAYLOAD]);

async function rig(): Promise<{ r: ToolRig; handles: DescribeHandles }> {
  let handles: DescribeHandles | undefined;
  const r = await toolRig({
    tools: [flowsDescribeJourneys, flowsRecordJourneys, processWait],
    clock: createTestClock(Date.parse('2026-11-22T10:00:00Z')),
    fake: { meta: { capabilities: ['meta', 'api_token_sockets'] } },
    env: { LOADCRAFT_LOCALE: 'en' },
    files: {
      'loadcraft/project.json': JSON.stringify({
        schema: 1,
        url: 'https://app.loadcraft.io',
        project: { id: PROJECT, name: 'sklep' },
      }),
      '.env.perf': `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${FILE_CANARY}\n`,
    },
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      // the credential only in what the browser agent says at each step: it reaches the call
      // through the frames of the walk alone
      handles = registerDescribeRoutes(fake, {
        runIds: [RUN],
        walk: { zakupy: { label: `klika: zakupy ${JWT}` } },
      });
    },
  });
  if (handles === undefined) throw new Error('no describe routes');
  return { r, handles };
}

const call = (r: ToolRig, tool: string, args: Record<string, unknown>): Promise<RigCallResult> =>
  settleClock(r, r.call(tool, args), { limitMs: 400_000 });

const stateText = (r: ToolRig): string => {
  try {
    return readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  } catch {
    return '';
  }
};

describe('a credential in the name of a path of the walk (FIX-77)', () => {
  it('is masked in the progress, the result and the state, and the planner still gets its path back', async () => {
    const { r, handles } = await rig();
    const plan = await call(r, 'flows_describe_journeys', {
      description:
        'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą. Część klientów ' +
        'przegląda katalog, część sprawdza swoje zamówienia.',
      environment: 'perf',
      account: { from_env: '.env.perf' },
    });
    expect(plan.isError, plan.text).toBe(false);
    const results = [await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' })];
    for (let again = 0; again < 8; again += 1) {
      const last = results[results.length - 1];
      if (last === undefined || last.isError || last.outcome?.status === 'done') break;
      results.push(await call(r, 'process_wait', { operation: HANDLE }));
    }
    const last = results[results.length - 1];
    expect(last?.isError, last?.text).toBe(false);
    const progress = results.flatMap((result) =>
      result.progress.map((entry) => entry.message ?? ''),
    );
    expect(progress.join('\n')).toContain('klika: zakupy');
    for (const text of [
      ...results.map((result) => result.text),
      ...results.map((result) => JSON.stringify(result.outcome ?? null)),
      progress.join('\n'),
      stateText(r),
    ]) {
      expect(leaks(text)).toEqual([]);
    }
    // the approval went to the planner with the paths as it proposed them
    expect(handles.approvals).toEqual([SKLEP_PROPOSAL.map((path) => ({ ...path }))]);
  });
});
