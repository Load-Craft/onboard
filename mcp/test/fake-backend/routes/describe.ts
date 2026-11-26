// Flows from a description, walked by the agent browser, in the fake backend
// (`api/routes/scenario_from_description.py`: `generate` :624, `runs/{run_id}` :1596, `cancel`
// :1167, `timeline` :2737). The POST answers with a run id after the checks that come before the
// run (Pydantic limits of `GenerateRequest` :197-213, the setup gate :651, the agent-browser slots
// :578-586). The run goes on the test clock: it plans, then either pauses for the approval of a
// split (two paths or more) and sends `split_proposal` on its channel, or drives a single path at
// once. The channel task is created with the run, so its handshake knows the run (`fake.channel`).
//
// The walk: `split_resume` on the channel (`handle_split_resume` :891-959) starts it, or a refusal
// answers it (`split_resume_refused` when every agent browser is busy, `message_denied` for a
// principal without the editor role, an `error` frame when the run is not waiting for it). The
// paths are walked one after another: agent steps, the build of the flow, `path_done` or
// `path_failed`; `drive_snapshot` is what a socket connecting later is told (`ws:53-117`). The
// agent may ask for help (`help_requested`) and get the browser back (`control_returned`), both
// also in the timeline. A `stop` message ends the walk gently (`stop_run` :962-987: the path in
// progress stops, built paths are saved); `POST …/cancel` ends it at once. Flows are saved when
// the run completes, as LoadCraft saves them once, at the end.

import { readFileSync } from 'node:fs';

import type { components } from '../../../src/http/generated/api.js';
import { SKLEP_IDS } from '../../golden/index.js';
import type { Job } from '../jobs.js';
import {
  FakeHttpError,
  type ChannelStub,
  type Fake,
  type Store,
  type WireFrame,
} from '../server.js';
import { createIdSource, createStore } from '../store.js';
import { SKLEP_COLLECTIONS, SKLEP_WORLD_IDS, seedSklep } from '../worlds/sklep.js';

type GenerateRequest = components['schemas']['GenerateRequest'];
type RunDetailsResponse = components['schemas']['RunDetailsResponse'];
type SessionPath = components['schemas']['SessionPath'];
type FlowDetail = components['schemas']['FlowDetail'];
type TimelineResponse = components['schemas']['TimelineResponse'];

/** One proposed path as the planner writes it (`split_plan.py:90-143`). */
export interface ProposedPath {
  readonly name: string;
  readonly steps: readonly string[];
  readonly depends_on_prior?: boolean;
  readonly needs_verify?: boolean;
  readonly mutates?: boolean;
  readonly creates_own_identity?: boolean;
  readonly rationale?: string;
}

/** The three paths of run 3 of the golden texts. */
export const SKLEP_PROPOSAL: readonly ProposedPath[] = [
  {
    name: 'zakupy',
    steps: ['logowanie', 'wyszukanie', 'koszyk', 'kod rabatowy', 'płatność'],
    depends_on_prior: false,
    needs_verify: false,
    mutates: true,
    creates_own_identity: false,
    rationale: 'Kupno produktu z kodem rabatowym',
  },
  {
    name: 'przeglądanie',
    steps: ['kategoria', 'produkt'],
    depends_on_prior: false,
    needs_verify: false,
    mutates: false,
    creates_own_identity: false,
    rationale: 'Przeglądanie katalogu',
  },
  {
    name: 'konto',
    steps: ['logowanie', 'zamówienia'],
    depends_on_prior: false,
    needs_verify: false,
    mutates: false,
    creates_own_identity: false,
    rationale: 'Historia zamówień',
  },
];

/** How one path of the walk goes; by default it is walked whole and its flow saved. */
export interface WalkPathScript {
  /** `partial`: the flow is saved but stops short (`note` says what was not carried out). */
  readonly outcome?: 'saved' | 'partial' | 'failed';
  readonly note?: string;
  /** Why a failed path failed; it fails at both of its attempts. */
  readonly failure?: string;
  /** What the agent says it does at every step; default `klika: <the step of the plan>`. */
  readonly label?: string;
  /** The agent asks for help at a step of the plan (from 0) and waits for the user. */
  readonly help?: {
    readonly atStep: number;
    readonly reason: 'captcha' | 'second_factor' | 'unknown_blocker';
    readonly agentSays?: string;
    /** The browser goes back to the agent this long after the request; never when absent. */
    readonly returnedAfterMs?: number;
    /** Nobody helps: the agent gives up this long after the request and the path fails. */
    readonly gaveUpAfterMs?: number;
    /** What the user marked their part as, when they handed the browser back. */
    readonly obstacle?: 'captcha' | 'one_time_code' | 'payment' | 'other';
  };
}

export interface DescribeWorld {
  /** Paths the planner proposes; default: the three of run 3. One path is driven at once. */
  readonly paths?: readonly ProposedPath[];
  /** `shared_sign_in` of the frame; default: true when the request carried an account. */
  readonly sharedSignIn?: boolean;
  /** Milliseconds after the start at which the plan is ready; default 8 s. */
  readonly planAtMs?: number;
  /** The run fails while planning, with this message. */
  readonly failure?: string;
  /** The message the run row carries once the run was cancelled (a walk that failed with a text). */
  readonly cancelMessage?: string;
  /** The run pauses for approval, but its channel never sends the proposal. */
  readonly silent?: boolean;
  /** Setup parts that are missing: the POST refuses with 409 `setup_incomplete`. */
  readonly missingSetup?: readonly string[];
  /** Every agent browser is busy: the POST refuses with 409 `agent_browsers_busy`. */
  readonly busy?: boolean;
  /** Ids given to the runs, in order (e.g. the one the golden texts pin); seeded ones after. */
  readonly runIds?: readonly string[];
  /** How the paths of the walk go, by path name. */
  readonly walk?: Readonly<Record<string, WalkPathScript>>;
  /** The approval is refused: every agent browser is busy. */
  readonly approvalBusy?: boolean;
  /** The approval is denied with this code (`editor_role_required`). */
  readonly approvalDenied?: string;
}

export interface DescribeHandles {
  /** Ids of the runs started so far, oldest first. */
  readonly runs: readonly string[];
  /** Request bodies of the POSTs that passed the checks, as received. */
  readonly bodies: readonly GenerateRequest[];
  /** Paths of every accepted approval, as sent. */
  readonly approvals: readonly (readonly Record<string, unknown>[])[];
}

/** Agent browsers of one backend instance (`NL_AGENT_BROWSERS_MAX`, `config/settings.py:212-234`). */
const BROWSER_LIMIT = 2;
const RUNNING_AT_MS = 1000;
const DEFAULT_PLAN_AT_MS = 8000;

interface RunState {
  readonly status: 'queued' | 'running' | 'failed';
  readonly step: string | null;
  readonly awaiting: boolean;
  readonly approved: readonly string[];
  readonly error: string | null;
}

interface RunRecord {
  readonly description: string;
  readonly targetUrl: string;
  readonly paths: readonly ProposedPath[];
  readonly channel: ChannelStub<'describe'>;
  walk?: Walk;
  /** Clock time of `POST …/cancel`. */
  cancelledAt?: number;
}

// ---- the walk -----------------------------------------------------------------------------

/** Milliseconds of the shared sign-in, of one step of the plan, and of the build of a flow. */
const SETUP_MS = 2000;
const STEP_MS = 1500;
const BUILD_MS = 2000;
/** How long the agent waits for the user (`HUMAN_WAIT_S`, `live_drives.py:142`). */
const HELP_WAIT_MS = 600_000;
/** From the last path, or from an accepted stop, to the end of the run. */
const END_MS = 1000;

type WalkEvent =
  | { readonly at: number; readonly kind: 'setup_done' }
  | {
      readonly at: number;
      readonly kind: 'step';
      readonly path: number;
      readonly planStep: number;
      readonly label: string;
      readonly attempt: number;
    }
  | { readonly at: number; readonly kind: 'stage'; readonly path: number; readonly attempt: number }
  | { readonly at: number; readonly kind: 'retry'; readonly path: number; readonly reason: string }
  | { readonly at: number; readonly kind: 'built'; readonly path: number }
  | { readonly at: number; readonly kind: 'failed'; readonly path: number; readonly reason: string }
  | {
      readonly at: number;
      readonly kind: 'help';
      readonly path: number;
      readonly reason: string;
      readonly agentSays: string | null;
    }
  | {
      readonly at: number;
      readonly kind: 'returned';
      readonly path: number;
      readonly obstacle: string | null;
    }
  | { readonly at: number; readonly kind: 'end' };

interface Walk {
  /** The job of the walk: its start is the approval (or, for one path, the run's start). */
  readonly job: Job;
  /** Milliseconds after the start of the job at which the walk begins. */
  readonly offset: number;
  readonly paths: readonly ProposedPath[];
  readonly scripts: readonly WalkPathScript[];
  /** Times are relative to the beginning of the walk. */
  readonly events: readonly WalkEvent[];
  /** Milliseconds after the beginning at which a stop was accepted. */
  stoppedAt?: number;
}

interface PathNow {
  status: SessionPath['status'];
  attempts: number;
  steps: number;
  reason: string | null;
}

interface WalkNow {
  readonly begun: boolean;
  readonly setup: boolean;
  readonly ended: boolean;
  readonly paths: PathNow[];
  /** The path the agent works on, when one. */
  readonly driving: number | undefined;
}

function walkEvents(
  paths: readonly ProposedPath[],
  scripts: readonly WalkPathScript[],
): WalkEvent[] {
  const events: WalkEvent[] = [];
  let at = SETUP_MS;
  events.push({ at, kind: 'setup_done' });
  for (const [index, path] of paths.entries()) {
    const script = scripts[index] ?? {};
    const attempts = script.outcome === 'failed' ? 2 : 1;
    let gaveUp = false;
    walking: for (let attempt = 1; attempt <= attempts; attempt += 1) {
      for (let planStep = 0; planStep < Math.max(1, path.steps.length); planStep += 1) {
        at += STEP_MS;
        events.push({
          at,
          kind: 'step',
          path: index,
          planStep,
          label: script.label ?? `klika: ${path.steps[planStep] ?? path.name}`,
          attempt,
        });
        const help = script.help;
        if (help !== undefined && attempt === 1 && help.atStep === planStep) {
          events.push({
            at: at + 1,
            kind: 'help',
            path: index,
            reason: help.reason,
            agentSays: help.agentSays ?? null,
          });
          if (help.gaveUpAfterMs !== undefined) {
            // The wait for the user ran out: the path fails, with no hand-back on the timeline.
            at += help.gaveUpAfterMs;
            events.push({ at, kind: 'failed', path: index, reason: 'Nobody helped in time.' });
            gaveUp = true;
            break walking;
          }
          // Nobody hands the browser back: the walk waits, and never ends.
          if (help.returnedAfterMs === undefined) return events;
          at += help.returnedAfterMs;
          events.push({ at, kind: 'returned', path: index, obstacle: help.obstacle ?? null });
        }
      }
      if (attempt < attempts) {
        at += STEP_MS;
        events.push({
          at,
          kind: 'retry',
          path: index,
          reason: script.failure ?? 'The page did not answer.',
        });
      }
    }
    if (gaveUp) continue;
    if (script.outcome === 'failed') {
      at += STEP_MS;
      events.push({
        at,
        kind: 'failed',
        path: index,
        reason: script.failure ?? 'The page did not answer.',
      });
      continue;
    }
    events.push({ at: at + 1, kind: 'stage', path: index, attempt: attempts });
    at += BUILD_MS;
    events.push({ at, kind: 'built', path: index });
  }
  events.push({ at: at + END_MS, kind: 'end' });
  return events;
}

/** Where the walk stands `elapsed` ms after the start of its job. */
function walkNow(walk: Walk, elapsed: number): WalkNow {
  const since = elapsed - walk.offset;
  const paths: PathNow[] = walk.paths.map(() => ({
    status: 'queued',
    attempts: 0,
    steps: 0,
    reason: null,
  }));
  if (since < 0) return { begun: false, setup: false, ended: false, paths, driving: undefined };
  const limit = walk.stoppedAt === undefined ? since : Math.min(since, walk.stoppedAt);
  let setup = true;
  let ended = false;
  let driving: number | undefined;
  for (const event of walk.events) {
    if (event.at > limit) break;
    switch (event.kind) {
      case 'setup_done':
        setup = false;
        break;
      case 'step': {
        const path = paths[event.path];
        if (path === undefined) break;
        path.status = 'driving';
        path.attempts = event.attempt;
        path.steps = event.planStep + 1;
        driving = event.path;
        break;
      }
      case 'built': {
        const path = paths[event.path];
        if (path !== undefined) path.status = 'built';
        driving = undefined;
        break;
      }
      case 'failed': {
        const path = paths[event.path];
        if (path !== undefined) {
          path.status = 'failed';
          path.reason = event.reason;
        }
        driving = undefined;
        break;
      }
      case 'end':
        ended = true;
        break;
      default:
        break;
    }
  }
  if (walk.stoppedAt !== undefined && since >= walk.stoppedAt) {
    // The stop ends the path in progress and every path after it; the built ones are saved.
    for (const path of paths)
      if (path.status === 'driving' || path.status === 'queued') path.status = 'stopped';
    if (since >= walk.stoppedAt + END_MS) ended = true;
    driving = undefined;
  }
  if (ended) for (const path of paths) if (path.status === 'built') path.status = 'saved';
  return { begun: true, setup, ended, paths, driving };
}

const SNAPSHOT_STATE: Readonly<Record<SessionPath['status'], string>> = {
  queued: 'queued',
  driving: 'driving',
  built: 'done',
  saved: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

function snapshotFrame(walk: Walk, now: WalkNow): WireFrame {
  return {
    type: 'drive_snapshot',
    setup: now.setup ? 'running' : 'done',
    paths: walk.paths.map((path, index) => {
      const state = now.paths[index];
      return {
        path_index: index,
        name: path.name,
        state: SNAPSHOT_STATE[state?.status ?? 'queued'],
        ...(state?.status === 'failed' && state.reason !== null ? { reason: state.reason } : {}),
        ...(state?.status === 'stopped' ? { stop_cause: 'stopped_by_user' } : {}),
      };
    }),
  };
}

/** The frames of the walk, each followed by the snapshot a later socket would be told. */
function walkEmissions(walk: Walk): { afterMs: number; frame: WireFrame }[] {
  const out: { afterMs: number; frame: WireFrame }[] = [];
  const at = (ms: number): number => walk.offset + ms;
  for (const event of walk.events) {
    const frames: WireFrame[] = [];
    switch (event.kind) {
      case 'setup_done':
        break;
      case 'step':
        frames.push({
          type: 'agent_step',
          step: {
            path_index: event.path,
            attempt: event.attempt,
            step_number: event.planStep + 1,
            label: event.label,
            plan_step_index: event.planStep,
            outcome: 'ok',
          },
        });
        break;
      case 'stage':
        frames.push({
          type: 'path_stage',
          path_index: event.path,
          attempt: event.attempt,
          stage: 'build_flow',
        });
        break;
      case 'retry':
        frames.push({
          type: 'path_failed',
          path_index: event.path,
          path_name: walk.paths[event.path]?.name ?? '',
          reason: event.reason,
          attempt: 1,
          will_retry: true,
        });
        break;
      case 'built':
        frames.push({
          type: 'path_done',
          path_index: event.path,
          path_name: walk.paths[event.path]?.name ?? '',
        });
        break;
      case 'failed':
        frames.push({
          type: 'path_failed',
          path_index: event.path,
          path_name: walk.paths[event.path]?.name ?? '',
          reason: event.reason,
          attempt: 2,
          will_retry: false,
        });
        break;
      case 'help':
        frames.push({
          type: 'help_requested',
          path_index: event.path,
          attempt: 1,
          reason: event.reason,
          agent_says: event.agentSays,
          expires_at: null,
        });
        break;
      case 'returned':
        frames.push({
          type: 'control_returned',
          path_index: event.path,
          attempt: 1,
          reason: 'handed_back',
          choice: event.obstacle === null ? 'journey' : 'obstacle',
          obstacle_kind: event.obstacle,
        });
        break;
      case 'end':
        frames.push({ type: 'complete', result: { status: 'completed' } });
        break;
    }
    for (const frame of frames) out.push({ afterMs: at(event.at), frame });
    if (event.kind !== 'end') {
      out.push({ afterMs: at(event.at), frame: snapshotFrame(walk, walkNow(walk, at(event.at))) });
    }
  }
  return out;
}

/** Flows of the run 3 golden texts by path name; another name gets a copy of `konto`. */
const FLOW_IDS: Readonly<Record<string, string>> = {
  zakupy: SKLEP_IDS.flowZakupy,
  przeglądanie: SKLEP_WORLD_IDS.flowPrzegladanie,
  konto: SKLEP_WORLD_IDS.flowKonto,
};

let sklepFlows: FlowDetail[] | undefined;

function flowTemplates(): FlowDetail[] {
  if (sklepFlows === undefined) {
    const store = createStore(createIdSource(1));
    seedSklep(store, { stage: 'flows' });
    const zakupy = JSON.parse(
      readFileSync(new URL('../../fixtures/flows/zakupy-run3-opis.json', import.meta.url), 'utf8'),
    ) as FlowDetail;
    sklepFlows = [
      { ...zakupy, id: SKLEP_IDS.flowZakupy },
      ...store
        .collection<FlowDetail>(SKLEP_COLLECTIONS.flows)
        .list((flow) => flow.name !== 'zakupy'),
    ];
  }
  return sklepFlows;
}

/** The flow a saved path left in the store, created the first time it is asked for. */
function savedFlowId(store: Store, projectId: string, name: string): string {
  const flows = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows);
  const templates = flowTemplates();
  const id = FLOW_IDS[name] ?? store.newId();
  if (flows.get(id) === undefined) {
    const template =
      templates.find((flow) => flow.name === name) ??
      templates.find((flow) => flow.name === 'konto');
    if (template === undefined) throw new Error('the sklep world has no flow to copy');
    flows.insert({
      ...template,
      id,
      project_id: projectId,
      name,
      generated_by: 'scenario_from_description',
      tags: ['nl-scenario'],
      // a flow recorded in the browser is not pinned to a docs version (it reads the current one)
      openapi_spec_id: null,
    });
  }
  return id;
}

const registered = new WeakMap<Fake, DescribeHandles>();

function validation(loc: readonly string[], type: string, msg: string): FakeHttpError {
  return new FakeHttpError(422, { detail: [{ type, loc: ['body', ...loc], msg }] });
}

function checkBody(body: GenerateRequest): void {
  if (typeof body.description !== 'string') {
    throw validation(['description'], 'missing', 'Field required');
  }
  if (typeof body.target_url !== 'string') {
    throw validation(['target_url'], 'missing', 'Field required');
  }
  const steps = body.max_steps;
  if (steps != null && (steps < 1 || steps > 60)) {
    throw validation(['max_steps'], 'less_than_equal', 'Input should be between 1 and 60');
  }
  const credentials = body.auth_credentials;
  if (credentials != null) {
    // `domain/models/playwright_script.py:12-28`: both values must be non-empty strings.
    if (typeof credentials.username !== 'string' || credentials.username === '') {
      throw validation(['auth_credentials', 'username'], 'value_error', 'must not be empty');
    }
    if (typeof credentials.password !== 'string' || credentials.password === '') {
      throw validation(['auth_credentials', 'password'], 'value_error', 'must not be empty');
    }
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Registers the two routes; idempotent per fake (the first world wins). */
export function registerDescribeRoutes(fake: Fake, world: DescribeWorld = {}): DescribeHandles {
  const known = registered.get(fake);
  if (known !== undefined) return known;
  const runs: string[] = [];
  const bodies: GenerateRequest[] = [];
  const approvals: Record<string, unknown>[][] = [];
  const records = new Map<string, RunRecord>();
  /** Flow ids of saved paths, by run and path, once the run completed. */
  const flowIds = new Map<string, string>();

  const startWalk = (
    jobs: Fake['jobs'],
    record: RunRecord,
    paths: readonly ProposedPath[],
    offset: number,
  ): void => {
    const scripts = paths.map((path) => world.walk?.[path.name] ?? {});
    const job = jobs.start<null>('scenario_from_description_walk', {
      steps: [{ afterMs: 0, state: null }],
    });
    const walk: Walk = { job, offset, paths, scripts, events: walkEvents(paths, scripts) };
    record.walk = walk;
    record.channel.attach(
      job,
      walkEmissions(walk),
      () => walk.stoppedAt === undefined && record.cancelledAt === undefined,
    );
  };

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/scenario-from-description/generate',
    (req, store, jobs) => {
      const projectId = req.params.project_id;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const body = req.body as GenerateRequest;
      checkBody(body);
      if (world.missingSetup !== undefined && world.missingSetup.length > 0) {
        throw new FakeHttpError(409, {
          detail: { error: 'setup_incomplete', missing: [...world.missingSetup] },
        });
      }
      if (world.busy === true) {
        throw new FakeHttpError(409, {
          detail: {
            error: 'agent_browsers_busy',
            message: `All ${String(BROWSER_LIMIT)} agent browsers are busy with other runs; try again later.`,
            limit: BROWSER_LIMIT,
          },
        });
      }
      bodies.push(body);

      const paths = world.paths ?? SKLEP_PROPOSAL;
      const planAt = Math.max(world.planAtMs ?? DEFAULT_PLAN_AT_MS, RUNNING_AT_MS + 1000);
      const single = paths.length === 1;
      const planned: RunState =
        world.failure !== undefined
          ? {
              status: 'failed',
              step: null,
              awaiting: false,
              approved: [],
              error: world.failure,
            }
          : single
            ? {
                status: 'running',
                step: 'browser_agent',
                awaiting: false,
                approved: paths.map((path) => path.name),
                error: null,
              }
            : {
                status: 'running',
                step: 'split_approval',
                awaiting: true,
                approved: [],
                error: null,
              };
      const id = world.runIds?.[runs.length];
      const job = jobs.start<RunState>('scenario_from_description', {
        ...(id === undefined ? {} : { id }),
        steps: [
          {
            afterMs: 0,
            state: { status: 'queued', step: null, awaiting: false, approved: [], error: null },
          },
          {
            afterMs: RUNNING_AT_MS,
            state: {
              status: 'running',
              step: 'split_plan',
              awaiting: false,
              approved: [],
              error: null,
            },
          },
          { afterMs: planAt, state: planned },
        ],
      });
      runs.push(job.id);
      // The channel of the run: its handshake knows the run from now on.
      const channel = fake.channel('describe', { project_id: projectId, run_id: job.id });
      const record: RunRecord = {
        description: body.description,
        targetUrl: body.target_url,
        paths,
        channel,
      };
      records.set(job.id, record);
      if (single && world.failure === undefined) startWalk(jobs, record, paths, planAt);
      channel.onMessage((message) => onMessage(job.id, message));
      if (planned.awaiting && world.silent !== true) {
        const credentials = body.auth_credentials != null;
        channel.attach(job, [
          {
            afterMs: planAt,
            frame: {
              type: 'split_proposal',
              proposed_paths: paths.map((path) => ({ ...path, steps: [...path.steps] })),
              // `scenario_from_description_ws.py:363-375` with `shared_login_is_wanted`.
              shared_sign_in:
                world.sharedSignIn ??
                (credentials && !paths.every((path) => path.creates_own_identity === true)),
            },
          },
        ]);
      }
      return { status: 200, body: { run_id: job.id, status: 'started' } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}',
    (req, store, jobs) => {
      const id = req.params.run_id;
      const job = jobs.find<RunState>(id);
      const record = records.get(id);
      if (job === undefined || record === undefined) {
        throw new FakeHttpError(404, { detail: `Scenario run not found: ${id}` });
      }
      return {
        status: 200,
        body: details(id, job.state, record, store, req.params.project_id, jobs),
      };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/timeline',
    (req, _store, jobs) => {
      const id = req.params.run_id;
      const record = records.get(id);
      if (jobs.find(id) === undefined || record === undefined) {
        throw new FakeHttpError(404, { detail: `Scenario run not found: ${id}` });
      }
      const body: TimelineResponse = { run_id: id, events: timeline(record), notes: [] };
      return { status: 200, body };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/cancel',
    (req, _store, jobs) => {
      const id = req.params.run_id;
      const job = jobs.find<RunState>(id);
      const record = records.get(id);
      if (job === undefined || record === undefined) {
        throw new FakeHttpError(404, { detail: `Scenario run not found: ${id}` });
      }
      const now = statusOf(job.state, record, jobs);
      if (now !== 'queued' && now !== 'running') {
        return {
          status: 200,
          body: { run_id: id, cancelled: false, status: now, error_message: null },
        };
      }
      record.cancelledAt = fake.jobs.find(id)?.elapsedMs ?? 0;
      record.channel.emit({ type: 'cancelled' });
      return {
        status: 200,
        body: { run_id: id, cancelled: true, status: 'cancelled', error_message: null },
      };
    },
  );

  // ---- reading a run ----

  function walkOf(record: RunRecord, jobs: Fake['jobs']): WalkNow | undefined {
    const walk = record.walk;
    if (walk === undefined) return undefined;
    const job = jobs.find(walk.job.id);
    if (job === undefined) return undefined;
    const now = walkNow(walk, job.elapsedMs);
    return now.begun ? now : undefined;
  }

  function statusOf(plan: RunState, record: RunRecord, jobs: Fake['jobs']): string {
    if (record.cancelledAt !== undefined) return 'cancelled';
    const now = walkOf(record, jobs);
    if (now === undefined) return plan.status;
    return now.ended ? 'completed' : 'running';
  }

  function details(
    id: string,
    plan: RunState,
    record: RunRecord,
    store: Store,
    projectId: string,
    jobs: Fake['jobs'],
  ): RunDetailsResponse {
    const now = walkOf(record, jobs);
    const walk = record.walk;
    const status = statusOf(plan, record, jobs);
    const terminal = status !== 'queued' && status !== 'running';
    const base: RunDetailsResponse = {
      protocol_version: 2,
      run_id: id,
      status,
      current_step: plan.step,
      error_message:
        record.cancelledAt !== undefined ? (world.cancelMessage ?? plan.error) : plan.error,
      target_url: record.targetUrl,
      description: record.description,
      title: record.description.slice(0, 80),
      target_host: hostOf(record.targetUrl),
      awaiting_split_approval: plan.awaiting && now === undefined && !terminal,
      approved_paths_names: [...plan.approved],
      paths: [],
      flows_saved: [],
      failed_paths: [],
      all_paths_failed: false,
    };
    if (now === undefined || walk === undefined) return base;
    const paths: SessionPath[] = walk.paths.map((path, index) => {
      const state = now.paths[index] ?? {
        status: 'queued' as const,
        attempts: 0,
        steps: 0,
        reason: null,
      };
      const script = walk.scripts[index] ?? {};
      const saved = state.status === 'saved';
      const key = `${id}|${String(index)}`;
      if (saved && !flowIds.has(key)) flowIds.set(key, savedFlowId(store, projectId, path.name));
      const flowId = saved ? (flowIds.get(key) ?? null) : null;
      return {
        path_index: index,
        name: path.name,
        status: terminal && state.status === 'built' ? 'saved' : state.status,
        step_count: state.steps,
        attempts: Array.from({ length: state.attempts }, (_, at) => at + 1),
        partial: saved && script.outcome === 'partial',
        failure_reason: state.status === 'failed' ? state.reason : null,
        stop_cause: state.status === 'stopped' ? 'stopped_by_user' : null,
        flow_id: flowId,
        not_driven: false,
      };
    });
    return {
      ...base,
      current_step: now.setup ? 'setup' : 'browser_agent',
      awaiting_split_approval: false,
      approved_paths_names: walk.paths.map((path) => path.name),
      paths,
      flows_saved: paths.flatMap((path) =>
        path.flow_id == null
          ? []
          : [
              {
                name: path.name,
                flow_id: path.flow_id,
                path_index: path.path_index,
                note:
                  walk.scripts[path.path_index]?.outcome === 'partial'
                    ? (walk.scripts[path.path_index]?.note ?? null)
                    : null,
                version: 1,
                change_reason: null,
              },
            ],
      ),
      failed_paths: paths
        .filter((path) => path.status === 'failed')
        .map((path) => ({
          path_index: path.path_index,
          name: path.name,
          reason: path.failure_reason ?? '',
          not_driven: false,
        })),
      all_paths_failed: paths.length > 0 && paths.every((path) => path.status === 'failed'),
    };
  }

  /** The help and the control events of the walk so far, as `GET …/timeline` lists them. */
  function timeline(record: RunRecord): NonNullable<TimelineResponse['events']> {
    const walk = record.walk;
    if (walk === undefined) return [];
    const job = fake.jobs.find(walk.job.id);
    if (job === undefined) return [];
    const since = job.elapsedMs - walk.offset;
    const limit = walk.stoppedAt === undefined ? since : Math.min(since, walk.stoppedAt);
    const start = job.startedAt + walk.offset;
    const events: NonNullable<TimelineResponse['events']> = [];
    for (const event of walk.events) {
      if (event.at > limit) break;
      if (event.kind === 'help') {
        events.push({
          type: 'help_requested',
          path_index: event.path,
          attempt: 1,
          reason: event.reason as 'captcha' | 'second_factor' | 'unknown_blocker',
          agent_says: event.agentSays,
          expires_at: new Date(start + event.at + HELP_WAIT_MS).toISOString(),
        });
        events.push({
          type: 'control_taken',
          path_index: event.path,
          attempt: 1,
          started_at: null,
        });
      } else if (event.kind === 'returned') {
        events.push({
          type: 'control_returned',
          path_index: event.path,
          attempt: 1,
          reason: 'handed_back',
          choice: event.obstacle === null ? 'journey' : 'obstacle',
          obstacle_kind: event.obstacle as 'captcha' | 'one_time_code' | 'payment' | 'other' | null,
        });
      }
    }
    return events;
  }

  // ---- messages of the client ----

  function onMessage(id: string, message: unknown): void {
    const record = records.get(id);
    if (record === undefined || typeof message !== 'object' || message === null) return;
    const type = (message as { type?: unknown }).type;
    if (type === 'split_resume') onApproval(id, record, (message as { paths?: unknown }).paths);
    if (type === 'stop') onStop(record);
  }

  function onApproval(id: string, record: RunRecord, sent: unknown): void {
    const jobs = fake.jobs;
    const plan = jobs.find<RunState>(id);
    if (world.approvalDenied !== undefined) {
      record.channel.emit({
        type: 'message_denied',
        message_type: 'split_resume',
        code: world.approvalDenied,
      });
      return;
    }
    if (
      plan === undefined ||
      !plan.state.awaiting ||
      record.walk !== undefined ||
      record.cancelledAt !== undefined
    ) {
      record.channel.emit({
        type: 'error',
        error: 'No pending split approval for this run.',
        node: null,
        technical: null,
      });
      return;
    }
    if (world.approvalBusy === true) {
      record.channel.emit({
        type: 'split_resume_refused',
        detail: {
          error: 'agent_browsers_busy',
          message: `All ${String(BROWSER_LIMIT)} agent browsers are busy with other runs; try again later.`,
          limit: BROWSER_LIMIT,
        },
      });
      return;
    }
    const paths = (Array.isArray(sent) ? sent : []).filter(
      (path): path is Record<string, unknown> => typeof path === 'object' && path !== null,
    );
    approvals.push(paths);
    const chosen = paths.flatMap((path) => {
      const found = record.paths.find((proposed) => proposed.name === path['name']);
      return found === undefined ? [] : [found];
    });
    startWalk(jobs, record, chosen, 0);
  }

  function onStop(record: RunRecord): void {
    const walk = record.walk;
    const job = walk === undefined ? undefined : fake.jobs.find(walk.job.id);
    const now = walk === undefined || job === undefined ? undefined : walkNow(walk, job.elapsedMs);
    if (walk === undefined || job === undefined || now === undefined || !now.begun || now.ended) {
      record.channel.emit({ type: 'stop_refused', code: 'stop_nothing_running' });
      return;
    }
    if (walk.stoppedAt !== undefined) {
      record.channel.emit({ type: 'stop_refused', code: 'stop_already_stopping' });
      return;
    }
    walk.stoppedAt = job.elapsedMs - walk.offset;
    record.channel.emit({
      type: 'stop_accepted',
      reason: 'stopped_by_user',
      path_index: null,
      attempt: null,
    });
    // The end of a stopped walk: its own job, as the frames of the walk no longer go out.
    const end = fake.jobs.start<null>('scenario_from_description_stop', {
      steps: [{ afterMs: 0, state: null }],
    });
    const stopped = walkNow(walk, job.elapsedMs + END_MS);
    record.channel.attach(
      end,
      [
        { afterMs: 0, frame: snapshotFrame(walk, stopped) },
        { afterMs: END_MS, frame: { type: 'complete', result: { status: 'completed' } } },
      ],
      () => record.cancelledAt === undefined,
    );
  }

  const handles: DescribeHandles = { runs, bodies, approvals };
  registered.set(fake, handles);
  return handles;
}
