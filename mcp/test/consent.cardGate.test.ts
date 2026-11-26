// The gate of a consent card (`consent/confirmCard.ts`): a card first, the write only with its token
// and the same arguments. The consent of a group (one yes covering the next calls of the group) is a
// mechanism of the gate that no tool uses yet; it is tested here on its own.

import { describe, expect, it } from 'vitest';

import { cardGate, GRANT_CALLS } from '../src/consent/confirmCard.js';

function context(start = Date.parse('2026-11-22T10:30:00Z')) {
  const drafts = new Map<string, unknown>();
  let now = start;
  return {
    advance: (ms: number) => {
      now += ms;
    },
    ctx: {
      clock: { now: () => now },
      state: {
        get: (_section: string, key: string) =>
          drafts.has(key) ? { value: drafts.get(key) } : undefined,
        set: (_section: string, key: string, value: unknown) => {
          drafts.set(key, value);
          return Promise.resolve();
        },
        delete: (_section: string, key: string) => {
          drafts.delete(key);
          return Promise.resolve();
        },
      },
    } as unknown as Parameters<typeof cardGate>[0],
  };
}

const ARGS = { slot: 'coupons' };

async function yes(ctx: Parameters<typeof cardGate>[0], group?: string) {
  const card = await cardGate(ctx, 'tool', 'p', ARGS, undefined, { group });
  if (card.write) throw new Error('a card was expected');
  return cardGate(ctx, 'tool', 'p', ARGS, card.token, { group });
}

describe('cardGate', () => {
  it('writes only with the token of its card, once', async () => {
    const { ctx } = context();
    const card = await cardGate(ctx, 'tool', 'p', ARGS, undefined);
    expect(card.write).toBe(false);
    const token = card.write ? '' : card.token;
    expect(await cardGate(ctx, 'tool', 'p', { slot: 'other' }, token)).toMatchObject({
      write: false,
      renewed: 'changed',
    });
    const fresh = await cardGate(ctx, 'tool', 'p', ARGS, undefined);
    const again = fresh.write ? '' : fresh.token;
    expect(await cardGate(ctx, 'tool', 'p', ARGS, again)).toEqual({ write: true });
    expect(await cardGate(ctx, 'tool', 'p', ARGS, again)).toMatchObject({ write: false });
  });

  it('without a group a yes covers nothing else', async () => {
    const { ctx } = context();
    expect(await yes(ctx)).toEqual({ write: true });
    expect((await cardGate(ctx, 'tool', 'p', ARGS, undefined)).write).toBe(false);
  });

  it('with a group a yes covers the next calls up to the limit and the card time', async () => {
    const { ctx } = context();
    expect(await yes(ctx, 'g')).toEqual({ write: true });
    for (let used = 2; used <= GRANT_CALLS; used += 1) {
      expect(await cardGate(ctx, 'tool', 'p', ARGS, undefined, { group: 'g' })).toEqual({
        write: true,
        granted: { used, limit: GRANT_CALLS },
      });
    }
    expect((await cardGate(ctx, 'tool', 'p', ARGS, undefined, { group: 'g' })).write).toBe(false);
    const later = context();
    await yes(later.ctx, 'g');
    later.advance(31 * 60_000);
    expect((await cardGate(later.ctx, 'tool', 'p', ARGS, undefined, { group: 'g' })).write).toBe(
      false,
    );
  });

  it('a call of its own is never covered and its yes covers nothing', async () => {
    const { ctx } = context();
    await yes(ctx, 'g');
    const own = await cardGate(ctx, 'tool', 'p', ARGS, undefined, { group: 'g', own: true });
    expect(own.write).toBe(false);
    const other = context();
    const card = await cardGate(other.ctx, 'tool', 'p', ARGS, undefined, { group: 'g', own: true });
    const token = card.write ? '' : card.token;
    await cardGate(other.ctx, 'tool', 'p', ARGS, token, { group: 'g', own: true });
    expect((await cardGate(other.ctx, 'tool', 'p', ARGS, undefined, { group: 'g' })).write).toBe(
      false,
    );
  });
});
