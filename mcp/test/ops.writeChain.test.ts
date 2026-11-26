import { describe, expect, it } from 'vitest';
import { createWriteChain } from '../src/ops/writeChain.js';

describe('createWriteChain', () => {
  it('runs writes in the order they were asked for', async () => {
    const chain = createWriteChain();
    const seen: number[] = [];
    void chain.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      seen.push(1);
    });
    void chain.run(() => {
      seen.push(2);
      return Promise.resolve();
    });
    await chain.flush();
    expect(seen).toEqual([1, 2]);
  });

  it('goes on after a failed write: later writes still run, and flush reports the first error once', async () => {
    const chain = createWriteChain();
    const seen: string[] = [];
    void chain.run(() => Promise.reject(new Error('first')));
    void chain.run(() => {
      seen.push('after');
      return Promise.resolve();
    });
    void chain.run(() => Promise.reject(new Error('second')));
    await expect(chain.flush()).rejects.toThrow('first');
    expect(seen).toEqual(['after']);
    await expect(chain.flush()).resolves.toBeUndefined();
  });
});
