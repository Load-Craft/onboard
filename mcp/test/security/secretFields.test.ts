// The one rule that says a field name holds a secret (`isSecretField`): the HTTP client masks error
// bodies by it, the HAR import and the secret-name paths (`*secret`, `[secret]`) of the contract read
// it. A table of names that must count, and of look-alike names that must not.

import { describe, expect, it } from 'vitest';

import { isSecretField } from '../../src/security/secretFields.js';

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
