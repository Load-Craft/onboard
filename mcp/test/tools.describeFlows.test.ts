// `flows_describe_journeys`: a description, an environment and a test account in, the plan of the paths
// LoadCraft's browser will walk out. The password is read from the env file by the server and goes
// to LoadCraft only in the body of the request; the plan comes from the run's channel, which is
// opened with the token in a header and an `Origin`, and closed as soon as the plan is read.

import { readFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readPlan } from '../src/api/describe.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { Secret } from '../src/secret.js';
import { renderDescribeFlows, type DescribeFlowsData } from '../src/render/views/describeFlows.js';
import { flowsDescribeJourneys, targetRefusal } from '../src/tools/flowsDescribeJourneys.js';
import { processWait } from '../src/tools/processWait.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import {
  registerDescribeRoutes,
  type DescribeHandles,
  type DescribeWorld,
} from './fake-backend/routes/describe.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { startFake, type Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { FILE_CANARY } from './helpers/canary.js';
import { waitFor } from './helpers/async.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:00:00Z');
const RUN = SKLEP_IDS.recordRun;
const PLAN = `r-${RUN.slice(0, 8)}`;
const DESCRIPTION =
  'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą, część z kodem ' +
  'rabatowym. Część klientów przegląda katalog, część sprawdza swoje zamówienia.';
const EMAIL = 'user@example.com';
const ENV_SECRET = 'svc-key-91ac77e0d2';
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
  '.env.perf': `API_URL=https://api.perf.example.com\nTEST_USER_EMAIL=${EMAIL}\nTEST_USER_PASSWORD=${FILE_CANARY}\n`,
};
const CAPABILITIES = ['meta', 'api_token_sockets'];
const ARGS = {
  description: DESCRIPTION,
  environment: 'perf',
  account: { from_env: '.env.perf' },
} as const;
const GENERATE = `/api/v1/projects/${SKLEP_IDS.project}/scenario-from-description/generate`;
const LINK = `https://app.loadcraft.io/projects/${SKLEP_IDS.project}/scenario-from-description/runs/${RUN}`;

// ---- a proxy in front of the fake: what the plugin sends, and a Host it can rewrite ----------

interface Upgrade {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

interface Proxy {
  readonly url: string;
  readonly upgrades: readonly Upgrade[];
}

/**
 * Passes every request and WebSocket upgrade on to the fake and notes each upgrade. With `host`,
 * the `Host` header is replaced, as a reverse proxy that names its upstream does.
 */
async function startProxy(fake: Fake, options: { host?: string } = {}): Promise<Proxy> {
  const target = new URL(fake.url);
  const upgrades: Upgrade[] = [];
  const sockets = new Set<Socket>();
  const headersFor = (raw: IncomingHttpHeaders): IncomingHttpHeaders =>
    options.host === undefined ? raw : { ...raw, host: options.host };
  const server = createServer((req, res) => {
    const upstream = request(
      {
        host: target.hostname,
        port: Number(target.port),
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: headersFor(req.headers),
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket: Socket, head: Buffer) => {
    upgrades.push({ url: req.url ?? '', headers: { ...req.headers } });
    const headers = headersFor(req.headers);
    const upstream = netConnect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    for (const end of [socket, upstream]) {
      sockets.add(end);
      end.on('error', () => {
        socket.destroy();
        upstream.destroy();
      });
    }
  });
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return { url: `http://127.0.0.1:${String(port)}`, upgrades };
}

// ---- the rig ---------------------------------------------------------------------------------

interface Setup {
  readonly world?: DescribeWorld;
  readonly locale?: 'en' | 'pl';
  readonly capabilities?: readonly string[];
  readonly proxy?: { host?: 'fake' };
  /** The tool sees a backend address that is not the loopback (requests still reach the fake). */
  readonly remoteBackend?: boolean;
  readonly files?: Readonly<Record<string, string>>;
  /** Changes to the stored environments before the call (frontend address, last probe). */
  readonly environments?: (fake: Fake) => void;
}

interface Started {
  readonly r: ToolRig;
  readonly handles: DescribeHandles;
  readonly proxy?: Proxy;
}

async function rig(setup: Setup = {}): Promise<Started> {
  let handles: DescribeHandles | undefined;
  let proxy: Proxy | undefined;
  const env: NodeJS.ProcessEnv = { LOADCRAFT_LOCALE: setup.locale ?? 'en' };
  const r = await toolRig({
    tools: [
      setup.remoteBackend === true
        ? {
            ...flowsDescribeJourneys,
            invoke: (ctx, args) =>
              flowsDescribeJourneys.invoke(
                { ...ctx, config: { ...ctx.config, apiUrl: 'https://app.loadcraft.io/api/v1' } },
                args,
              ),
          }
        : flowsDescribeJourneys,
      processWait,
    ],
    clock: createTestClock(NOW),
    fake: { meta: { capabilities: setup.capabilities ?? CAPABILITIES } },
    env,
    files: { ...BOUND, ...setup.files },
    world: async (fake) => {
      registerLookupRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      handles = registerDescribeRoutes(fake, { runIds: [RUN], ...setup.world });
      setup.environments?.(fake);
      if (setup.proxy !== undefined) {
        const host = setup.proxy.host === 'fake' ? new URL(fake.url).host : undefined;
        proxy = await startProxy(fake, host === undefined ? {} : { host });
        env.LOADCRAFT_API_URL = `${proxy.url}/api/v1`;
      }
    },
  });
  if (handles === undefined) throw new Error('the world did not register the describe routes');
  return { r, handles, ...(proxy === undefined ? {} : { proxy }) };
}

const call = (r: ToolRig, args: Record<string, unknown>): Promise<RigCallResult> =>
  settleClock(r, r.call('flows_describe_journeys', args));

const posts = (r: ToolRig) =>
  r.fake.calls.filter((item) => item.method === 'POST' && item.path === GENERATE);

const stateText = (r: ToolRig): string => {
  try {
    return readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  } catch {
    return '';
  }
};

const data = (result: RigCallResult): DescribeFlowsData =>
  result.outcome?.data as DescribeFlowsData;

function updateEnvironment(fake: Fake, id: string, fields: Record<string, unknown>): void {
  fake.store.collection(SKLEP_COLLECTIONS.environments).update(id, fields);
}

// ---- run 3 -----------------------------------------------------------------------------------

describe('flows_describe_journeys: the plan of run 3', () => {
  it('draws the plan of three paths as in the golden text', async () => {
    const { r } = await rig({ locale: 'pl' });
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(`${result.text}\n`).toBe(goldenText('run3', '03-flows_describe_journeys'));
    expect(data(result)).toMatchObject({
      plan: PLAN,
      single: false,
      started: false,
      accountUsed: { file: '.env.perf', emailKey: 'TEST_USER_EMAIL' },
      link: LINK,
    });
    expect(data(result).paths.map((path) => path.name)).toEqual([
      'zakupy',
      'przeglądanie',
      'konto',
    ]);
  });

  it('sends the password only in the request body; the result, log and cache never hold it', async () => {
    const { r, handles } = await rig();
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(handles.bodies).toHaveLength(1);
    expect(handles.bodies[0]).toEqual({
      description: DESCRIPTION,
      app_context: 'Sklep API',
      target_url: 'https://perf.example.com',
      environment_id: SKLEP_WORLD_IDS.environments.perf,
      auth_credentials: { username: EMAIL, password: FILE_CANARY },
    });
    // The view data names the file and the key, never the address or the password.
    expect(JSON.stringify(result.outcome)).not.toContain(EMAIL);
    expect(result.text).not.toContain(EMAIL);
    const state = stateText(r);
    expect(state).toContain(`record_run:${RUN}`);
    expect(state).toContain('przeglądanie');
    expect(state).not.toContain(EMAIL);
    r.assertClean();
  });

  it('opens the channel with the token in a header and a matching Origin, then closes it', async () => {
    const { r, proxy } = await rig({ proxy: {} });
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(proxy?.upgrades).toHaveLength(1);
    const [upgrade] = proxy?.upgrades ?? [];
    expect(upgrade?.url).toBe(
      `/ws/projects/${SKLEP_IDS.project}/scenario-from-description/runs/${RUN}`,
    );
    expect(upgrade?.url).not.toContain(CANARY);
    expect(upgrade?.url).not.toContain('token');
    expect(upgrade?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(upgrade?.headers.origin).toBe(proxy?.url);
    const channel = r.fake.channel('describe', { project_id: SKLEP_IDS.project, run_id: RUN });
    expect(channel.opened).toBe(1);
    // The client sent its close frame; the server sees it a moment later.
    await waitFor(() => channel.connections === 0, 'the socket to close');
    // The pause for the approval outlives the closed socket: nothing was sent on it.
    expect(channel.received).toEqual([]);
    expect(channel.status).toBe('running');
  });

  it('without an account sends no credentials and still reads the plan', async () => {
    const { r, handles } = await rig();
    const result = await call(r, { description: DESCRIPTION, environment: 'perf' });
    expect(result.isError, result.text).toBe(false);
    expect(handles.bodies[0]?.auth_credentials).toBeNull();
    expect(data(result).accountUsed).toBeNull();
    // Without an account no sign-in is shared.
    expect(data(result).sharedSignIn).toEqual([]);
  });

  describe('app_context', () => {
    const setProject = (description: string | null) => (fake: Fake) =>
      fake.store.collection(SKLEP_COLLECTIONS.projects).update(SKLEP_IDS.project, { description });

    it('sends the description of the project, as the frontend does', async () => {
      const { r, handles } = await rig({ environments: setProject('Shop with a checkout form.') });
      const result = await call(r, ARGS);
      expect(result.isError, result.text).toBe(false);
      expect(handles.bodies[0]?.app_context).toBe('Shop with a checkout form.');
    });

    it('falls back to loadcraft/overview.md when the project has no description', async () => {
      const { r, handles } = await rig({
        environments: setProject(null),
        files: { 'loadcraft/overview.md': '# Shop\nCustomers pay by card.\n' },
      });
      const result = await call(r, ARGS);
      expect(result.isError, result.text).toBe(false);
      expect(handles.bodies[0]?.app_context).toBe('# Shop\nCustomers pay by card.');
    });

    it('sends no app_context when there is neither a description nor an overview', async () => {
      const { r, handles } = await rig({ environments: setProject(null) });
      const result = await call(r, ARGS);
      expect(result.isError, result.text).toBe(false);
      expect(handles.bodies[0]).not.toHaveProperty('app_context');
    });

    it('masks the values of the env files before the text leaves', async () => {
      const { r, handles } = await rig({
        environments: setProject(
          `Admin key ${ENV_SECRET}, password ${FILE_CANARY}, page https://shop.example.com.`,
        ),
        files: { '.env': `SERVICE_KEY=${ENV_SECRET}\n` },
      });
      const result = await call(r, ARGS);
      expect(result.isError, result.text).toBe(false);
      const sent = handles.bodies[0]?.app_context ?? '';
      expect(sent).toBe(
        'Admin key [redacted], password [redacted], page https://shop.example.com.',
      );
      expect(sent).not.toContain(ENV_SECRET);
      expect(sent).not.toContain(FILE_CANARY);
    });

    it('cuts a longer text to the 8000 characters of a project description', async () => {
      const { r, handles } = await rig({ environments: setProject('a'.repeat(9000)) });
      const result = await call(r, ARGS);
      expect(result.isError, result.text).toBe(false);
      expect([...(handles.bodies[0]?.app_context ?? '')]).toHaveLength(8000);
    });
  });

  it('passes max_steps and the key names of the account', async () => {
    const { r, handles } = await rig({
      files: { '.env.qa': `QA_LOGIN=${EMAIL}\nQA_SECRET=${FILE_CANARY}\n` },
    });
    const result = await call(r, {
      ...ARGS,
      account: { from_env: '.env.qa', email_key: 'QA_LOGIN', password_key: 'QA_SECRET' },
      max_steps: 30,
    });
    expect(result.isError, result.text).toBe(false);
    expect(handles.bodies[0]).toMatchObject({
      max_steps: 30,
      auth_credentials: { username: EMAIL, password: FILE_CANARY },
    });
    expect(data(result).accountUsed).toEqual({ file: '.env.qa', emailKey: 'QA_LOGIN' });
  });

  it('lists only the paths that do not bring their own account as sharing the sign-in', async () => {
    const { r } = await rig({
      world: {
        paths: [
          { name: 'rejestracja', steps: ['register'], creates_own_identity: true },
          { name: 'zakupy', steps: ['log in', 'pay'] },
        ],
      },
    });
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(data(result).sharedSignIn).toEqual(['zakupy']);
    expect(data(result).paths[0]).toMatchObject({ name: 'rejestracja', ownIdentity: true });
    expect(result.text.split('\n').slice(0, 2)).toEqual([
      'plan r-2481a3f0 · 2 paths · shared sign-in for: zakupy',
      'own account, no shared sign-in: rejestracja',
    ]);
  });
});

describe('flows_describe_journeys: one path', () => {
  it('says the walk has started, with the live preview link, and asks nothing', async () => {
    const { r } = await rig({ world: { paths: [{ name: 'zakupy', steps: ['buy'] }] } });
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(data(result)).toMatchObject({ plan: PLAN, single: true, started: true });
    expect(result.text).toContain(PLAN);
    expect(result.text).toMatch(/one path[^\n]*already walking/iu);
    expect(result.text).toContain(`↗ live preview: ${LINK}`);
    // No channel is needed for a run that asks nothing.
    const channel = r.fake.channel('describe', { project_id: SKLEP_IDS.project, run_id: RUN });
    expect(channel.opened).toBe(0);
  });

  it('says it in Polish', async () => {
    const { r } = await rig({
      locale: 'pl',
      world: { paths: [{ name: 'zakupy', steps: ['buy'] }] },
    });
    const result = await call(r, ARGS);
    expect(result.isError, result.text).toBe(false);
    await expect(result.text).toMatchFileSnapshot('__snapshots__/describeFlows.single.pl.txt');
  });
});

// ---- refusals and errors ---------------------------------------------------------------------

describe('flows_describe_journeys: refusals', () => {
  it('names the missing key of the env file and sends nothing', async () => {
    const { r } = await rig();
    const result = await call(r, {
      ...ARGS,
      account: { from_env: '.env.perf', password_key: 'PERF_PASS' },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[env_key_missing\] /u);
    expect(result.text).toContain('PERF_PASS');
    expect(posts(r)).toHaveLength(0);
  });

  it('refuses a file that is not an env file without reading it', async () => {
    const { r } = await rig({ files: { 'notes.txt': `TEST_USER_PASSWORD=${FILE_CANARY}\n` } });
    const result = await call(r, { ...ARGS, account: { from_env: 'notes.txt' } });
    expect(result.text).toMatch(/^\[env_file_not_allowed\] /u);
    expect(posts(r)).toHaveLength(0);
  });

  it('agent_browsers_busy: one named error with a hint', async () => {
    const { r } = await rig({ world: { busy: true } });
    const result = await call(r, ARGS);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[agent_browsers_busy\] /u);
    expect(result.text).toMatch(/\n→ /u);
    await expect(result.text).toMatchFileSnapshot('__snapshots__/describeFlows.busy.en.txt');
  });

  it('setup_incomplete: names the missing parts', async () => {
    const { r } = await rig({ world: { missingSetup: ['profile'] } });
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[setup_incomplete\] /u);
    expect(result.text).toContain('application profile');
  });

  it('an environment without a frontend address: says how to fill it, sends nothing', async () => {
    const { r } = await rig({
      environments: (fake) => {
        updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, { frontend_url: null });
      },
    });
    const result = await call(r, { ...ARGS, environment: 'dev' });
    expect(result.text).toMatch(/^\[environment_without_frontend\] /u);
    expect(result.text).toContain('dev');
    expect(result.text).toMatch(/\n→ [^\n]*frontend address/u);
    expect(posts(r)).toHaveLength(0);
  });

  // The address the browser opens against where the plugin's backend runs: a local backend decides
  // for itself (its probe), a remote one never reaches private addresses; link-local always refused.
  const LOCAL = 'http://localhost:8000/api/v1';
  const LOCAL_V4 = 'http://127.0.0.1:8000/api/v1';
  const LOCAL_V6 = 'http://[::1]:8000/api/v1';
  const LOCAL_NAMED = 'http://app.localhost:8000/api/v1';
  const REMOTE = 'https://app.loadcraft.io/api/v1';
  const REMOTE_PRIVATE = 'http://10.0.0.5:8000/api/v1';
  it.each([
    // backend, frontend, probe, expected refusal
    [LOCAL, 'http://localhost:5173', 'ok', undefined],
    [LOCAL, 'http://localhost:5173', 'blocked', 'blocked_local'],
    [LOCAL, 'http://shop.localhost:5173', 'ok', undefined],
    [LOCAL, 'http://shop.localhost:5173', 'blocked', 'blocked_local'],
    [LOCAL, 'http://10.0.0.7:3000', 'ok', undefined],
    [LOCAL, 'http://10.0.0.7:3000', 'blocked', 'blocked_local'],
    [LOCAL, 'http://[::1]:8080', 'ok', undefined],
    [LOCAL, 'http://169.254.169.254', 'ok', 'link_local'],
    [LOCAL, 'http://169.254.169.254', 'blocked', 'link_local'],
    [LOCAL, 'http://[fe80::1]:80', 'ok', 'link_local'],
    [LOCAL, 'https://shop.example.com', 'ok', undefined],
    [LOCAL, 'https://shop.example.com', 'blocked', 'blocked_local'],
    [LOCAL_V4, 'http://localhost:5173', 'ok', undefined],
    [LOCAL_V6, 'http://localhost:5173', 'ok', undefined],
    [LOCAL_NAMED, 'http://localhost:5173', 'ok', undefined],
    [REMOTE, 'http://localhost:5173', 'ok', 'private'],
    [REMOTE, 'http://localhost:5173', 'blocked', 'private'],
    [REMOTE, 'http://shop.localhost:5173', 'ok', 'private'],
    [REMOTE, 'http://10.0.0.7:3000', 'ok', 'private'],
    [REMOTE, 'http://10.0.0.7:3000', 'blocked', 'private'],
    [REMOTE, 'http://169.254.169.254', 'ok', 'link_local'],
    [REMOTE, 'http://[fe80::1]:80', 'ok', 'link_local'],
    [REMOTE, 'https://shop.example.com', 'ok', undefined],
    [REMOTE, 'https://shop.example.com', 'blocked', 'blocked'],
    [REMOTE_PRIVATE, 'http://localhost:5173', 'ok', 'private'],
    ['https://127.0.0.1.example.com/api/v1', 'http://localhost:5173', 'ok', 'private'],
  ] as const)('backend %s, frontend %s, probe %s: %s', (api, frontend, probe, expected) => {
    expect(targetRefusal(frontend, probe === 'blocked' ? 'blocked' : 'ok', api)).toBe(expected);
  });

  it.each([
    ['http://10.0.0.7:3000', 'private'],
    ['http://localhost:5173', 'private'],
    ['http://[::1]:8080', 'private'],
    ['http://169.254.169.254/latest', 'link-local'],
    ['https://shop.internal.example.com', 'blocked'],
  ])(
    'a remote backend, a frontend at %s the LoadCraft browser cannot reach: use a HAR recording',
    async (url, why) => {
      const { r } = await rig({
        remoteBackend: true,
        environments: (fake) => {
          updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, {
            frontend_url: url,
            last_probe:
              why === 'blocked'
                ? {
                    checked_at: '2026-11-22T09:00:00Z',
                    results: [
                      { kind: 'base_url', status: 'ok', url: 'https://api.dev.example.com' },
                      { kind: 'frontend_url', status: 'blocked', url },
                    ],
                  }
                : null,
          });
        },
      });
      const result = await call(r, { ...ARGS, environment: 'dev' });
      expect(result.text).toMatch(/^\[target_unreachable\] /u);
      expect(result.text).toMatch(/\n→ [^\n]*HAR/u);
      expect(result.text).toContain('flows_import_har');
      expect(posts(r)).toHaveLength(0);
    },
  );

  it('a local backend leaves a localhost frontend to the backend: the run starts', async () => {
    const { r } = await rig({
      environments: (fake) => {
        updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, {
          frontend_url: 'http://localhost:5173',
          last_probe: null,
        });
      },
    });
    const result = await call(r, { ...ARGS, environment: 'dev' });
    expect(result.text).not.toMatch(/^\[target_unreachable\]/u);
    expect(posts(r).length).toBeGreaterThan(0);
  });

  it('a local backend that blocked the frontend probe: refused, with what to do', async () => {
    const { r } = await rig({
      environments: (fake) => {
        updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, {
          frontend_url: 'http://localhost:5173',
          last_probe: {
            checked_at: '2026-11-22T09:00:00Z',
            results: [{ kind: 'frontend_url', status: 'blocked', url: 'http://localhost:5173' }],
          },
        });
      },
    });
    const result = await call(r, { ...ARGS, environment: 'dev' });
    expect(result.text).toMatch(/^\[target_unreachable\] /u);
    expect(result.text).toMatch(/administrator/u);
    expect(result.text).toContain('flows_import_har');
    expect(posts(r)).toHaveLength(0);
  });

  it('a link-local frontend is refused even when the backend is local', async () => {
    const { r } = await rig({
      environments: (fake) => {
        updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, {
          frontend_url: 'http://169.254.169.254/',
          last_probe: null,
        });
      },
    });
    const result = await call(r, { ...ARGS, environment: 'dev' });
    expect(result.text).toMatch(/^\[target_unreachable\] /u);
    expect(result.text).toMatch(/link-local/u);
    expect(posts(r)).toHaveLength(0);
  });

  it('a public frontend whose last probe was fine is not refused', async () => {
    const { r } = await rig({
      environments: (fake) => {
        updateEnvironment(fake, SKLEP_WORLD_IDS.environments.dev, {
          last_probe: {
            checked_at: '2026-11-22T09:00:00Z',
            results: [{ kind: 'frontend_url', status: 'ok', url: 'https://dev.example.com' }],
          },
        });
      },
    });
    const result = await call(r, { ...ARGS, environment: 'dev' });
    expect(result.isError, result.text).toBe(false);
  });

  it('a backend without token sockets: backend_too_old, nothing read or sent', async () => {
    const { r } = await rig({ capabilities: ['meta'] });
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[backend_too_old\] /u);
    expect(result.text).toContain('api_token_sockets');
    expect(posts(r)).toHaveLength(0);
  });

  it('a rejected token: unauthorized', async () => {
    const { r } = await rig();
    r.fake.faults.next('POST', GENERATE, { status: 401, body: { detail: 'Invalid token' } });
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[unauthorized\] /u);
  });

  it('a run that fails while planning: the text of LoadCraft goes to the log, not to the model', async () => {
    const { r } = await rig({ world: { failure: 'URL blocked by the address policy' } });
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[describe_run_failed\] /u);
    expect(result.text).not.toContain('URL blocked by the address policy');
    const logged = r.logRecords('warn').filter((record) => record.msg === 'backend error text');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      source: 'flows_describe_journeys',
      text: 'URL blocked by the address policy',
    });
  });

  it('no plan on the channel within 15 s: an error with the state of the run', async () => {
    const { r } = await rig({ world: { silent: true } });
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[plan_not_received\] /u);
    expect(result.text).toContain('15 s');
    expect(result.text).toContain('waits for the approval');
    const channel = r.fake.channel('describe', { project_id: SKLEP_IDS.project, run_id: RUN });
    // The client sent its close frame; the server sees it a moment later.
    await waitFor(() => channel.connections === 0, 'the socket to close');
    // The run is kept: calling again continues it, it does not start a second one.
    const again = await call(r, ARGS);
    expect(again.text).toMatch(/^\[plan_not_received\] /u);
    expect(posts(r)).toHaveLength(1);
  });

  it('a handshake refused for its Origin (a proxy that rewrites Host): a readable error', async () => {
    const { r } = await rig({ proxy: { host: 'fake' } });
    const result = await call(r, ARGS);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[describe_channel_refused\] /u);
    expect(result.text).toContain('origin_not_allowed');
    expect(result.text).toContain('LOADCRAFT_API_URL');
    expect(result.text).toContain(LINK);
  });

  it('a network that blocks WebSocket: the plan waits in the app, with the link', async () => {
    const { r } = await rig();
    r.fake.faults.blockWebSocket();
    const result = await call(r, ARGS);
    expect(result.text).toMatch(/^\[describe_channel_unavailable\] /u);
    expect(result.text).toContain(LINK);
    expect(result.text).toContain('flows_import_har');
  });
});

// ---- waiting ---------------------------------------------------------------------------------

describe('flows_describe_journeys: a plan that takes longer than the call', () => {
  it('a second call after the plan was shown draws the same plan, without a socket or an approval', async () => {
    const { r, handles } = await rig();
    const first = await call(r, ARGS);
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome?.status).toBe('done');
    const opened = r.fake.channel('describe', {
      project_id: SKLEP_IDS.project,
      run_id: RUN,
    }).opened;
    const again = await call(r, ARGS);
    expect(again.isError, again.text).toBe(false);
    expect(again.outcome?.status).toBe('done');
    expect(again.text).toBe(first.text);
    expect(again.text).toContain(`plan ${PLAN}`);
    expect(again.text).toContain('przeglądanie');
    expect(handles.approvals).toEqual([]);
    expect(posts(r)).toHaveLength(1);
    // Drawn from the plan kept in the workspace: no second socket for it.
    expect(r.fake.channel('describe', { project_id: SKLEP_IDS.project, run_id: RUN }).opened).toBe(
      opened,
    );
  });

  it('returns the record_run handle, process_wait continues it, and a second call joins it', async () => {
    const { r } = await rig({ world: { planAtMs: 60_000 } });
    const first = await call(r, { ...ARGS, max_wait_s: 5 });
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome?.status).toBe('running');
    expect(first.outcome?.operation).toBe(`record_run:${RUN}`);
    expect(first.text).toContain(`record_run:${RUN}`);

    const joined = await call(r, { ...ARGS, max_wait_s: 5 });
    expect(joined.outcome?.operation).toBe(`record_run:${RUN}`);
    expect(posts(r)).toHaveLength(1);

    const done = await settleClock(r, r.call('process_wait', { operation: `record_run:${RUN}` }));
    expect(done.isError, done.text).toBe(false);
    expect(done.outcome?.status).toBe('done');
    expect(done.text).toContain(`plan ${PLAN}`);
    expect(done.text).toContain('przeglądanie');
    // The plan stays in the cache for the approval.
    expect(stateText(r)).toContain(`record_run:${RUN}`);
  });
});

// ---- reading the plan ---------------------------------------------------------------------------

describe('readPlan', () => {
  // Without the call around it: the socket must close because the plan was read, not because the
  // request of the tool ended.
  it('closes the socket as soon as the proposal is read', async () => {
    const clock = createTestClock(NOW);
    const fake = await startFake({ clock });
    const channel = fake.channel('describe', { project_id: SKLEP_IDS.project, run_id: RUN });
    channel.emit({
      type: 'split_proposal',
      proposed_paths: [{ name: 'zakupy', steps: ['log in', 7, 'pay'], creates_own_identity: true }],
      shared_sign_in: true,
    });
    const ctx = {
      config: { apiUrl: `${fake.url}/api/v1`, token: new Secret(fake.token) },
      log: createLogger({ level: 'error', sink: () => undefined }),
      clock,
    };
    const read = await readPlan(ctx, SKLEP_IDS.project, RUN, 15_000);
    expect(read).toMatchObject({
      kind: 'plan',
      sharedSignIn: true,
      paths: [
        { name: 'zakupy', steps: ['log in', 'pay'], dependsOnPrior: false, ownIdentity: true },
      ],
    });
    await waitFor(() => channel.connections === 0, 'the socket to close');
    expect(channel.opened).toBe(1);
  });
});

// ---- the view --------------------------------------------------------------------------------

describe('flows_describe_journeys: view', () => {
  const golden = JSON.parse(
    readFileSync(goldenUrl('run3/03-flows_describe_journeys.view.json'), 'utf8'),
  ) as DescribeFlowsData;

  it('draws the pl golden text from the golden data', () => {
    const text = renderDescribeFlows(golden, createTranslator('pl'));
    expect(`${text}\n`).toBe(goldenText('run3', '03-flows_describe_journeys'));
  });

  it('draws the same data in English', async () => {
    const text = renderDescribeFlows(golden, createTranslator('en'));
    await expect(`${text}\n`).toMatchFileSnapshot('__snapshots__/describeFlows.golden.en.txt');
  });

  it('names the paths when only some of them share the sign-in', () => {
    const text = renderDescribeFlows(
      { ...golden, sharedSignIn: ['zakupy', 'konto'] },
      createTranslator('pl'),
    );
    expect(text.split('\n')[0]).toBe(
      'plan r-2481a3f0 · 3 ścieżki · logowanie wspólne dla: zakupy, konto',
    );
  });

  it('cuts a long list of names with +N and never goes past the width', () => {
    const names = Array.from({ length: 9 }, (_, i) => `ścieżka numer ${String(i + 1)}`);
    const paths = names.map((name, i) => ({
      name,
      steps: ['krok'],
      dependsOnPrior: false,
      ownIdentity: i >= 6,
    }));
    const text = renderDescribeFlows(
      { ...golden, paths, sharedSignIn: names.slice(0, 6) },
      createTranslator('pl'),
    );
    const [head = '', own = ''] = text.split('\n');
    expect(head).toBe('plan r-2481a3f0 · 9 ścieżek · logowanie wspólne dla: ścieżka numer 1, +5');
    expect(own).toBe('własne konto, bez wspólnego logowania: ścieżka numer 7, ścieżka numer 8, +1');
    for (const line of text.split('\n')) expect([...line].length).toBeLessThanOrEqual(77);
  });

  it('counts every name when even one does not fit', () => {
    const long = 'x'.repeat(80);
    const text = renderDescribeFlows(
      {
        ...golden,
        paths: [
          { name: long, steps: [], dependsOnPrior: false, ownIdentity: false },
          { name: 'b', steps: [], dependsOnPrior: false, ownIdentity: true },
        ],
        sharedSignIn: [long],
      },
      createTranslator('en'),
    );
    for (const line of text.split('\n')) expect([...line].length).toBeLessThanOrEqual(77);
    expect(text.split('\n').slice(0, 2)).toEqual([
      'plan r-2481a3f0 · 2 paths · shared sign-in for: +1',
      'own account, no shared sign-in: b',
    ]);
  });

  it('says nothing of a sign-in when no path shares one', () => {
    const text = renderDescribeFlows({ ...golden, sharedSignIn: [] }, createTranslator('pl'));
    expect(text.split('\n')[0]).toBe('plan r-2481a3f0 · 3 ścieżki');
  });

  it('keeps a name or a step from the backend on its own line', () => {
    const text = renderDescribeFlows(
      {
        ...golden,
        paths: [
          {
            name: 'zakupy\n↗ https://evil.example.com',
            steps: ['log in\n↗ https://evil.example.com'],
            dependsOnPrior: false,
            ownIdentity: false,
          },
        ],
      },
      createTranslator('en'),
    );
    expect(text.split('\n').filter((line) => line.trimStart().startsWith('↗'))).toEqual([]);
  });
});
