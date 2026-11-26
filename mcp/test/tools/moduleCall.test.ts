// The helpers a module tool reads the backend with: the secrets of an answer are known to the scope
// of the call before the view sees the data, a third party's text loses what the scope knows before
// the shapes of secrets are masked, and a body the mask cannot read is hidden whole.

import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../../src/http/client.js';
import { createLogger } from '../../src/log.js';
import { body, callBackend, content } from '../../src/tools/moduleCall.js';
import { CallSecretScope } from '../../src/workspace/secrets.js';
import { CANARY } from '../helpers/canary.js';

const NOTES = 'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get';

function scope(): CallSecretScope {
  return new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
}

/** An HTTP client that answers every request with `data`, the way openapi-fetch hands it back. */
function answering(data: unknown, seen: string[] = []): HttpClient {
  const client = {
    request(method: string, path: string): Promise<{ data: unknown; response: Response }> {
      seen.push(`${method} ${path}`);
      return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
    },
  };
  return client as unknown as HttpClient;
}

describe('callBackend', () => {
  it('registers the value of every field of a secret name in the answer, at any depth', async () => {
    const secrets = scope();
    const seen: string[] = [];
    const answer = [{ text: 'a note', meta: { api_token: 'tok-1234567890abcdef' } }];
    const http = answering(answer, seen);
    const data = await callBackend(
      { services: { http, links: {} as never }, signal: new AbortController().signal, secrets },
      NOTES,
      { path: { project_id: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61' } },
    );
    expect(seen).toEqual(['GET /api/v1/projects/{project_id}/agent-guidance']);
    expect(data).toEqual(answer);
    expect(secrets.scrub('the token tok-1234567890abcdef')).not.toContain('tok-1234567890abcdef');
  });
});

describe('content', () => {
  it('keeps a secret the scope knows out whole, also where a mask by shape would cut it', () => {
    const secrets = scope();
    secrets.add(CANARY);
    const shown = content({ secrets }, `Accept the banner (${CANARY}) and go on`);
    expect(shown).not.toContain(CANARY.slice(0, 8));
    expect(shown).toContain('Accept the banner');
  });

  it('masks a value its words name and registers it', () => {
    const secrets = scope();
    const shown = content({ secrets }, 'Sign in with\npassword: Hunter-2-correct-horse');
    expect(shown).not.toContain('Hunter-2-correct-horse');
    expect(shown).not.toContain('\n');
    expect(secrets.scrub('Hunter-2-correct-horse')).not.toContain('Hunter-2-correct-horse');
  });
});

describe('body', () => {
  it('hides a body the mask cannot read, whole', () => {
    expect(body({ secrets: scope() }, '\u0000\u0001binary', 'application/octet-stream')).toEqual({
      kind: 'hidden',
      type: 'application/octet-stream',
      bytes: 8,
    });
  });

  it('shows a JSON body with the values of secret fields replaced', () => {
    const shown = body({ secrets: scope() }, '{"user":"ann","password":"Pw-77-secret"}', null);
    expect(shown.kind).toBe('shown');
    expect(JSON.stringify(shown)).not.toContain('Pw-77-secret');
  });
});
