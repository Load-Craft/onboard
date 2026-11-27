// The rig of the read tools of module run: the sklep world after its runs (the performance run
// e-3f9a12c4 and the QA run e-8c2d4f17), the workspace bound to its project, every route set of the
// fake backend and the routes of the module's own reads.

import type { Tool } from '../../../src/registry.js';
import { registerRunModuleRoutes } from '../../fake-backend/routes/run.js';
import type { Fake } from '../../fake-backend/server.js';
import type { ToolRig } from '../../helpers/rig.js';
import { resultsRig } from '../results/rig.js';

export {
  BOUND,
  CONTROL,
  dataOf,
  errorCode,
  processOf,
  readsOf,
  stateFile,
  STATE_PATH,
  target,
} from '../results/rig.js';
export { OTHER, OTHER_HANDLE, PROJECT, RUN, RUN_HANDLE } from '../results/fixtures.js';

export interface RunRigOptions {
  readonly tools: readonly Tool[];
  /** Seeds the answers of the routes of module run, after the world is in place. */
  readonly seed?: (fake: Fake) => void;
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
}

export function runRig(options: RunRigOptions): Promise<ToolRig> {
  return resultsRig({
    tools: options.tools,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.files === undefined ? {} : { files: options.files }),
    seed: (fake) => {
      registerRunModuleRoutes(fake);
      options.seed?.(fake);
    },
  });
}

/** The requests of the project's runs and ops reads (everything under `…/gatling/`), in order. */
export function gatlingCalls(r: ToolRig): { path: string; query: Record<string, string> }[] {
  return r.fake.calls
    .filter((call) => /\/gatling\//u.test(call.path))
    .map((call) => ({
      path: call.path.replace(/^\/api\/v1\/projects\/[^/]+/u, ''),
      query: call.query,
    }));
}
