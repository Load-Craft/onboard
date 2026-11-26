// Result routes of the fake backend, over the executions and results of the sklep world: the run
// detail (`GET …/gatling/executions/{id}`, the facts the verdict is made of) and the stored result
// with its time series (`GET …/gatling/executions/{id}/result`). The request rows
// (`…/endpoints`) and the error groups (`…/errors`) are registered by their own sets, which this
// one calls, so a test that needs the whole report registers one function. Registration is
// idempotent per fake.

import type { Fake } from '../server.js';
import { FakeHttpError } from '../server.js';
import {
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from '../worlds/sklep.js';
import { registerErrorGroupsRoute } from './analysis.js';
import { registerCompareRoute } from './compare.js';
import { registerSelfCheckRoutes } from './selfCheck.js';

const registered = new WeakSet<Fake>();

/**
 * `GET …/gatling/executions/{id}` (`api/routes/gatling.py:13273-13341`) and
 * `GET …/gatling/executions/{id}/result` (`api/routes/gatling_results.py:613-751`; 404 `No results
 * found for execution {id}` while the run has no stored result). The routes of the request rows
 * and of the error groups are registered with them.
 */
export function registerResultRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerSelfCheckRoutes(fake);
  registerErrorGroupsRoute(fake);
  registerCompareRoute(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const execution = store
        .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
        .require(req.params.execution_id, `Execution ${req.params.execution_id} not found`);
      return { status: 200, body: { ...execution } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result',
    (req, store) => {
      const id = req.params.execution_id;
      const result = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).get(id);
      if (result === undefined) {
        throw new FakeHttpError(404, { detail: `No results found for execution ${id}` });
      }
      return {
        status: 200,
        body: { ...result, peak_active_users: result.peak_active_users ?? null },
      };
    },
  );
}
