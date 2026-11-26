// The transitional list of files that still reach the backend through the hand-written
// modules. Code under src/tools, ops, resolve, workspace, render and report must use the clients generated from the contracts:
// `callOperation` over `http/generated/operations.ts` for REST and `typedChannel` over
// `ws/generated/channels.ts` for WebSocket. The tools of the first stage were written before those
// clients existed and read the backend through `src/api/*` (each reader registered with `reads()`)
// and through `ws/channel.ts` and `ws/frames.ts`.
//
// The list only shrinks. A file moves off it when its tool is rewritten on the generated clients;
// the guard fails when a listed file no longer needs its entry, and no new file may be added.
// Paths are relative to src, with `/` separators.

/** Files that import the hand-written readers of `src/api/*` (a type-only import outside src/tools needs no entry). */
export const LEGACY_API_READERS: readonly string[] = [
  'render/views/getDiagnosis.ts',
  'resolve/handles.ts',
  // one flow build tool split into three, with its ways under tools/flows: the same readers
  'tools/flows/fromEndpoints.ts',
  'tools/flows/fromHar.ts',
  'tools/flows/fromSuggestions.ts',
  'tools/flowsGenerateFromEndpoints.ts',
  'tools/flowsGenerateFromHar.ts',
  'tools/flowsGenerateFromSuggestions.ts',
  // one scenario tool split into two, with its shared code under tools/scenario: the same readers
  'tools/scenario/flowWarnings.ts',
  'tools/scenario/generate.ts',
  'tools/scenario/propose.ts',
  'tools/scenarioGenerate.ts',
  'tools/scenarioSuggestSplit.ts',
  'tools/processCancel.ts',
  'tools/flowsDescribeJourneys.ts',
  'tools/resultsAnalyzeRun.ts',
  'tools/flowsGet.ts',
  'tools/resultsGetReport.ts',
  'tools/processGetStatus.ts',
  'tools/flowsImportHar.ts',
  // one setup tool split into five, with its shared code under tools/project: the same readers
  'tools/project/environments.ts',
  'tools/project/setup.ts',
  'tools/projectAnalyzeSetup.ts',
  'tools/projectApplySetup.ts',
  'tools/projectCheckEnv.ts',
  'tools/projectCreate.ts',
  'tools/projectSaveEnv.ts',
  'tools/runPlan.ts',
  // one data tool split into four, with its shared code under tools/data: the same readers
  'tools/data/accountsFile.ts',
  'tools/data/bindings.ts',
  'tools/data/plan.ts',
  'tools/data/readPlan.ts',
  'tools/data/slotData.ts',
  'tools/data/slotDataset.ts',
  'tools/data/steps.ts',
  'tools/data/suggestion.ts',
  'tools/data/target.ts',
  'tools/dataCreateDataset.ts',
  'tools/dataSuggestActions.ts',
  'tools/dataCreateAccounts/operation.ts',
  'tools/dataCreateAccounts/provision.ts',
  'tools/dataCreateAccounts.ts',
  'tools/recordWalk.ts',
  'tools/run/dryRun.ts',
  'tools/run/start.ts',
  'tools/run/wait.ts',
  'tools/scenarioCheckSelf.ts',
  'tools/projectConnectTelemetry.ts',
  'tools/flowsSuggestJourneys.ts',
  'tools/projectImportDocs.ts',
];

/** Files that import the hand-written channel and frame modules of `src/ws`. */
export const LEGACY_WS_MODULES: readonly string[] = [
  'ops/operation.ts',
  'tools/flows/fromHar.ts',
  'tools/flowsDescribeJourneys.ts',
  'tools/recordWalk.ts',
];
