// The mask of a recorded request: values of secret fields are replaced in every shape a body, an
// address or a text can have them in, the shape around them stays, and every replaced value is
// returned to be registered with the secret scope of the call.

import { describe, expect, it } from 'vitest';

import {
  headerNames,
  headerSecrets,
  maskBody,
  maskText,
  maskUrl,
} from '../../src/security/traceMask.js';

const S = 'S3CRET-value-91';

describe('maskBody', () => {
  it.each([
    [
      'JSON at any depth, a number under a secret name too',
      JSON.stringify({
        user: 'a@example.com',
        auth: { password: S, pin: 123456, keep: true },
        credentials: { login: 'a', list: [S] },
      }),
      '{"user":"a@example.com","auth":{"password":"[redacted]","pin":"[redacted]","keep":true},' +
        '"credentials":{"login":"[redacted]","list":["[redacted]"]}}',
      [S, '123456'],
    ],
    [
      'JSON with a secret field below a plain one',
      JSON.stringify({ account: { password: S, remember: true } }),
      '{"account":{"password":"[redacted]","remember":true}}',
      [S],
    ],
    [
      'JSON cut short by the length limit of the record',
      `{"error":"bad","refresh_token":"${S}","items":[1,2`,
      '{"error":"bad","refresh_token":"[redacted]"…',
      // Hidden to the end: where the value ends is not known, so nothing is registered.
      [],
    ],
    [
      'JSON cut inside the secret itself',
      `{"error":"bad","access_token":"${S.slice(0, 9)}`,
      '{"error":"bad","access_token":"[redacted]"…',
      [],
    ],
    [
      'a urlencoded form',
      `user=a%40example.com&password=${encodeURIComponent(S)}&next=%2F`,
      'user=a%40example.com&password=[redacted]&next=%2F',
      [S],
    ],
    [
      'a multipart form',
      ['--b', 'Content-Disposition: form-data; name="password"', '', S, '--b--'].join('\r\n'),
      ['--b', 'Content-Disposition: form-data; name="password"', '', '[redacted]', '--b--'].join(
        '\r\n',
      ),
      [S],
    ],
    [
      'a plain text with pairs and a bearer credential',
      `denied: token=${S}; Authorization: Bearer ${S}x`,
      'denied: token=[redacted]; Authorization: Bearer [redacted]',
      [S, `${S}x`],
    ],
  ])('%s', (_name, input, expected, secrets) => {
    const masked = maskBody(input, input.startsWith('denied') ? 'text/plain' : null);
    expect(masked.kind).toBe('shown');
    if (masked.kind !== 'shown') return;
    expect(masked.text).toBe(expected);
    for (const secret of secrets) expect(masked.secrets).toContain(secret);
  });

  it('keeps fields whose names only look alike', () => {
    const body = JSON.stringify({ passed: 3, keyboard: 'qwerty', token_endpoint: '/oauth/token' });
    expect(maskBody(body)).toEqual({ kind: 'shown', text: body, secrets: [] });
  });

  it('keeps identifiers: a UUID, a number, a hex id of 32 digits, a plain long word', () => {
    const body = JSON.stringify({
      id: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61',
      trace: '4bf92f3577b34da6a3ce929d0e0e4736',
      total: 123456789,
      path: '/api/v1/products/categories/electronics/accessories',
    });
    expect(maskBody(body)).toEqual({ kind: 'shown', text: body, secrets: [] });
  });

  it.each([
    ['a body of an unknown type', 'id|x|y', 'application/x-custom'],
    ['plain text without a text type', 'access granted to X', null],
    ['binary bytes', '\u0000\u0001PNG', 'image/png'],
  ])('hides %s whole and says what it was', (_name, input, type) => {
    expect(maskBody(input, type)).toEqual({
      kind: 'hidden',
      type,
      bytes: Buffer.byteLength(input, 'utf8'),
    });
  });
});

describe('maskText and maskUrl', () => {
  it('masks the password of an address and the secret query parameters, nothing else', () => {
    const url = `https://user:${S}@api.example.com/login?api_key=${S}&lang=pl&page=2`;
    const masked = maskUrl(url);
    expect(masked.text).toBe(
      'https://user:[redacted]@api.example.com/login?api_key=[redacted]&lang=pl&page=2',
    );
    expect(masked.secrets).toContain(S);
  });

  it('masks a JSON Web Token wherever it stands', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl';
    expect(maskText(`got ${jwt} back`).text).toBe('got [redacted] back');
  });

  it('does not take the scheme of a credential for the credential', () => {
    const masked = maskText('authorization: Bearer abcdefghijkl');
    expect(masked.text).toBe('authorization: Bearer [redacted]');
    expect(masked.secrets).not.toContain('Bearer');
  });
});

describe('headers', () => {
  const lines = [
    'Content-Type: application/json',
    `Authorization: Bearer ${S}`,
    `Cookie: lang=pl; sid=${S}; theme=darkmodeon`,
    `X-Api-Key: ${S}k`,
    'Set-Cookie: <redacted>',
    'X-Cut-Na',
    'content-type: text/plain',
  ].join('\n');

  it('lists each name once, in order, without values', () => {
    expect(headerNames(lines)).toEqual([
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Api-Key',
      'Set-Cookie',
    ]);
  });

  it('returns the credential values to register, never what the backend already masked', () => {
    const secrets = headerSecrets(lines);
    expect(secrets).toContain(S);
    expect(secrets).toContain(`Bearer ${S}`);
    expect(secrets).toContain(`${S}k`);
    // A long cookie value is a session until proven otherwise; a short plain one is not.
    expect(secrets).toContain('darkmodeon');
    expect(secrets).not.toContain('pl');
    expect(secrets).not.toContain('application/json');
    expect(secrets.some((value) => value.includes('<redacted>'))).toBe(false);
  });
});
