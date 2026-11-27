// The routes behind `scenario_save`: creating an empty scenario (`POST …/gatling/scenarios`) and
// changing its metadata or SLO thresholds (`PUT …/gatling/scenarios/{id}`), as the backend does them:
// an absent or null field stays, a changed name creates a version (tags and the active flag do not),
// `assertion_thresholds` null withdraws and `{}` is the stock SLO, an unknown threshold is a 422.
// Registration is idempotent per fake.

import { FakeHttpError, type Fake } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepScenario } from '../worlds/sklep.js';

const registered = new WeakSet<Fake>();

/** The thresholds the fake knows; any other key is refused as the backend refuses an unknown one. */
export const KNOWN_THRESHOLDS: readonly string[] = ['p50_ms', 'p95_ms', 'p99_ms', 'error_rate_pct'];

interface CreateBody {
  readonly name: string;
  readonly simulation_class_name: string;
  readonly tags?: readonly string[] | null;
  readonly assertion_thresholds?: Record<string, unknown> | null;
}

interface UpdateBody {
  readonly name?: string | null;
  readonly tags?: readonly string[] | null;
  readonly is_active?: boolean | null;
  readonly assertion_thresholds?: Record<string, unknown> | null;
}

/** The 422 of a body that fails validation (`HTTPValidationError`). */
function refusal(message: string): FakeHttpError {
  return new FakeHttpError(422, {
    detail: [{ loc: ['body', 'assertion_thresholds'], msg: message, type: 'value_error' }],
  });
}

function checkThresholds(value: Record<string, unknown> | null | undefined): void {
  for (const [key, one] of Object.entries(value ?? {})) {
    if (!KNOWN_THRESHOLDS.includes(key)) {
      throw refusal(`Unknown assertion threshold: ${key}`);
    }
    if (typeof one !== 'number') {
      throw refusal(`Threshold ${key} must be a number`);
    }
  }
}

export function registerScenarioSaveRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // A new scenario is metadata only: the world's first scenario with its own identity, no tags and
  // no thresholds (the answer of a read of it is a whole scenario, as the contract has it).
  fake.route('POST', '/api/v1/projects/{project_id}/gatling/scenarios', (req, store) => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
    const body = req.body as CreateBody;
    checkThresholds(body.assertion_thresholds);
    const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
    const [template] = scenarios.list();
    if (template === undefined) throw new Error('the world has no scenario to copy');
    const id = store.newId();
    scenarios.insert({
      ...structuredClone(template),
      id,
      name: body.name,
      simulation_class_name: body.simulation_class_name,
      description: '',
      tags: [...(body.tags ?? [])],
      is_active: true,
      current_version: 1,
      assertion_thresholds: body.assertion_thresholds ?? null,
    });
    return { status: 200, body: { id, message: 'Scenario created' } };
  });

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      const scenario = scenarios.require(req.params.scenario_id, 'Scenario not found');
      const body = req.body as UpdateBody;
      if ('assertion_thresholds' in body) checkThresholds(body.assertion_thresholds);
      const renamed = body.name !== undefined && body.name !== null && body.name !== scenario.name;
      scenarios.update(scenario.id, {
        ...(body.name === undefined || body.name === null ? {} : { name: body.name }),
        ...(body.tags === undefined || body.tags === null ? {} : { tags: [...body.tags] }),
        ...(body.is_active === undefined || body.is_active === null
          ? {}
          : { is_active: body.is_active }),
        ...('assertion_thresholds' in body
          ? { assertion_thresholds: body.assertion_thresholds ?? null }
          : {}),
        ...(renamed ? { current_version: scenario.current_version + 1 } : {}),
      });
      return { status: 200, body: { message: 'Scenario updated' } };
    },
  );
}
