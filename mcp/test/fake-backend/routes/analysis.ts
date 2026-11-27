// Analysis routes of the fake backend, over the `gatling_execution_analyses` collection of the
// sklep world. `process_get_status` only asks whether a stored analysis exists; `results_analyze_run` reads the
// same route. Registration is idempotent per fake, so every tool test that needs the route can call
// it without knowing who registered it first.

import { FakeHttpError, type Fake, type Job, type Store } from '../server.js';
import { requireRun } from './executionOwner.js';
import {
  SKLEP_COLLECTIONS,
  type SklepAnalysisDocument,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
} from '../worlds/sklep.js';

const registered = new WeakSet<Fake>();
const startRegistered = new WeakSet<Fake>();
const errorsRegistered = new WeakSet<Fake>();

/** How a started analysis behaves; the defaults are a successful run of six seconds. */
export interface AnalysisRunScript {
  /** Progress frames: `afterMs` after the start. */
  readonly progress?: readonly {
    readonly afterMs: number;
    readonly progress: number;
    readonly step: 'collect' | 'analyze' | 'persist';
    readonly label: string;
  }[];
  /** The document is stored and the `complete` frame sent this long after the start. */
  readonly completeAfterMs?: number;
  /** The run fails instead: only an `error` frame, nothing is stored. */
  readonly failure?: {
    readonly afterMs: number;
    readonly error: string;
    readonly recoverable?: boolean;
  };
  /** Fields of the stored document that differ from the seeded one. */
  readonly document?: Partial<SklepAnalysisDocument>;
  /** The channel stays quiet (no observer, or a stuck run): the result is stored all the same. */
  readonly silent?: boolean;
  readonly costUsd?: number;
}

const DEFAULT_PROGRESS: NonNullable<AnalysisRunScript['progress']> = [
  { afterMs: 1_000, progress: 10, step: 'collect', label: 'Collecting run data' },
  { afterMs: 3_000, progress: 55, step: 'analyze', label: 'Analysing' },
];
const DEFAULT_COMPLETE_MS = 6_000;

interface StartedRun {
  readonly job: Job;
  readonly executionId: string;
  readonly script: AnalysisRunScript;
  /** The row the stored one is made from, with `document` as its analysis. */
  readonly template: SklepExecutionAnalysis;
  readonly document: SklepAnalysisDocument;
  persisted: boolean;
}

const started = new WeakMap<Fake, StartedRun[]>();

function newestAnalysis(store: Store, executionId: string): SklepExecutionAnalysis | undefined {
  return store
    .collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses)
    .list((analysis) => analysis.execution_id === executionId)
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
}

/** Stores the document of every started run that has finished by now, as the background task does. */
function settle(fake: Fake): void {
  const analyses = fake.store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses);
  for (const run of started.get(fake) ?? []) {
    if (run.persisted) continue;
    const job = fake.jobs.find(run.job.id);
    if (job === undefined || job.state !== 'done') continue;
    run.persisted = true;
    const afterMs = run.script.completeAfterMs ?? DEFAULT_COMPLETE_MS;
    analyses.insert({
      ...run.template,
      id: `analysis-${job.id}`,
      execution_id: run.executionId,
      cost_usd: run.script.costUsd ?? 0.07,
      generated_at: new Date(job.startedAt + afterMs).toISOString(),
      analysis: run.document,
    });
  }
}

/**
 * `GET …/gatling/executions/{id}/analysis`: the newest stored document; 404 `No analysis has been
 * generated for this execution yet.` while there is none.
 */
export function registerAnalysisReadRoute(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analysis',
    (req, store) => {
      settle(fake);
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      store
        .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
        .require(req.params.execution_id, 'Execution not found');
      const stored = store
        .collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses)
        .list((analysis) => analysis.execution_id === req.params.execution_id)
        .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
      if (stored === undefined) {
        throw new FakeHttpError(404, {
          detail: 'No analysis has been generated for this execution yet.',
        });
      }
      return { status: 200, body: { ...stored } };
    },
  );
}

/**
 * `POST …/gatling/executions/{id}/analyze-async[?force=true]`: a stored analysis and no `force`
 * answers `{cached: true, …}`; otherwise every call starts a NEW run —
 * the backend does not deduplicate — and answers `{cached: false, run_id, status: 'started'}`.
 * The run is a fake job: it sends its frames on the `analysis` channel and stores its document
 * when the test clock reaches the end, whether or not anybody listens. The script is that of the
 * first registration. Also registers the read route.
 */
export function registerAnalysisStartRoute(fake: Fake, script: AnalysisRunScript = {}): void {
  registerAnalysisReadRoute(fake);
  if (startRegistered.has(fake)) return;
  startRegistered.add(fake);
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analyze-async',
    (req, store, jobs) => {
      settle(fake);
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const executionId = req.params.execution_id;
      store
        .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
        .require(executionId, 'Execution not found');
      const stored = newestAnalysis(store, executionId);
      if (stored !== undefined && req.query['force'] !== 'true') {
        return {
          status: 200,
          body: {
            cached: true,
            analysis: stored.analysis,
            verdict: stored.verdict,
            generated_at: stored.generated_at,
            model: stored.model,
            cost_usd: stored.cost_usd,
          },
        };
      }
      const endMs = script.failure?.afterMs ?? script.completeAfterMs ?? DEFAULT_COMPLETE_MS;
      const job = jobs.start('analyze', {
        steps: [
          { afterMs: 0, state: 'running' },
          { afterMs: endMs, state: script.failure === undefined ? 'done' : 'failed' },
        ],
      });
      const template =
        stored ?? store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses).list()[0];
      if (template === undefined) {
        throw new Error('the fake analysis route needs a seeded analysis to copy from');
      }
      const document = { ...template.analysis, ...script.document };
      const run: StartedRun = { job, executionId, script, template, document, persisted: false };
      started.set(fake, [...(started.get(fake) ?? []), run]);
      const channel = fake.channel('analysis', { run_id: job.id });
      if (script.silent !== true) {
        const progress = (script.progress ?? DEFAULT_PROGRESS).map((step) => ({
          afterMs: step.afterMs,
          frame: {
            type: 'gatling-analysis:progress',
            payload: {
              progress: step.progress,
              current_step: step.step,
              step_label: step.label,
            },
          },
        }));
        const last =
          script.failure === undefined
            ? {
                afterMs: endMs,
                frame: {
                  type: 'gatling-analysis:complete',
                  payload: { run_id: job.id, analysis: document },
                },
              }
            : {
                afterMs: endMs,
                frame: {
                  type: 'gatling-analysis:error',
                  payload: {
                    error: script.failure.error,
                    ...(script.failure.recoverable === undefined
                      ? {}
                      : { recoverable: script.failure.recoverable }),
                  },
                },
              };
        channel.attach(job, [...progress.filter((step) => step.afterMs < endMs), last]);
      }
      return { status: 200, body: { cached: false, run_id: job.id, status: 'started' as const } };
    },
  );
}

/**
 * `GET …/gatling/executions/{id}/errors`: the error groups of the stored result
 *, the counts the diagnosis shows.
 */
export function registerErrorGroupsRoute(fake: Fake): void {
  if (errorsRegistered.has(fake)) return;
  errorsRegistered.add(fake);
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/errors',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const result = store
        .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
        .require(req.params.execution_id, 'Result not found');
      return {
        status: 200,
        body: {
          errors: result.errors,
          error_summary: null,
          error_summary_source: null,
          series_source: result.series_source,
          series_retention: result.series_retention,
        },
      };
    },
  );
}
