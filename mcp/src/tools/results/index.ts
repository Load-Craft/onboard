// The tools of module results. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { resultsCheckProduction } from './checkProduction.js';
import { resultsCompareRuns } from './compareRuns.js';
import { resultsExportReport } from './exportReport.js';
import { resultsGetLogs } from './getLogs.js';
import { resultsGetRequest } from './getRequest.js';
import { resultsSetBaseline } from './setBaseline.js';

export const tools: readonly ModuleTool[] = [
  resultsCheckProduction,
  resultsCompareRuns,
  resultsExportReport,
  resultsGetLogs,
  resultsGetRequest,
  resultsSetBaseline,
];
