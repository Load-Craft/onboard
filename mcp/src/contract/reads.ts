/**
 * Compile-time check of the hand-written Zod readers against the generated contract types.
 *
 * A reader (`z.looseObject({...})`) reads only the keys the plugin needs. `reads<Wire>()(schema)`
 * makes `tsc` fail at that reader when a key it reads is missing from `Wire` (the generated type
 * of the answer or the frame) or has another type there (a reader may be narrower, like an enum
 * of a string, or wider, like a string for a literal, but not of another kind). The check runs on the output type of
 * the schema, descends into nested objects and arrays, and skips what the contract leaves open
 * (`unknown`, string-keyed records) and what the reader leaves open (`z.unknown()`).
 *
 * The error shows up as a missing property `contract mismatch` whose type lists the paths.
 */
import type * as z from 'zod';

import type { paths } from '../http/generated/api.js';

import type {
  ClientBody,
  ClientFrames,
  ServerBody,
  ServerFrames,
} from '../ws/generated/channels.js';

/** The keys a type names, without its string and number index signatures. */
type Known<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** Keys of every member of a union (`keyof` of a union is only the common keys). */
type AllKeys<T> = T extends unknown ? keyof T : never;
type PropOf<T, K> = T extends unknown ? (K extends keyof T ? T[K] : undefined) : never;

/**
 * What the sender promises (`W`) must fit into what the reader accepts: every value, `null` and a
 * missing key included. The reader schema is walked, not only its input type, because Zod types
 * hide what `.catch()`, `.default()` and `.optional()` accept. A reader may be narrower than a
 * plain `string` of the contract (an enum it validates), but not narrower than a list of values
 * the contract names. `z.unknown()` accepts anything.
 *
 * A pipe is read on the side that meets the wire value: its input schema, or, when that input is
 * open (`z.unknown().pipe(X)`, `z.preprocess(fn, X)`), the schema it hands the value to. A union
 * must accept every value of the contract with at least one option (a discriminated union splits
 * the contract by its key first), and each option, being tried and dropped like a `.catch()`, is
 * walked leniently: it may not read a key the contract lacks or a value of another type.
 * Limitation: an option of a kind the contract never has is reported even when another option
 * covers the contract, so a tolerant union wider than the contract (`z.union([z.number(),
 * z.string()])` for a contract `number`) fails to compile.
 *
 * Under `.catch()` (`L`, lenient) a value the reader does not accept falls back to the catch
 * value, so `null`, a missing key and a value of an enum the contract extends are not reported
 * there. A key the contract does not have, an object or array where the contract has none and a
 * value of another type still are: the reader could never read them, and would quietly give the
 * fallback on every answer.
 */
type DiffRead<W, S, P extends string, L extends boolean = false> =
  S extends z.ZodCatch<infer T>
    ? DiffRead<W, T, P, true>
    : S extends z.ZodUnknown | z.ZodAny
      ? never
      : unknown extends W
        ? never
        : S extends z.ZodOptional<infer T>
          ? DiffRead<Exclude<W, undefined>, T, P, L>
          : S extends z.ZodDefault<infer T>
            ? DiffRead<Exclude<W, undefined>, T, P, L>
            : S extends z.ZodNullable<infer T>
              ? DiffRead<Exclude<W, null>, T, P, L>
              : S extends z.ZodPipe<infer A, infer B>
                ? A extends z.ZodUnknown | z.ZodAny | z.core.$ZodTransform
                  ? DiffRead<W, B, P, L>
                  : DiffRead<W, A, P, L>
                : S extends z.ZodUnion<infer O>
                  ? DiffUnion<W, O, DiscOf<S>, P, L>
                  : | (L extends true
                        ? never
                        : | (null extends W
                              ? null extends z.input<S>
                                ? never
                                : `${P}: the contract allows null`
                              : never)
                          | (undefined extends W
                              ? undefined extends z.input<S>
                                ? never
                                : `${P}: the contract may omit it`
                              : never))
                    | ([NonNullable<W>] extends [never]
                        ? never
                        : ReadCore<NonNullable<W>, S, P, L>);

type DiscOf<S> = S extends z.ZodDiscriminatedUnion<readonly z.core.SomeType[], infer D> ? D : never;

/** The members of `W`, an object split into one member per value of its key `D`. */
type SplitBy<W, D extends string> = [D] extends [never]
  ? W
  : W extends object
    ? D extends keyof W
      ? W[D] extends infer V
        ? V extends unknown
          ? Omit<W, D> & { [K in D]: V }
          : never
        : never
      : W
    : W;

/** The members of `W` no option of the union accepts. */
type Unaccepted<W, O extends readonly unknown[], P extends string> = W extends unknown
  ? true extends { [I in keyof O]: [DiffRead<W, O[I], P>] extends [never] ? true : false }[number]
    ? never
    : W
  : never;

type DiffUnion<
  W,
  O,
  D extends string,
  P extends string,
  L extends boolean,
> = O extends readonly unknown[]
  ? | { [I in keyof O]: DiffRead<W, O[I], P, true> }[number]
    | (L extends true
        ? never
        : [Unaccepted<SplitBy<W, D>, O, P>] extends [never]
          ? never
          : null extends Unaccepted<SplitBy<W, D>, O, P>
            ? `${P}: the contract allows null`
            : undefined extends Unaccepted<SplitBy<W, D>, O, P>
              ? `${P}: the contract may omit it`
              : `${P}: the contract allows values the reader does not accept`)
  : never;

type ReadCore<W, S, P extends string, L extends boolean> =
  S extends z.ZodObject<infer Shape>
    ? [Extract<W, object>] extends [never]
      ? `${P}: the contract has no object`
      : L extends true
        ? DiffReadObject<Extract<W, object>, Shape, P, L>
        : [W] extends [object]
          ? DiffReadObject<W, Shape, P, L>
          : `${P}: the contract allows values the reader does not accept`
    : S extends z.ZodArray<infer E>
      ? [Extract<W, readonly unknown[]>] extends [never]
        ? `${P}: the contract has no array`
        : L extends true
          ? DiffRead<ArrayItem<W>, E, `${P}[]`, L>
          : [W] extends [readonly unknown[]]
            ? DiffRead<ArrayItem<W>, E, `${P}[]`, L>
            : `${P}: the contract allows values the reader does not accept`
      : S extends z.ZodType
        ? ReadLeaf<W, NonNullable<z.input<S>>, P, L>
        : never;

type ArrayItem<W> = W extends readonly (infer E)[] ? E : never;

/** The kinds of JSON value a type holds; two types of disjoint kinds never share a value. */
type Kind<T> = T extends string
  ? 'string'
  : T extends number
    ? 'number'
    : T extends boolean
      ? 'boolean'
      : T extends readonly unknown[]
        ? 'array'
        : T extends object
          ? 'object'
          : 'other';

type ReadLeaf<W, I, P extends string, L extends boolean> = unknown extends I
  ? never
  : [W] extends [I]
    ? never
    : [I] extends [never]
      ? L extends true
        ? never
        : `${P}: the contract allows values the reader does not accept`
      : L extends true
        ? [Kind<W> & Kind<I>] extends [never]
          ? `${P}: another type in the contract`
          : never
        : [Exclude<Kind<W>, Kind<I>>] extends [never]
          ? [W] extends [string]
            ? [string] extends [W]
              ? never
              : `${P}: the contract allows values the reader does not accept`
            : `${P}: the contract allows values the reader does not accept`
          : `${P}: another type in the contract`;

type DiffReadObject<W, Shape, P extends string, L extends boolean> = {
  [K in keyof Shape & string]-?: K extends AllKeys<W>
    ? DiffRead<PropOf<W, K>, Shape[K], `${P}.${K}`, L>
    : `${P}.${K}: not in the contract`;
}[keyof Shape & string];

/** For what the plugin sends: its output must fit the contract (`R` is the schema output). */
type Diff<W, R, P extends string> = unknown extends R
  ? never
  : unknown extends W
    ? never
    : [NonNullable<R>] extends [readonly (infer RE)[]]
      ? [NonNullable<W>] extends [readonly (infer WE)[]]
        ? Diff<WE, RE, `${P}[]`>
        : `${P}: the contract has no array`
      : [NonNullable<R>] extends [object]
        ? [NonNullable<W>] extends [object]
          ? DiffObject<NonNullable<W>, NonNullable<R>, P>
          : `${P}: the contract has no object`
        : [NonNullable<R>] extends [NonNullable<W>]
          ? never
          : [NonNullable<W>] extends [NonNullable<R>]
            ? never
            : `${P}: another type in the contract`;

type DiffObject<W, R, P extends string> = {
  [K in keyof Known<R> & string]-?: K extends AllKeys<W>
    ? Diff<PropOf<W, K>, Known<R>[K], `${P}.${K}`>
    : `${P}.${K}: not in the contract`;
}[keyof Known<R> & string];

/** `unknown` when the reader agrees with the contract; the error otherwise. */
type Verdict<D> = [D] extends [never] ? unknown : { readonly 'contract mismatch': D };

/** Returns the schema as it is; `tsc` fails when it reads what `Wire` does not have. */
export function reads<Wire>() {
  return <S extends z.ZodType>(schema: S & Verdict<DiffRead<Wire, S, ''>>): S => schema;
}

type Side = 'server' | 'client';
type FrameTable<S extends Side> = S extends 'server' ? ServerFrames : ClientFrames;
type BodyOf<
  S extends Side,
  C extends keyof FrameTable<S>,
  T extends keyof FrameTable<S>[C],
> = S extends 'server'
  ? ServerBody<C & keyof ServerFrames, T & keyof ServerFrames[C & keyof ServerFrames]>
  : ClientBody<C & keyof ClientFrames, T & keyof ClientFrames[C & keyof ClientFrames]>;

/** A server frame is read (input check), a client frame is sent (output check). */
type Check<S extends Side, W, Schema extends z.ZodType> = S extends 'server'
  ? DiffRead<W, Schema, ''>
  : Diff<W, z.output<Schema>, ''>;

type TableCheck<S extends Side, C extends keyof FrameTable<S>, Table> = {
  [T in keyof Table]: T extends keyof FrameTable<S>[C]
    ? Verdict<Check<S, BodyOf<S, C, T>, Table[T] & z.ZodType>>
    : { readonly 'contract mismatch': 'no such frame in the contract' };
};

/**
 * The readers of the server frames of one channel, by wire type; each is checked against the
 * body of that frame in the generated types. Returns the table as it is.
 */
export function readsTable<C extends keyof ServerFrames>() {
  return <Table extends Record<string, z.ZodType>>(
    table: Table & TableCheck<'server', C, Table>,
  ): Table => table;
}

/** As `readsTable`, for the messages the plugin sends. */
export function sendsTable<C extends keyof ClientFrames>() {
  return <Table extends Record<string, z.ZodType>>(
    table: Table & TableCheck<'client', C, Table>,
  ): Table => table;
}

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : never;
type Success<Responses> = {
  [S in keyof Responses & (200 | 201 | 202)]: Json<Responses[S]>;
}[keyof Responses & (200 | 201 | 202)];

/**
 * The JSON body of a successful answer of an operation of the generated OpenAPI types:
 * `ResponseOf<'/api/v1/projects/{project_id}', 'get'>`; `never` when the operation has none.
 */
export type ResponseOf<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: infer R;
}
  ? Success<R>
  : never;
