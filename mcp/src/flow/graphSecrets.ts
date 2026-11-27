// A graph a model writes (`flows_save`) is checked for a secret before anything is sent: a literal that
// is the value of a field of a secret name (a header, a body field or a variable named like a token, a
// password, a key) or that has the shape of a credential. A reference to a variable (`#{token}`,
// `{{token}}`) is how a flow should carry a value, so it is no literal. The answer names where the
// secret sits (the path), never the value.

import { isSecretField } from '../security/secretFields.js';
import { maskText } from '../security/traceMask.js';

const REFERENCE = /(?:#\{|\{\{)[A-Za-z_][A-Za-z0-9_]*\}?\}/gu;

const SCHEME = /^(?:bearer|basic|token|digest|apikey)\s*/iu;

/** A string with its references and a leading auth scheme word taken out: what is left is the literal part. */
const literalOf = (value: string): string =>
  value.replace(REFERENCE, '').trim().replace(SCHEME, '');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The path of the first secret literal in `value` (`blocks[0].config.headers.x-api-key`), or undefined. */
export function secretInGraph(value: unknown, path = ''): string | undefined {
  if (typeof value === 'string') {
    const literal = literalOf(value);
    if (literal.length >= 4 && maskText(literal).secrets.length > 0) return path;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = secretInGraph(item, `${path}[${String(index)}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (typeof item === 'string' && isSecretField(key) && literalOf(item) !== '') return here;
    const found = secretInGraph(item, here);
    if (found !== undefined) return found;
  }
  return undefined;
}
