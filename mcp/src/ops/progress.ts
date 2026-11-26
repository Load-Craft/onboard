// Progress reporting for one tool call. The tool calls `report`; the protocol rules live here:
// notify only when the client sent a progress token, strictly increasing `progress`, at most one
// notification per second (the newest skipped message wins), a repeat of the last message after
// 5 s of silence so a long wait stays visible, and nothing at all after `stop()`.

import type { ProgressReporter } from '../context.js';
import type { Clock } from './clock.js';

/** Minimum gap between two notifications. */
export const MIN_INTERVAL_MS = 1000;
/** Scale of `total` when a fraction is known; fine enough that keep-alive drift stays negligible. */
export const TOTAL = 1_000_000;
/** Silence after which the last message is repeated. */
export const KEEPALIVE_MS = 5000;

/** The part of `ctx.mcpReq` this module needs. */
export interface ProgressRequest {
  readonly _meta?: { readonly progressToken?: string | number | undefined } | undefined;
  notify(notification: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; total?: number; message?: string };
  }): Promise<void>;
}

interface Pending {
  message: string;
  fraction: number | undefined;
}

export function createProgress(req: ProgressRequest, clock: Clock): ProgressReporter {
  const token = req._meta?.progressToken;
  let stopped = false;
  // Aborted by stop(): pending waits end at once and release their timers.
  const waits = new AbortController();
  let lastProgress = 0;
  let lastSentAt: number | undefined;
  let last: Pending | undefined;
  let pending: Pending | undefined;
  let flushScheduled = false;
  // Bumped on every send; a keep-alive armed for an older send is stale and does nothing.
  let epoch = 0;

  function wait(ms: number, then: () => void): void {
    clock.sleep(ms, waits.signal).then(
      () => {
        if (!stopped) then();
      },
      () => undefined,
    );
  }

  function send(item: Pending): void {
    if (token === undefined) return;
    let progress = lastProgress + 1;
    let total: number | undefined;
    if (item.fraction !== undefined) {
      const clamped = Math.min(1, Math.max(0, item.fraction));
      progress = Math.max(Math.round(clamped * TOTAL), progress);
      // Progress must strictly increase; only after a million sends could it pass `total`,
      // and then `total` is dropped rather than sent smaller than `progress`.
      if (progress <= TOTAL) total = TOTAL;
    }
    lastProgress = progress;
    lastSentAt = clock.now();
    last = item;
    epoch += 1;
    const armed = epoch;
    req
      .notify({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress,
          ...(total === undefined ? {} : { total }),
          message: item.message,
        },
      })
      .catch(() => undefined);
    wait(KEEPALIVE_MS, () => {
      if (epoch === armed && last !== undefined) send(last);
    });
  }

  function flush(): void {
    flushScheduled = false;
    const item = pending;
    pending = undefined;
    if (item !== undefined) send(item);
  }

  return {
    report(message, fraction) {
      if (stopped || token === undefined) return;
      const item: Pending = { message, fraction };
      const due = lastSentAt === undefined ? 0 : lastSentAt + MIN_INTERVAL_MS - clock.now();
      if (due <= 0 && !flushScheduled) {
        send(item);
        return;
      }
      pending = item;
      if (!flushScheduled) {
        flushScheduled = true;
        wait(due, flush);
      }
    },
    stop() {
      stopped = true;
      pending = undefined;
      waits.abort();
    },
  };
}
