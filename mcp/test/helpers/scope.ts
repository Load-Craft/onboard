import type { SecretScope } from '../../src/secret.js';
import { Secret } from '../../src/secret.js';

/** A scope that masks nothing. For tests that need a scope but do not exercise masking. */
export function noopSecretScope(): SecretScope {
  return {
    add: (value: string) => new Secret(value),
    scrub: (text: string) => text,
    scrubDeep: <T>(value: T): T => value,
    containsSecret: () => false,
    incomplete: false,
    markIncomplete: () => undefined,
  };
}
