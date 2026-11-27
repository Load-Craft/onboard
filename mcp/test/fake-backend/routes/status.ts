// Reads `process_get_status` needs on top of the lookups (`routes/lookup.ts`, `routes/flows.ts`): the setup
// status of the project (`routes/setup.ts`: the seeded project is a finished session, a project
// created by a test starts with nothing done) and the stored AI analysis of an execution
// (`routes/analysis.ts`, registered idempotently).

import type { Fake } from '../server.js';
import { registerAnalysisReadRoute } from './analysis.js';
import { registerSetupRoutes } from './setup.js';

/**
 * Registers `GET …/setup/status` (with the other setup routes, `routes/setup.ts`) and, unless
 * already there, `GET …/gatling/executions/{id}/analysis`.
 */
export function registerStatusRoutes(fake: Fake): void {
  registerSetupRoutes(fake);
  registerAnalysisReadRoute(fake);
}
