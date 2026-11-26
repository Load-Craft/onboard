import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFailed,
} from 'vitest';

import type { components } from '../../src/http/generated/api.js';
import { assertNoCanary, CANARY } from '../helpers/canary.js';
import { createTestClock, settleClock, type TestClock } from '../helpers/clock.js';
import {
  loadContract,
  PATH_CONVERTER_PARAMS,
  UNTYPED_SUCCESS_RESPONSES,
  untypedSuccessResponses,
} from './contract.js';
import { FakeHttpError, startFake, type Fake, type RoutePath } from './server.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type CreateProjectRequest = components['schemas']['CreateProjectRequest'];
type SetupRun = components['schemas']['ProjectSetupRunResponse'];

const AUTH = { authorization: `Bearer ${CANARY}` };

function projectDetail(
  id: string,
  body: Pick<CreateProjectRequest, 'name' | 'base_url' | 'description'>,
): ProjectDetail {
  return {
    id,
    name: body.name,
    description: body.description ?? null,
    project_type: 'api',
    base_url: body.base_url,
    openapi_spec_id: null,
    default_headers: {},
    auth_config: {},
    variables: {},
    is_active: true,
    created_at: '2026-11-22T10:00:00Z',
    updated_at: '2026-11-22T10:00:00Z',
    created_by: 'user@example.com',
  };
}

async function getJson(
  fake: Fake,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL(path, fake.url), init);
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

describe('fake backend', () => {
  let clock: TestClock;
  let fake: Fake;

  beforeEach(async () => {
    clock = createTestClock(Date.UTC(2026, 10, 22, 10));
    fake = await startFake({ clock, seed: 7 });
  });

  afterEach(async () => {
    await fake.close();
  });

  describe('authentication', () => {
    it('answers 401 in the backend shape without a token', async () => {
      const response = await getJson(fake, '/api/v1/auth/me');
      expect(response).toEqual({ status: 401, body: { detail: 'Authentication required' } });
    });

    it('answers 401 for another scheme and for a wrong bearer token, never echoing it', async () => {
      const basic = await getJson(fake, '/api/v1/auth/me', {
        headers: { authorization: `Basic ${CANARY}` },
      });
      expect(basic).toEqual({ status: 401, body: { detail: 'Invalid Authorization header' } });

      const wrong = await getJson(fake, '/api/v1/auth/me', {
        headers: { authorization: 'Bearer not-the-token' },
      });
      expect(wrong).toEqual({ status: 401, body: { detail: 'Malformed principal token' } });

      const signed = await getJson(fake, '/api/v1/auth/me', {
        headers: { authorization: 'Bearer payload.signature' },
      });
      expect(signed).toEqual({
        status: 401,
        body: { detail: 'Invalid principal token signature' },
      });
      assertNoCanary(basic, wrong, signed);
    });

    it('serves the current principal with the token', async () => {
      const response = await getJson(fake, '/api/v1/auth/me', { headers: AUTH });
      expect(response).toEqual({
        status: 200,
        body: { authenticated: true, user_id: 'user@example.com' },
      });
    });

    it('lets a route opt out of authentication', async () => {
      fake.route(
        'GET',
        '/api/v1/auth/session',
        () => ({
          status: 200,
          body: { authenticated: false, user_id: null },
        }),
        { auth: 'none' },
      );
      const response = await getJson(fake, '/api/v1/auth/session');
      expect(response.status).toBe(200);
    });
  });

  describe('calls', () => {
    it('records method, path, query and body in arrival order, files replaced by their size', async () => {
      fake.route('POST', '/api/v1/projects', (req, store) => {
        const body = req.body as CreateProjectRequest;
        return { status: 200, body: projectDetail(store.newId(), body) };
      });
      fake.route('POST', '/api/v1/projects/{project_id}/har/upload', (req) => ({
        status: 200,
        body: {
          har_session_id: `har-${req.params.project_id}`,
          total_entries: req.files[0]?.size ?? 0,
          filtered_entries: req.files.length,
          base_url: 'https://api.perf.example.com',
          duration_ms: 0,
          excluded_count: 0,
        },
      }));

      const created = await getJson(fake, '/api/v1/projects', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'sklep', base_url: 'https://api.perf.example.com' }),
      });
      expect(created.status).toBe(200);

      const form = new FormData();
      form.set('label', 'zakupy');
      form.set('file', new Blob(['{"log":{}}'], { type: 'application/json' }), 'zakupy.har');
      const uploaded = await getJson(fake, '/api/v1/projects/p1/har/upload?mode=full', {
        method: 'POST',
        headers: AUTH,
        body: form,
      });
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
      expect(uploaded.body).toMatchObject({ har_session_id: 'har-p1', total_entries: 10 });

      expect(fake.calls).toEqual([
        {
          method: 'POST',
          path: '/api/v1/projects',
          query: {},
          body: { name: 'sklep', base_url: 'https://api.perf.example.com' },
        },
        {
          method: 'POST',
          path: '/api/v1/projects/p1/har/upload',
          query: { mode: 'full' },
          body: { label: 'zakupy', file: { file: 'zakupy.har', size: 10 } },
        },
      ]);
    });

    it('gives deterministic identifiers for the same seed', async () => {
      const other = await startFake({ clock, seed: 7 });
      try {
        expect([fake.store.newId(), fake.store.newId()]).toEqual([
          other.store.newId(),
          other.store.newId(),
        ]);
        expect(fake.store.newId()).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      } finally {
        await other.close();
      }
    });
  });

  describe('jobs', () => {
    function routeSetupRun(): void {
      fake.route('GET', '/api/v1/project-setup/runs/{run_id}', (req, _store, jobs) => {
        const job = jobs.read<Pick<SetupRun, 'status' | 'phase' | 'progress'>>(req.params.run_id);
        return { status: 200, body: { run_id: job.id, ...job.state } };
      });
    }

    it('moves a job through its states as the test clock advances', async () => {
      routeSetupRun();
      const job = fake.jobs.start('project-setup', {
        steps: [
          { afterMs: 0, state: { status: 'queued', phase: 'queued', progress: 0 } },
          { afterMs: 2_000, state: { status: 'analyzing', phase: 'analyzing', progress: 40 } },
          { afterMs: 5_000, state: { status: 'completed', phase: 'done', progress: 100 } },
        ],
      });
      const read = async (): Promise<unknown> =>
        (await getJson(fake, `/api/v1/project-setup/runs/${job.id}`, { headers: AUTH })).body;

      expect(await read()).toMatchObject({ run_id: job.id, status: 'queued' });
      await clock.advance(1_999);
      expect(await read()).toMatchObject({ status: 'queued' });
      await clock.advance(1);
      expect(await read()).toMatchObject({ status: 'analyzing', progress: 40 });
      await clock.advance(10_000);
      expect(await read()).toMatchObject({ status: 'completed', progress: 100 });
      expect(fake.jobs.read(job.id).finished).toBe(true);
    });

    it('answers 404 for an unknown job', async () => {
      routeSetupRun();
      const response = await getJson(fake, '/api/v1/project-setup/runs/missing', {
        headers: AUTH,
      });
      expect(response).toEqual({ status: 404, body: { detail: 'Job not found: missing' } });
    });

    it('rejects a schedule that does not start at zero or goes back in time', () => {
      expect(() => fake.jobs.start('x', { steps: [] })).toThrow(/at least one step/);
      expect(() => fake.jobs.start('x', { steps: [{ afterMs: 5, state: 1 }] })).toThrow(
        /first step/,
      );
      expect(() =>
        fake.jobs.start('x', {
          steps: [
            { afterMs: 0, state: 1 },
            { afterMs: 10, state: 2 },
            { afterMs: 5, state: 3 },
          ],
        }),
      ).toThrow(/ascending/);
    });
  });

  describe('faults', () => {
    it('serves a one-shot fault once, then the route again', async () => {
      fake.faults.next('GET', '/api/v1/auth/me', {
        status: 502,
        body: { detail: 'upstream unavailable', retryable: true },
      });
      const first = await getJson(fake, '/api/v1/auth/me', { headers: AUTH });
      const second = await getJson(fake, '/api/v1/auth/me', { headers: AUTH });
      expect(first).toEqual({
        status: 502,
        body: { detail: 'upstream unavailable', retryable: true },
      });
      expect(second.status).toBe(200);
      expect(fake.calls.map((call) => call.path)).toEqual(['/api/v1/auth/me', '/api/v1/auth/me']);
    });

    it('matches a fault by route template as well as by concrete path', async () => {
      fake.route('GET', '/api/v1/project-setup/runs/{run_id}', () => ({
        status: 200,
        body: { run_id: 'r1', status: 'queued' as const, phase: 'queued', progress: 0 },
      }));
      fake.faults.next('GET', '/api/v1/project-setup/runs/{run_id}', {
        status: 409,
        body: { detail: { code: 'setup_incomplete' } },
      });
      const first = await getJson(fake, '/api/v1/project-setup/runs/r1', { headers: AUTH });
      const second = await getJson(fake, '/api/v1/project-setup/runs/r1', { headers: AUTH });
      expect([first.status, second.status]).toEqual([409, 200]);
    });

    it('forgets every job on restart, so reading one answers 404', async () => {
      fake.route('GET', '/api/v1/project-setup/runs/{run_id}', (req, _store, jobs) => ({
        status: 200,
        body: {
          run_id: req.params.run_id,
          ...jobs.read<Pick<SetupRun, 'status' | 'phase' | 'progress'>>(req.params.run_id).state,
        },
      }));
      const job = fake.jobs.start('project-setup', {
        steps: [{ afterMs: 0, state: { status: 'analyzing', phase: 'analyzing', progress: 10 } }],
      });
      const projectId = fake.store.newId();
      fake.store.collection<{ id: string; name: string }>('projects').insert({
        id: projectId,
        name: 'sklep',
      });

      const before = await getJson(fake, `/api/v1/project-setup/runs/${job.id}`, {
        headers: AUTH,
      });
      fake.faults.restart();
      const after = await getJson(fake, `/api/v1/project-setup/runs/${job.id}`, {
        headers: AUTH,
      });

      expect(before.status).toBe(200);
      expect(after).toEqual({ status: 404, body: { detail: `Job not found: ${job.id}` } });
      expect(fake.store.collection('projects').get(projectId)).toEqual({
        id: projectId,
        name: 'sklep',
      });
    });
  });

  describe('contract check', () => {
    it('fails the test with the operation and the field path when a response breaks the contract', async () => {
      fake.route('GET', '/api/v1/projects/{project_id}', (req) => ({
        status: 200,
        body: {
          ...projectDetail(req.params.project_id, { name: 'sklep', base_url: 'x' }),
          name: 42,
        } as unknown as ProjectDetail,
      }));

      const response = await getJson(fake, '/api/v1/projects/p1', { headers: AUTH });

      expect(response.status).toBe(500);
      const [violation, ...others] = fake.takeViolations();
      expect(others).toEqual([]);
      expect(violation?.message).toMatch(/GET \/api\/v1\/projects\/\{project_id\}/);
      expect(violation?.message).toMatch(/get_project_api_v1_projects__project_id__get/);
      expect(violation?.message).toMatch(/\/name must be string/);
      expect(fake.violations).toEqual([]);
    });

    it('fails on a success status the operation does not declare', async () => {
      fake.route('GET', '/api/v1/auth/session', () => ({
        status: 201,
        body: { authenticated: true, user_id: null },
      }));
      await getJson(fake, '/api/v1/auth/session', { headers: AUTH });
      expect(fake.takeViolations().map((violation) => violation.message)).toEqual([
        expect.stringMatching(/status 201 is not declared/),
      ]);
    });

    it('requires the backend error envelope on undeclared error statuses', async () => {
      fake.faults.next('GET', '/api/v1/auth/me', { status: 503, body: { message: 'down' } });
      await getJson(fake, '/api/v1/auth/me', { headers: AUTH });
      expect(fake.takeViolations().map((violation) => violation.message)).toEqual([
        expect.stringMatching(/503.*must have required property 'detail'/s),
      ]);
    });

    it('accepts an error a handler throws when it carries the envelope', async () => {
      fake.route('GET', '/api/v1/projects/{project_id}', (req) => {
        throw new FakeHttpError(404, { detail: `Project not found: ${req.params.project_id}` });
      });
      const response = await getJson(fake, '/api/v1/projects/p9', { headers: AUTH });
      expect(response).toEqual({ status: 404, body: { detail: 'Project not found: p9' } });
    });

    it('fails the test when a handler throws something else', async () => {
      fake.route('GET', '/api/v1/projects/{project_id}', () => {
        throw new Error('handler bug');
      });
      const response = await getJson(fake, '/api/v1/projects/p9', { headers: AUTH });
      expect(response.status).toBe(500);
      expect(fake.takeErrors().map((error) => error.message)).toEqual(['handler bug']);
    });

    it('throws when a route that is not in the contract is registered', () => {
      expect(() =>
        fake.route('GET', '/api/v1/nothing-here' as RoutePath, () => ({ status: 200 })),
      ).toThrow(/GET \/api\/v1\/nothing-here is not in contracts\/loadcraft-openapi\.json/);
      expect(() =>
        fake.route('DELETE' as 'GET', '/api/v1/auth/me', () => ({ status: 200 })),
      ).toThrow(/DELETE \/api\/v1\/auth\/me is not in contracts/);
    });

    it('answers /api/v1/meta without a token, in the shape of the snapshot', async () => {
      const response = await getJson(fake, '/api/v1/meta');
      expect(response).toEqual({
        status: 200,
        body: {
          version: '0.0.0-fake',
          api_revision: 1,
          capabilities: ['meta'],
          public_base_url: null,
        },
      });
    });

    it('answers 404 like the backend for a path no route serves', async () => {
      const response = await getJson(fake, '/api/v1/nothing-here', { headers: AUTH });
      expect(response).toEqual({ status: 404, body: { detail: 'Not Found' } });
    });

    it('redirects a path that differs only by its trailing slash with a 307, as FastAPI does', async () => {
      fake.route('GET', '/api/v1/projects', () => ({
        status: 200,
        body: { projects: [], total: 0 },
      }));
      const answer = await fetch(new URL('/api/v1/projects/?limit=5', fake.url), {
        headers: AUTH,
        redirect: 'manual',
      });
      expect(answer.status).toBe(307);
      expect(answer.headers.get('location')).toBe(`${fake.url}/api/v1/projects?limit=5`);
      const wrongMethod = await fetch(new URL('/api/v1/projects/', fake.url), {
        method: 'DELETE',
        redirect: 'manual',
      });
      expect(wrongMethod.status).toBe(307);
      const unknown = await getJson(fake, '/api/v1/nothing-here/', { headers: AUTH });
      expect(unknown.status).toBe(404);
    });

    it('matches a FastAPI path-converter parameter across several segments', async () => {
      fake.route(
        'GET',
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/report/{filepath}',
        // a report asset is a file: the answer is its bytes
        (req) => ({ status: 200, body: Buffer.from(req.params.filepath) }),
      );
      const response = await fetch(
        new URL(
          '/api/v1/projects/p1/gatling/executions/e1/report/assets/js/app%20main.js',
          fake.url,
        ),
        { headers: AUTH },
      );
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 200,
        body: 'assets/js/app main.js',
      });
    });

    it('prefers the longer literal route over a path-converter parameter, as the backend does', () => {
      const contract = loadContract();
      const base = '/api/v1/projects/p1/gatling/executions/e1/endpoints';
      expect(contract.match('GET', `${base}/POST /checkout/step/percentiles`)?.path).toBe(
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}/percentiles',
      );
      expect(contract.match('GET', `${base}/POST /checkout/step`)?.path).toBe(
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}',
      );
      expect(contract.match('GET', '/api/v1/projects/p1/flows/a/b')).toBeUndefined();
      for (const [template, name] of Object.entries(PATH_CONVERTER_PARAMS)) {
        expect(template).toContain(`{${name}}`);
        expect(contract.has('GET', template)).toBe(true);
      }
    });

    it('keeps the explicit list of untyped success responses equal to the snapshot', () => {
      expect([...UNTYPED_SUCCESS_RESPONSES].sort()).toEqual(
        untypedSuccessResponses(loadContract()),
      );
    });
  });
});

// A tool test that never calls close() and only checks `!ok` must still fail when the fake broke
// the contract: the check runs when the test ends. `it.fails` turns that failure into a pass, and
// the next test proves the failure came from the contract check and nothing else.
describe('contract check without close()', () => {
  let failure: string[] | undefined;

  it.fails('fails a test that never closes the fake', async () => {
    onTestFailed(({ task }) => {
      failure = (task.result?.errors ?? []).map((error) => error.message ?? '');
    });
    const fake = await startFake({ clock: createTestClock() });
    fake.route('GET', '/api/v1/auth/session', () => ({
      status: 201,
      body: { authenticated: true, user_id: null },
    }));
    const response = await fetch(new URL('/api/v1/auth/session', fake.url), { headers: AUTH });
    expect(response.ok).toBe(false);
  });

  it('failed it through the contract violation alone', () => {
    expect(failure).toEqual([
      expect.stringMatching(
        /contract violation: GET \/api\/v1\/auth\/session .*status 201 is not declared/s,
      ),
    ]);
  });
});

describe('fake outside a test', () => {
  let outside: unknown;
  let manual: Fake | undefined;

  beforeAll(async () => {
    outside = await startFake({ clock: createTestClock() }).catch((error: unknown) => error);
    manual = await startFake({ clock: createTestClock(), scope: 'manual' });
  });

  afterAll(async () => {
    await manual?.close();
  });

  it('refuses to start where the end-of-test check cannot run', () => {
    expect(outside).toBeInstanceOf(Error);
    expect((outside as Error).message).toMatch(/inside a test or beforeEach.*scope: 'manual'/s);
  });

  it('runs with scope manual, checked by close()', async () => {
    const response = await fetch(new URL('/api/v1/auth/me', manual?.url), { headers: AUTH });
    expect(response.status).toBe(200);
  });
});

describe('fake backend and settleClock', () => {
  it('the clock does not move while the fake still works out an answer', async () => {
    const clock = createTestClock(Date.UTC(2026, 10, 22, 10));
    const fake = await startFake({ clock });
    fake.route('GET', '/api/v1/projects/{project_id}', async (req) => {
      // Real work the client cannot see: its socket only waits for the answer.
      await new Promise<void>((done) => setTimeout(done, 80));
      return {
        status: 200,
        body: projectDetail(req.params.project_id, { name: 'sklep', base_url: 'x' }),
      };
    });
    // The caller gives up after 1 s of test time, as a request with a time limit on the clock does.
    const call = Promise.race([
      getJson(fake, '/api/v1/projects/p1', { headers: AUTH }).then((response) => response.status),
      clock.sleep(1000).then(() => 'gave up' as const),
    ]);
    expect(await settleClock({ clock }, call)).toBe(200);
  });

  it('a handler that sleeps on the test clock lets it move', async () => {
    const clock = createTestClock(Date.UTC(2026, 10, 22, 10));
    const fake = await startFake({ clock });
    fake.route('GET', '/api/v1/projects/{project_id}', async (req) => {
      await clock.sleep(30_000);
      return {
        status: 200,
        body: projectDetail(req.params.project_id, { name: 'sklep', base_url: 'x' }),
      };
    });
    const started = clock.now();
    const call = getJson(fake, '/api/v1/projects/p1', { headers: AUTH });
    expect((await settleClock({ clock }, call)).status).toBe(200);
    expect(clock.now() - started).toBe(30_000);
  });
});
