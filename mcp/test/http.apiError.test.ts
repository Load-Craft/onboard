import { describe, expect, it } from 'vitest';

import { ToolError } from '../src/errors.js';
import { apiErrorInit, LoadcraftApiError } from '../src/http/apiError.js';

describe('LoadcraftApiError', () => {
  it('is a ToolError carrying status, code, message, details and retryable', () => {
    const cause = new Error('socket closed');
    const error = new LoadcraftApiError({
      status: 409,
      code: 'setup_incomplete',
      message: 'Setup is incomplete.',
      details: { missing: ['profile'] },
      retryable: true,
      cause,
    });
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'setup_incomplete',
      message: 'Setup is incomplete.',
      details: { missing: ['profile'] },
      retryable: true,
    });
    expect(error.cause).toBe(cause);
  });

  it('is not retryable and has no details unless given', () => {
    const error = new LoadcraftApiError({ status: 403, code: 'forbidden', message: 'No access.' });
    expect(error.retryable).toBe(false);
    expect(error.details).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});

describe('apiErrorInit with a plain-text detail', () => {
  it('reads a 422 {detail: "text"} (a refused telemetry host) as code invalid with that text', () => {
    const init = apiErrorInit(
      422,
      JSON.stringify({ detail: 'Target host is not allowed: 10.0.0.5 is a private address' }),
    );
    expect(init).toMatchObject({
      status: 422,
      code: 'invalid',
      message: 'Target host is not allowed: 10.0.0.5 is a private address',
    });
  });
});

describe('apiErrorInit: a secret the error body names in a field of a secret name', () => {
  const SECRET = 'PW-SENTINEL-6c1e9b';

  it('masks the value of a `password` field wherever the message quotes it, and in details', () => {
    const init = apiErrorInit(
      409,
      JSON.stringify({
        detail: { code: 'conflict', message: `account exists with ${SECRET}`, password: SECRET },
      }),
    );
    expect(init.code).toBe('conflict');
    expect(init.message).toBe('account exists with [redacted]');
    expect(init.details).toEqual({ password: '[redacted]' });
  });

  it('masks a URL in a field of a secret name (`password_url`): an address can carry the secret', () => {
    const url = `https://example.com/reset?key=${SECRET}`;
    const init = apiErrorInit(
      409,
      JSON.stringify({ detail: { code: 'conflict', message: `use ${url}`, password_url: url } }),
    );
    expect(init.message).toBe('use [redacted]');
    expect(JSON.stringify(init)).not.toContain(SECRET);
  });

  it('keeps the address of a token endpoint: it names where a token is fetched, not a token', () => {
    const endpoint = 'https://idp.example.com/oauth/token';
    const init = apiErrorInit(
      422,
      JSON.stringify({
        detail: { code: 'invalid', message: `${endpoint} refused`, token_endpoint: endpoint },
      }),
    );
    expect(init.message).toBe(`${endpoint} refused`);
    expect(init.details).toEqual({ token_endpoint: endpoint });
  });

  it.each([
    ['password', ['body', 'password']],
    ['a nested auth_password', ['body', 'environments', 0, 'auth_password']],
    ['api_key', ['body', 'api_key']],
  ])('masks the input of a validation error about %s', (_name, loc) => {
    const init = apiErrorInit(
      422,
      JSON.stringify({
        detail: [
          { type: 'string_too_short', loc, msg: `value ${SECRET} too short`, input: SECRET },
        ],
      }),
    );
    expect(init.message).toContain('[redacted]');
    expect(JSON.stringify(init)).not.toContain(SECRET);
  });

  it('masks every string under a secret field, nested and in lists, and keeps numbers', () => {
    const init = apiErrorInit(
      400,
      JSON.stringify({
        error: 'invalid',
        message: `rejected ${SECRET} and other-${SECRET}-2`,
        credentials: { user: 'anna@example.com', secret: SECRET },
        tokens: [`other-${SECRET}-2`],
        pass_count: 3,
      }),
    );
    expect(JSON.stringify(init)).not.toContain(SECRET);
    expect(init.details).toMatchObject({ pass_count: 3 });
  });

  it.each(['private_key', 'privateKey', 'access_key', 'key', 'pin', 'user_pin', 'otp', 'otp_code'])(
    'masks the value of a field named %s',
    (field) => {
      const init = apiErrorInit(
        409,
        JSON.stringify({ detail: { code: 'conflict', message: `bad ${SECRET}`, [field]: SECRET } }),
      );
      expect(init.message).toBe('bad [redacted]');
      expect(JSON.stringify(init)).not.toContain(SECRET);
    },
  );

  it.each(['key_name', 'shipping', 'hotpath', 'monkey', 'pinned'])(
    'keeps the value of %s: `key`, `pin` and `otp` count only as a whole part of the name',
    (field) => {
      const value = 'visible-value-1234';
      const init = apiErrorInit(
        409,
        JSON.stringify({ detail: { code: 'conflict', message: `bad ${value}`, [field]: value } }),
      );
      expect(init.message).toBe(`bad ${value}`);
    },
  );

  it('leaves an error that names no secret field as it was', () => {
    const init = apiErrorInit(409, JSON.stringify({ detail: 'Flow zakupy already exists.' }));
    expect(init.message).toBe('Flow zakupy already exists.');
  });
});

// A server failure (5xx) and a refused token (401) carry text the plugin cannot vouch for: a stack
// trace, a connection string, the token echoed back. The model gets the code, the status and
// whether a retry can help; the text of the body goes to the log only.
describe('apiErrorInit: statuses whose text never reaches the model', () => {
  const SECRET = 'hunter2-not-registered-anywhere';
  const NOT_QUOTED: readonly number[] = [500, 501, 502, 503, 504, 599, 401];

  /** What of the init reaches the model: everything but the text kept for the log. */
  function modelSees(init: ReturnType<typeof apiErrorInit>): unknown {
    return { ...init, logText: undefined, details: undefined };
  }

  it.each(NOT_QUOTED)('%i: {detail: text} gives the bare status, not the text', (status) => {
    const init = apiErrorInit(
      status,
      JSON.stringify({ detail: `db failed for ${SECRET} at host` }),
    );
    expect(init.message).toBe(`LoadCraft API answered HTTP ${String(status)}.`);
    expect(JSON.stringify(modelSees(init))).not.toContain(SECRET);
    expect(init.status).toBe(status);
  });

  it.each(NOT_QUOTED)('%i: a validation list gives no message', (status) => {
    const init = apiErrorInit(
      status,
      JSON.stringify({ detail: [{ loc: ['body', 'name'], msg: SECRET, input: SECRET }] }),
    );
    expect(JSON.stringify(modelSees(init))).not.toContain(SECRET);
  });

  it.each(NOT_QUOTED)('%i: an envelope loses its message, keeps the retry flag', (status) => {
    const init = apiErrorInit(
      status,
      JSON.stringify({
        error: 'llm_generation_failed',
        message: `provider said ${SECRET}`,
        retryable: true,
        trace: [SECRET],
      }),
    );
    expect(JSON.stringify(modelSees(init))).not.toContain(SECRET);
    expect(init.retryable).toBe(true);
    expect(init.message).toBe(`LoadCraft API answered HTTP ${String(status)}.`);
  });

  it('a 401 keeps no part of the body, a 5xx keeps it as data for the code that parses it', () => {
    const body = JSON.stringify({ detail: { requested: 50, created: 0, failed: 50 } });
    expect(apiErrorInit(401, body).details).toBeUndefined();
    expect(apiErrorInit(502, body).details).toEqual({ requested: 50, created: 0, failed: 50 });
  });

  it('keeps the machine code of a 5xx envelope when it is a plain identifier', () => {
    const init = apiErrorInit(
      503,
      JSON.stringify({ error: 'llm_generation_failed', message: 'x' }),
    );
    expect(init.code).toBe('llm_generation_failed');
  });

  it.each([
    ['text with spaces', `broken ${SECRET}`],
    ['a path', '/srv/app/main.py'],
    ['upper case and digits', `ERR-${SECRET}`],
    ['too long', 'a'.repeat(80)],
  ])('falls back to the code of the status for a 5xx code that is %s', (_name, code) => {
    const init = apiErrorInit(500, JSON.stringify({ error: code, message: 'm' }));
    expect(init.code).toBe('server_error');
  });

  it('a 401 is always unauthorized, whatever code its body names', () => {
    const init = apiErrorInit(401, JSON.stringify({ error: 'token_expired', message: SECRET }));
    expect(init.code).toBe('unauthorized');
    expect(init.message).toBe('LoadCraft API answered HTTP 401.');
  });

  it.each([500, 502, 401])('%i: a body that is not JSON is not quoted', (status) => {
    const init = apiErrorInit(status, `<html><body>Traceback ${SECRET}</body></html>`);
    expect(JSON.stringify(modelSees(init))).not.toContain(SECRET);
    expect(init.message).toBe(`LoadCraft API answered HTTP ${String(status)}.`);
  });

  it('the text goes to logText, on one line, masked by field name and cut short', () => {
    const init = apiErrorInit(
      500,
      JSON.stringify({ detail: `failed\n  for ${SECRET}`, password: SECRET, pad: 'x'.repeat(900) }),
    );
    expect(init.logText).toContain('failed');
    expect(init.logText).not.toContain(SECRET);
    expect(init.logText).not.toContain('\n');
    expect(init.logText?.length).toBeLessThanOrEqual(501);
    expect(init.logText?.endsWith('…')).toBe(true);
  });

  it('a 4xx has no logText: the model gets its text', () => {
    expect(apiErrorInit(422, JSON.stringify({ detail: 'x' })).logText).toBeUndefined();
  });

  it('an empty body and the status code stay as they were', () => {
    expect(apiErrorInit(500, '')).toMatchObject({ status: 500, code: 'server_error' });
    expect(apiErrorInit(502, '   ')).toMatchObject({ code: 'bad_gateway', retryable: true });
  });

  it.each([
    [400, 'invalid'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid'],
    [429, 'rate_limited'],
  ])('%i keeps quoting the text of the backend (code %s)', (status, code) => {
    const init = apiErrorInit(
      status,
      JSON.stringify({ detail: 'Name must be unique in the project' }),
    );
    expect(init.code).toBe(code);
    expect(init.message).toBe('Name must be unique in the project');
  });

  it('a 4xx that names a secret field is still masked, not withheld', () => {
    const init = apiErrorInit(
      422,
      JSON.stringify({
        detail: [{ loc: ['body', 'password'], msg: `rejected ${SECRET}`, input: SECRET }],
      }),
    );
    expect(init.message).toContain('[redacted]');
    expect(JSON.stringify(modelSees(init))).not.toContain(SECRET);
  });
});
