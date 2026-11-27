// The health check of a scenario in the fake backend: `POST /api/scenarios/{id}/health-check` starts it under
// the session id the caller chose, its frames go out on the channel `healthCheck` (nothing is stored: a
// socket that connects after a frame was sent never sees it), and the score is cached for
// `GET /api/scenarios/{id}/staleness` once the check has run to its end. A test writes the script with
// `scriptHealthCheck`; without one the check runs 3 s on the test clock with the three nodes of the
// backend and ends complete. Registration is idempotent per fake.

import { randomUUID } from 'node:crypto';

import type { Fake } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepScenario } from '../worlds/sklep.js';

export interface HealthCheckNode {
  readonly afterMs: number;
  readonly node: 'extract_endpoints' | 'compare' | 'recommend';
  readonly progress: number;
  readonly status: 'running' | 'completed';
}

export interface HealthCheckResult {
  readonly staleness_score?: number;
  readonly covered_endpoints?: readonly {
    readonly drift_details: readonly string[] | null;
    readonly method: string;
    readonly path_template: string;
    readonly status: 'current' | 'modified' | 'removed';
  }[];
  readonly parameter_drifts?: readonly {
    readonly change_description: string;
    readonly endpoint: string;
    readonly new_value_type: string | null;
    readonly old_value_type: string | null;
    readonly param_location: 'query' | 'header' | 'body';
    readonly param_name: string;
  }[];
  readonly recommendations?: readonly string[];
  readonly uncovered_endpoints?: readonly string[];
}

export interface HealthCheckScript {
  /** The nodes the check reports, as the clock reaches them; default: the backend's three. */
  readonly progress?: readonly HealthCheckNode[];
  /** Milliseconds from the start to the end; default 3000. `0` ends at once, with the answer. */
  readonly endMs?: number;
  /** How it ends: the report (default), an `error` frame, or silence (no frame, the score is cached). */
  readonly outcome?: 'complete' | { readonly error: string } | 'silent';
  readonly result?: HealthCheckResult;
}

const SCRIPT = 'health_check_script';
export const HEALTH_CHECKS = 'health_checks';

interface Started {
  readonly id: string;
  readonly scenario_id: string;
  readonly job: string;
  readonly score: number | null;
  readonly checked_at: string;
}

export const DEFAULT_NODES: readonly HealthCheckNode[] = [
  { afterMs: 500, node: 'extract_endpoints', progress: 20, status: 'running' },
  { afterMs: 1000, node: 'extract_endpoints', progress: 50, status: 'completed' },
  { afterMs: 1500, node: 'compare', progress: 60, status: 'completed' },
  { afterMs: 2500, node: 'recommend', progress: 100, status: 'completed' },
];

/** The script of the next checks (until the next script). */
export function scriptHealthCheck(fake: Fake, script: HealthCheckScript): void {
  const collection = fake.store.collection<{ id: string; script: HealthCheckScript }>(SCRIPT);
  collection.delete('script');
  collection.insert({ id: 'script', script });
}

/** The sessions the fake started, in order: what a test checks about the request the tool sent. */
export function startedChecks(fake: Fake): readonly Started[] {
  return fake.store.collection<Started>(HEALTH_CHECKS).list();
}

const registered = new WeakSet<Fake>();

export function registerHealthCheckRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('POST', '/api/scenarios/{scenario_id}/health-check', (req, store, jobs) => {
    const body = req.body as {
      reference_id: string;
      reference_source: string;
      session_id?: string | null;
    };
    const script =
      store.collection<{ id: string; script: HealthCheckScript }>(SCRIPT).get('script')?.script ??
      {};
    const sessionId = body.session_id ?? randomUUID();
    const scenarioId = req.params.scenario_id;
    const endMs = script.endMs ?? 3000;
    const result = script.result ?? {};
    const score = result.staleness_score ?? 0.35;
    const job = jobs.start('health_check', {
      steps: [
        { afterMs: 0, state: 'running' },
        { afterMs: Math.max(1, endMs), state: 'done' },
      ],
    });
    const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
    const known = scenarios.get(scenarioId) !== undefined;
    store.collection<Started>(HEALTH_CHECKS).insert({
      id: sessionId,
      scenario_id: scenarioId,
      job: job.id,
      score: known ? score : null,
      checked_at: new Date(job.startedAt + endMs).toISOString(),
    });
    const channel = fake.channel('healthCheck', { session_id: sessionId });
    const outcome = script.outcome ?? 'complete';
    const terminal =
      outcome === 'silent'
        ? undefined
        : outcome === 'complete'
          ? {
              type: 'complete',
              result: {
                checked_at: new Date(job.startedAt + endMs).toISOString(),
                covered_endpoints: [...(result.covered_endpoints ?? [])],
                parameter_drifts: [...(result.parameter_drifts ?? [])],
                recommendations: [...(result.recommendations ?? [])],
                reference_source: body.reference_source,
                scenario_id: scenarioId,
                staleness_score: score,
                uncovered_endpoints: [...(result.uncovered_endpoints ?? [])],
              },
            }
          : { type: 'error', error: outcome.error, node: null, technical: null };
    const emissions = [
      ...(outcome === 'silent' ? [] : (script.progress ?? DEFAULT_NODES))
        .filter((step) => step.afterMs < endMs)
        .map((step) => ({
          afterMs: step.afterMs,
          frame: {
            type: 'progress',
            node: step.node,
            progress: step.progress,
            status: step.status,
            details: {},
          },
        })),
      ...(terminal === undefined ? [] : [{ afterMs: endMs, frame: terminal }]),
    ];
    if (endMs === 0 && terminal !== undefined) channel.emit(terminal);
    else channel.attach(job, emissions);
    return { status: 200, body: { session_id: sessionId } };
  });
}
