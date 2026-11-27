// The view of `scenario_compile_composition` and of the lines of its consent card. The names and the
// messages of the build are texts a person, the generator or Gradle wrote: they arrive masked and made
// one line. The build output itself is never shown, only how many lines it has.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { decimal, num } from '../primitives.js';

/** What the card froze: the composition and how many of its members a build would take. */
export interface CompileCompositionFacts {
  readonly composition_id: string;
  /** The name (the `{name}` of the log entry). */
  readonly name: string;
  readonly members: number;
  readonly enabled: number;
}

/**
 * How the build ended: it passed, the generated code did not compile, the build environment failed
 * (not the code), or no member was enabled so there was nothing to build.
 */
export type CompileKind = 'compiled' | 'code_failed' | 'environment_failed' | 'no_enabled_member';

export interface CompileCompositionData {
  readonly composition_id: string;
  readonly name: string;
  /** The backend's verdict: the project compiled. */
  readonly ok: boolean;
  readonly kind: CompileKind;
  readonly duration_s: number;
  /** At most 5 of each, and how many the backend named. */
  readonly errors: readonly string[];
  readonly error_count: number;
  readonly warnings: readonly string[];
  readonly warning_count: number;
  /** Lines of the build output; the output itself is not read into the data. */
  readonly output_lines: number;
}

export function cardViewCompileComposition(
  facts: CompileCompositionFacts,
  t: Translator,
): CardView {
  return {
    title: t('scenario_compile_composition.card.title', { name: facts.name }),
    lines: [
      t('scenario_compile_composition.card.members', {
        enabled: num(facts.enabled, t.locale),
        members: num(facts.members, t.locale),
      }),
      t('scenario_compile_composition.card.nothing_runs'),
    ],
    cost: t('scenario_compile_composition.card.cost'),
    undo: t('scenario_compile_composition.card.undo'),
  };
}

export function renderCompileComposition(data: CompileCompositionData, t: Translator): string {
  const params = {
    name: data.name,
    seconds: decimal(data.duration_s, 1, t.locale),
  };
  const lines = [t(`scenario_compile_composition.done.${data.kind}`, params)];
  for (const text of data.errors) lines.push(t('scenario_compile_composition.error', { text }));
  if (data.error_count > data.errors.length) {
    lines.push(
      t('scenario_compile_composition.more', {
        count: num(data.error_count - data.errors.length, t.locale),
      }),
    );
  }
  for (const text of data.warnings) lines.push(t('scenario_compile_composition.warning', { text }));
  if (data.warning_count > data.warnings.length) {
    lines.push(
      t('scenario_compile_composition.more', {
        count: num(data.warning_count - data.warnings.length, t.locale),
      }),
    );
  }
  if (data.kind === 'code_failed' && data.output_lines > 0) {
    lines.push(
      t('scenario_compile_composition.output', { lines: num(data.output_lines, t.locale) }),
    );
  }
  return lines.join('\n');
}
