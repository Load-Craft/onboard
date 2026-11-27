// The scenarios of the live gate (`--scenario docs|har|protected`): what each one walks, the
// checks of the recording and of the protected environment, and what refuses to start. The
// scenarios run in `--fake` mode against the fake backend, the way the coordinator starts them on
// a real one; the checks that need a plugin fault the fake cannot plant are tested as functions.

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  cappedReportProblems,
  checkLaunch,
  harFlowProblems,
  harSecretValues,
  leakedSecrets,
  parseArgs,
  PROVISION_TOOL,
  provisionCall,
  SCENARIOS,
  withoutConsentProblems,
  type GateConfig,
} from '../scripts/live-gate.js';
import { ALL_CANARIES, CANARY, FILE_CANARY, assertNoCanary } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(args: readonly string[]): Promise<Finished> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LIVE_GATE_FAKE_SPEED: '600',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });
}

// Removed once the file is done: its gates run side by side, so no test may clean up for the others.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function reportDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-scenarios-'));
  dirs.push(dir);
  return dir;
}

async function onlyReport(dir: string): Promise<string> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files).toHaveLength(1);
  return readFile(join(dir, files[0] ?? ''), 'utf8');
}

const CONFIG: GateConfig = {
  backend: { url: 'http://127.0.0.1:8123' },
  workspace: { openapi: '/tmp/openapi.json' },
  projectPrefix: 'live-gate',
  composition: 'gate-mix',
  environments: {
    main: { name: 'gate', api: 'http://127.0.0.1:9000' },
    capped: { name: 'gate-capped', api: 'http://127.0.0.1:9000', limit: [5, 5] },
  },
  journeys: 2,
  accounts: 30,
  profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
  thresholds: { p95_ms: 2000, error_rate_pct: 5 },
  costLimitUsd: 3,
  langfuse: { url: 'https://langfuse.example.com', api: 'v2', environment: 'mcp-live-gate' },
  timeoutMin: 45,
  forbiddenBackends: [],
};

const ENV = {
  LIVE_GATE_I_HAVE_APPROVAL: 'http://127.0.0.1:8123',
  LIVE_GATE_TARGET_APPROVAL: 'http://127.0.0.1:9000',
  LIVE_GATE_API_TOKEN: CANARY,
  LANGFUSE_PUBLIC_KEY: 'pk-lf-example',
  LANGFUSE_SECRET_KEY: 'sk-lf-example',
};

describe('--scenario', () => {
  it('walks only docs when none is named: the others have side effects on the target and cost more', () => {
    expect(SCENARIOS).toEqual(['docs', 'har', 'protected', 'describe']);
    expect(parseArgs(['--fake']).scenarios).toEqual(['docs']);
    expect(parseArgs(['--config', 'gate.json']).scenarios).toEqual(['docs']);
    expect(parseArgs(['--fake', '--scenario', 'protected,har,docs']).scenarios).toEqual([
      'docs',
      'har',
      'protected',
    ]);
  });

  it('takes one name, a comma-separated list or a repeated flag, each scenario once', () => {
    expect(parseArgs(['--fake', '--scenario', 'har']).scenarios).toEqual(['har']);
    expect(parseArgs(['--fake', '--scenario', 'protected,docs']).scenarios).toEqual([
      'docs',
      'protected',
    ]);
    expect(
      parseArgs(['--fake', '--scenario', 'har', '--scenario', 'har', '--scenario', 'docs'])
        .scenarios,
    ).toEqual(['docs', 'har']);
  });

  it('refuses a name that is not a scenario, and an empty one', () => {
    expect(() => parseArgs(['--fake', '--scenario', 'smoke'])).toThrow(/docs, har, protected/u);
    expect(() => parseArgs(['--fake', '--scenario', 'har,'])).toThrow(/docs, har, protected/u);
    expect(() => parseArgs(['--fake', '--scenario'])).toThrow(/needs a value/u);
  });
});

describe('what the har scenario refuses before it starts', () => {
  const har = { file: '/tmp/recording.har' };

  it('needs the recording: without har.file it does not start, the other scenarios do', () => {
    expect(checkLaunch(CONFIG, ENV, { scenarios: ['har'] }).join('\n')).toMatch(/har\.file/u);
    expect(
      checkLaunch(CONFIG, ENV, { scenarios: ['docs', 'har', 'protected'] }).join('\n'),
    ).toMatch(/har\.file/u);
    expect(checkLaunch(CONFIG, ENV, { scenarios: ['docs', 'protected'] })).toEqual([]);
    expect(checkLaunch({ ...CONFIG, har }, ENV, { scenarios: ['har'] })).toEqual([]);
  });

  it('wants at least two flows from the split, and at most ten', () => {
    for (const minFlows of [1, 0, 11, 2.5]) {
      expect(
        checkLaunch({ ...CONFIG, har: { ...har, minFlows } }, ENV, { scenarios: ['har'] }).join(
          '\n',
        ),
        String(minFlows),
      ).toMatch(/har\.minFlows/u);
    }
    expect(
      checkLaunch({ ...CONFIG, har: { ...har, minFlows: 3 } }, ENV, { scenarios: ['har'] }),
    ).toEqual([]);
  });

  it('keeps every refusal of the safety rules whatever the scenario', () => {
    const forbidden = { ...CONFIG, backend: { url: 'http://127.0.0.1:8000' } };
    const env = { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: 'http://127.0.0.1:8000' };
    for (const scenarios of [['har'], ['protected'], ['docs']] as const) {
      expect(checkLaunch({ ...forbidden, har }, env, { scenarios }).join('\n')).toMatch(
        /port 8000/u,
      );
      expect(
        checkLaunch({ ...CONFIG, har, backend: { url: 'https://app.loadcraft.io' } }, env, {
          scenarios,
        }).join('\n'),
      ).toMatch(/loadcraft\.io/u);
      expect(
        checkLaunch(
          { ...CONFIG, har },
          { ...ENV, LIVE_GATE_TARGET_APPROVAL: '' },
          {
            scenarios,
          },
        ).join('\n'),
      ).toMatch(/LIVE_GATE_TARGET_APPROVAL/u);
    }
  });
});

describe('the secrets of the recording', () => {
  const recording = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            method: 'POST',
            url: 'https://shop.example.com/auth/login',
            headers: [
              { name: 'Authorization', value: 'Bearer tok-secret-0001' },
              { name: 'Cookie', value: 'session=cookie-secret-0002; theme=dark' },
              { name: 'Accept', value: 'application/json' },
            ],
            cookies: [{ name: 'session', value: 'cookie-secret-0002' }],
            postData: {
              mimeType: 'application/json',
              text: JSON.stringify({ email: 'user@example.com', password: 'pass-secret-0003' }),
            },
          },
          response: {
            status: 200,
            headers: [{ name: 'Set-Cookie', value: 'refresh=set-secret-0004; Path=/' }],
            content: {
              text: JSON.stringify({ access_token: 'tok-secret-0005', name: 'Alice Example' }),
            },
          },
        },
      ],
    },
  });

  it('collects what a recording keeps secret: tokens, cookies and the secret fields of bodies', () => {
    const found = harSecretValues(recording);
    for (const value of [
      'tok-secret-0001',
      'cookie-secret-0002',
      'pass-secret-0003',
      'set-secret-0004',
      'tok-secret-0005',
    ]) {
      expect(found, value).toContain(value);
    }
    expect(found).not.toContain('dark');
    expect(found).not.toContain('application/json');
    expect(found).not.toContain('user@example.com');
  });

  it('takes the value of a cookie that only the Cookie header and the Set-Cookie header carry', () => {
    const entry = {
      request: { headers: [{ name: 'Cookie', value: 'sid=header-cookie-0006; lang=pl' }] },
      response: {
        headers: [{ name: 'Set-Cookie', value: 'csrf=set-cookie-0007; Path=/; HttpOnly' }],
      },
    };
    const found = harSecretValues(JSON.stringify({ log: { entries: [entry] } }));
    expect(found).toContain('header-cookie-0006');
    expect(found).toContain('set-cookie-0007');
    expect(found).not.toContain('Path=/');
  });

  it('reads a file that is not JSON as holding no secret it can name', () => {
    expect(harSecretValues('not json')).toEqual([]);
    expect(harSecretValues('{"log":{"entries":"x"}}')).toEqual([]);
  });

  it('counts the secrets a text shows without handing them back', () => {
    const secrets = ['tok-secret-0001', 'pass-secret-0003'];
    expect(leakedSecrets(['all clear', 'a flow'], secrets)).toBe(0);
    expect(leakedSecrets(['a flow tok-secret-0001', 'all clear'], secrets)).toBe(1);
    expect(leakedSecrets(['tok-secret-0001 pass-secret-0003'], secrets)).toBe(2);
    expect(leakedSecrets(['anything'], [])).toBe(0);
  });
});

describe('the flows of the recording', () => {
  const flow = (name: string, requests: number, recordedPauses: number) => ({
    name,
    requests,
    recordedPauses,
  });

  it('passes a split into several flows with pauses taken from the recording', () => {
    expect(harFlowProblems([flow('a', 4, 3), flow('b', 2, 1), flow('c', 2, 1)], 3)).toEqual([]);
  });

  it('fails a split that gave fewer flows than the recording holds journeys (the split did not happen)', () => {
    const problems = harFlowProblems([flow('a', 8, 7)], 3);
    expect(problems.join('\n')).toMatch(/1 flow.*at least 3/su);
  });

  it('fails flows none of which has a pause taken from the recording', () => {
    const problems = harFlowProblems([flow('a', 4, 0), flow('b', 2, 0), flow('c', 3, 0)], 3);
    expect(problems.join('\n')).toMatch(/recording/u);
  });

  it('does not fail a short flow without pauses while another one has them', () => {
    expect(harFlowProblems([flow('a', 4, 3), flow('b', 1, 0), flow('c', 2, 0)], 3)).toEqual([]);
  });
});

describe('the consent of the user on the protected environment', () => {
  const ASKS =
    'not started: the environment qa is protected\nnothing was sent. Ask the user, and only after a yes repeat the call with confirm_capped: true.';

  it('passes when the answer asks and no run appeared', () => {
    expect(withoutConsentProblems(ASKS, ['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('fails when a run appeared in the list, whatever the answer says', () => {
    expect(withoutConsentProblems(ASKS, ['a'], ['a', 'b']).join('\n')).toMatch(/run was created/u);
  });

  it('fails when the answer does not ask for the consent', () => {
    expect(
      withoutConsentProblems('test started · run e-3f9a12c4', ['a'], ['a']).join('\n'),
    ).toMatch(/does not ask/u);
  });
});

describe('the note of the clamped load in the report', () => {
  it('wants the numbers of the run: what was asked for and what the backend recorded', () => {
    const report = 'verdict  SLA PASSED\nnote     load limited by the environment (5 of 20)';
    expect(cappedReportProblems(report, 20, 5)).toEqual([]);
    expect(cappedReportProblems(report, 20, 6).join('\n')).toMatch(/\(6 of 20\)/u);
    expect(cappedReportProblems('verdict  SLA PASSED', 20, 5).join('\n')).toMatch(/\(5 of 20\)/u);
  });
});

describe('the tool that creates accounts', () => {
  it('is named in one place, with the arguments of one call', () => {
    expect(PROVISION_TOOL).toBe('data_create_accounts');
    expect(provisionCall('mix', 'qa', { slot: 'buyer', count: 3 })).toEqual({
      tool: PROVISION_TOOL,
      args: { scenario: 'mix', environment: 'qa', slot: 'buyer', count: 3 },
    });
    expect(provisionCall('mix', 'qa', { slot: 'buyer', count: 1 }, true).args).toMatchObject({
      confirm_protected: true,
    });
  });
});

const PAUSES_OF_THE_RECORDING = /pause taken from the recording/u;

describe.concurrent('npm run gate -- --fake --scenario har', () => {
  it('sends the recording, splits it through the HAR channel and checks the flows and their pauses', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--scenario', 'har', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const report = await onlyReport(dir);
    expect(report).toContain('Result: **PASSED**');
    expect(report).toContain('| Scenarios | har |');
    expect(report).toContain('`flows_import_har`');
    expect(report).toContain('`flows_generate_from_har`');
    expect(report).toMatch(PAUSES_OF_THE_RECORDING);
    // Only the recording was walked: no journeys of the documentation, no scenario, no test.
    expect(report).not.toContain('`flows_suggest_journeys`');
    expect(report).not.toContain('`run_start`');
    expect(report).not.toContain('`scenario_suggest_split`');
    expect(report).not.toContain('`scenario_generate`');
    // The split gave one flow for each journey of the recording.
    expect(report).toMatch(/3 flows came out of the recording/u);
    // The credentials of the recording were looked for in the answers of both steps.
    expect(
      report.match(/no credential of the recording is in the answers \([1-9]\d* looked for\)/gu),
    ).toHaveLength(2);
    // The secrets of the recording are in no file the gate writes and no line it prints.
    for (const text of [report, run.stdout, run.stderr]) {
      assertNoCanary(text);
      for (const canary of ALL_CANARIES) expect(text).not.toContain(canary);
      expect(text).not.toContain(FILE_CANARY);
    }
  }, 300_000);

  it('fails when the split gave one flow instead of one for each journey', async () => {
    const dir = await reportDir();
    const run = await runGate([
      '--fake',
      '--scenario',
      'har',
      '--fake-fault',
      'har-one-flow',
      '--report-dir',
      dir,
    ]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(
      /Failed at step \d+ `flows_generate_from_har` \(flows from the recording\)/u,
    );
    expect(report).toMatch(/1 flow came out of the recording.*at least 3/u);
  }, 300_000);

  it('fails when no flow has a pause taken from the recording', async () => {
    const dir = await reportDir();
    const run = await runGate([
      '--fake',
      '--scenario',
      'har',
      '--fake-fault',
      'har-no-pauses',
      '--report-dir',
      dir,
    ]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(
      /Failed at step \d+ `flows_generate_from_har` \(flows from the recording\)/u,
    );
    expect(report).toMatch(/no flow has a pause taken from the recording/u);
  }, 300_000);
});

describe('npm run gate -- --fake --scenario protected', () => {
  it('asks for the consent twice, creates nothing without it and checks the clamped run and its note', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--scenario', 'protected', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const report = await onlyReport(dir);
    expect(report).toContain('Result: **PASSED**');
    expect(report).toContain('| Scenarios | protected |');
    expect(report).toContain('no run was created without consent');
    expect(report).toMatch(/no account was created without consent/u);
    expect(report).toMatch(
      /with consent exactly one account is created on qa \(slot "User accounts": 30 → 31\)/u,
    );
    expect(report).toMatch(/does not exceed the limit of qa: 5 ≤ 5 users/u);
    expect(report).toMatch(/the report of the clamped run carries the note \(5 of 20\)/u);
    // The test of the main environment and the recording belong to the other scenarios.
    expect(report).not.toMatch(/test on the unprotected environment/u);
    expect(report).not.toContain('`flows_import_har`');
    expect(report).not.toContain('`results_analyze_run`');
    assertNoCanary(report);
  }, 300_000);

  it('a run that records more users than the limit of its environment fails the gate on the limit', async () => {
    const dir = await reportDir();
    const run = await runGate([
      '--fake',
      '--scenario',
      'protected',
      '--fake-fault',
      'run-over-limit',
      '--report-dir',
      dir,
    ]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(/Failed at step \d+ `run_start` \(clamped test with consent\)/u);
    expect(report).toContain('does not exceed the limit of qa: 6 ≤ 5 users');
  }, 300_000);
});

/**
 * A copy of the built server with one rule of the plugin switched off, so that the gate meets the
 * fault it exists to find. The edit must match the built file exactly once, or the test says the
 * build no longer has the line this test patches.
 */
async function brokenServer(from: string, to: string): Promise<string> {
  const source = await readFile(join(ROOT, 'dist', 'server.mjs'), 'utf8');
  expect(source.split(from).length - 1, `the built server holds ${from} once`).toBe(1);
  const dir = await reportDir();
  const path = join(dir, 'server.mjs');
  await writeFile(path, source.replace(from, to));
  return path;
}

describe.concurrent(
  'npm run gate -- --fake-server (the plugin breaks a rule the gate watches)',
  () => {
    const protectedWith = async (server: string): Promise<{ run: Finished; report: string }> => {
      const dir = await reportDir();
      const run = await runGate([
        '--fake',
        '--scenario',
        'protected',
        '--fake-server',
        server,
        '--report-dir',
        dir,
      ]);
      return { run, report: await onlyReport(dir) };
    };

    it('--fake-server needs --fake: a real run never takes another build of the server', () => {
      expect(() => parseArgs(['--config', 'gate.json', '--fake-server', 'x.mjs'])).toThrow(
        /works only with --fake/u,
      );
    });

    it('a plugin that does not clamp the load fails the gate on the limit of the environment', async () => {
      const server = await brokenServer(
        'const clamped = profile.vusers > ceiling;',
        'const clamped = false;',
      );
      const { run, report } = await protectedWith(server);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toMatch(/Failed at step \d+ `run_start` \(clamped test with consent\)/u);
      expect(report).toContain('does not exceed the limit of qa: 20 ≤ 5 users');
    }, 300_000);

    it('a plugin that starts a test on the protected environment without consent fails the gate and leaves nothing running', async () => {
      const server = await brokenServer('args.confirm_capped !== true', 'false');
      const { run, report } = await protectedWith(server);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toMatch(
        /Failed at step \d+ `run_start` \(consent on the protected environment\): .*a run was created without consent/u,
      );
      expect(report).toContain('## Stopping');
    }, 300_000);

    it('a plugin that creates accounts on the protected environment without consent fails the gate', async () => {
      const server = await brokenServer('args.confirm_protected !== true', 'false');
      const { run, report } = await protectedWith(server);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toMatch(
        /Failed at step \d+ `data_create_accounts` \(consent for accounts on the protected environment\)/u,
      );
    }, 300_000);

    it('a report that does not say the load was clamped fails the gate', async () => {
      const server = await brokenServer(
        '"report.capped": "load limited by the environment ({to} of {from})"',
        '"report.capped": "limited ({to} of {from})"',
      );
      const { run, report } = await protectedWith(server);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toMatch(
        /Failed at step \d+ `results_get_report` \(note of the clamped load in the report\)/u,
      );
      expect(report).toContain('(5 of 20)');
    }, 300_000);
  },
);

describe.concurrent('npm run gate -- --fake (default scenario)', () => {
  it('walks only the documentation: no recording, no consent steps, no account on the protected environment', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const report = await onlyReport(dir);
    expect(report).toContain('| Scenarios | docs |');
    expect(report).toContain('`results_analyze_run`');
    expect(report).not.toContain('`flows_import_har`');
    expect(report).not.toContain('consent on the protected environment');
    expect(report).not.toContain('no account was created without consent');
  }, 300_000);
});

describe.concurrent('npm run gate -- --fake (every scenario)', () => {
  it('walks the documentation, the recording and the protected environment in one project', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--scenario', 'docs,har,protected', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const report = await onlyReport(dir);
    expect(report).toContain('| Scenarios | docs, har, protected |');
    for (const tool of [
      'flows_suggest_journeys',
      'flows_import_har',
      'run_start',
      'results_analyze_run',
    ]) {
      expect(report, tool).toContain(`\`${tool}\``);
    }
    expect(report).toMatch(PAUSES_OF_THE_RECORDING);
    expect(report).toContain('no run was created without consent');
    expect(report).toMatch(/\| Cleanup \| project sklep-\d{8}-\d{6} deleted \|/u);
    assertNoCanary(report);
    expect(report).not.toContain(FILE_CANARY);
  }, 300_000);
});
