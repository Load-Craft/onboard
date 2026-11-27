import { describe, expect, it } from 'vitest';
import { analyzeBreach, findBreach, type SeriesPoint } from '../src/report/breach.js';

const BUCKET = 5;

/** A series of `n` buckets at 5 s steps whose value is `f(index)`. */
function series(n: number, f: (i: number) => number): SeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({ offsetS: i * BUCKET, value: f(i) }));
}

describe('findBreach', () => {
  it('finds a rising series that crosses the limit from bucket 74 (370 s) and stays above', () => {
    const s = series(120, (i) => i * 10); // 740 at bucket 74, limit 735
    expect(findBreach(s, 735, { bucketS: BUCKET })).toEqual({ firstOffsetS: 370, sustained: true });
  });

  it('does not count a single spike', () => {
    const s = series(60, (i) => (i === 30 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toBeNull();
  });

  it('does not count two buckets over the limit with the default of three', () => {
    const s = series(60, (i) => (i === 30 || i === 31 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toBeNull();
  });

  it('counts exactly three consecutive buckets and reports the first one', () => {
    const s = series(60, (i) => (i >= 30 && i <= 32 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({
      firstOffsetS: 150,
      sustained: false,
    });
  });

  it('reports a breach that recovers as not sustained', () => {
    const s = series(60, (i) => (i >= 20 && i < 40 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({
      firstOffsetS: 100,
      sustained: false,
    });
  });

  it('returns null when the limit is never exceeded, equal is not exceeding', () => {
    const s = series(60, () => 500);
    expect(findBreach(s, 500, { bucketS: BUCKET })).toBeNull();
  });

  it('honours minBuckets', () => {
    const s = series(60, (i) => (i === 30 || i === 31 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET, minBuckets: 2 })).toEqual({
      firstOffsetS: 150,
      sustained: false,
    });
  });

  it('a hole in the series breaks the run', () => {
    const s = series(60, (i) => (i >= 30 && i <= 33 ? 900 : 100)).filter((p) => p.offsetS !== 160);
    expect(findBreach(s, 500, { bucketS: BUCKET })).toBeNull();
  });

  it('skips a short run and finds a later qualifying one', () => {
    const s = series(80, (i) => (i === 10 || (i >= 50 && i <= 52) ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({
      firstOffsetS: 250,
      sustained: false,
    });
  });

  it('a non-finite value ends the run', () => {
    const s = series(40, (i) => (i === 21 ? Number.NaN : i >= 20 && i <= 22 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toBeNull();
  });

  it('accepts an unsorted series', () => {
    const s = series(60, (i) => (i >= 30 ? 900 : 100)).reverse();
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({ firstOffsetS: 150, sustained: true });
  });

  it('returns null for an empty series', () => {
    expect(findBreach([], 500, { bucketS: BUCKET })).toBeNull();
  });

  it.each([0, -5, Number.NaN])('rejects bucketS %s', (bucketS) => {
    expect(() => findBreach([], 1, { bucketS })).toThrow(RangeError);
  });

  it.each([0, 1.5, -1])('rejects minBuckets %s', (minBuckets) => {
    expect(() => findBreach([], 1, { bucketS: 5, minBuckets })).toThrow(RangeError);
  });
});

describe('analyzeBreach', () => {
  it('says why an empty series has no breach', () => {
    expect(analyzeBreach([], 500, { bucketS: BUCKET })).toEqual({
      breach: null,
      reason: 'series_empty',
    });
  });

  it('says why a series that retention removed has no breach', () => {
    const s = series(60, () => 900);
    expect(analyzeBreach(s, 500, { bucketS: BUCKET, seriesSource: 'absent_retention' })).toEqual({
      breach: null,
      reason: 'series_absent_retention',
    });
  });

  it('says why an unmeasured series has no breach', () => {
    expect(analyzeBreach([], 500, { bucketS: BUCKET, seriesSource: 'absent_unmeasured' })).toEqual({
      breach: null,
      reason: 'series_absent_unmeasured',
    });
  });

  it('distinguishes "never above the limit" from "no data"', () => {
    const s = series(60, () => 100);
    expect(analyzeBreach(s, 500, { bucketS: BUCKET, seriesSource: 'prometheus' })).toEqual({
      breach: null,
      reason: 'limit_not_exceeded',
    });
  });

  it('returns the breach with reason ok', () => {
    const s = series(60, (i) => (i >= 30 ? 900 : 100));
    expect(analyzeBreach(s, 500, { bucketS: BUCKET, seriesSource: 'prometheus' })).toEqual({
      breach: { firstOffsetS: 150, sustained: true },
      reason: 'ok',
    });
  });
});

describe('findBreach, first qualifying run only', () => {
  it('a later qualifying run does not turn the first one sustained', () => {
    const s = series(80, (i) => ((i >= 10 && i <= 12) || i >= 50 ? 900 : 100));
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({ firstOffsetS: 50, sustained: false });
  });

  it('a hole after a qualified run ends it', () => {
    const s = series(40, (i) => (i >= 10 ? 900 : 100)).filter((p) => p.offsetS !== 80);
    expect(findBreach(s, 500, { bucketS: BUCKET })).toEqual({ firstOffsetS: 50, sustained: false });
  });
});
