// The one rule that says a field name holds a secret (`isSecretField`): the HTTP client masks error
// bodies by it, the HAR import and the secret-name paths (`*secret`, `[secret]`) of the contract read
// it. A table of names that must count, and of look-alike names that must not.

import { describe, expect, it } from 'vitest';

import {
  hideSecretFields,
  isSecretField,
  secretFieldMasker,
  secretFieldValues,
  VARIABLE_REFERENCE,
} from '../../src/security/secretFields.js';
import { maskText } from '../../src/security/traceMask.js';
import { leakedPieces } from '../helpers/canary.js';

const SECRET = [
  'password',
  'db_pass',
  'api_key',
  'x-api-key',
  'X-Tenant-Key',
  'x_signing_key',
  'Authorization',
  'set-cookie',
  'access_token',
  'client_secret',
  'session',
  'session_id',
  'X-Session-Token',
  'sid',
  'connect.sid',
  'SID',
  'jwt',
  'id_jwt',
  'bearer',
  'BearerToken',
  'signature',
  'X-Signature',
  'signing_secret',
  'webhook_signing',
  'key',
  'auth',
  'X-Auth',
  'totp',
  'mfa_code',
  'verification_code',
  'code_verifier',
  '_csrf',
  'nonce',
  'SAMLResponse',
  'cvv',
  'X-CSRF',
  'saml_assertion',
  'client_assertion',
  'device_code',
  'authorization_code',
];

const PLAIN = [
  'sidebar',
  'side',
  'inside',
  'residual',
  'keyboard',
  'monkey',
  'key_name',
  'keys',
  'hotkeys',
  'passed',
  'shipping',
  'hotpath',
  'name',
  'accept',
  'content-type',
  'token_endpoint',
  'auth_type',
  'author',
  'oauth',
  'uses_csrf',
  'code',
  'assertions',
  'failed_assertions',
  'assertion_message',
  'suggested_assertions',
  'assertion_thresholds',
];

describe('isSecretField: names that hold a secret', () => {
  it.each(SECRET)('%s counts', (name) => {
    expect(isSecretField(name)).toBe(true);
  });

  it.each(PLAIN)('%s does not', (name) => {
    expect(isSecretField(name)).toBe(false);
  });
});

// A field that names the kind of a value (`auth_type`, `token_type`, `scheme`) holds a word like
// `none` or `bearer`, not a secret. Registered, that word was masked in every text of the call.
const JWT_CANARY =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnktc3ViamVjdCJ9.c2lnbmF0dXJlLWNhbmFyeS0xMjM0';
const KEY_CANARY = 'key-canary-7f3a9c2e51d8';

const EFFECTIVE = {
  auth: {
    auth_type: 'bearer',
    auth_config: { token: JWT_CANARY, api_key: KEY_CANARY },
  },
  description: 'The target answers bearer tokens and basic logins.',
};

describe('secretFieldValues: the kind of a secret is not the secret', () => {
  it.each(['auth_type', 'token_type', 'type', 'kind', 'scheme', 'auth-scheme'])(
    '%s is not a secret field',
    (name) => {
      expect(isSecretField(name)).toBe(false);
    },
  );

  it('registers the credentials of an auth object and not its type', () => {
    const values = secretFieldValues(EFFECTIVE);
    expect(values).toEqual(expect.arrayContaining([JWT_CANARY, KEY_CANARY]));
    expect(values).not.toContain('bearer');
  });

  it('leaves the word bearer in another field of the same answer', () => {
    const masker = secretFieldMasker(EFFECTIVE);
    expect(masker).toBeDefined();
    const text = `${EFFECTIVE.description} type: bearer, token: ${JWT_CANARY}, key: ${KEY_CANARY}`;
    const shown = masker?.text(text) ?? '';
    expect(shown).toContain('answers bearer tokens and basic logins');
    expect(shown).toContain('type: bearer');
    expect(leakedPieces(shown, [JWT_CANARY])).toEqual([]);
    expect(shown).not.toContain(KEY_CANARY);
  });

  it('keeps the type and redacts the credentials when the fields are hidden', () => {
    const masker = secretFieldMasker(EFFECTIVE);
    if (masker === undefined) throw new Error('no masker');
    const hidden = hideSecretFields(EFFECTIVE, masker);
    expect(hidden.auth.auth_type).toBe('bearer');
    expect(leakedPieces(JSON.stringify(hidden), [JWT_CANARY])).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain(KEY_CANARY);
  });

  it('registers a value under a kind field when it is not a word', () => {
    const body = { auth: { auth_type: { value: JWT_CANARY }, scheme: [KEY_CANARY] } };
    expect(secretFieldValues(body)).toEqual(expect.arrayContaining([JWT_CANARY, KEY_CANARY]));
    const masker = secretFieldMasker(body);
    if (masker === undefined) throw new Error('no masker');
    expect(leakedPieces(JSON.stringify(hideSecretFields(body, masker)), [JWT_CANARY])).toEqual([]);
    expect(leakedPieces(masker.text(`seen ${JWT_CANARY}`), [JWT_CANARY])).toEqual([]);
  });

  it('still registers every other string of an object of a secret name', () => {
    expect(secretFieldValues({ cookie: { name: 'sid', value: 'cookie-value-1234' } })).toContain(
      'cookie-value-1234',
    );
  });
});

// A field of a secret name that holds names, not values (FIX-68): the operations a token covers
// (`token_operations`, a list of `METHOD /path`), the reasons of a session estimate, the names of
// variables no step consumes, the id of an endpoint. Registered, every operation name was cut out of
// every text of the call.
const API_MAP = {
  areas: [
    {
      name: 'Cart',
      token_operations: ['GET /cart', 'POST /auth/password/reset'],
      outside_area_token_operations: ['DELETE /cart/items/{item_id}'],
    },
  ],
  session_reasons: ['no login step in the journey'],
  auth_credentials_without_consumer: ['LC_AUTH_TOKEN', 'LC_AUTH_PASSWORD'],
  token_endpoint_id: 'endpoint-7c21',
  token_endpoint_ids: ['endpoint-7c22'],
  token: JWT_CANARY,
};

describe('secretFieldValues: a field of names is not a secret', () => {
  it('registers no operation, reason, variable name or endpoint id, and still the token', () => {
    const values = secretFieldValues(API_MAP);
    expect(values).toEqual([JWT_CANARY]);
  });

  it('shows them when the fields are hidden', () => {
    const masker = secretFieldMasker(API_MAP);
    if (masker === undefined) throw new Error('no masker');
    const hidden = hideSecretFields(API_MAP, masker);
    expect(hidden.areas[0]?.token_operations).toEqual(['GET /cart', 'POST /auth/password/reset']);
    expect(hidden.session_reasons).toEqual(API_MAP.session_reasons);
    expect(hidden.auth_credentials_without_consumer).toEqual(['LC_AUTH_TOKEN', 'LC_AUTH_PASSWORD']);
    expect(hidden.token_endpoint_id).toBe('endpoint-7c21');
    expect(hidden.token).toBe('[redacted]');
    expect(masker.text('calls GET /cart with the token')).toBe('calls GET /cart with the token');
  });

  it('reads an object or a list of objects under such a name as any field of a secret name', () => {
    for (const body of [
      { token_operations: { value: JWT_CANARY } },
      { token_operations: [{ token: JWT_CANARY }] },
      { session_reasons: ['fine', { value: KEY_CANARY }] },
    ]) {
      const values = secretFieldValues(body);
      expect(values.some((value) => value === JWT_CANARY || value === KEY_CANARY)).toBe(true);
    }
  });

  it.each([
    'token_ops',
    'session_reason_text',
    'secret_operation',
    'session_id',
    'token_id',
    'password_vars_value',
  ])('keeps %s, whose name does not end in a word of names, a secret field', (name) => {
    expect(secretFieldValues({ [name]: ['value-canary-1234'] })).toEqual(['value-canary-1234']);
  });

  it('keeps the name rule itself: the secret-name paths of the contract still match these names', () => {
    for (const name of ['token_operations', 'session_reasons', 'token_endpoint_id'])
      expect(isSecretField(name)).toBe(true);
  });
});

describe('secretFieldValues: the metadata of a list under a secret name in LoadCraft’s own answer', () => {
  const TOKENS = {
    tokens: [
      {
        id: '0d0c7034-0005-4000-8000-000000000002',
        label: 'old',
        prefix: 'lcp_9f00',
        created_at: '2026-11-01T08:00:00Z',
        created_by: 'user-1',
        last_used_at: '2026-11-26T03:00:00.123456+00:00',
        revoked_at: '2026-11-10T08:00:00Z',
        token_id: 'a1b2c3d4e5f6a7b8',
        last_outcome: 'accepted',
        last_refusal_codes: ['packet_too_old_x9'],
        token: KEY_CANARY,
        secret: JWT_CANARY,
      },
    ],
  };

  it('does not register its times, ids, author, outcome and codes, but still its token and secret', () => {
    const values = secretFieldValues(TOKENS, { ownContract: true });
    expect(values).toEqual(expect.arrayContaining([KEY_CANARY, JWT_CANARY, 'lcp_9f00']));
    for (const kept of [
      '0d0c7034-0005-4000-8000-000000000002',
      '2026-11-01T08:00:00Z',
      '2026-11-26T03:00:00.123456+00:00',
      '2026-11-10T08:00:00Z',
      'user-1',
      'a1b2c3d4e5f6a7b8',
      'accepted',
      'packet_too_old_x9',
      'old',
    ]) {
      expect(values).not.toContain(kept);
    }
  });

  it('leaves a label to the mask by shape: a label that is a JWT is not registered here, content() masks it', () => {
    const values = secretFieldValues(
      { tokens: [{ label: JWT_CANARY, created_at: '2026-11-01T08:00:00Z' }] },
      { ownContract: true },
    );
    expect(values).not.toContain(JWT_CANARY);
    expect(leakedPieces(maskText(JWT_CANARY).text, [JWT_CANARY])).toEqual([]);
  });

  it('keeps every value a secret in a third party’s text, and a field of a secret name itself', () => {
    const third = secretFieldValues(TOKENS);
    expect(third).toEqual(expect.arrayContaining(['2026-11-01T08:00:00Z', 'a1b2c3d4e5f6a7b8']));
    // the rule is for what sits under the container, not for the container's own value
    expect(secretFieldValues({ session_id: 'sess-1a2b3c4d5e6f' }, { ownContract: true })).toEqual([
      'sess-1a2b3c4d5e6f',
    ]);
    expect(
      secretFieldValues({ access_token: '2026-11-01T08:00:00Z' }, { ownContract: true }),
    ).toEqual(['2026-11-01T08:00:00Z']);
  });
});

describe('a shell variable as the whole value is a reference, never a secret', () => {
  it.each(['$LOADCRAFT_INGEST_TOKEN', 'Bearer $LOADCRAFT_INGEST_TOKEN', '$API_KEY_2'])(
    '%s is a reference',
    (value) => {
      expect(VARIABLE_REFERENCE.test(value)).toBe(true);
    },
  );

  it.each([
    '$',
    '$AB',
    '$abc123secret',
    '$1ABC',
    '$TOKEN-1',
    'lcp_9f00ab12cd34ef56',
    'x $TOKEN_NAME',
  ])('%s is not', (value) => {
    expect(VARIABLE_REFERENCE.test(value)).toBe(false);
  });

  it('keeps Bearer $LOADCRAFT_INGEST_TOKEN in a command and masks a real token and a lowercase one', () => {
    const command = '-H "Authorization: Bearer $LOADCRAFT_INGEST_TOKEN"';
    expect(maskText(command).text).toBe(command);
    expect(maskText('Authorization: Bearer lcp_9f00ab12cd34ef56gh78').text).not.toContain(
      'lcp_9f00ab12cd34ef56gh78',
    );
    expect(maskText('Authorization: Bearer $abc123secret').text).not.toContain('abc123secret');
  });
});
