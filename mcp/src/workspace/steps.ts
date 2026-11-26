// Status of a step from its checks and the `required` flags of the catalog (CHECKS). A step is `done` when
// every check that is required of it has `ok: true`. A required check that is missing or null takes a `done`
// step back to `active`; the reducer opens a warning for it. A step is `blocked` while problems[] holds an
// open problem of severity `blocker` of its module, whatever its checks; once the last one is closed, the
// step gets the status of its checks again. No tool sets a status.
//
// `process.step` is the first step of the pipeline (PIPELINE, in its order) that is not `done`, or the last
// one when all are. Modules outside the pipeline have a status but never hold the step.
//
// `required` is data: true, false, or `{ when, in }` (required while the state field `when` holds one of `in`).
// The schema's `isRequired` evaluates it; nothing here reads the words of a condition.
import { CHECKS } from '../catalog.generated.js';
import { PIPELINE, isRequired, type Process } from './processState.js';

type StepStatus = Process['steps']['project']['status'];
type CheckValue = { ok: boolean | null };
type LooseStep = { status: StepStatus; checks: Record<string, CheckValue | undefined> };

/** Code of the warning opened when a step goes back from `done`; its `ref.id` is the module. */
export const STEP_REOPENED_CODE = 'step_reopened';

/** Names of the checks required of a step right now that do not hold `ok: true`. */
export function missingRequired(
  module: string,
  checks: LooseStep['checks'],
  process: Process,
): string[] {
  return CHECKS.filter((c) => c.module === module)
    .filter((c) => isRequired(c.required, process))
    .filter((c) => checks[c.check]?.ok !== true)
    .map((c) => c.check);
}

export interface SettledStep {
  module: string;
  from: StepStatus;
  to: StepStatus;
  missing: string[];
}

/** Modules with an open problem of severity `blocker`; `process` (the process as a whole) has no step. */
export function blockedModules(problems: Process['problems']): ReadonlySet<string> {
  return new Set(problems.filter((p) => p.severity === 'blocker').map((p) => p.module));
}

/**
 * Recomputes the status of every step. A module with an open blocker is `blocked`. Otherwise a step with no
 * recorded check is `todo`; one with some checks is `active` until nothing required is missing and a verdict
 * `ok: true` exists, then `done`. `process` is the process the conditions of `required` are read from (its
 * `choices` after the update) and the blockers come from (its `problems` after the update).
 */
export function settleSteps(
  steps: Process['steps'],
  process: Process,
): { steps: Process['steps']; settled: SettledStep[] } {
  const next = { ...steps } as unknown as Record<string, LooseStep>;
  const settled: SettledStep[] = [];
  const blocked = blockedModules(process.problems);
  for (const [module, step] of Object.entries(next)) {
    const verdicts = Object.values(step.checks);
    const missing = missingRequired(module, step.checks, process);
    const to: StepStatus = blocked.has(module)
      ? 'blocked'
      : verdicts.length === 0
        ? 'todo'
        : missing.length === 0 && verdicts.some((v) => v?.ok === true)
          ? 'done'
          : 'active';
    if (to !== step.status) {
      next[module] = { ...step, status: to };
      settled.push({ module, from: step.status, to, missing });
    }
  }
  return { steps: next as unknown as Process['steps'], settled };
}

/** The step of the process: the first step of the pipeline that is not `done`; the last when all are. */
export function currentStep(steps: Process['steps']): Process['step'] {
  let step: Process['step'] = PIPELINE[0];
  for (const module of PIPELINE) {
    step = module;
    if (steps[module].status !== 'done') break;
  }
  return step;
}

/**
 * The statuses of the steps and the step of the process as the checks and problems of `p` say, with no
 * warning opened. The store runs it on every process it writes, after pruning: a process that comes from a
 * merge (bindProject), a migration or another write path, and one whose oldest blocker the pruning dropped,
 * get the same statuses and step as an update would give them.
 */
export function settleProcess(p: Process): Pick<Process, 'steps' | 'step'> {
  const { steps } = settleSteps(p.steps, p);
  return { steps, step: currentStep(steps) };
}
