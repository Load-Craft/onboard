// Arithmetic of the traffic-split proposal: whole percents that add up to 100, an equal split, and
// the reading of the model's plan. No I/O.

import type { ProposedShare } from '../../api/scenarioBuilder.js';

const TOTAL = 100;
/** Remainders closer than this are a tie; the earlier flow wins it. */
const TIE = 1e-9;

/**
 * Scales `raw` to sum 100 and rounds to whole percents by the largest-remainder method; equal
 * remainders go to the earlier entry, so 33.3 / 33.3 / 33.3 gives 34 / 33 / 33.
 */
export function roundToHundred(raw: readonly number[]): number[] {
  const sum = raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((value) => (value * TOTAL) / sum);
  const floors = scaled.map((value) => Math.floor(value + TIE));
  const missing = TOTAL - floors.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((value, index) => ({ index, remainder: value - (floors[index] ?? 0) }))
    .sort((a, b) =>
      Math.abs(a.remainder - b.remainder) < TIE ? a.index - b.index : b.remainder - a.remainder,
    );
  const result = [...floors];
  for (const { index } of order.slice(0, Math.max(0, missing))) {
    result[index] = (result[index] ?? 0) + 1;
  }
  return result;
}

/** `count` equal shares of 100, the remainder going to the first flows. */
export function equalShares(count: number): number[] {
  return roundToHundred(Array.from({ length: count }, () => 1));
}

/**
 * Percent per flow, in the order of `flowIds`, from the model's entries (several entries of one
 * flow add up). `null` when the plan does not cover every flow with a positive share or names a
 * flow that was not asked about: such a plan is not a split of these flows.
 */
export function sharesFromProposal(
  flowIds: readonly string[],
  entries: readonly ProposedShare[],
): number[] | null {
  const sums = new Map<string, number>(flowIds.map((id) => [id, 0]));
  for (const entry of entries) {
    const known = sums.get(entry.flowId);
    if (known === undefined || !Number.isFinite(entry.proportion)) return null;
    sums.set(entry.flowId, known + entry.proportion);
  }
  const raw = flowIds.map((id) => sums.get(id) ?? 0);
  if (raw.length === 0 || raw.some((value) => !(value > 0))) return null;
  return roundToHundred(raw);
}
