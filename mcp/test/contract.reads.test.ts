// A hand-written Zod reader may read only what the contract describes, and must accept everything
// the contract lets the sender put there. `reads<Wire>()` makes tsc fail at the reader otherwise.
// Each case below is a reader compiled on its own (`helpers/typeProbe.ts`): `ok` cases must
// compile, the others must fail with the named path in the message.

import { describe, expect, it } from 'vitest';

import { compileCases, SRC } from './helpers/typeProbe.js';

const PRELUDE = `
import * as z from 'zod';
import { reads, readsTable, sendsTable, type ResponseOf } from '${SRC}/contract/reads.ts';

interface Wire {
  id: string;
  count: number;
  note: string | null;
  mode?: string;
  kind: 'a' | 'b' | 'c';
  nested: { name: string; tags: string[]; maybe?: number }[];
  free: Record<string, unknown>;
  anything: unknown;
}
`;

interface Case {
  readonly name: string;
  readonly code: string;
  /** Text the error must contain; absent: the case must compile. */
  readonly fails?: string;
}

const CASES: readonly Case[] = [
  {
    name: 'ok: existing keys, a narrower enum of a plain string, nullable helpers, open readers',
    code: `reads<Wire>()(z.looseObject({
      id: z.string(), count: z.number().int(), note: z.string().nullable(),
      mode: z.enum(['x', 'y']).optional(), kind: z.enum(['a', 'b', 'c']),
      nested: z.array(z.looseObject({ name: z.string(), maybe: z.number().optional() })),
      free: z.looseObject({ whatever: z.number() }), anything: z.unknown(),
    }));`,
  },
  {
    name: 'ok: .catch and .default accept what the contract may omit or null',
    code: `reads<Wire>()(z.looseObject({
      note: z.string().catch(''), mode: z.string().default('x'), kind: z.string().catch('a'),
    }));`,
  },
  {
    name: 'ok: under .catch a missing key, null and an enum the contract extends fall back',
    code: `reads<Wire>()(z.looseObject({
      nested: z.array(z.looseObject({ name: z.string(), maybe: z.number() })).catch([]),
      kind: z.enum(['a', 'b']).catch('a'), mode: z.enum(['x']).catch('x'),
      note: z.string().or(z.null()).catch(''),
    }));`,
  },
  {
    name: 'under .catch: a renamed key of an array item',
    code: `reads<Wire>()(z.looseObject({
      nested: z.array(z.looseObject({ title: z.string() })).catch([]),
    }));`,
    fails: '.nested[].title: not in the contract',
  },
  {
    name: 'under .catch: a renamed key of the whole answer',
    code: `reads<Wire>()(z.looseObject({ gone: z.string() }).catch({ gone: '' }));`,
    fails: '.gone: not in the contract',
  },
  {
    name: 'under .catch: a key of another type',
    code: `reads<Wire>()(z.looseObject({ count: z.string().catch('') }));`,
    fails: '.count: another type in the contract',
  },
  {
    name: 'under .catch: an array where the contract has none',
    code: `reads<Wire>()(z.looseObject({ id: z.array(z.string()).catch([]) }));`,
    fails: '.id: the contract has no array',
  },
  {
    name: 'under .catch: an object where the contract has none',
    code: `reads<Wire>()(z.looseObject({ count: z.looseObject({ value: z.number() }).catch({ value: 0 }) }));`,
    fails: '.count: the contract has no object',
  },
  {
    name: 'a key the contract lacks',
    code: `reads<Wire>()(z.looseObject({ gone: z.string() }));`,
    fails: '.gone: not in the contract',
  },
  {
    name: 'a key of another type',
    code: `reads<Wire>()(z.looseObject({ count: z.string() }));`,
    fails: '.count',
  },
  {
    name: 'a nested key the contract lacks',
    code: `reads<Wire>()(z.looseObject({ nested: z.array(z.looseObject({ gone: z.string() })) }));`,
    fails: '.nested[].gone: not in the contract',
  },
  {
    name: 'the contract allows null, the reader does not',
    code: `reads<Wire>()(z.looseObject({ note: z.string() }));`,
    fails: '.note: the contract allows null',
  },
  {
    name: 'the contract may omit a key, the reader requires it',
    code: `reads<Wire>()(z.looseObject({ mode: z.string() }));`,
    fails: '.mode: the contract may omit it',
  },
  {
    name: 'a nested key the contract may omit, the reader requires',
    code: `reads<Wire>()(z.looseObject({ nested: z.array(z.looseObject({ maybe: z.number() })) }));`,
    fails: '.nested[].maybe: the contract may omit it',
  },
  {
    name: 'a value of the contract the enum reader does not list',
    code: `reads<Wire>()(z.looseObject({ kind: z.enum(['a', 'b']) }));`,
    fails: '.kind: the contract allows values the reader does not accept',
  },
  {
    name: 'ok: pipes, transforms and unions that read what the contract has',
    code: `reads<Wire>()(z.looseObject({
      id: z.string().transform((value) => value.length),
      count: z.preprocess((value) => value, z.number()),
      nested: z.array(z.union([
        z.looseObject({ name: z.string(), maybe: z.number() }),
        z.looseObject({ name: z.string(), tags: z.array(z.string()) }),
      ])),
      free: z.unknown().pipe(z.looseObject({ whatever: z.number() })),
      anything: z.unknown().pipe(z.union([z.looseObject({ x: z.string() }), z.string()])),
    }));`,
  },
  {
    name: 'ok: a discriminated union over a key the contract lists',
    code: `reads<Wire>()(z.discriminatedUnion('kind', [
      z.looseObject({ kind: z.literal('a'), count: z.number() }),
      z.looseObject({ kind: z.enum(['b', 'c']), id: z.string() }),
    ]));`,
  },
  {
    name: 'a pipe from unknown at the top: a key the contract lacks',
    code: `reads<Wire>()(z.unknown().pipe(z.looseObject({ gone: z.string() })));`,
    fails: '.gone: not in the contract',
  },
  {
    name: 'a pipe from unknown inside: a key the contract lacks',
    code: `reads<Wire>()(z.looseObject({
      nested: z.unknown().pipe(z.array(z.looseObject({ gone: z.string() }))),
    }));`,
    fails: '.nested[].gone: not in the contract',
  },
  {
    name: 'a pipe from unknown: null the reader does not accept',
    code: `reads<Wire>()(z.looseObject({ note: z.unknown().pipe(z.string()) }));`,
    fails: '.note: the contract allows null',
  },
  {
    name: 'preprocess: a string reader of a number',
    code: `reads<Wire>()(z.looseObject({ count: z.preprocess((value) => value, z.string()) }));`,
    fails: '.count: another type in the contract',
  },
  {
    name: 'union: an option reads a key the contract lacks',
    code: `reads<Wire>()(z.looseObject({
      nested: z.array(z.union([z.looseObject({ gone: z.string() }), z.looseObject({ name: z.string() })])),
    }));`,
    fails: '.nested[].gone: not in the contract',
  },
  {
    name: 'union: an option reads a key of another type',
    code: `reads<Wire>()(z.union([z.looseObject({ count: z.string() }), z.looseObject({ id: z.string() })]));`,
    fails: '.count: another type in the contract',
  },
  {
    name: 'discriminated union: an option reads a key the contract lacks',
    code: `reads<Wire>()(z.discriminatedUnion('kind', [
      z.looseObject({ kind: z.literal('a'), gone: z.string() }),
      z.looseObject({ kind: z.enum(['b', 'c']) }),
    ]));`,
    fails: '.gone: not in the contract',
  },
  {
    name: 'union: an option of a kind the contract never has',
    code: `reads<Wire>()(z.looseObject({ note: z.union([z.string(), z.looseObject({})]).nullable() }));`,
    fails: '.note: the contract has no object',
  },
  {
    name: 'union: null the options do not accept',
    code: `reads<Wire>()(z.looseObject({ note: z.union([z.literal('x'), z.string()]) }));`,
    fails: '.note: the contract allows null',
  },
  {
    name: 'union: no option accepts a value of the contract',
    code: `reads<Wire>()(z.looseObject({ kind: z.union([z.literal('a'), z.literal('b')]) }));`,
    fails: '.kind: the contract allows values the reader does not accept',
  },
  {
    name: 'REST ok: a nullable key read as nullish',
    code: `reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(z.object({ test_types_generated_from_spec_id: z.string().nullish() }));`,
  },
  {
    name: 'REST: a nullable key read as a plain string',
    code: `reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(z.object({ test_types_generated_from_spec_id: z.string() }));`,
    fails: '.test_types_generated_from_spec_id: the contract allows null',
  },
  {
    name: 'REST: a required key read with another type',
    code: `reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(z.object({ name: z.number() }));`,
    fails: '.name',
  },
  {
    name: 'WS ok: a nullable key read as nullish, an enum read whole',
    code: `readsTable<'refine'>()({ 'flow-suggestions-refine:progress': z.looseObject({
      progress: z.number().int(), described: z.number().int().nullish(),
      current_step: z.enum(['start', 'group', 'describe']).optional(),
    }) });`,
  },
  {
    name: 'WS: a nullable key read as a number',
    code: `readsTable<'refine'>()({ 'flow-suggestions-refine:progress': z.looseObject({ described: z.number().int().optional() }) });`,
    fails: '.described: the contract allows null',
  },
  {
    name: 'WS: an enum value the reader does not list',
    code: `readsTable<'refine'>()({ 'flow-suggestions-refine:progress': z.looseObject({ current_step: z.enum(['start', 'group']).optional() }) });`,
    fails: '.current_step: the contract allows values the reader does not accept',
  },
  {
    name: 'WS: a frame type the channel does not have',
    code: `readsTable<'refine'>()({ 'flow-suggestions-refine:nothing': z.looseObject({}) });`,
    fails: 'no such frame in the contract',
  },
  {
    name: 'WS: a key the frame lacks',
    code: `readsTable<'refine'>()({ 'flow-suggestions-refine:progress': z.looseObject({ nope: z.string() }) });`,
    fails: '.nope: not in the contract',
  },
  {
    name: 'sends: a key the client frame lacks',
    code: `sendsTable<'har'>()({ 'har:cancel': z.looseObject({ nope: z.string() }) });`,
    fails: '.nope: not in the contract',
  },
];

describe('reads / readsTable / sendsTable', () => {
  const result = compileCases(
    PRELUDE,
    CASES.map(({ name, code }) => ({ name, code })),
  );

  it('compiles the prelude', () => {
    expect(result.get('prelude') ?? []).toEqual([]);
  });

  it.each(CASES)('$name', ({ name, fails }) => {
    const errors = result.get(name) ?? [];
    if (fails === undefined) expect(errors).toEqual([]);
    else {
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toContain(fails);
    }
  });
});
