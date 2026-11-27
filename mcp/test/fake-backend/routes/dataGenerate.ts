// AI dataset generation of the fake backend: `POST …/feeders/generate-async` (a flow; the run's frames go out on
// the channel `gatlingFeeder` and the dataset exists in the list only once the run has ended well) and
// `POST …/feeders/generate-from-scenario` (a scenario; synchronous). The slot route is in `provision.ts`.
// A test writes the script of the next runs with `scriptFeederGeneration`; without one a run takes 4 s on the test
// clock, reports its four steps and ends complete. Registration is idempotent per fake.

import { randomUUID } from 'node:crypto';

import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepFeeder, type SklepScenario } from '../worlds/sklep.js';
import { generatedContent, newFeeder } from './provision.js';

export interface FeederGenerationScript {
  /** Milliseconds from the start to the end; default 4000. `0` ends at once. */
  readonly endMs?: number;
  /** How it ends: `complete` (default), an `error` frame (nothing saved), or silence (the dataset appears, no frame). */
  readonly outcome?:
    'complete' | { readonly error: string; readonly recoverable?: boolean } | 'silent';
  /** The columns of the dataset; default: `name`, `email`, `city`. */
  readonly columns?: readonly string[];
}

const SCRIPT = 'feeder_generation_script';
export const FEEDER_RUNS = 'feeder_generation_runs';

export interface FeederRun {
  readonly id: string;
  readonly feeder_id: string;
  readonly job: string;
  readonly failed: boolean;
  readonly body: Readonly<Record<string, unknown>>;
}

export const DEFAULT_STEPS = [
  { afterMs: 500, step: 'prepare', label: 'Preparing', progress: 10 },
  { afterMs: 1500, step: 'generate', label: 'Generating the rows', progress: 35 },
  { afterMs: 2500, step: 'format', label: 'Formatting', progress: 70 },
  { afterMs: 3500, step: 'save', label: 'Saving', progress: 90 },
] as const;

/** The script of the next runs (until the next script). */
export function scriptFeederGeneration(fake: Fake, script: FeederGenerationScript): void {
  const collection = fake.store.collection<{ id: string; script: FeederGenerationScript }>(SCRIPT);
  collection.delete('script');
  collection.insert({ id: 'script', script });
}

/** The runs the fake started, in order: what a test checks about the request the tool sent. */
export function startedRuns(fake: Fake): readonly FeederRun[] {
  return fake.store.collection<FeederRun>(FEEDER_RUNS).list();
}

/** The datasets of runs that have not ended well yet: the list does not show them. */
export function hiddenFeederIds(
  store: Store,
  jobs: { find<S>(id: string): { readonly state: S } | undefined },
): ReadonlySet<string> {
  return new Set(
    store
      .collection<FeederRun>(FEEDER_RUNS)
      .list((run) => run.failed || jobs.find<string>(run.job)?.state !== 'done')
      .map((run) => run.feeder_id),
  );
}

const registered = new WeakSet<Fake>();

export function registerDataGenerateRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/generate-async',
    (req, store, jobs) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const body = req.body as {
        name: string;
        flow_id?: string | null;
        record_count: number;
        feeder_type: string;
      };
      const script =
        store.collection<{ id: string; script: FeederGenerationScript }>(SCRIPT).get('script')
          ?.script ?? {};
      const endMs = script.endMs ?? 4000;
      const runId = randomUUID();
      const outcome = script.outcome ?? 'complete';
      const job = jobs.start('feeder_generation', {
        steps: [
          { afterMs: 0, state: 'running' },
          { afterMs: Math.max(1, endMs), state: 'done' },
        ],
      });
      const columns = [...(script.columns ?? ['name', 'email', 'city'])];
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      const feeder = feeders.insert(
        newFeeder(randomUUID(), {
          name: body.name,
          file_name: `${body.name}.${body.feeder_type}`,
          content: generatedContent(columns, body.record_count),
          record_count: body.record_count,
          columns,
          provenance: 'auto',
          created_at: new Date(job.startedAt + endMs).toISOString(),
          updated_at: new Date(job.startedAt + endMs).toISOString(),
        }),
      );
      store.collection<FeederRun>(FEEDER_RUNS).insert({
        id: runId,
        feeder_id: feeder.id,
        job: job.id,
        failed: typeof outcome === 'object',
        body,
      });
      const channel = fake.channel('gatlingFeeder', { run_id: runId });
      const terminal =
        outcome === 'silent'
          ? undefined
          : outcome === 'complete'
            ? {
                type: 'gatling-feeder:complete',
                payload: { feeder_id: feeder.id, run_id: runId, status: 'completed' },
              }
            : {
                type: 'gatling-feeder:error',
                payload: { error: outcome.error, recoverable: outcome.recoverable ?? true },
              };
      const emissions = [
        ...(outcome === 'silent' ? [] : DEFAULT_STEPS)
          .filter((step) => step.afterMs < endMs)
          .map((step) => ({
            afterMs: step.afterMs,
            frame: {
              type: 'gatling-feeder:progress',
              payload: {
                current_step: step.step,
                progress: step.progress,
                status: 'in_progress',
                step_label: step.label,
              },
            },
          })),
        ...(terminal === undefined ? [] : [{ afterMs: endMs, frame: terminal }]),
      ];
      if (endMs === 0 && terminal !== undefined) channel.emit(terminal);
      else channel.attach(job, emissions);
      return { status: 200, body: { run_id: runId, status: 'started' } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/generate-from-scenario',
    (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const body = req.body as {
        scenario_id: string;
        name: string;
        output_type: string;
        row_count: number;
      };
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .get(body.scenario_id);
      if (scenario === undefined) throw new FakeHttpError(404, { detail: 'Scenario not found' });
      const columns = [
        ...new Set(
          scenario.feeder_slots
            .filter((slot) => slot.role === 'data' || slot.identity_kind === null)
            .flatMap((slot) => slot.columns),
        ),
      ];
      if (columns.length === 0) {
        throw new FakeHttpError(400, {
          detail: 'The scenario has no slot of plain data to generate.',
        });
      }
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      const created = feeders.insert(
        newFeeder(randomUUID(), {
          name: body.name,
          file_name: `${body.name}.${body.output_type}`,
          content: generatedContent(columns, body.row_count),
          record_count: body.row_count,
          columns,
        }),
      );
      return { status: 200, body: { ...created } };
    },
  );
}
