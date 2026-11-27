// Invalidation of check verdicts and closing of steps by `required`. The table comes from the catalog
// (STATE_INVALIDATIONS, CHECKS); the tests walk it row by row and run on a real state file.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKS, STATE_INVALIDATIONS } from '../src/catalog.generated.js';
import { createLogger } from '../src/log.js';
import {
  LIMITS,
  PIPELINE,
  CHECKS as STATE_CHECKS,
  type Process,
} from '../src/workspace/processState.js';
import { createProcessStore, type ProcessUpdateInput } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const FLOW = '22222222-2222-4222-8222-222222222222';
const SCENARIO = '66666666-6666-4666-8666-666666666666';
const ENV = '55555555-5555-4555-8555-555555555555';
const OTHER_ENV = '77777777-7777-4777-8777-777777777777';
const NOW_MS = Date.parse('2026-03-01T12:00:00.000Z');

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-invalidate-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function store() {
  return createProcessStore(root, {
    secrets: new CallSecretScope(createLogger({ level: 'error', sink: () => undefined })),
    clock: { now: () => NOW_MS },
  });
}
function processNow(): Process {
  const file = join(root, 'loadcraft', '.cache', 'state.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { process: Record<string, Process> };
  const found = parsed.process[PROJECT];
  if (found === undefined) throw new Error('no process');
  return found;
}

/** Every check of the catalog set to ok = true. */
function allChecks(
  ok: boolean | null = true,
): Record<string, Record<string, { ok: boolean | null }>> {
  const out: Record<string, Record<string, { ok: boolean | null }>> = {};
  for (const c of CHECKS) (out[c.module] ??= {})[c.check] = { ok };
  return out;
}
async function seed(): Promise<void> {
  await store().applyUpdate(PROJECT, { checks: allChecks() }, { tool: 'seed_tool' });
}
const verdict = (p: Process, module: string, check: string) =>
  (
    p.steps as unknown as Record<
      string,
      { checks: Record<string, { ok: boolean | null; by: string }> }
    >
  )[module]?.checks[check];

/** An update that carries a `choices.*` trigger: the new value differs from any earlier one. */
const CHOICE_UPDATES: Record<string, ProcessUpdateInput> = {
  'choices.run.env_id': { choices: { run: { env_id: ENV } } },
  'choices.scenario.split': { choices: { scenario: { split: { [FLOW]: 40 } } } },
  'choices.scenario.data_mix': { choices: { scenario: { data_mix: 'realistic' } } },
  'choices.run.profile': { choices: { run: { profile: { type: 'load', vusers: 10 } } } },
  'choices.run.target': { choices: { run: { target: { kind: 'scenario', id: SCENARIO } } } },
  'choices.run.traffic_snapshot_id': { choices: { run: { traffic_snapshot_id: OTHER_ENV } } },
};

const rows = STATE_INVALIDATIONS.flatMap((row) =>
  row.triggers.map((trigger) => ({ event: row.event, trigger, invalidates: row.invalidates })),
);

describe('invalidation table from the catalog', () => {
  it('names only checks the catalog knows, and a sample update for every choices trigger', () => {
    const known = new Set(CHECKS.map((c) => `${c.module}.${c.check}`));
    for (const row of STATE_INVALIDATIONS) {
      for (const path of row.invalidates) expect(known.has(path), path).toBe(true);
      for (const t of row.triggers) {
        if (t.startsWith('choices.')) expect(CHOICE_UPDATES[t], t).toBeDefined();
      }
    }
  });

  it('agrees with the required flags of the state schema', () => {
    for (const c of CHECKS) {
      const mine = (
        STATE_CHECKS as unknown as Record<string, Record<string, { required: unknown }>>
      )[c.module]?.[c.check];
      expect(mine?.required, c.path).toEqual(c.required);
    }
  });

  it.each(rows)(
    '$trigger ($event) sets exactly its checks to null',
    async ({ trigger, invalidates }) => {
      await seed();
      const update: ProcessUpdateInput = trigger.startsWith('choices.')
        ? (CHOICE_UPDATES[trigger] as ProcessUpdateInput)
        : {};
      const tool = trigger.startsWith('choices.') ? 'process_set_choices' : trigger;
      await store().applyUpdate(PROJECT, update, { tool });
      const p = processNow();
      for (const c of CHECKS) {
        const v = verdict(p, c.module, c.check);
        if (invalidates.includes(`${c.module}.${c.check}`)) {
          expect(v?.ok, c.path).toBeNull();
          expect(v?.by, c.path).toBe(`invalidated:${trigger}`);
        } else {
          expect(v, c.path).toMatchObject({ ok: true, by: 'seed_tool' });
        }
      }
      expect(p.problems.some((x) => x.code === 'check_invalidated')).toBe(true);
    },
  );

  it('an inert call of a trigger (a preview, a request for consent) invalidates nothing but keeps its update', async () => {
    await seed();
    await store().applyUpdate(
      PROJECT,
      {
        problems: {
          open: [
            {
              module: 'flows',
              tool: 'flows_migrate_docs',
              code: 'flows_on_old_docs',
              severity: 'warning',
              message: 'one flow on an older docs version',
              flow_ids: [FLOW],
            },
          ],
        },
      },
      { tool: 'flows_migrate_docs', inert: true },
    );
    const p = processNow();
    for (const c of CHECKS) {
      expect(verdict(p, c.module, c.check), c.path).toMatchObject({ ok: true, by: 'seed_tool' });
    }
    expect(p.problems.map((x) => x.code)).toEqual(['flows_on_old_docs']);
  });

  it('a choices trigger that does not change the value invalidates nothing', async () => {
    await store().applyUpdate(
      PROJECT,
      { choices: { run: { env_id: ENV } } },
      { tool: 'process_set_choices' },
    );
    await seed();
    await store().applyUpdate(
      PROJECT,
      { choices: { run: { env_id: ENV } } },
      { tool: 'process_set_choices' },
    );
    expect(verdict(processNow(), 'run', 'planned')?.ok).toBe(true);
  });

  it('a trigger tool that finds nothing to invalidate does not raise rev', async () => {
    await store().applyUpdate(PROJECT, { ids: { env_id: ENV } }, { tool: 'x' });
    const before = processNow().rev;
    await store().applyUpdate(PROJECT, {}, { tool: 'project_save_env' });
    expect(processNow().rev).toBe(before);
  });

  it('leaves ids untouched', async () => {
    await store().applyUpdate(
      PROJECT,
      { ids: { env_id: ENV }, add: { flow_ids: [FLOW] } },
      { tool: 'x' },
    );
    await seed();
    await store().applyUpdate(PROJECT, {}, { tool: 'flows_save' });
    expect(processNow().ids).toMatchObject({ env_id: ENV, flow_ids: [FLOW] });
  });

  it('the last write counts: the tool invalidates, then sets its own check', async () => {
    await seed();
    await store().applyUpdate(
      PROJECT,
      { checks: { scenario: { self_check: { ok: true } } } },
      { tool: 'flows_save' },
    );
    const p = processNow();
    expect(verdict(p, 'scenario', 'self_check')).toMatchObject({ ok: true, by: 'flows_save' });
    expect(verdict(p, 'scenario', 'compiled')).toMatchObject({
      ok: null,
      by: 'invalidated:flows_save',
    });
    expect(
      p.problems.some((x) => x.code === 'check_invalidated' && x.ref?.id === 'scenario.self_check'),
    ).toBe(false);
  });

  it('an undo from the journal is an ordinary call and invalidates the same way', async () => {
    await seed();
    await store().applyUpdate(PROJECT, {}, { tool: 'scenario_restore_version' });
    expect(verdict(processNow(), 'scenario', 'self_check')).toMatchObject({
      ok: null,
      by: 'invalidated:scenario_restore_version',
    });
  });

  it('a later successful check closes the warning of that check', async () => {
    await seed();
    await store().applyUpdate(PROJECT, {}, { tool: 'flows_save' });
    await store().applyUpdate(
      PROJECT,
      { checks: { run: { planned: { ok: true } } } },
      { tool: 'run_plan' },
    );
    const refs = processNow()
      .problems.filter((x) => x.code === 'check_invalidated')
      .map((x) => x.ref?.id);
    expect(refs).not.toContain('run.planned');
    expect(refs).toContain('scenario.compiled');
  });
});

describe('closing steps by required', () => {
  it('done when every required check is ok, and an unmet condition does not count', async () => {
    await seed();
    const p = processNow();
    expect(p.steps.project.status).toBe('done');
    expect(p.steps.run.status).toBe('done');
    expect(p.steps.traffic.status).toBe('done');
  });

  it('a conditional check counts only when its condition holds', async () => {
    const checks = allChecks();
    await store().applyUpdate(
      PROJECT,
      {
        choices: { flows: { method: 'har' } },
        checks: {
          flows: { ...checks.flows, har_analyzed: { ok: null }, journeys_suggested: { ok: null } },
        },
      },
      { tool: 'seed_tool' },
    );
    const flows = processNow().steps.flows;
    expect(flows.status).toBe('active');
    await store().applyUpdate(
      PROJECT,
      { checks: { flows: { har_analyzed: { ok: true } } } },
      { tool: 'flows_analyze_har' },
    );
    expect(processNow().steps.flows.status).toBe('done');
  });

  it('data.accounts is required only when choices.data.needs_accounts is true, recorded or not', async () => {
    const checks = allChecks();
    await store().applyUpdate(
      PROJECT,
      { checks: { ...checks, data: { ...checks.data, accounts: { ok: false } } } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.data.status).toBe('done');
    await store().applyUpdate(
      PROJECT,
      { choices: { data: { needs_accounts: true } } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.data.status).toBe('active');
    await store().applyUpdate(
      PROJECT,
      // a tool that is no trigger: data_create_accounts would also invalidate data.datasets_ready
      { checks: { data: { accounts: { ok: true } } } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.data.status).toBe('done');
  });

  it('an invalidated required check returns done to active with a warning; ids stay', async () => {
    await store().applyUpdate(PROJECT, { ids: { env_id: ENV } }, { tool: 'x' });
    await seed();
    await store().applyUpdate(PROJECT, {}, { tool: 'project_save_env' });
    const p = processNow();
    expect(p.steps.project.status).toBe('active');
    expect(p.steps.scenario.status).toBe('active');
    expect(p.ids.env_id).toBe(ENV);
    const warn = p.problems.find((x) => x.code === 'step_reopened' && x.ref?.id === 'project');
    expect(warn).toMatchObject({
      severity: 'warning',
      module: 'project',
      tool: 'project_save_env',
    });
    expect(warn?.message).toContain('env_checked');
  });

  it('a step without any recorded check stays todo, even when nothing is required of it', async () => {
    await store().applyUpdate(
      PROJECT,
      { checks: { project: { created: { ok: true } } } },
      { tool: 'project_create' },
    );
    const p = processNow();
    expect(p.steps.traffic.status).toBe('todo');
    expect(p.steps.project.status).toBe('active');
  });

  it('the step becomes done again and the reopen warning closes', async () => {
    await seed();
    await store().applyUpdate(PROJECT, {}, { tool: 'project_save_env' });
    await store().applyUpdate(
      PROJECT,
      { checks: { project: { env_checked: { ok: true } } } },
      { tool: 'project_check_env' },
    );
    const p = processNow();
    expect(p.steps.project.status).toBe('done');
    expect(p.problems.some((x) => x.code === 'step_reopened' && x.ref?.id === 'project')).toBe(
      false,
    );
  });
});

// ---- the step of the process and `blocked` -------------------------------------------------------

/** The checks of the catalog for the given modules only, every one set to ok = true. */
function checksOf(modules: readonly string[]): Record<string, Record<string, { ok: boolean }>> {
  const out: Record<string, Record<string, { ok: boolean }>> = {};
  for (const c of CHECKS)
    if (modules.includes(c.module)) (out[c.module] ??= {})[c.check] = { ok: true };
  return out;
}
const blocker = (module: string, code = 'backend_down') => ({
  module: module as Process['problems'][number]['module'],
  tool: 'seed_tool',
  code,
  severity: 'blocker' as const,
  message: 'The target does not answer.',
});

describe('process.step follows the steps that are done', () => {
  it.each(PIPELINE.map((_, done) => done))(
    'with the first %i steps of the pipeline done, the step is the next one (the last when all are)',
    async (done) => {
      await store().applyUpdate(
        PROJECT,
        { ids: { env_id: ENV }, checks: checksOf(PIPELINE.slice(0, done)) },
        { tool: 'seed_tool' },
      );
      expect(processNow().step).toBe(PIPELINE[done]);
    },
  );

  it('all steps of the pipeline done: the step is the last one', async () => {
    await store().applyUpdate(PROJECT, { checks: checksOf(PIPELINE) }, { tool: 'seed_tool' });
    expect(processNow().step).toBe(PIPELINE.at(-1));
  });

  it('a step that is done after one that is not does not move the step past the open one', async () => {
    const all = checksOf(PIPELINE);
    await store().applyUpdate(
      PROJECT,
      { checks: { ...all, flows: { ...all.flows, questions_answered: { ok: false } } } },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(p.steps.scenario.status).toBe('done');
    expect(p.step).toBe('flows');
  });

  it('modules outside the pipeline neither hold nor move the step', async () => {
    await store().applyUpdate(PROJECT, { checks: checksOf(['project']) }, { tool: 'seed_tool' });
    expect(processNow().step).toBe('flows');
    await store().applyUpdate(
      PROJECT,
      { checks: checksOf(['traffic', 'functional', 'github']) },
      { tool: 'seed_tool' },
    );
    expect(processNow().step).toBe('flows');
  });

  it('an invalidation takes the step back to the step it reopened, in the same write', async () => {
    await store().applyUpdate(PROJECT, { ids: { env_id: ENV } }, { tool: 'x' });
    await seed();
    expect(processNow().step).toBe('results');
    const before = processNow().rev;
    await store().applyUpdate(PROJECT, {}, { tool: 'project_save_env' });
    const p = processNow();
    expect(p.steps.project.status).toBe('active');
    expect(p.step).toBe('project');
    expect(p.rev).toBe(before + 1);
    await store().applyUpdate(
      PROJECT,
      { checks: { project: { env_checked: { ok: true } } } },
      { tool: 'project_check_env' },
    );
    // scenario lost its verdicts to the change of the environment too
    expect(processNow().step).toBe('scenario');
  });

  it('a changed choice that makes a check required takes the step back', async () => {
    const flows = Object.fromEntries(
      Object.entries(checksOf(['flows']).flows ?? {}).filter(([name]) => name !== 'har_analyzed'),
    );
    await store().applyUpdate(
      PROJECT,
      { checks: { ...checksOf(['project']), flows } },
      { tool: 'seed_tool' },
    );
    expect(processNow().step).toBe('scenario');
    await store().applyUpdate(
      PROJECT,
      // har_analyzed was never recorded: with the method har it is required of flows
      { choices: { flows: { method: 'har' } } },
      { tool: 'seed_tool' },
    );
    expect(processNow().step).toBe('flows');
  });
});

describe('blocked is set by the reducer from an open blocker of the module', () => {
  it('an open blocker blocks its step whatever its checks, and the step stays there', async () => {
    await store().applyUpdate(PROJECT, { checks: checksOf(PIPELINE) }, { tool: 'seed_tool' });
    await store().applyUpdate(
      PROJECT,
      { problems: { open: [blocker('flows')] } },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(p.steps.flows.status).toBe('blocked');
    expect(p.steps.project.status).toBe('done');
    expect(p.steps.scenario.status).toBe('done');
    expect(p.step).toBe('flows');
    // blocked is no reopening: no warning of the step besides the blocker itself
    expect(p.problems.map((x) => x.code)).toEqual(['backend_down']);
  });

  it('a warning, or a blocker of the process as a whole, blocks no step', async () => {
    await store().applyUpdate(PROJECT, { checks: checksOf(['project']) }, { tool: 'seed_tool' });
    await store().applyUpdate(
      PROJECT,
      {
        problems: {
          open: [{ ...blocker('project'), severity: 'warning' }, blocker('process', 'other')],
        },
      },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(Object.values(p.steps).map((s) => s.status)).not.toContain('blocked');
    expect(p.step).toBe('flows');
  });

  it('a blocker of a step without checks blocks it too; of a module outside the pipeline, only that module', async () => {
    await store().applyUpdate(
      PROJECT,
      // two codes: one code without ref is one problem (pruning keeps the newest)
      { problems: { open: [blocker('data', 'data_down'), blocker('github', 'github_down')] } },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(p.steps.data.status).toBe('blocked');
    expect(p.steps.github.status).toBe('blocked');
    expect(p.steps.project.status).toBe('todo');
    expect(p.step).toBe('project');
  });

  it('closing a blocker gives its step back the status of its checks and moves the step on', async () => {
    await store().applyUpdate(
      PROJECT,
      { checks: checksOf(['project', 'flows']) },
      { tool: 'seed_tool' },
    );
    await store().applyUpdate(
      PROJECT,
      {
        problems: { open: [blocker('flows', 'flows_down'), blocker('scenario', 'scenario_down')] },
      },
      { tool: 'seed_tool' },
    );
    expect(processNow().step).toBe('flows');
    await store().applyUpdate(
      PROJECT,
      { problems: { close: [{ code: 'flows_down' }] } },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(p.steps.flows.status).toBe('done');
    expect(p.steps.scenario.status).toBe('blocked');
    expect(p.step).toBe('scenario');
    expect(p.problems.map((x) => x.code)).toEqual(['scenario_down']);
    await store().applyUpdate(
      PROJECT,
      { problems: { close: [{ code: 'scenario_down' }] } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.scenario.status).toBe('todo');
    expect(processNow().problems).toEqual([]);
  });

  it('a blocker pruned off the full list of problems no longer blocks its step', async () => {
    await store().applyUpdate(PROJECT, { checks: checksOf(['project']) }, { tool: 'seed_tool' });
    await store().applyUpdate(
      PROJECT,
      { problems: { open: [blocker('project')] } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.project.status).toBe('blocked');
    // as many newer warnings as the list holds: the oldest problem, the blocker, is pruned
    await store().applyUpdate(
      PROJECT,
      {
        problems: {
          open: Array.from({ length: LIMITS.problems }, (_, i) => ({
            ...blocker('flows', `warning_${String(i)}`),
            severity: 'warning' as const,
          })),
        },
      },
      { tool: 'seed_tool' },
    );
    const p = processNow();
    expect(p.problems.some((x) => x.severity === 'blocker')).toBe(false);
    expect(p.steps.project.status).toBe('done');
    expect(p.step).toBe('flows');
  });

  it('a blocked step keeps blocked while its checks change, and settles once the blocker is gone', async () => {
    await store().applyUpdate(
      PROJECT,
      { problems: { open: [blocker('project')] } },
      { tool: 'seed_tool' },
    );
    await store().applyUpdate(PROJECT, { checks: checksOf(['project']) }, { tool: 'seed_tool' });
    expect(processNow().steps.project.status).toBe('blocked');
    await store().applyUpdate(
      PROJECT,
      { problems: { close: [{ code: 'backend_down' }] } },
      { tool: 'seed_tool' },
    );
    expect(processNow().steps.project.status).toBe('done');
    expect(processNow().step).toBe('flows');
  });
});
