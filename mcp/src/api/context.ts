// Conventions of the `api/*` layer, the only code that calls the REST client. Every function there
// has the shape `(api: ApiContext, ...args) => Promise<Model>`: it passes the call's signal to the
// request (so cancelling the tool stops the transfer), unwraps the body with `must` and narrows the
// answer to what tools may see. A tool never calls `ctx.services.http` itself.

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';

/** What an `api/*` function needs from the tool call; a `ToolContext` is one. */
export type ApiContext = Pick<ToolContext, 'services' | 'signal'>;

/**
 * What an `api/*` function needs to read or write an operation whose contract marks secret fields:
 * the secret scope of the call too, so `callOperation` registers what those fields hold before a
 * later error of the backend can quote it.
 */
export type SecretApiContext = ApiContext & Pick<ToolContext, 'secrets'>;

/**
 * The body of a REST answer. The client throws on every non-2xx answer, so a missing body here
 * means something between the plugin and LoadCraft answered without one.
 */
export async function must<T>(call: Promise<{ data?: T }>): Promise<T> {
  const { data } = await call;
  if (data === undefined) {
    throw new ToolError('bad_gateway', { message: 'LoadCraft answered without a body.' });
  }
  return data;
}

/**
 * Runs a request that stops a background job. LoadCraft answers 404 for a job it does not know or
 * that already ended, and 409 for one that is no longer in a stoppable state; both mean there was
 * nothing to stop, so the answer is `false` and not an error.
 */
export async function stopRequest(call: () => Promise<boolean>): Promise<boolean> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof LoadcraftApiError && (error.status === 404 || error.status === 409)) {
      return false;
    }
    throw error;
  }
}
