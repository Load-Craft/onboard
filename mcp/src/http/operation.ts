// Calls of the LoadCraft REST API by operationId. `OPERATIONS` (generated from the contract
// snapshot) says which method and path an operationId is; `OpInput<Id>` and `OpOutput<Id>` type the
// parameters and the answer from the generated `operations`; `callOperation` sends the call through
// the one HTTP client, so the token, the time limit, the size limit and the error shape are the
// client's. A non-2xx answer is thrown as `LoadcraftApiError`, never returned: `OpError<Id>` only
// types the body such an answer carries (`LoadcraftApiError.details`). The secret fields of an
// operation (`SECRET_PATHS`, from the marks of the contract) are registered with the secret scope of
// the tool call, the values sent before the request and the values received before the answer is
// returned: every output of the call masks them. So are the cells of the credential columns of a
// dataset the answer carries; such an answer is not returned to a call without the scope. A value shorter than the masking threshold is not registered: the mask
// does not search for it, and the logger of the process would keep it for nothing.

import { ToolError } from '../errors.js';
import { secretValuesAt, type SecretScope } from '../secret.js';
import { credentialCells } from '../security/datasetCells.js';
import { MIN_SECRET_LENGTH } from '../security/mask.js';
import { isSecretField } from '../security/secretFields.js';
import type { HttpClient } from './client.js';
import type { operations } from './generated/api.js';
import { OPERATIONS, type OperationId } from './generated/operations.js';
import { SECRET_PATHS, type SecretPaths } from './generated/secrets.js';

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206;
type JsonMedia = 'application/json' | `${string}+json`;

/** Keys of the media types `C` declares that are JSON. */
type JsonKeys<C> = Extract<keyof C, JsonMedia>;
type TextKeys<C> = Extract<keyof C, `text/${string}`>;

/**
 * What a response with the `content` map `C` carries: its JSON schema; for text (CSV included) a
 * string; for any other media type (a file, an image) a Blob; for no content nothing (`void`).
 */
type ContentBody<C> = [keyof C] extends [never]
  ? void
  : [JsonKeys<C>] extends [never]
    ? [TextKeys<C>] extends [never]
      ? Blob
      : string
    : C[JsonKeys<C>];

type ResponseBody<Response> = Response extends { content: infer C } ? ContentBody<C> : void;

type Responses<O> = O extends { responses: infer R } ? R : never;

/** The body of the successful (2xx) answer of an operation. */
export type OperationOutput<O> = ResponseBody<Responses<O>[keyof Responses<O> & SuccessStatus]>;

/** The bodies of the non-2xx answers of an operation (the ones that carry a body). */
export type OperationError<O> = Exclude<
  ResponseBody<Responses<O>[Exclude<keyof Responses<O>, SuccessStatus>]>,
  void
>;

type ParamGroup<O, Place extends 'path' | 'query' | 'header', Name extends string> = O extends {
  parameters: infer P;
}
  ? Place extends keyof P
    ? [NonNullable<P[Place]>] extends [never]
      ? unknown
      : undefined extends P[Place]
        ? { [N in Name]?: NonNullable<P[Place]> }
        : { [N in Name]: NonNullable<P[Place]> }
    : unknown
  : unknown;

type RequestBodyOf<O> = 'requestBody' extends keyof O
  ? NonNullable<O['requestBody']> extends { content: infer C }
    ? C extends Record<string, unknown>
      ? { [M in keyof C]: M extends 'multipart/form-data' ? FormData : C[M] }[keyof C]
      : never
    : never
  : never;

type BodyGroup<O> = [RequestBodyOf<O>] extends [never]
  ? unknown
  : undefined extends O[keyof O & 'requestBody']
    ? { body?: RequestBodyOf<O> }
    : { body: RequestBodyOf<O> };

/** An operation that takes no parameters and no body. */
type NoInput = Record<never, never>;

type Collapse<T> = unknown extends T ? NoInput : { [K in keyof T]: T[K] };

/**
 * The input of an operation: `path`, `query` and `header` parameters (each only when the operation
 * has some) and `body` (a multipart body is `FormData`).
 */
export type OperationInput<O> = Collapse<
  ParamGroup<O, 'path', 'path'> &
    ParamGroup<O, 'query', 'query'> &
    ParamGroup<O, 'header', 'header'> &
    BodyGroup<O>
>;

export type OpInput<Id extends OperationId> = OperationInput<operations[Id]>;
/** A `blob` answer is a file whatever type the generator saw (a JSON-declared string is a file). */
export type OpOutput<Id extends OperationId> = (typeof OPERATIONS)[Id]['response'] extends 'blob'
  ? Blob
  : OperationOutput<operations[Id]>;
export type OpError<Id extends OperationId> = OperationError<operations[Id]>;

/** Per-call options of the client (see `http/client.ts`). */
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /**
   * The secret scope of the tool call (`ctx.secrets`). Required for an operation whose contract marks
   * secret fields: what they hold is registered with it.
   */
  secrets?: Pick<SecretScope, 'add'>;
}

type CallArgs<Id extends OperationId> = keyof OpInput<Id> extends never
  ? [input?: OpInput<Id>, options?: CallOptions]
  : Record<never, never> extends OpInput<Id>
    ? [input?: OpInput<Id>, options?: CallOptions]
    : [input: OpInput<Id>, options?: CallOptions];

interface Untyped {
  request(
    method: string,
    path: string,
    init: Record<string, unknown>,
  ): Promise<{ data?: unknown; response: Response }>;
}

interface InputShape {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  header?: Record<string, unknown>;
  body?: unknown;
}

/**
 * The longest value of a secret field registered whole. The masker builds every encoded form of a
 * value it registers (raw, one line, JSON, percent, base64, hex), which for a value of megabytes
 * costs seconds of CPU and more than a gigabyte of memory: the whole content of a dataset, which the
 * contract marks secret, is such a value. 8 KB keeps every secret that is one value (a token, a JWT,
 * an API key, a PEM private key of 4096 bits is about 3.3 KB) and costs a few milliseconds. A longer
 * value is not quoted whole by any output; the secrets inside a dataset are its credential cells,
 * registered one by one (`credentialCells`).
 */
export const MAX_WHOLE_SECRET_LENGTH = 8 * 1024;

/** `Accept` for answers that are not JSON; JSON ones keep the client's default. */
const ACCEPT = { json: null, empty: null, blob: '*/*', text: '*/*' } as const;

const PARSE_AS = { json: 'json', text: 'text', blob: 'blob', empty: 'text' } as const;

/** The secret fields of every operation, as `SECRET_PATHS` holds them. */
export type SecretPathTable = { readonly [Id in OperationId]?: SecretPaths };

/** The signature of `callOperation`. */
export type CallOperation = <Id extends OperationId>(
  http: HttpClient,
  id: Id,
  ...args: CallArgs<Id>
) => Promise<OpOutput<Id>>;

/**
 * `callOperation` over a given table of secret fields. The server uses the one generated from the
 * contract; a test passes a table generated from a changed copy of the contract to show that a field
 * whose mark is gone is no longer masked.
 */
export function operationCaller(table: SecretPathTable): CallOperation {
  return async function call<Id extends OperationId>(
    http: HttpClient,
    id: Id,
    ...args: CallArgs<Id>
  ): Promise<OpOutput<Id>> {
    const row = Object.hasOwn(OPERATIONS, id) ? OPERATIONS[id] : undefined;
    if (row === undefined) throw new TypeError(`Unknown operationId: ${String(id)}`);
    const [input, options] = args;
    const { secrets, ...clientOptions } = options ?? {};
    const secretPaths = Object.hasOwn(table, id) ? table[id] : undefined;
    if (secretPaths !== undefined && secrets === undefined) {
      throw new TypeError(
        `${id}: the contract marks secret fields of this operation; pass the secret scope of the call (options.secrets)`,
      );
    }
    const { path, query, header, body }: InputShape = input ?? {};
    for (const [, name] of row.path.matchAll(/\{([^}]+)\}/g)) {
      const value = name === undefined ? undefined : path?.[name];
      if (name !== undefined && (value === undefined || value === null || value === '')) {
        throw new TypeError(`${id}: path parameter "${name}" has no value`);
      }
    }
    const accept = ACCEPT[row.response];
    const init: Record<string, unknown> = {
      params: { path, query, header: accept === null ? header : { Accept: accept, ...header } },
      parseAs: PARSE_AS[row.response],
      ...clientOptions,
    };
    if (body !== undefined) init['body'] = body;
    const register = (values: readonly string[]): void => {
      for (const value of values) if (value.length >= MIN_SECRET_LENGTH) secrets?.add(value);
    };
    const registerWhole = (values: readonly string[]): void => {
      register(values.filter((value) => value.length <= MAX_WHOLE_SECRET_LENGTH));
    };
    if (secretPaths !== undefined) {
      registerWhole(secretValuesAt(input, secretPaths.request, isSecretField));
    }
    // The generic `request` of openapi-fetch cannot follow a method and path chosen at run time; the
    // table and the generated types are what make this call safe.
    const client = http as unknown as Untyped;
    const { data } = await client.request(row.method, row.path, init);
    if (row.response === 'json') {
      if (data === undefined) {
        // A success with no body: something between the plugin and LoadCraft answered without one.
        throw new ToolError('bad_gateway', { message: 'LoadCraft answered without a body.' });
      }
      if (secretPaths !== undefined) {
        registerWhole(secretValuesAt(data, secretPaths.response, isSecretField));
      }
      const cells = credentialCells(data);
      if (cells.length > 0 && secrets === undefined) {
        throw new TypeError(
          `${id}: the answer carries a dataset with credential columns; pass the secret scope of the call (options.secrets)`,
        );
      }
      register(cells);
    }
    return (row.response === 'empty' ? undefined : data) as OpOutput<Id>;
  };
}

/**
 * Calls the operation `id` and returns the body of its successful answer: the parsed JSON, a string
 * for text, a Blob for a file, `undefined` for an answer without content. The values of its secret
 * fields (`SECRET_PATHS`), in the input and in the answer, are registered with `options.secrets`; an
 * operation with secret fields called without it is refused before anything is sent.
 */
export const callOperation: CallOperation = operationCaller(SECRET_PATHS);

/**
 * `Promise.all` for reads of one tool call sent at once, which waits for every one of them before it
 * throws the first error. A failed read ends the call, and the log of the call writes the text of the
 * backend's error; a read still in flight then has not yet registered the secrets of its answer, so a
 * quote of one of them in that text would stay unmasked. Settled first, every answer that came back
 * has registered its secrets (`callOperation` does so before it returns).
 */
export async function settleAll<T extends readonly unknown[] | []>(
  calls: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const settled = await Promise.allSettled(calls);
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
  }
  return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [K in keyof T]: Awaited<T[K]>;
  };
}
