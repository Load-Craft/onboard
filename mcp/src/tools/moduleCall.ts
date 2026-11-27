// How a module tool calls the backend and lets what it read reach a view.
//
// - `callBackend` calls an operation through the client generated from the contract, with the
//   signal and the secret scope of the call. The scope learns, before the answer is returned, the
//   values of the fields the contract and contracts/secret-fields.json mark as secret
//   (`callOperation`) and the value of every field whose name says it is a secret (`isSecretField`),
//   at any depth: every output of the call masks them, the view included.
// - a text of the backend goes through `inline` (render/primitives.ts) before a view prints it.
// - `content` is a text the target or a third party wrote (a log line, a page, an error of the
//   application): the secrets the call knows replaced, then masked by the shapes of secrets
//   (`maskText`), what that replaced registered, then made one line.
// - `body` is a recorded body: shown masked when its format is one the mask reads, hidden whole
//   (only its type and size) when it is not.

import type { ToolContext } from '../context.js';
import { callOperation, type CallOptions, type OpInput, type OpOutput } from '../http/operation.js';
import type { HttpClient } from '../http/client.js';
import type { OperationId } from '../http/generated/operations.js';
import { inline } from '../render/primitives.js';
import { MIN_SECRET_LENGTH } from '../security/mask.js';
import { secretFieldValues } from '../security/secretFields.js';
import { maskBody, maskText } from '../security/traceMask.js';

export type CallContext = Pick<ToolContext, 'services' | 'signal' | 'secrets'>;

/** The input argument of an operation: none, optional or required, as the contract has it. */
export type CallInput<Id extends OperationId> = keyof OpInput<Id> extends never
  ? []
  : Record<never, never> extends OpInput<Id>
    ? [input?: OpInput<Id>]
    : [input: OpInput<Id>];

/** The query parameters of an operation, as the client types them; `never` when it has none. */
export type QueryOf<Id extends OperationId> = 'query' extends keyof OpInput<Id>
  ? NonNullable<OpInput<Id>['query' & keyof OpInput<Id>]>
  : never;

/** The body of an operation, as the client types it; `never` when it takes none. */
export type BodyOf<Id extends OperationId> = 'body' extends keyof OpInput<Id>
  ? NonNullable<OpInput<Id>['body' & keyof OpInput<Id>]>
  : never;

type AnyCall = (
  http: HttpClient,
  id: OperationId,
  input: unknown,
  options: CallOptions,
) => Promise<unknown>;

function register(ctx: Pick<ToolContext, 'secrets'>, values: readonly string[]): void {
  for (const value of values) if (value.length >= MIN_SECRET_LENGTH) ctx.secrets.add(value);
}

/**
 * Calls the operation `id` and returns the body of its successful answer; a non-2xx answer is
 * thrown as `LoadcraftApiError` (the registry turns it into the error the model sees).
 */
export function callBackend<Id extends OperationId>(
  ctx: CallContext,
  id: Id,
  ...input: CallInput<Id>
): Promise<OpOutput<Id>> {
  return callWith(ctx, id, input[0], {});
}

/** The longest a tool call may wait for one operation (3 minutes): a build or a model's answer. */
export const LONGEST_CALL_MS = 180_000;

/**
 * `callBackend` for an operation that runs long (a build, a model's answer): the whole call, retries
 * included, may take `timeoutMs` (up to `LONGEST_CALL_MS`) instead of the client's default.
 */
export function callBackendFor<Id extends OperationId>(
  ctx: CallContext,
  timeoutMs: number,
  id: Id,
  ...input: CallInput<Id>
): Promise<OpOutput<Id>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > LONGEST_CALL_MS) {
    throw new RangeError(`callBackendFor: timeoutMs must be 1 to ${String(LONGEST_CALL_MS)}`);
  }
  return callWith(ctx, id, input[0], { timeoutMs });
}

async function callWith<Id extends OperationId>(
  ctx: CallContext,
  id: Id,
  input: unknown,
  extra: { readonly timeoutMs?: number },
): Promise<OpOutput<Id>> {
  // `callOperation` types its input by the operation; `CallInput` gave the caller the same type,
  // which a generic `Id` cannot carry through its rest parameter.
  const call = callOperation as AnyCall;
  const data = await call(ctx.services.http, id, input, {
    signal: ctx.signal,
    secrets: ctx.secrets,
    ...extra,
  });
  register(ctx, secretFieldValues(data, { ownContract: true }));
  return data as OpOutput<Id>;
}

/**
 * A text the target or a third party wrote, masked, its secrets registered, made one line. The
 * secrets the call already knows (the token among them) go first: a mask by shape that replaced a
 * part of one would leave the rest where the scope no longer finds it.
 */
export function content(
  ctx: Pick<ToolContext, 'secrets'>,
  text: string,
  max?: number,
  options: { readonly documentation?: boolean } = {},
): string {
  const masked = maskText(ctx.secrets.scrub(text), options);
  register(ctx, masked.secrets);
  return inline(masked.text, max);
}

/** A recorded body as a view may show it: masked, or hidden whole when the mask cannot read it. */
export type ShownBody =
  | { readonly kind: 'shown'; readonly text: string }
  | { readonly kind: 'hidden'; readonly type: string | null; readonly bytes: number };

/** A recorded body (`type`: its media type), masked or hidden whole; its secrets registered first. */
export function body(
  ctx: Pick<ToolContext, 'secrets'>,
  text: string,
  type: string | null,
  side: 'request' | 'response' = 'response',
  options: { readonly documentation?: boolean } = {},
): ShownBody {
  const masked = maskBody(ctx.secrets.scrub(text), type, side, options);
  if (masked.kind === 'hidden') return masked;
  register(ctx, masked.secrets);
  return { kind: 'shown', text: masked.text };
}
