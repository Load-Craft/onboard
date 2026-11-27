// The warning `flows_on_old_docs` follows the flows found on an older docs version: one warning whose
// flow_ids are replaced, nothing written when the state already says the same, and a list cut short
// (more than the 100 flows one read returns) never closes it.

import { describe, expect, it } from 'vitest';

import { oldDocsUpdate, outdatedFlows } from '../src/flow/oldDocs.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const open = (ids: string[]) => ({
  problems: [
    {
      id: 'pr-1',
      module: 'flows' as const,
      tool: 'process_get_status',
      code: 'flows_on_old_docs',
      severity: 'warning' as const,
      message: 'old',
      flow_ids: ids,
      at: '2026-11-26T10:00:00Z',
    },
  ],
});

describe('flows_on_old_docs from a reading of the flows', () => {
  it('replaces the flow ids instead of adding to them', () => {
    const update = oldDocsUpdate(open([A]), [{ id: B }], 'process_get_status');
    expect(update?.problems?.close).toEqual([{ code: 'flows_on_old_docs' }]);
    expect(update?.problems?.open?.[0]?.flow_ids).toEqual([B]);
  });

  it('writes nothing when the state already names the same flows', () => {
    expect(
      oldDocsUpdate(open([A, B]), [{ id: B }, { id: A }], 'scenario_generate'),
    ).toBeUndefined();
  });

  it('closes the warning when a full list has no such flow', () => {
    expect(oldDocsUpdate(open([A]), [], 'project_import_docs')).toEqual({
      problems: { close: [{ code: 'flows_on_old_docs' }] },
    });
  });

  it('a list cut short never closes the warning and keeps the flows it did not read', () => {
    expect(oldDocsUpdate(open([A]), [], 'process_get_status', true)).toBeUndefined();
    const update = oldDocsUpdate(open([A]), [{ id: B }], 'process_get_status', true);
    expect([...(update?.problems?.open?.[0]?.flow_ids ?? [])].sort()).toEqual([A, B].sort());
  });

  it('takes spec_status when the server gives it, the pin against the current version otherwise', () => {
    const flows = [
      { id: A, name: 'b', spec_status: 'current' as const, openapi_spec_id: 'old' },
      { id: B, name: 'a', spec_status: null, openapi_spec_id: 'old' },
    ];
    expect(outdatedFlows(flows, 'new').map((flow) => flow.id)).toEqual([B]);
  });
});
