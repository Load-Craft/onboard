// Is the backend new enough for this plugin? `GET /api/v1/meta` answers with the revision of the
// API surface and the optional features it has; the plugin refuses an older backend with one
// sentence instead of letting the first call end in a bare 404.

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from './apiError.js';
import type { HttpClient } from './client.js';
import type { components } from './generated/api.js';

export type Meta = components['schemas']['MetaResponse'];

/** Oldest `api_revision` of the backend this plugin works with. */
export const MIN_API_REVISION = 1;

/** One `/meta` call per process: the promise of the answer is kept per client. */
const answers = new WeakMap<HttpClient, Promise<Meta>>();

/**
 * Texts live in the dictionaries as `error.backend_too_old.message|hint`; `reasonKind` picks the
 * `error.backend_too_old.reason.<kind>` text (see `http/errors.ts`) and `advice` is empty or
 * starts with a space.
 */
function tooOld(
  reasonKind: 'revision' | 'capability' | 'noMeta',
  reason: string,
  extra: Readonly<Record<string, string | number>> = {},
  advice = '',
): ToolError {
  return new ToolError('backend_too_old', {
    message: `This LoadCraft server is older than the plugin supports (${reason}).`,
    params: { reasonKind, advice: advice === '' ? '' : ` ${advice}`, ...extra },
  });
}

async function fetchMeta(http: HttpClient): Promise<Meta> {
  try {
    const { data } = await http.GET('/api/v1/meta');
    if (data === undefined) throw new ToolError('bad_gateway', { message: 'Empty /meta answer.' });
    return data;
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw tooOld(
        'noMeta',
        'GET /api/v1/meta answered 404: the server does not report its version',
      );
    }
    throw error;
  }
}

/** Backend facts, asked once; a failed call is not remembered. Throws `backend_too_old` below the minimum revision. */
export async function getMeta(http: HttpClient): Promise<Meta> {
  let answer = answers.get(http);
  if (answer === undefined) {
    answer = fetchMeta(http);
    answers.set(http, answer);
    answer.catch(() => {
      if (answers.get(http) === answer) answers.delete(http);
    });
  }
  const meta = await answer;
  if (meta.api_revision < MIN_API_REVISION) {
    throw tooOld(
      'revision',
      `API revision ${String(meta.api_revision)}, the plugin needs ${String(MIN_API_REVISION)}`,
      { have: meta.api_revision, need: MIN_API_REVISION },
    );
  }
  return meta;
}

/** Whether the backend lists `name` among its capabilities. */
export async function hasCapability(http: HttpClient, name: string): Promise<boolean> {
  const meta = await getMeta(http);
  return (meta.capabilities ?? []).includes(name);
}

/** Throws `backend_too_old` naming `name` when the backend does not list it; `advice` is the caller's next step. */
export async function requireCapability(
  http: HttpClient,
  name: string,
  advice: string,
): Promise<void> {
  const meta = await getMeta(http);
  if ((meta.capabilities ?? []).includes(name)) return;
  throw tooOld(
    'capability',
    `the server lacks the "${name}" feature`,
    { capability: name },
    advice,
  );
}
