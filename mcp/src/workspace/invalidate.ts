// Invalidation of check verdicts. After one object changes, the verdicts about objects that depend on it are
// no longer current: they become `ok: null` with `by: invalidated:<trigger>`, and each one gets a warning.
// The table is read from the catalog (STATE_INVALIDATIONS); there is no second copy of it here.
//
// A trigger is a tool name, or a `choices.<module>.<field>` key. A tool is a trigger whenever it is the
// tool of the call; a choices key is a trigger when the update carries a value for it that differs from the
// value held now.
import { STATE_INVALIDATIONS } from '../catalog.generated.js';
import type { Process } from './processState.js';

/** Code of the warning opened for an invalidated check; its `ref.id` is `<module>.<check>`. */
export const INVALIDATED_CODE = 'check_invalidated';

export interface InvalidatedCheck {
  module: string;
  check: string;
  /** The trigger that invalidated it (stamped as `invalidated:<trigger>`). */
  trigger: string;
}

type Loose = Record<string, unknown>;

function valueAt(root: unknown, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Loose)[key];
  }
  return node;
}

/** The triggers this call carries: its tool, and every `choices.*` key of the table whose value changes. */
export function triggersOf(tool: string, before: Process['choices'], after: unknown): string[] {
  const found = new Set<string>([tool]);
  for (const row of STATE_INVALIDATIONS) {
    for (const trigger of row.triggers) {
      if (!trigger.startsWith('choices.')) continue;
      const path = trigger.split('.').slice(1);
      const next = valueAt(after, path);
      if (next === undefined) continue;
      if (JSON.stringify(next) !== JSON.stringify(valueAt(before, path))) found.add(trigger);
    }
  }
  return [...found];
}

/** The checks the table invalidates for the given triggers; the first trigger to name a check is kept. */
export function invalidatedBy(triggers: readonly string[]): InvalidatedCheck[] {
  const out = new Map<string, InvalidatedCheck>();
  for (const row of STATE_INVALIDATIONS) {
    const trigger = triggers.find((t) => row.triggers.includes(t));
    if (trigger === undefined) continue;
    for (const path of row.invalidates) {
      const [module, check] = path.split('.');
      if (module === undefined || check === undefined || out.has(path)) continue;
      out.set(path, { module, check, trigger });
    }
  }
  return [...out.values()];
}

type Steps = Process['steps'];
type LooseSteps = Record<string, { status: string; checks: Record<string, unknown> }>;

/**
 * Sets the named checks to `ok: null`. Only a check that holds a verdict (`ok` is not already null) changes:
 * an absent check is already unknown. Returns new objects (the state is frozen) and the checks that changed.
 */
export function invalidateChecks(
  steps: Steps,
  targets: readonly InvalidatedCheck[],
  now: string,
): { steps: Steps; changed: InvalidatedCheck[] } {
  const next = { ...steps } as unknown as LooseSteps;
  const changed: InvalidatedCheck[] = [];
  for (const target of targets) {
    const step = next[target.module];
    const held = step?.checks[target.check] as { ok: boolean | null; note?: string } | undefined;
    if (step === undefined || held === undefined || held.ok === null) continue;
    next[target.module] = {
      ...step,
      checks: {
        ...step.checks,
        [target.check]: { ok: null, at: now, by: `invalidated:${target.trigger}` },
      },
    };
    changed.push(target);
  }
  return { steps: next as unknown as Steps, changed };
}
