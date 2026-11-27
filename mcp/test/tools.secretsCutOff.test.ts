// The project's list of datasets names them and carries none of their cells: no content, no sample
// rows. A call that lists a dataset of many accounts therefore registers no cell of it and is never
// cut short, so the backend's errors keep their text; the cells of a dataset come only with an
// answer that holds that dataset, which registers every one of them.

import { describe, expect, it } from 'vitest';

import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
} from './fake-backend/worlds/sklep.js';
import { dataRig } from './helpers/dataWorlds.js';
import { CANARY, type ToolRig } from './helpers/rig.js';

/** A dataset of `rows` accounts whose last password is the canary. */
function addBigDataset(r: ToolRig, rows: number): void {
  const feeders = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
  const [template] = feeders.list();
  if (template === undefined) throw new Error('no dataset to copy');
  const lines = Array.from({ length: rows }, (_, i) =>
    i === rows - 1
      ? `u${String(i)}@example.com,Pw-${CANARY}`
      : `u${String(i)}@example.com,pw-${String(i)}`,
  );
  feeders.insert({
    ...template,
    id: 'big-dataset',
    name: 'big accounts',
    file_name: 'big.csv',
    columns: ['email', 'password'],
    column_semantics: { email: 'identity', password: 'credential' },
    content: `email,password\n${lines.join('\n')}\n`,
    record_count: rows,
  });
}

describe('a call that lists a dataset of many accounts', () => {
  it('receives none of its cells and keeps the text of the backend error', async () => {
    const r = await dataRig({ tools: [dataCheckReadiness] });
    addBigDataset(r, 1050);
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/feeders/preflight`,
      { status: 409, body: { detail: 'Slot conflict: the slot is bound twice.' } },
    );
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Slot conflict');
    const listed = r.fake.calls.filter((call) => call.path.endsWith('/gatling/feeders'));
    expect(listed.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.logRecords())).not.toContain(CANARY);
  });
});
