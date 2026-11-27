// Vitest file. Named *.spec.ts on purpose: `claude plugin test` collects every *.test.ts in the
// plugin and would try to run this file in the mods environment (see mod/docs/mods-facts.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { processGetStatus } from '../../mcp/src/tools/processGetStatus.js';
import { runStart } from '../../mcp/src/tools/runStart.js';
import { processWait } from '../../mcp/src/tools/processWait.js';
import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { registerAnalysisReadRoute } from '../../mcp/test/fake-backend/routes/analysis.js';
import { registerDataRoutes } from '../../mcp/test/fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from '../../mcp/test/fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../../mcp/test/fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../../mcp/test/fake-backend/routes/lookup.js';
import { registerStatusRoutes } from '../../mcp/test/fake-backend/routes/status.js';
import { seedSklep } from '../../mcp/test/fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from '../../mcp/test/helpers/clock.js';
import { CANARY, toolRig } from '../../mcp/test/helpers/rig.js';

import { en } from '../../mcp/src/render/i18n/en.js';
import { operationEn, operationPl } from '../../mcp/src/render/i18n/operation.js';
import { pl } from '../../mcp/src/render/i18n/pl.js';
import {
  lostNotice,
  notice,
  parseSnapshot,
  statusLine,
  type OperationSnapshot,
} from '../src/view/status.js';

const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;

const golden = (path: string): string =>
  readFileSync(
    join(import.meta.dirname, '..', '..', 'mcp', 'test', 'golden', path),
    'utf8',
  ).replace(/\n$/u, '');

/** The snapshot of the test of run 1 at 6:40 of 10:00 (the same facts as `10-run_start-postep`). */
const RUNNING: OperationSnapshot = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};

describe('the texts of the line come from the server', () => {
  const dictionaries = { en, pl } as const;
  const sources = { en: operationEn, pl: operationPl } as const;

  it.each(['en', 'pl'] as const)('%s: the dictionary holds every text of the line', (locale) => {
    const keys = Object.keys(sources[locale]);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      expect((dictionaries[locale] as Record<string, unknown>)[key], `${locale} ${key}`).toBe(
        (sources[locale] as Record<string, unknown>)[key],
      );
    }
  });

  it('both locales have the same keys', () => {
    expect(Object.keys(operationPl).sort()).toEqual(Object.keys(operationEn).sort());
  });
});

describe('lostNotice', () => {
  it('says that the state is unknown and where to look', () => {
    for (const locale of ['en', 'pl'] as const) {
      const lost = lostNotice(locale);
      expect(lost.kind).toBe('lost');
      expect(lost.text).toContain('/loadcraft:status');
      expect(lost.text).toContain('process_get_status');
    }
  });
});

describe('statusLine', () => {
  it('draws the numbers of run 1 the way the progress pattern does', () => {
    expect(statusLine(RUNNING, 'pl')).toBe(
      `LoadCraft · test ${golden('run1/10-run_start-postep.pl.txt')}`,
    );
    expect(statusLine(RUNNING, 'pl')).toBe(
      'LoadCraft · test 6:40 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
    );
    expect(statusLine(RUNNING, 'en')).toBe(
      'LoadCraft · test 6:40 / 10:00 · 690 requests/s · p95≈ 910 ms · errors 0.6%',
    );
  });

  it('draws the time alone while the numbers are not there yet', () => {
    const { live: _live, ...bare } = RUNNING;
    expect(statusLine(bare, 'pl')).toBe('LoadCraft · test 6:40 / 10:00');
    const missing = { ...RUNNING, live: { rps: 12, p95_ms: null, error_pct: null } };
    expect(statusLine(missing, 'en')).toBe('LoadCraft · test 6:40 / 10:00 · 12 requests/s');
  });

  it('says that the project is being built, with the time since the start', () => {
    const building: OperationSnapshot = {
      operation: HANDLE,
      kind: 'test_run',
      phase: 'building',
      elapsed_s: 18,
      planned_s: 600,
    };
    expect(statusLine(building, 'pl')).toBe('LoadCraft · budowanie… 0:18');
    expect(statusLine(building, 'en')).toBe('LoadCraft · building… 0:18');
  });

  it('names an operation of another kind and the time it takes', () => {
    const scenario: OperationSnapshot = {
      operation: 'scenario_generation:abc',
      kind: 'scenario_generation',
      elapsed_s: 75,
    };
    expect(statusLine(scenario, 'en')).toBe('LoadCraft · scenario generation 1:15');
    expect(statusLine(scenario, 'pl')).toBe('LoadCraft · generowanie scenariuszy 1:15');
    const accounts: OperationSnapshot = {
      operation: 'account_provision:abc',
      kind: 'account_provision',
      elapsed_s: 42,
    };
    expect(statusLine(accounts, 'en')).toBe('LoadCraft · account creation 0:42');
    expect(statusLine(accounts, 'pl')).toBe('LoadCraft · zakładanie kont 0:42');
  });

  it('says that the operation waits for the user', () => {
    const waiting: OperationSnapshot = {
      operation: 'record_run:r1',
      kind: 'record_run',
      elapsed_s: 30,
      needs_user: 'Log in to the shop',
    };
    expect(statusLine(waiting, 'en')).toContain('waiting for the user: Log in to the shop');
  });

  it('keeps to 200 characters, cutting from the end, and drops control characters', () => {
    const long: OperationSnapshot = {
      operation: 'record_run:r1',
      kind: 'record_run',
      elapsed_s: 30,
      needs_user: `Log in\n\u001b[31mnow ${'x'.repeat(400)}`,
    };
    const line = statusLine(long, 'en');
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line.startsWith('LoadCraft · ')).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect([...line].some((char) => char.charCodeAt(0) < 32)).toBe(false);
  });

  it('gives the same line for the same snapshot, and has no warning sign of its own', () => {
    expect(statusLine(RUNNING, 'pl')).toBe(statusLine({ ...RUNNING }, 'pl'));
    expect(statusLine(RUNNING, 'pl')).not.toContain('⚠');
  });
});

describe('parseSnapshot', () => {
  it('reads the snapshot process_get_status gives, and nothing that is not one', () => {
    expect(parseSnapshot(RUNNING)).toEqual(RUNNING);
    for (const junk of [
      undefined,
      null,
      'x',
      [],
      {},
      { operation: HANDLE },
      { operation: 5, kind: 'test_run', elapsed_s: 1 },
      { operation: HANDLE, kind: 'test_run', elapsed_s: 'soon' },
      { operation: 'nonsense', kind: 'test_run', elapsed_s: 1 },
    ]) {
      expect(parseSnapshot(junk)).toBeUndefined();
    }
  });

  it('keeps live numbers that are null', () => {
    const raw = { ...RUNNING, live: { rps: null, p95_ms: 5, error_pct: null } };
    expect(parseSnapshot(raw)?.live).toEqual({ rps: null, p95_ms: 5, error_pct: null });
  });
});

describe('notice', () => {
  const done = { ...RUNNING, phase: 'completed' };
  const failed = { ...RUNNING, phase: 'failed' };

  it('running to completed: the test is done, with its numbers', () => {
    expect(notice(RUNNING, done, 'pl')).toEqual({
      kind: 'done',
      text: 'Test zakończony · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
    });
    expect(notice(RUNNING, done, 'en')?.text).toMatch(/^Test finished/u);
  });

  it('running to failed: the test failed', () => {
    expect(notice(RUNNING, failed, 'en')?.kind).toBe('failed');
    expect(notice(RUNNING, failed, 'pl')?.text).toMatch(/^Test nieudany/u);
    expect(notice(RUNNING, { ...RUNNING, phase: 'abandoned' }, 'en')?.kind).toBe('failed');
  });

  it('running to cancelled: reported as an end, not as a failure', () => {
    const stopped = notice(RUNNING, { ...RUNNING, phase: 'cancelled' }, 'en');
    expect(stopped?.kind).toBe('done');
    expect(stopped?.text).toMatch(/^Test stopped/u);
  });

  it('running to waiting for the user: asks for the user, with what is wanted', () => {
    const waiting = { ...RUNNING, needs_user: 'Log in to the shop' };
    expect(notice(RUNNING, waiting, 'en')).toEqual({
      kind: 'needs_user',
      text: 'LoadCraft · waiting for the user: Log in to the shop',
    });
    expect(notice(RUNNING, waiting, 'pl')?.text).toBe(
      'LoadCraft · czeka na użytkownika: Log in to the shop',
    );
  });

  it('no change of state: nothing', () => {
    expect(notice(RUNNING, { ...RUNNING, elapsed_s: 410 }, 'en')).toBeUndefined();
    expect(notice(done, done, 'en')).toBeUndefined();
    expect(notice(failed, failed, 'en')).toBeUndefined();
    const waiting = { ...RUNNING, needs_user: 'Log in' };
    expect(notice(waiting, { ...waiting, elapsed_s: 500 }, 'en')).toBeUndefined();
  });

  it('a first look at an operation the mod knew as in progress announces what it finds', () => {
    expect(notice(undefined, done, 'en')?.kind).toBe('done');
    expect(notice(undefined, failed, 'en')?.kind).toBe('failed');
    expect(notice(undefined, { ...RUNNING, needs_user: 'Log in' }, 'en')?.kind).toBe('needs_user');
    expect(notice(undefined, RUNNING, 'en')).toBeUndefined();
  });

  it('the text of the user request is cleaned of control characters and cut', () => {
    const waiting = { ...RUNNING, needs_user: `Log\nin ${'y'.repeat(500)}` };
    const text = notice(RUNNING, waiting, 'en')?.text ?? '';
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThan(250);
  });
});

describe('a snapshot the real process_get_status tool gives', () => {
  const PERF: RunScript = {
    createdBeforeS: 2,
    startsAtS: 5,
    loadS: 600,
    end: 'completed',
    live: (elapsed) =>
      elapsed >= 390
        ? { rps: 690, p95: 910, errorRate: 0.006 }
        : { rps: 100, p95: 300, errorRate: 0 },
    final: { rps: 690, p95: 1120, errorRate: 0.006 },
    series: [10, 20, 30],
  };

  it('is read and drawn as the line of run 1', async () => {
    const clock = createTestClock(Date.parse('2026-11-22T11:00:00Z'));
    const r = await toolRig({
      tools: [processGetStatus, runStart, processWait],
      world: (fake) => {
        scriptRuns(fake, clock, PERF);
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerDataRoutes(fake);
        registerExecutionRoutes(fake);
        registerStatusRoutes(fake);
        registerAnalysisReadRoute(fake);
        seedSklep(fake.store, { stage: 'data' });
        planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
      },
      clock,
      env: { LOADCRAFT_LOCALE: 'pl' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const started = await settleClock(
      r,
      r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
        max_wait_s: 1,
      }),
    );
    expect(started.isError).toBe(false);
    await r.clock.advance(404_000);

    const result = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    const snapshot = parseSnapshot(JSON.parse(result.text));
    expect(snapshot).toEqual(RUNNING);
    expect(statusLine(snapshot as OperationSnapshot, 'pl')).toBe(
      'LoadCraft · test 6:40 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
    );
    expect(result.text).not.toContain(CANARY);
  });
});
