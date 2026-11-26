// View of `scenario_check_self`: the request chain of every re-checked scenario. The line that names the
// environment is not part of the result (the mock-up has none there); it heads the progress.

import type { Translator } from '../../context.js';
import { inline } from '../primitives.js';
import {
  renderSelfCheckChain,
  renderSelfCheckHeader,
  type SelfCheckChainView,
} from './selfCheckChain.js';

export interface SelfCheckData extends SelfCheckChainView {
  /** The default environment the requests went to; `null` when the project has none. */
  readonly environment: string | null;
}

/** Where a check that has not ended stands. */
export type CheckPhase = 'pending' | 'running' | 'repairing';

export interface SelfCheckProgress {
  readonly environment: string | null;
  readonly done: number;
  readonly total: number;
  readonly active: readonly { readonly name: string; readonly phase: CheckPhase }[];
}

export function renderSelfCheck(data: SelfCheckData, t: Translator): string {
  return renderSelfCheckChain(data, t);
}

/** One line for the progress of the wait: the header, how many ended, what is in progress. */
export function renderSelfCheckProgress(progress: SelfCheckProgress, t: Translator): string {
  const head = [
    renderSelfCheckHeader(progress.environment, t),
    `${String(progress.done)}/${String(progress.total)}`,
  ];
  const active = progress.active.map(
    (item) => `${inline(item.name)}: ${t(`selfCheck.phase.${item.phase}`)}`,
  );
  return [...head, ...(active.length === 0 ? [] : [active.join(', ')])].join(' · ');
}
