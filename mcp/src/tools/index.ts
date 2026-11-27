import type { Tool } from '../registry.js';
import { dataCheckReadiness } from './dataCheckReadiness.js';
import { EXPOSED_MODULE_TOOLS } from './_generated/modules.js';
import { dataCreateAccounts } from './dataCreateAccounts.js';
import { dataCreateDataset } from './dataCreateDataset.js';
import { dataSetBindings } from './dataSetBindings.js';
import { dataSuggestActions } from './dataSuggestActions.js';
import { flowsDelete } from './flowsDelete.js';
import { flowsDescribeJourneys } from './flowsDescribeJourneys.js';
import { flowsGenerateFromEndpoints } from './flowsGenerateFromEndpoints.js';
import { flowsGenerateFromHar } from './flowsGenerateFromHar.js';
import { flowsGenerateFromSuggestions } from './flowsGenerateFromSuggestions.js';
import { flowsImportHar } from './flowsImportHar.js';
import { flowsMigrateDocs } from './flowsMigrateDocs.js';
import { flowsRecordJourneys } from './flowsRecordJourneys.js';
import { flowsSuggestJourneys } from './flowsSuggestJourneys.js';
import { runPlan } from './runPlan.js';
import { processCancel } from './processCancel.js';
import { processGetStatus } from './processGetStatus.js';
import { processWait } from './processWait.js';
import { projectAnalyzeSetup } from './projectAnalyzeSetup.js';
import { projectApplySetup } from './projectApplySetup.js';
import { projectCheckEnv } from './projectCheckEnv.js';
import { projectConnectTelemetry } from './projectConnectTelemetry.js';
import { projectCreate } from './projectCreate.js';
import { projectDelete } from './projectDelete.js';
import { projectGet } from './projectGet.js';
import { projectImportDocs } from './projectImportDocs.js';
import { projectSaveEnv } from './projectSaveEnv.js';
import { projectSetProfile } from './projectSetProfile.js';
import { resultsAnalyzeRun } from './resultsAnalyzeRun.js';
import { resultsGetErrors } from './resultsGetErrors.js';
import { resultsGetReport } from './resultsGetReport.js';
import { resultsGetTraces } from './resultsGetTraces.js';
import { runStart } from './runStart.js';
import { scenarioCheckSelf } from './scenarioCheckSelf.js';
import { scenarioGenerate } from './scenarioGenerate.js';
import { scenarioSuggestSplit } from './scenarioSuggestSplit.js';

/** The tools of today's registry; each lives in its own file next to this one. */
export const LEGACY_TOOLS: readonly Tool[] = [
  processGetStatus,
  flowsGenerateFromSuggestions,
  flowsGenerateFromEndpoints,
  flowsGenerateFromHar,
  scenarioSuggestSplit,
  scenarioGenerate,
  flowsDescribeJourneys,
  resultsAnalyzeRun,
  resultsGetReport,
  flowsImportHar,
  projectCreate,
  projectSaveEnv,
  projectCheckEnv,
  projectAnalyzeSetup,
  projectApplySetup,
  projectGet,
  projectSetProfile,
  runPlan,
  dataSuggestActions,
  dataCheckReadiness,
  dataSetBindings,
  dataCreateDataset,
  dataCreateAccounts,
  flowsRecordJourneys,
  runStart,
  projectConnectTelemetry,
  flowsSuggestJourneys,
  scenarioCheckSelf,
  projectImportDocs,
  flowsMigrateDocs,
  processWait,
  processCancel,
  projectDelete,
  flowsDelete,
  resultsGetErrors,
  resultsGetTraces,
];

/**
 * Every tool the server exposes: today's tools and the written tools of the modules
 * (`tools/<module>/`); a tool of a module that is registered but not written is not offered.
 */
export const ALL_TOOLS: readonly Tool[] = [...LEGACY_TOOLS, ...EXPOSED_MODULE_TOOLS];
