// Time source injected into long-running operations so tests never wait for real.

export interface Clock {
  now(): number;
  /** Resolves after `ms`; rejects with an AbortError as soon as `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError(signal));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortError(signal));
      };
      // unref: a pending wait must not keep the process alive after the call ended.
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms).unref();
      signal.addEventListener('abort', onAbort, { once: true });
    });
  },
};
