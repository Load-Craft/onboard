// Generation of one flow from a description of the fake backend (`generate-async` and the state
// read): the POST answers with a run id at once after the checks that come before the run (setup
// gate, endpoint ids, Pydantic limits of `GenerateFlowRequest`), the run goes on the test clock,
// and the flow it makes is saved when the run completes. The state is kept by the "backend": `GET
// …/flow-generation/{run_id}/status` answers 404 for a run the process does not know, as after a
// restart (`fake.faults.restart()`).

import type { components } from '../../../src/http/generated/api.js';
import type { Clock } from '../../../src/ops/clock.js';
import { FakeHttpError, type Fake } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';
import { pinOf, synthesize } from './batch.js';

type FlowDetail = components['schemas']['FlowDetail'];
type GenerateFlowRequest = components['schemas']['GenerateFlowRequest'];
type RegenerateFlowRequest = components['schemas']['RegenerateFlowRequest'];

const FLOWS = 'flows';
/** The run is `running` from this moment; a run is never done earlier. */
const RUNNING_AT_MS = 1000;
const DEFAULT_DONE_MS = 6000;

export interface FlowGenerationWorld {
  /** Milliseconds after the start at which the run ends; default 6 s. */
  readonly afterMs?: number;
  /** The flow to save (its name is replaced by the request's); default: built from the endpoints. */
  readonly flow?: FlowDetail;
  /** The run ends `failed` with this message and saves nothing. */
  readonly failure?: string;
  /** The run ends `cancelled` and saves nothing. */
  readonly cancelled?: boolean;
  /** Setup parts that are missing: the POST refuses with 409 `setup_incomplete`. */
  readonly missingSetup?: readonly string[];
  /** Called with the request body of every POST that passed the checks. */
  readonly onPost?: (body: GenerateFlowRequest) => void;
  /** Called with the request body of every regeneration that passed the checks. */
  readonly onRegenerate?: (flowId: string, body: RegenerateFlowRequest) => void;
}

export interface FlowGenerationHandles {
  /** Ids of the runs started so far, oldest first. */
  readonly runs: readonly string[];
}

interface RunState {
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly step: string | null;
  readonly progress: number;
  readonly flowId: string | null;
  readonly error: string | null;
}

const registered = new WeakMap<Fake, FlowGenerationHandles>();

function validation(loc: string, type: string, msg: string): FakeHttpError {
  return new FakeHttpError(422, { detail: [{ type, loc: ['body', loc], msg }] });
}

/** `_names_endpoint`. */
function names(id: string, endpoint: SklepEndpoint): boolean {
  if (id.includes(':/')) {
    const at = id.indexOf(':');
    return (
      endpoint.method.toLowerCase() === id.slice(0, at).toLowerCase() &&
      endpoint.path === id.slice(at + 1)
    );
  }
  return id === endpoint.id || id === endpoint.path || id === endpoint.operation_id;
}

/** Registers the two routes over the sklep world; idempotent per fake. */
export function registerFlowGenerationRoutes(
  fake: Fake,
  world: FlowGenerationWorld = {},
  clock?: Pick<Clock, 'now'> & { sleep?: Clock['sleep'] },
): FlowGenerationHandles {
  const known = registered.get(fake);
  if (known !== undefined) return known;
  const runs: string[] = [];

  fake.route('POST', '/api/v1/projects/{project_id}/flows/generate-async', (req, store, jobs) => {
    const projectId = req.params.project_id;
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    const body = req.body as GenerateFlowRequest;
    if (typeof body.description !== 'string' || body.description.length < 10) {
      throw validation(
        'description',
        'string_too_short',
        'String should have at least 10 characters',
      );
    }
    if (body.description.length > 2000) {
      throw validation(
        'description',
        'string_too_long',
        'String should have at most 2000 characters',
      );
    }
    if ((body.flow_name ?? '').length > 255) {
      throw validation('flow_name', 'string_too_long', 'String should have at most 255 characters');
    }
    if (world.missingSetup !== undefined && world.missingSetup.length > 0) {
      throw new FakeHttpError(409, {
        detail: { error: 'setup_incomplete', missing: [...world.missingSetup] },
      });
    }
    const ids = body.endpoint_ids ?? [];
    if (ids.length === 0) {
      throw new FakeHttpError(422, { detail: 'At least one endpoint or operation is required' });
    }
    const endpoints = store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints).list();
    const unknown = ids.filter((id) => !endpoints.some((endpoint) => names(id, endpoint)));
    if (unknown.length > 0) {
      throw new FakeHttpError(422, {
        detail: {
          code: 'unknown_endpoint_ids',
          message: 'Some endpoint ids are not in the project specification',
          endpoint_ids: unknown,
        },
      });
    }
    world.onPost?.(body);

    const name = body.flow_name ?? 'Generated flow';
    const doneAt = Math.max(world.afterMs ?? DEFAULT_DONE_MS, RUNNING_AT_MS + 1000);
    const failed = world.failure !== undefined;
    const stopped = world.cancelled === true;
    let flowId: string | null = null;
    if (!failed && !stopped) {
      const matched = ids.flatMap((id) => {
        const found = endpoints.find((endpoint) => names(id, endpoint));
        return found === undefined ? [] : [found];
      });
      const template =
        world.flow ??
        synthesize(
          store,
          projectId,
          {
            basket_id: 'run',
            name,
            description: body.description,
            endpoint_ids: matched.map((endpoint) => endpoint.id),
            pattern_type: 'semantic',
            tags: [],
          },
          matched,
        );
      const flow: FlowDetail = {
        ...template,
        project_id: projectId,
        openapi_spec_id: pinOf(store, projectId, template.openapi_spec_id),
        name,
        tags: [],
        generation_description: body.description,
      };
      flowId = flow.id;
      const save = (): void => {
        store.collection<FlowDetail>(FLOWS).insert(flow);
      };
      if (clock?.sleep === undefined) save();
      else
        void clock
          .sleep(doneAt, new AbortController().signal)
          .then(save)
          .catch(() => undefined);
    }
    const end: RunState = {
      status: failed ? 'failed' : stopped ? 'cancelled' : 'completed',
      step: null,
      progress: failed || stopped ? 40 : 100,
      flowId,
      error: world.failure ?? null,
    };
    const job = jobs.start<RunState>('flow_generation', {
      steps: [
        {
          afterMs: 0,
          state: { status: 'pending', step: null, progress: 0, flowId: null, error: null },
        },
        {
          afterMs: RUNNING_AT_MS,
          state: {
            status: 'running',
            step: 'Calling the model',
            progress: 40,
            flowId: null,
            error: null,
          },
        },
        { afterMs: doneAt, state: end },
      ],
    });
    runs.push(job.id);
    return { status: 200, body: { run_id: job.id, status: 'started' } };
  });

  // Regenerating a flow: the same run machinery; a flow with no recorded source is refused (400,
  // `can_regenerate` false). The run overwrites the flow in place as a new version when it completes;
  // a failed or cancelled run leaves it untouched.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/regenerate',
    (req, store, jobs) => {
      const projectId = req.params.project_id;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const flows = store.collection<FlowDetail>(FLOWS);
      const flow = flows.get(req.params.flow_id);
      if (flow === undefined) throw new FakeHttpError(404, { detail: 'Flow not found' });
      const body = req.body as RegenerateFlowRequest;
      if (typeof body.description !== 'string' || body.description === '') {
        throw validation(
          'description',
          'string_too_short',
          'String should have at least 1 character',
        );
      }
      if (!flow.can_regenerate) {
        throw new FakeHttpError(400, {
          detail: 'Flow has no recorded source endpoints or operations to regenerate from',
        });
      }
      world.onRegenerate?.(flow.id, body);
      const doneAt = Math.max(world.afterMs ?? DEFAULT_DONE_MS, RUNNING_AT_MS + 1000);
      const failed = world.failure !== undefined;
      const stopped = world.cancelled === true;
      if (!failed && !stopped) {
        const save = (): void => {
          flows.update(flow.id, {
            current_version: flow.current_version + 1,
            generation_description: body.description,
            updated_at: '2026-11-27T12:00:00Z',
          });
        };
        if (clock?.sleep === undefined) save();
        else
          void clock
            .sleep(doneAt, new AbortController().signal)
            .then(save)
            .catch(() => undefined);
      }
      const end: RunState = {
        status: failed ? 'failed' : stopped ? 'cancelled' : 'completed',
        step: null,
        progress: failed || stopped ? 40 : 100,
        flowId: failed || stopped ? null : flow.id,
        error: world.failure ?? null,
      };
      const job = jobs.start<RunState>('flow_generation', {
        steps: [
          {
            afterMs: 0,
            state: { status: 'pending', step: null, progress: 0, flowId: null, error: null },
          },
          {
            afterMs: RUNNING_AT_MS,
            state: {
              status: 'running',
              step: 'generate_flow',
              progress: 40,
              flowId: null,
              error: null,
            },
          },
          { afterMs: doneAt, state: end },
        ],
      });
      runs.push(job.id);
      return { status: 200, body: { run_id: job.id, status: 'started' } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/flows/flow-generation/{run_id}/status',
    (req, _store, jobs) => {
      const id = req.params.run_id;
      const job = jobs.find<RunState>(id);
      if (job === undefined) throw new FakeHttpError(404, { detail: 'Run not found' });
      return {
        status: 200,
        body: {
          run_id: id,
          status: job.state.status,
          current_step: job.state.step,
          progress_pct: job.state.progress,
          result_flow_id: job.state.flowId,
          error_message: job.state.error,
        },
      };
    },
  );

  const handles: FlowGenerationHandles = { runs };
  registered.set(fake, handles);
  return handles;
}
