// A result route answers a run the project does not have (unknown, deleted, or a run of another
// project) with one 404, `Execution {id} not found`, before it reads any store. The tools that take
// a 404 of their route as an absence (no result, a report not archived, a request the run did not
// count, a log with no lines) answer that 404 as not_found instead.

import { describe, expect, it } from 'vitest';

import { resultsExportReport } from '../../../src/tools/results/exportReport.js';
import { resultsGetLogs } from '../../../src/tools/results/getLogs.js';
import { resultsGetRequest } from '../../../src/tools/results/getRequest.js';
import { resultsGetReport } from '../../../src/tools/resultsGetReport.js';
import { seedExecutionOwner } from '../../fake-backend/routes/executionOwner.js';
import { seedLogs, seedReport, seedRequestDetail } from '../../fake-backend/routes/results.js';
import {
  executionPath,
  LOGS_FULL,
  REPORT_FILES,
  REQUEST_FULL,
  RUN,
  RUN_HANDLE,
} from './fixtures.js';
import { errorCode, resultsRig } from './rig.js';

const GONE = { status: 404, body: { detail: `Execution ${RUN} not found` } };

describe('a run the project does not have is not_found on the result routes', () => {
  it('results_get_logs: a run of another project, as the backend answers it', async () => {
    const r = await resultsRig({
      tools: [resultsGetLogs],
      seed: (fake) => {
        seedLogs(fake.store, RUN, LOGS_FULL);
        seedExecutionOwner(fake.store, RUN, 'another-project');
      },
    });
    const result = await r.call('results_get_logs', { run_id: RUN_HANDLE });
    expect(errorCode(result)).toBe('not_found');
    expect(result.text).not.toContain('[ERROR]');
  });

  it('results_export_report: not_found, not report_not_archived', async () => {
    const r = await resultsRig({
      tools: [resultsExportReport],
      seed: (fake) => seedReport(fake.store, RUN, REPORT_FILES),
    });
    r.fake.faults.next('GET', executionPath(RUN, '/report/index.html'), GONE);
    const result = await r.call('results_export_report', { run_id: RUN_HANDLE });
    expect(errorCode(result)).toBe('not_found');
  });

  it('results_get_request: not_found without the hint about request names', async () => {
    const r = await resultsRig({
      tools: [resultsGetRequest],
      seed: (fake) => seedRequestDetail(fake.store, RUN, 'POST /checkout', REQUEST_FULL),
    });
    r.fake.faults.next('GET', executionPath(RUN, '/endpoints/POST%20%2Fcheckout'), GONE);
    const result = await r.call('results_get_request', {
      run_id: RUN_HANDLE,
      request: 'POST /checkout',
    });
    expect(errorCode(result)).toBe('not_found');
    expect(result.text).not.toContain('the name is exact');
  });

  it('results_get_report: not_found, not a run that left no result', async () => {
    const r = await resultsRig({ tools: [resultsGetReport] });
    r.fake.faults.next('GET', executionPath(RUN, '/result'), GONE);
    const result = await r.call('results_get_report', { execution: RUN_HANDLE });
    expect(errorCode(result)).toBe('not_found');
  });
});
