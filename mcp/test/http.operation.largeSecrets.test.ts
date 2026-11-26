// What `callOperation` registers from a large answer. A field the contract marks secret is registered
// whole only up to `MAX_WHOLE_SECRET_LENGTH`: the masker builds every encoded form of a value, so the
// whole content of a dataset (megabytes of CSV) would cost seconds and gigabytes per call. The
// secrets inside such a content are its credential cells, registered one by one; a dataset in a
// list gives at most `MAX_CELLS_PER_LISTED_DATASET` of them.

import { describe, expect, it } from 'vitest';

import { ToolError } from '../src/errors.js';
import type { HttpClient } from '../src/http/client.js';
import { callOperation, MAX_WHOLE_SECRET_LENGTH } from '../src/http/operation.js';
import { MAX_CELLS_PER_LISTED_DATASET } from '../src/security/datasetCells.js';
import { createLogger } from '../src/log.js';
import { CallSecretScope } from '../src/workspace/secrets.js';

const LIST_FEEDERS = 'list_feeders_api_v1_projects__project_id__gatling_feeders_get';
const GET_PROJECT = 'get_project_api_v1_projects__project_id__get';
const CELL = 'Pw-cell-7f3a9c21';

/** A client whose one answer is `data` (`callOperation` sends through `request`). */
function answering(data: unknown): HttpClient {
  return {
    request: () => Promise.resolve({ data, response: new Response() }),
  } as unknown as HttpClient;
}

function scope(): { secrets: CallSecretScope; added: string[] } {
  const added: string[] = [];
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const add = secrets.add.bind(secrets);
  secrets.add = (value: string) => {
    added.push(value);
    return add(value);
  };
  return { secrets, added };
}

/** A CSV of accounts of about `bytes` bytes; the first row holds `CELL` as its password. */
function accounts(bytes: number): string {
  const rows = ['email,password', `first@example.com,${CELL}`];
  let size = rows[0]?.length ?? 0;
  for (let i = 0; size < bytes; i += 1) {
    const row = `user-${String(i)}@example.com,pw-${String(i).padStart(8, '0')}`;
    rows.push(row);
    size += row.length + 1;
  }
  return `${rows.join('\n')}\n`;
}

function feederList(content: string): unknown {
  return {
    feeders: [
      {
        id: 'd1',
        name: 'konta',
        feeder_type: 'csv',
        columns: ['email', 'password'],
        column_semantics: { email: 'identity', password: 'credential' },
        content,
      },
    ],
    total: 1,
  };
}

const params = { path: { project_id: 'p1' } } as const;

describe('callOperation: large secret values', () => {
  it('registers a listed 2 MB dataset content by its first cells, not whole, within a time budget', async () => {
    const content = accounts(2 * 1024 * 1024);
    const { secrets, added } = scope();
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    await callOperation(answering(feederList(content)), LIST_FEEDERS, params, { secrets });
    const elapsed = performance.now() - started;
    const grown = process.memoryUsage().heapUsed - before;
    expect(added).not.toContain(content);
    expect(added.every((value) => value.length <= MAX_WHOLE_SECRET_LENGTH)).toBe(true);
    expect(added.length).toBeLessThanOrEqual(MAX_CELLS_PER_LISTED_DATASET);
    // A credential cell of the content is still a secret of the call.
    expect(secrets.scrub(`password was ${CELL} here`)).not.toContain(CELL);
    expect(elapsed).toBeLessThan(1000);
    expect(grown).toBeLessThan(256 * 1024 * 1024);
  });

  it('still registers a secret field whole up to the limit', async () => {
    const value = `k-${'x'.repeat(MAX_WHOLE_SECRET_LENGTH - 2)}`;
    const { secrets, added } = scope();
    await callOperation(
      answering({ id: 'p1', name: 'shop', variables: { api_secret: value } }),
      GET_PROJECT,
      params,
      { secrets },
    );
    expect(added).toContain(value);
  });

  it('leaves out a secret field longer than the limit', async () => {
    const value = 'y'.repeat(MAX_WHOLE_SECRET_LENGTH + 1);
    const { secrets, added } = scope();
    await callOperation(
      answering({ id: 'p1', name: 'shop', variables: { api_secret: value } }),
      GET_PROJECT,
      params,
      { secrets },
    );
    expect(added).not.toContain(value);
  });
});

describe('callOperation: a JSON answer of success without a body', () => {
  it('is a bad_gateway error, as the hand-written readers had it', async () => {
    const { secrets } = scope();
    const error = await callOperation(answering(undefined), GET_PROJECT, params, {
      secrets,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('bad_gateway');
  });
});
