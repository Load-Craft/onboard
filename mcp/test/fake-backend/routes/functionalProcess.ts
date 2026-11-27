// The long operations of module functional in the fake backend (src/tools/functional/): the AI run on the
// test types (`POST …/test-types/suggest-async` and `…/generate-async`, the channel `testTypes`, the outcome
// at `GET …/test-types/suggest/{run_id}`) and the payload generation (`POST …/generate-payloads-async`, the
// channel `payloadGen`, the ZIP at `GET …/generate-payloads/{run_id}/download`, served once). Frames are not
// stored: a socket that connects after a frame was sent never sees it, and the REST outcome holds the result.
// A test writes the script with `scriptTestTypes` and `scriptPayloads`; without one a run takes 3 s of the
// test clock and ends complete. A generation creates the test types of the project when it starts.
// Registration is idempotent per fake.

import { randomUUID } from 'node:crypto';

import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

type Outcome = 'complete' | { readonly error: string } | 'silent';

export interface TestTypesScript {
  /** Milliseconds from the start to the end; default 3000. */
  readonly endMs?: number;
  readonly outcome?: Outcome;
  /** suggest: the suggestions of the run. */
  readonly suggestions?: readonly Record<string, unknown>[];
  /** generate: the names of the test types the run creates. */
  readonly created?: readonly string[];
  /** generate: base types the project already had. */
  readonly skipped?: number;
  readonly rationale?: string | null;
  readonly omitted?: readonly string[];
}

export interface PayloadsScript {
  readonly endMs?: number;
  readonly outcome?: Outcome;
  /** The ZIP the download serves. */
  readonly bytes?: Buffer;
}

const SCRIPTS = 'functional_process_scripts';
const RUNS = 'functional_process_runs';

interface Stored<T> {
  readonly id: string;
  readonly value: T;
}

function putScript(fake: Fake, key: string, value: unknown): void {
  const records = fake.store.collection<Stored<unknown>>(SCRIPTS);
  records.delete(key);
  records.insert({ id: key, value });
}

export const scriptTestTypes = (fake: Fake, script: TestTypesScript): void =>
  putScript(fake, 'testTypes', script);
export const scriptPayloads = (fake: Fake, script: PayloadsScript): void =>
  putScript(fake, 'payloads', script);

function scriptOf<T>(store: Store, key: string): T {
  return (store.collection<Stored<T>>(SCRIPTS).get(key)?.value ?? {}) as T;
}

interface TestTypesRun {
  readonly id: string;
  readonly mode: 'suggest' | 'generate';
  readonly job: string;
  readonly endMs: number;
  readonly outcome: Outcome;
  readonly payload: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
}

interface PayloadsRun {
  readonly id: string;
  readonly job: string;
  readonly endMs: number;
  readonly outcome: Outcome;
  readonly bytes: Buffer;
  downloaded: boolean;
  readonly body: {
    flow_ids: string[];
    test_type_ids: string[];
    test_counts: Record<string, number>;
  };
}

const DEFAULT_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('payloads')]);
export const PAYLOAD_RUNS = 'functional_payload_runs';
export const TEST_TYPES_RUNS = RUNS;

/** The payload runs the fake started, in order: what a test checks about the request the tool sent. */
export function startedPayloads(fake: Fake): readonly PayloadsRun[] {
  return fake.store.collection<PayloadsRun>(PAYLOAD_RUNS).list();
}

const registered = new WeakSet<Fake>();

export function registerFunctionalProcessRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  const requireProject = (store: Store, id: string): void => {
    store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
  };

  const startTestTypes = (
    store: Store,
    jobs: Parameters<Parameters<Fake['route']>[2]>[2],
    projectId: string,
    mode: 'suggest' | 'generate',
  ): { run_id: string; mode: string; status: string } => {
    requireProject(store, projectId);
    const script = scriptOf<TestTypesScript>(store, 'testTypes');
    const runId = randomUUID();
    const endMs = script.endMs ?? 3000;
    const outcome = script.outcome ?? 'complete';
    const suggestions = [...(script.suggestions ?? [])];
    let created: Record<string, unknown>[] = [];
    if (mode === 'generate') {
      const testTypes = store.collection<Record<string, unknown> & { id: string }>(
        SKLEP_COLLECTIONS.testTypes,
      );
      created = (script.created ?? []).map((name, index) =>
        testTypes.insert({
          id: store.newId(),
          project_id: projectId,
          default_count: 3,
          is_enabled: true,
          priority: 100 + index,
          base_type_name: name,
          effective_name: name,
          effective_display_name: name,
          effective_category: 'generated',
        }),
      );
    }
    const payload: Record<string, unknown> = {
      mode,
      omitted_operations: [...(script.omitted ?? [])],
      run_id: runId,
      status: 'completed',
      ...(mode === 'suggest'
        ? { suggestions, total: suggestions.length }
        : {
            created: created.length,
            skipped: script.skipped ?? 0,
            rationale: script.rationale ?? null,
            test_types: created,
          }),
    };
    const job = jobs.start('test_types', {
      steps: [
        { afterMs: 0, state: 'running' },
        { afterMs: Math.max(1, endMs), state: 'done' },
      ],
    });
    const result: Record<string, unknown> | null =
      mode === 'generate'
        ? {
            created: created.length,
            skipped: script.skipped ?? 0,
            rationale: script.rationale ?? null,
            test_types: created,
            omitted_operations: [...(script.omitted ?? [])],
            uses_soft_errors: false,
          }
        : null;
    store
      .collection<TestTypesRun>(RUNS)
      .insert({ id: runId, mode, job: job.id, endMs, outcome, payload, result });
    const channel = fake.channel('testTypes', { run_id: runId });
    const terminal =
      outcome === 'silent'
        ? undefined
        : outcome === 'complete'
          ? { type: 'test-types:complete', payload }
          : {
              type: 'test-types:error',
              payload: { error: outcome.error, mode, recoverable: false },
            };
    const step = (afterMs: number, current: string, progress: number) => ({
      afterMs,
      frame: {
        type: 'test-types:progress',
        payload: {
          current_step: current,
          mode,
          progress,
          status: 'in_progress',
          step_label: current,
        },
      },
    });
    channel.attach(job, [
      ...(outcome === 'silent'
        ? []
        : [step(500, 'prepare_context', 15), step(1500, 'run_operation', 55)].filter(
            (item) => item.afterMs < endMs,
          )),
      ...(terminal === undefined ? [] : [{ afterMs: endMs, frame: terminal }]),
    ]);
    return { run_id: runId, mode, status: 'started' };
  };

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/test-types/suggest-async',
    (req, store, jobs) => ({
      status: 200,
      body: startTestTypes(store, jobs, req.params.project_id, 'suggest'),
    }),
  );
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/test-types/generate-async',
    (req, store, jobs) => ({
      status: 200,
      body: startTestTypes(store, jobs, req.params.project_id, 'generate'),
    }),
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/test-types/suggest/{run_id}',
    (req, store, jobs) => {
      requireProject(store, req.params.project_id);
      const run = store.collection<TestTypesRun>(RUNS).get(req.params.run_id);
      if (run === undefined) throw new FakeHttpError(404, { detail: 'Run not found' });
      if (!jobs.read(run.job).finished) {
        return { status: 200, body: { run_id: run.id, status: 'pending' } };
      }
      if (typeof run.outcome === 'object') {
        return {
          status: 200,
          body: { run_id: run.id, status: 'failed', mode: run.mode, error: run.outcome.error },
        };
      }
      return {
        status: 200,
        body:
          run.mode === 'suggest'
            ? {
                run_id: run.id,
                status: 'completed',
                mode: 'suggest',
                suggestions: run.payload['suggestions'] as never,
                total: run.payload['total'] as number,
                omitted_operations: run.payload['omitted_operations'] as string[],
              }
            : { run_id: run.id, status: 'completed', mode: 'generate', result: run.result },
      };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/generate-payloads-async',
    (req, store, jobs) => {
      requireProject(store, req.params.project_id);
      const body = req.body as PayloadsRun['body'];
      const script = scriptOf<PayloadsScript>(store, 'payloads');
      const runId = randomUUID();
      const endMs = script.endMs ?? 3000;
      const outcome = script.outcome ?? 'complete';
      const job = jobs.start('payload_gen', {
        steps: [
          { afterMs: 0, state: 'running' },
          { afterMs: Math.max(1, endMs), state: 'done' },
        ],
      });
      store.collection<PayloadsRun>(PAYLOAD_RUNS).insert({
        id: runId,
        job: job.id,
        endMs,
        outcome,
        bytes: script.bytes ?? DEFAULT_ZIP,
        downloaded: false,
        body,
      });
      const channel = fake.channel('payloadGen', { run_id: runId });
      const terminal =
        outcome === 'silent'
          ? undefined
          : outcome === 'complete'
            ? { type: 'payload-gen:complete', payload: { run_id: runId, status: 'completed' } }
            : {
                type: 'payload-gen:error',
                payload: { error: outcome.error, recoverable: false },
              };
      const step = (afterMs: number, current: string, progress: number) => ({
        afterMs,
        frame: {
          type: 'payload-gen:progress',
          payload: {
            current_step: current,
            progress,
            status: 'in_progress',
            step_label: current,
          },
        },
      });
      channel.attach(job, [
        ...(outcome === 'silent'
          ? []
          : [
              step(300, 'prepare', 10),
              step(1000, 'generate', 30),
              step(2000, 'package', 90),
            ].filter((item) => item.afterMs < endMs)),
        ...(terminal === undefined ? [] : [{ afterMs: endMs, frame: terminal }]),
      ]);
      return { status: 200, body: { run_id: runId, status: 'started' as const } };
    },
  );

  // The ZIP is served once: 404 for an unknown run, one still running, a failed one, one already served.
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/generate-payloads/{run_id}/download',
    (req, store, jobs) => {
      requireProject(store, req.params.project_id);
      const run = store.collection<PayloadsRun>(PAYLOAD_RUNS).get(req.params.run_id);
      if (
        run === undefined ||
        run.downloaded ||
        typeof run.outcome === 'object' ||
        !jobs.read(run.job).finished
      ) {
        throw new FakeHttpError(404, { detail: 'Payloads not available' });
      }
      store.collection<PayloadsRun>(PAYLOAD_RUNS).update(run.id, { downloaded: true });
      return {
        status: 200,
        body: run.bytes,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="payloads-${run.id.slice(0, 8)}.zip"`,
        },
      };
    },
  );
}
