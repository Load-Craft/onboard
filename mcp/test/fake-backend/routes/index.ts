// Every route set of the fake backend in one call, for the stand-alone fake (`npm run fake`) and
// any test that wants the whole world answering. A new `routes/<name>.ts` exporting
// `register*Route(s)(fake)` is added here; `routes/index.test.ts` fails while one is missing.
// Registrars must be idempotent per fake (pattern: `routes/analysis.ts`) because a set may depend
// on another and register it itself.

import type { Fake } from '../server.js';
import { registerFlowGenerationRoutes } from './flowGeneration.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
  registerOpenapiUploadRoute,
} from './documentation.js';
import { registerProjectRoutes } from './projects.js';
import { registerProjectModuleRoutes } from './project.js';
import { registerProjectWriteRoutes } from './projectWrites.js';
import { registerHealthCheckRoutes } from './healthCheck.js';
import { registerScenarioReadRoutes } from './scenario.js';
import { registerScenarioConsentRoutes } from './scenarioConsent.js';
import { registerScenarioSaveRoutes } from './scenarioSave.js';
import { registerScenarioWriteRoutes } from './scenarioWrites.js';
import { registerBatchGenerateRoute } from './batch.js';
import { registerHarRoutes } from './har.js';
import { registerDataRoutes } from './data.js';
import { registerDataGenerateRoutes } from './dataGenerate.js';
import { registerDeletionRoutes } from './deletion.js';
import { registerDescribeRoutes } from './describe.js';
import { registerExecutionRoutes } from './executions.js';
import { registerErrorGroupsRoute } from './analysis.js';
import { registerAnalysisStartRoute } from './analysis.js';
import { registerAnalysisReadRoute } from './analysis.js';
import { registerDataWriteRoutes } from './dataWrites.js';
import { registerFunctionalConsentWriteRoutes } from './functionalConsentWrites.js';
import { registerFunctionalModuleRoutes } from './functional.js';
import { registerFunctionalProcessRoutes } from './functionalProcess.js';
import { registerFunctionalWriteRoutes } from './functionalWrites.js';
import { registerFlowRoutes } from './flows.js';
import { registerFlowCopilotRoutes } from './flowCopilot.js';
import { registerFlowSaveRoutes } from './flowSave.js';
import { registerWalkImageRoutes } from './walkImages.js';
import { registerFlowWriteRoutes } from './flowWrites.js';
import { registerResultRoutes } from './results.js';
import { registerRunModuleRoutes } from './run.js';
import { registerRunWriteRoutes } from './runWrites.js';
import { registerCompareRoute } from './compare.js';
import { registerLookupRoutes } from './lookup.js';
import { registerProvisionRoutes } from './provision.js';
import { registerCompositionRoutes } from './compositions.js';
import { registerScenarioBuilderRoutes } from './scenarioBuilder.js';
import { registerScenarioRoutes, registerTestTypeRoutes } from './scenarios.js';
import { registerSelfCheckRoutes } from './selfCheck.js';
import { registerSpecMigrationRoutes } from './specMigration.js';
import { registerSetupRoutes } from './setup.js';
import { registerStatusRoutes } from './status.js';
import { registerOpenapiReadRoute, registerSuggestionRoutes } from './suggestions.js';
import { registerTelemetryRoutes } from './telemetry.js';
import { registerTraceRoutes } from './traces.js';
import { registerTrafficRoutes } from './traffic.js';
import { registerGithubRoutes } from './github.js';

export function registerAllRoutes(fake: Fake): void {
  registerFlowGenerationRoutes(fake);
  registerProjectRoutes(fake);
  registerHarRoutes(fake);
  registerDataRoutes(fake);
  registerDataGenerateRoutes(fake);
  registerDeletionRoutes(fake);
  registerDescribeRoutes(fake);
  registerExecutionRoutes(fake);
  registerErrorGroupsRoute(fake);
  registerResultRoutes(fake);
  registerCompareRoute(fake);
  registerAnalysisStartRoute(fake);
  registerLookupRoutes(fake);
  registerProvisionRoutes(fake);
  registerFlowRoutes(fake);
  registerFlowWriteRoutes(fake);
  registerFlowCopilotRoutes(fake);
  registerFlowSaveRoutes(fake);
  registerWalkImageRoutes(fake);
  registerScenarioBuilderRoutes(fake);
  registerAnalysisReadRoute(fake);
  registerSelfCheckRoutes(fake);
  registerScenarioRoutes(fake);
  registerTestTypeRoutes(fake);
  registerCompositionRoutes(fake);
  registerStatusRoutes(fake);
  registerSetupRoutes(fake);
  registerTelemetryRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerSuggestionRoutes(fake);
  registerBatchGenerateRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  registerOpenapiUploadRoute(fake);
  registerSpecMigrationRoutes(fake);
  registerTraceRoutes(fake);
  registerProjectModuleRoutes(fake);
  registerProjectWriteRoutes(fake);
  registerScenarioReadRoutes(fake);
  registerHealthCheckRoutes(fake);
  registerScenarioWriteRoutes(fake);
  registerScenarioConsentRoutes(fake);
  registerScenarioSaveRoutes(fake);
  registerFunctionalModuleRoutes(fake);
  registerFunctionalWriteRoutes(fake);
  registerFunctionalProcessRoutes(fake);
  registerFunctionalConsentWriteRoutes(fake);
  registerDataWriteRoutes(fake);
  registerRunModuleRoutes(fake);
  registerRunWriteRoutes(fake);
  registerTrafficRoutes(fake);
  registerGithubRoutes(fake);
}
