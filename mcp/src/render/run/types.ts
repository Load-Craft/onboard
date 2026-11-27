// Types the views of module run share.

export type RunStatus = 'pending' | 'building' | 'running' | 'completed' | 'failed' | 'cancelled';

/** The load a run or a saved run was started with, as far as its stored workload names it. */
export interface WorkloadView {
  readonly type: string | null;
  readonly vusers: number | null;
  readonly ramp: number | null;
  readonly hold: number | null;
}
