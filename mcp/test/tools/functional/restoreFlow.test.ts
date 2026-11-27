// `functional_restore_flow` (module functional): a flow restored to a saved version, with the state
// before it kept as a new version and the undo taken from the log (the object in the fake is compared).

import { describe, expect, it } from 'vitest';

import { functionalRestoreFlow } from '../../../src/tools/functional/restoreFlow.js';
import {
  seedFlows,
  seedFlowVersions,
  type FlowDetailBody,
} from '../../fake-backend/routes/functional.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import { expectUndoRestores, loggedCalls } from '../../helpers/undo.js';
import { apiCalls, dataOf, errorCode, functionalRig } from './rig.js';

const TOOL = 'functional_restore_flow';
const FLOW = '4c0e2d3f-0001-4d00-8000-000000000001';

const CHECKOUT: FlowDetailBody = {
  id: FLOW,
  name: 'Checkout',
  description: null,
  openapi_spec_id: '3b9d1c2e-0001-4c00-8000-000000000001',
  version: '2.16.0',
  blocks_count: 3,
  blocks: [],
  edges: [],
  variables: {},
  is_active: true,
  tags: [],
  timeout_ms: 30_000,
  retry_count: 0,
  retry_delay_ms: 0,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
};

function rig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  return functionalRig({
    tools: [functionalRestoreFlow],
    locale,
    seed: (fake) => {
      seedFlows(fake.store, [CHECKOUT]);
      seedFlowVersions(fake.store, FLOW, [
        { id: 'v2', flow_id: FLOW, version: '2.16.0', created_at: '2026-11-22T10:00:00Z' },
        { id: 'v1', flow_id: FLOW, version: '2.15.0', created_at: '2026-11-20T10:00:00Z' },
      ]);
    },
  });
}

const stored = (r: ToolRig): unknown => {
  // what the fake holds of the flow and its saved versions: a read through the tool's own routes
  const flows = r.fake.store
    .collection<{ id: string; value: unknown }>('functional_module_reads')
    .get('flows')?.value as FlowDetailBody[];
  const versions = r.fake.store
    .collection<{ id: string; value: unknown }>('functional_module_reads')
    .get(`flow-versions:${FLOW}`)?.value as { version: string }[];
  return { version: flows[0]?.version, saved: versions.map((entry) => entry.version).length };
};

describe('functional_restore_flow', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(functionalRestoreFlow);
    expect(functionalRestoreFlow.implemented).toBe(true);
  });

  it('restores a saved version: versions read before and after, one POST, the snapshot named', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { flow_id: FLOW, version: '2.15.0' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Functional flow "Checkout" restored to version 2.15.0 (3 blocks).',
        'The state before the restore was kept as version before-restore-3; the undo restores it.',
      ].join('\n'),
    );
    expect(apiCalls(r)).toEqual([
      `GET /api/v1/test-flows/${FLOW}/versions`,
      `POST /api/v1/test-flows/${FLOW}/versions/2.15.0/restore`,
      `GET /api/v1/test-flows/${FLOW}/versions`,
    ]);
    expect(stored(r)).toEqual({ version: '2.15.0', saved: 3 });
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      args: `${FLOW} 2.15.0`,
      result: 'Checkout: version 2.15.0 restored',
    });
  });

  it('the undo from the log puts the flow back as it was', async () => {
    const r = await rig();
    const undo = await expectUndoRestores(
      r,
      { tool: TOOL, args: { flow_id: FLOW, version: '2.15.0' } },
      () =>
        stored(r) &&
        (
          r.fake.store
            .collection<{ id: string; value: unknown }>('functional_module_reads')
            .get('flows')?.value as FlowDetailBody[]
        )[0]?.version,
    );
    expect(undo.tool).toBe(TOOL);
    expect(undo.args).toEqual({ flow_id: FLOW, version: 'before-restore-3' });
  });

  it('the data names the flow, the version and the snapshot', async () => {
    const r = await rig();
    const data = dataOf<{
      name: string;
      version: string;
      snapshot: string | null;
      undoable: boolean;
    }>(await r.call(TOOL, { flow_id: FLOW, version: '2.15.0', format: 'data' }));
    expect(data).toMatchObject({
      name: 'Checkout',
      version: '2.15.0',
      snapshot: 'before-restore-3',
      undoable: true,
    });
  });

  it('says so and declares no undo when the backend lists no new version', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/test-flows/{flow_id}/versions', {
      status: 200,
      body: [{ id: 'v2', flow_id: FLOW, version: '2.16.0', created_at: '2026-11-22T10:00:00Z' }],
    });
    r.fake.faults.next('POST', '/api/v1/test-flows/{flow_id}/versions/{version}/restore', {
      status: 200,
      body: CHECKOUT,
    });
    r.fake.faults.next('GET', '/api/v1/test-flows/{flow_id}/versions', {
      status: 200,
      body: [{ id: 'v2', flow_id: FLOW, version: '2.16.0', created_at: '2026-11-22T10:00:00Z' }],
    });
    const result = await r.call(TOOL, { flow_id: FLOW, version: '2.16.0' });
    expect(result.text).toContain('cannot be undone from the log');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('a project with no functional tests at all says so instead of a plain not_found', async () => {
    const r = await functionalRig({
      tools: [functionalRestoreFlow],
      seed: (fake) => {
        seedFlows(fake.store, []);
      },
    });
    const result = await r.call(TOOL, { flow_id: FLOW, version: '2.15.0' });
    expect(errorCode(result)).toBe('functional_no_flows');
    expect(result.text).toContain('This project has no functional tests yet');
    expect(apiCalls(r)).toEqual([
      `GET /api/v1/test-flows/${FLOW}/versions`,
      'GET /api/v1/test-flows?limit=1',
    ]);
    const pl = await functionalRig({ tools: [functionalRestoreFlow], locale: 'pl' });
    expect((await pl.call(TOOL, { flow_id: FLOW, version: '2.15.0' })).text).toContain(
      'nie ma jeszcze testów funkcjonalnych',
    );
  });

  it('a version or a flow the backend lacks is not_found, and nothing is changed', async () => {
    const r = await rig();
    const before = stored(r);
    expect(errorCode(await r.call(TOOL, { flow_id: FLOW, version: '0.0.1' }))).toBe('not_found');
    expect(
      errorCode(
        await r.call(TOOL, { flow_id: '4c0e2d3f-0009-4d00-8000-000000000009', version: '1' }),
      ),
    ).toBe('not_found');
    expect(stored(r)).toEqual(before);
  });

  it('a name with a secret is masked and a label the mask changed is not offered for undo', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/test-flows/{flow_id}/versions', {
      status: 200,
      body: [],
    });
    r.fake.faults.next('POST', '/api/v1/test-flows/{flow_id}/versions/{version}/restore', {
      status: 200,
      body: { ...CHECKOUT, name: `Checkout password=${BACKEND_CANARY}` },
    });
    r.fake.faults.next('GET', '/api/v1/test-flows/{flow_id}/versions', {
      status: 200,
      body: [
        {
          id: 'n1',
          flow_id: FLOW,
          version: `snap password=${BACKEND_CANARY}`,
          created_at: '2026-11-27T12:00:00Z',
        },
      ],
    });
    const result = await r.call(TOOL, { flow_id: FLOW, version: '2.15.0' });
    expect(result.isError, result.text).toBe(false);
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('refuses arguments outside the catalog before a request', async () => {
    const r = await rig();
    for (const args of [
      {},
      { flow_id: FLOW },
      { version: '1' },
      { flow_id: 'x', version: '1' },
      { flow_id: FLOW, version: '' },
      { flow_id: FLOW, version: 'v'.repeat(61) },
      { flow_id: FLOW, version: '1', preview: true },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(apiCalls(r)).toEqual([]);
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig('pl');
    expect((await r.call(TOOL, { flow_id: FLOW, version: '2.15.0' })).text).toBe(
      [
        'Flow funkcjonalny „Checkout” przywrócony do wersji 2.15.0 (3 bloków).',
        'Stan sprzed przywrócenia zachowano jako wersję before-restore-3; cofnięcie ją przywróci.',
      ].join('\n'),
    );
  });
});
