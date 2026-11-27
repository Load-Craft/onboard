// The comparison of two runs of the fake backend (`GET …/gatling/executions/compare`),
// derived from the executions and results of the sklep
// world: the twelve metrics as `{a, b, delta}`, the load compared from the run manifests, and the
// overall answer as a conjunction over the facts that are known (null when nothing differs and
// something could not be read). A test may pin the answer for one pair (`seedComparison`).
// Registration is idempotent per fake.

import type { Fake, Store, SuccessBody } from '../server.js';
import { FakeHttpError } from '../server.js';
import {
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from '../worlds/sklep.js';

const registered = new WeakSet<Fake>();

/** The answer of `GET …/gatling/executions/compare`. */
export type ComparisonAnswer = SuccessBody<
  '/api/v1/projects/{project_id}/gatling/executions/compare',
  'GET'
>;

/** A comparison seeded for a pair: its answer, or an error in its place. */
export type SeededComparison =
  ComparisonAnswer | { readonly error: { readonly status: number; readonly detail: unknown } };

const SEEDED_COMPARISONS = 'gatling_execution_comparisons';

interface StoredComparison {
  readonly id: string;
  readonly answer: SeededComparison;
}

/**
 * The answer for the pair (`a`, `b`) in that order, read before the comparison is derived from the
 * world; a pair with nothing seeded is compared as before.
 */
export function seedComparison(store: Store, a: string, b: string, answer: SeededComparison): void {
  const records = store.collection<StoredComparison>(SEEDED_COMPARISONS);
  const id = `${a}|${b}`;
  records.delete(id);
  records.insert({ id, answer });
}

const METRICS = [
  'total_requests',
  'ok_count',
  'ko_count',
  'mean_response_time',
  'min_response_time',
  'max_response_time',
  'p50',
  'p75',
  'p90',
  'p95',
  'p99',
  'requests_per_second',
] as const;

type Row = Record<string, unknown>;

function field(row: unknown, name: string): number | null {
  const value = (row as Row)[name];
  return typeof value === 'number' ? value : null;
}

function delta(a: number | null, b: number | null): number | null {
  return typeof a === 'number' && typeof b === 'number' ? Math.round((b - a) * 100) / 100 : null;
}

/** The load of the two manifests: null when either has none, else whether they are equal. */
function sameWorkload(a: SklepExecution, b: SklepExecution): boolean | null {
  const first = a.run_manifest.workload;
  const second = b.run_manifest.workload;
  if (first === null || second === null) return null;
  return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * `GET …/gatling/executions/compare?a=&b=`: 404 `Execution {id} not found in project {pid}` for a
 * run the project does not have, 404 `No results found for execution {id}` for one without a
 * stored result.
 */
export function registerCompareRoute(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/executions/compare', (req, store) => {
    const executions = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
    const results = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
    const ids = [req.query.a, req.query.b].map((id) => id ?? '');
    const pinned = store
      .collection<StoredComparison>(SEEDED_COMPARISONS)
      .get(`${ids[0] ?? ''}|${ids[1] ?? ''}`)?.answer;
    if (pinned !== undefined) {
      if ('error' in pinned) {
        throw new FakeHttpError(pinned.error.status, { detail: pinned.error.detail });
      }
      return { status: 200, body: pinned };
    }
    const [a, b] = ids.map((id) => {
      const execution = executions.get(id);
      if (execution === undefined) {
        throw new FakeHttpError(404, {
          detail: `Execution ${id} not found in project ${req.params.project_id}`,
        });
      }
      return execution;
    });
    const [resultA, resultB] = ids.map((id) => {
      const result = results.get(id);
      if (result === undefined) {
        throw new FakeHttpError(404, { detail: `No results found for execution ${id}` });
      }
      return result;
    });
    if (a === undefined || b === undefined || resultA === undefined || resultB === undefined) {
      throw new FakeHttpError(404, { detail: 'Execution not found' });
    }

    const workload = sameWorkload(a, b);
    const reasons =
      a.run_manifest.target_base_url === b.run_manifest.target_base_url
        ? []
        : [
            `target_base_url differs: ${a.run_manifest.target_base_url} (a) vs ${b.run_manifest.target_base_url} (b)`,
          ];
    const comparable = workload === false || reasons.length > 0 ? false : workload;
    return {
      status: 200,
      body: {
        execution_a_id: a.id,
        execution_b_id: b.id,
        environment_a_id: a.run_manifest.target_environment_id,
        environment_b_id: b.run_manifest.target_environment_id,
        same_workload: workload,
        same_workload_basis: workload === null ? ('none' as const) : ('run_manifest' as const),
        comparable,
        not_comparable_reasons: reasons,
        metrics: Object.fromEntries(
          METRICS.map((name) => {
            const first = field(resultA, name);
            const second = field(resultB, name);
            return [name, { a: first, b: second, delta: delta(first, second) }];
          }),
        ),
        error_summary: { only_in_a: [], only_in_b: [], common: [] },
        warnings: [],
      },
    };
  });
}
