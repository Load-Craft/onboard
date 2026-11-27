// Runs the fake LoadCraft backend (test/fake-backend) as a process of its own, for manual and
// scripted exercising of the plugin without a real backend. Development only: nothing here is part
// of dist.
//
//   npm run fake -- --stage empty --port 8787 [--speed 60] [--token <token>] [--seed 1]
//                   [--run none|pass|fail]
//
// --run is the verdict of a test started with run_start. The run goes on the clock (building, then
// load as long as the profile) and ends as a stored, completed record. none (the default): the
// verdict follows the thresholds sent with run_start, over the world's own numbers (the slowest
// request is slow and ends with 503, so it usually fails them). pass: the run meets the
// thresholds, results_get_report reads SLA PASSED. fail: the run breaks them, results_get_report reads SLA FAILED
// and results_analyze_run has a cause to name. Without thresholds pass and fail judge against p95 500 ms
// and 1 % failed. Works on the sklep world and on any uploaded documentation.
//
// The world is "sklep" at the given session stage (empty, project, flows, scenario, data,
// executed); from an empty instance it carries a whole session on any uploaded API documentation
// (test/fake-backend/standalone.ts). The clock is the real one multiplied by --speed (default 60):
// a 10-minute test takes 10 seconds. The address and the token go to stderr; stdout stays empty.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_TOKEN = 'CANARY-SECRET-7f3a';

const RUN_MODES = ['none', 'pass', 'fail'];

function parseArgs(argv) {
  const options = {
    stage: 'empty',
    port: 8787,
    speed: 60,
    token: DEFAULT_TOKEN,
    seed: 1,
    run: 'none',
  };
  const known = new Set(Object.keys(options));
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (name === undefined || !known.has(name) || value === undefined) {
      throw new Error(
        `usage: npm run fake -- [--stage <stage>] [--port <n>] [--speed <x>] [--token <t>] [--seed <n>] [--run ${RUN_MODES.join('|')}] (got ${argv[i] ?? ''})`,
      );
    }
    options[name] = typeof options[name] === 'number' ? Number(value) : value;
    if (typeof options[name] === 'number' && !Number.isFinite(options[name])) {
      throw new Error(`--${name} needs a number`);
    }
  }
  if (options.speed <= 0) throw new Error('--speed must be positive');
  if (!RUN_MODES.includes(options.run)) {
    throw new Error(`--run must be one of: ${RUN_MODES.join(', ')} (got "${options.run}")`);
  }
  return options;
}

// The fake is TypeScript with `.js` import specifiers, and its server module imports `vitest` only
// for the end-of-test hook that `scope: 'manual'` never uses. So it is bundled on the fly, with a
// stand-in for vitest, instead of being run from source.
const ENTRY = `
import { startFake } from './test/fake-backend/server.ts';
import { setupStandalone } from './test/fake-backend/standalone.ts';
import { SKLEP_STAGES } from './test/fake-backend/worlds/sklep.ts';

export { SKLEP_STAGES };

export async function run({ stage, port, speed, token, seed, run: runMode }) {
  const started = Date.now();
  const clock = {
    now: () => started + (Date.now() - started) * speed,
    sleep: (ms, signal) =>
      new Promise((resolveSleep, reject) => {
        if (signal.aborted) return reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolveSleep();
        }, ms / speed);
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }),
  };
  const fake = await startFake({ clock, seed, token, port, scope: 'manual' });
  setupStandalone(fake, clock, { stage, run: runMode });
  return fake;
}
`;

const VITEST_STAND_IN = {
  name: 'vitest-stand-in',
  setup(b) {
    b.onResolve({ filter: /^vitest$/ }, () => ({ path: 'vitest', namespace: 'stand-in' }));
    b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({
      contents: 'export const onTestFinished = () => { throw new Error("no test runner"); };',
      loader: 'js',
    }));
  },
};

async function loadRunner(dir) {
  const outfile = join(dir, 'fake.mjs');
  await build({
    absWorkingDir: ROOT,
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'fake-entry.ts', loader: 'ts' },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
    external: ['bufferutil', 'utf-8-validate'],
    plugins: [VITEST_STAND_IN],
    // The contract snapshot is found relative to the module, and the bundle lives in a temp dir.
    define: {
      'import.meta.url': JSON.stringify(
        pathToFileURL(join(ROOT, 'test', 'fake-backend', 'contract.ts')).href,
      ),
      __LOADCRAFT_VERSION__: '"0.0.0-fake"',
    },
    banner: {
      js: "import { createRequire as __lcCreateRequire } from 'node:module';\nconst require = __lcCreateRequire(process.cwd() + '/');",
    },
  });
  return import(pathToFileURL(outfile).href);
}

const options = parseArgs(process.argv.slice(2));
const dir = mkdtempSync(join(tmpdir(), 'loadcraft-fake-'));
let fake;
try {
  const { run, SKLEP_STAGES } = await loadRunner(dir);
  if (!SKLEP_STAGES.includes(options.stage)) {
    throw new Error(`unknown --stage "${options.stage}"; allowed: ${SKLEP_STAGES.join(', ')}`);
  }
  fake = await run(options);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.stderr.write(
  `fake LoadCraft backend (world sklep, stage ${options.stage}, clock x${String(options.speed)}, runs ${options.run})\n` +
    `  address: http://127.0.0.1:${String(options.port)}\n` +
    `  token:   ${options.token}\n`,
);
