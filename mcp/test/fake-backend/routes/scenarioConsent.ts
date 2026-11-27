// The routes behind the tools of module scenario that ask on a consent card and that no other route
// set answers: its build
// (`POST …/compositions/{id}/dry-run`), and the copilot of a scenario (`POST …/scenarios/{id}/copilot/messages`
// and `…/messages/review`). Registration is idempotent per fake.

import { FakeHttpError, type Fake, type FakeRequest, type Store } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepComposition, type SklepScenario } from '../worlds/sklep.js';

const registered = new WeakSet<Fake>();

/** What a build answers (`dry_run_composition`): the verdict, the Gradle output on a failure. */
export interface DryRunAnswer {
  readonly is_valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly duration_seconds: number;
  /** Absent when no member is enabled. */
  readonly raw_output?: string;
}

/** A build that failed with this status instead of an answer (409: a member has no modular build). */
export interface DryRunRefusal {
  readonly error: { readonly status: number; readonly detail: unknown };
}

const DRY_RUNS = 'scenario_dry_runs';
const COPILOT = 'scenario_copilot_answers';

/** One proposal of the copilot, as the contract has it (the kinds the scenario copilot knows). */
export type CopilotAction =
  | {
      readonly kind: 'adjust_and_regenerate';
      readonly summary: string;
      readonly drop_flow_overlay: boolean;
    }
  | {
      readonly kind: 'rewrite_validator';
      readonly summary: string;
      readonly validator_name: string;
      readonly drop_flow_overlay: boolean;
    }
  | {
      readonly kind: 'generate_slot_feeder';
      readonly slot: string;
      readonly row_count: number;
      readonly enrich_with_llm: boolean;
    };

/** What the copilot of a scenario answers. */
export interface CopilotAnswer {
  readonly reply: string;
  readonly actions: readonly CopilotAction[];
}

/** What the copilot of scenario `scenarioId` answers (a question and a review alike); a refusal instead. */
export function seedCopilot(
  store: Store,
  scenarioId: string,
  answer: CopilotAnswer | DryRunRefusal,
): void {
  const records = store.collection<{ id: string; answer: CopilotAnswer | DryRunRefusal }>(COPILOT);
  records.delete(scenarioId);
  records.insert({ id: scenarioId, answer });
}

/** The workload types the scenario copilot models; `production` is not one of them. */
const MODELLED = ['smoke', 'ramp', 'constant', 'ramp_hold', 'stress'];

const DEFAULT_ANSWER: CopilotAnswer = {
  reply: 'Add a think time to the checkout step and bind the search dataset.',
  actions: [
    {
      kind: 'adjust_and_regenerate',
      summary: 'Add a 2 s pause after checkout',
      drop_flow_overlay: false,
    },
  ],
};

/** What the build of composition `compositionId` answers; without it, a build that passes. */
export function seedDryRun(
  store: Store,
  compositionId: string,
  answer: DryRunAnswer | DryRunRefusal,
): void {
  const records = store.collection<{ id: string; answer: DryRunAnswer | DryRunRefusal }>(DRY_RUNS);
  records.delete(compositionId);
  records.insert({ id: compositionId, answer });
}

/** The composition `id` of the project, or the 404 of the backend. */
function compositionOf(fake: Fake, id: string): SklepComposition {
  const found = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions).get(id);
  if (found === undefined) throw new FakeHttpError(404, { detail: 'Composition not found' });
  return found;
}

export function registerScenarioConsentRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // The build of the composition a run would ship: a pass, unless a test seeded another answer; with no
  // enabled member there is nothing to build (no output).
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/dry-run',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const saved = compositionOf(fake, req.params.composition_id);
      const seeded = store
        .collection<{ id: string; answer: DryRunAnswer | DryRunRefusal }>(DRY_RUNS)
        .get(saved.id)?.answer;
      if (seeded !== undefined && 'error' in seeded) {
        throw new FakeHttpError(seeded.error.status, { detail: seeded.error.detail });
      }
      if (seeded !== undefined) {
        return {
          status: 200,
          body: { ...seeded, errors: [...seeded.errors], warnings: [...seeded.warnings] },
        };
      }
      if (!saved.scenarios.some((link) => link.enabled)) {
        return {
          status: 200,
          body: {
            is_valid: false,
            errors: ['No enabled scenario'],
            warnings: [],
            duration_seconds: 0.1,
          },
        };
      }
      return {
        status: 200,
        body: { is_valid: true, errors: [], warnings: [], duration_seconds: 42.5, raw_output: '' },
      };
    },
  );

  // The copilot proposes and applies nothing; both routes answer from the seeded answer (a default
  // proposal without one) and refuse a workload of a type it does not model.
  const copilot =
    (review: boolean) =>
    (req: FakeRequest<{ project_id: string; scenario_id: string }>, store: Store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      const body = (req.body ?? {}) as { message?: string; workload?: { type?: string } | null };
      if (!review && (body.message === undefined || body.message === '')) {
        throw new FakeHttpError(422, {
          detail: [{ loc: ['body', 'message'], msg: 'Field required', type: 'missing' }],
        });
      }
      const type = body.workload?.type;
      if (type !== undefined && !MODELLED.includes(type)) {
        throw new FakeHttpError(422, {
          detail: [
            {
              loc: ['body', 'workload', 'type'],
              msg: 'workload_type_not_modelled',
              type: 'value_error',
            },
          ],
        });
      }
      const seeded = store
        .collection<{ id: string; answer: CopilotAnswer | DryRunRefusal }>(COPILOT)
        .get(scenario.id)?.answer;
      if (seeded !== undefined && 'error' in seeded) {
        throw new FakeHttpError(seeded.error.status, { detail: seeded.error.detail });
      }
      const answer = seeded ?? DEFAULT_ANSWER;
      return {
        status: 200,
        body: {
          message_id: store.newId(),
          reply: answer.reply,
          actions: answer.actions.map((one) => ({ ...one })),
        },
      };
    };
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/messages',
    copilot(false),
  );
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/messages/review',
    copilot(true),
  );
}
