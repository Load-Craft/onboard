// Every long-operation kind a handle can name, in one list: `process_wait` continues them and `process_cancel`
// stops the ones that can be stopped. A kind defined in a tool is added here; a test reads the
// source and fails while one is missing.

import type { AnyOperationKind } from '../ops/operation.js';
import { harGenerationOperation, harSplitOperation } from './flows/fromHar.js';
import { batchGenerationOperation } from './flows/fromSuggestions.js';
import { flowGenerationOperation } from './flows/fromEndpoints.js';
import { scenarioGenerationOperation } from './scenario/generate.js';
import { recordRunOperation } from './flowsDescribeJourneys.js';
import { analysisKind } from './resultsAnalyzeRun.js';
import { setupAnalysisOperation } from './project/setup.js';
import { testRunOperation } from './run/wait.js';
import { selfCheckOperation } from './scenarioCheckSelf.js';
import { accountProvisionOperation } from './dataCreateAccounts/operation.js';
import { refineOperation } from './flowsSuggestJourneys.js';
import { payloadsOperation } from './functional/generatePayloads.js';
import { testTypesOperation } from './functional/testTypesRun.js';
import { datasetGenerationOperation } from './data/generateDataset.js';
import { driftCheckOperation } from './scenario/checkDrift.js';

export const ALL_OPERATION_KINDS: readonly AnyOperationKind[] = [
  accountProvisionOperation,
  analysisKind,
  batchGenerationOperation,
  datasetGenerationOperation,
  driftCheckOperation,
  flowGenerationOperation,
  harGenerationOperation,
  harSplitOperation,
  payloadsOperation,
  recordRunOperation,
  refineOperation,
  scenarioGenerationOperation,
  selfCheckOperation,
  setupAnalysisOperation,
  testRunOperation,
  testTypesOperation,
];
