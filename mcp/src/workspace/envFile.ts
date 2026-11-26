// Reads a test account (email + password) from a dotenv file inside the project. The model passes
// only the file path and key names; the password becomes a `Secret` and the file content is never
// returned, logged or quoted in an error.

import { basename } from 'node:path';
import { ToolError } from '../errors.js';
import { decodeUtf8, openChecked, readLimited, type FileLimit } from './fileRead.js';
import { relativeToWorkspace, resolveInside } from './paths.js';
import type { Secret, SecretScope } from '../secret.js';

export interface EnvAccountKeys {
  emailKey?: string;
  passwordKey?: string;
}

export interface EnvAccount {
  email: string;
  password: Secret;
  keys: { email: string; password: string };
}

const DEFAULT_EMAIL_KEY = 'TEST_USER_EMAIL';
const DEFAULT_PASSWORD_KEY = 'TEST_USER_PASSWORD';
const ENV_LIMIT: FileLimit = { bytes: 256 * 1024, label: '256 KB' };
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** `.env`, `.env.<suffix>` or `<name>.env`. */
export function isEnvFileName(name: string): boolean {
  return name === '.env' || /^\.env\..+$/.test(name) || /^.+\.env$/.test(name);
}

function lastSegment(input: string): string {
  return basename(input.replace(/[\\/]+$/, ''));
}

function notEnvFile(shown: string): ToolError {
  return new ToolError('env_file_not_allowed', {
    params: { file: shown },
  });
}

async function readEnvText(root: string, input: string): Promise<{ text: string; shown: string }> {
  // The name is checked before the file system is touched, so other files are not even probed.
  if (!isEnvFileName(lastSegment(input))) throw notEnvFile(lastSegment(input));
  const path = resolveInside(root, input);
  const shown = relativeToWorkspace(root, path);
  // A symlink named like an env file must not lead to a file of another kind.
  if (!isEnvFileName(basename(path))) throw notEnvFile(shown);

  const { handle } = await openChecked(path, shown, { limit: ENV_LIMIT });
  let bytes: Buffer;
  try {
    bytes = await readLimited(handle, shown, ENV_LIMIT);
  } finally {
    await handle.close();
  }
  try {
    return { text: decodeUtf8(bytes, shown), shown };
  } finally {
    bytes.fill(0);
  }
}

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function isLineEnd(ch: string | undefined): boolean {
  return ch === '\n' || ch === '\r';
}

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

/**
 * Dotenv parser: `KEY=value`, `export KEY=value`, single quotes (literal), double quotes (with
 * `\n`, `\r`, `\t`, `\"`, `\\`), each closed on its own line; `#` comments on their own line or
 * after an unquoted value when preceded by whitespace (`pa#ss` stays a value); blank lines.
 * No variable interpolation. Lines that are not assignments are skipped. A later assignment of the
 * same key wins.
 */
export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let i = 0;
  const n = text.length;

  const skipToLineEnd = (): void => {
    while (i < n && !isLineEnd(text[i])) i += 1;
  };

  while (i < n) {
    while (i < n && (isBlank(text[i]) || isLineEnd(text[i]))) i += 1;
    if (i >= n) break;
    if (text[i] === '#') {
      skipToLineEnd();
      continue;
    }

    const lineStart = i;
    while (i < n && !isLineEnd(text[i]) && text[i] !== '=') i += 1;
    if (text[i] !== '=') {
      skipToLineEnd();
      continue;
    }
    let key = text.slice(lineStart, i).trim();
    if (key.startsWith('export') && isBlank(key[6])) key = key.slice(7).trim();
    i += 1;
    const afterEquals = i;
    while (i < n && isBlank(text[i])) i += 1;

    let value: string;
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      let out = '';
      let closed = false;
      while (i < n && !isLineEnd(text[i])) {
        const ch = text[i] ?? '';
        if (ch === quote) {
          closed = true;
          i += 1;
          break;
        }
        if (quote === '"' && ch === '\\' && i + 1 < n && !isLineEnd(text[i + 1])) {
          const next = text[i + 1] ?? '';
          const mapped = DOUBLE_QUOTE_ESCAPES[next];
          out += mapped ?? `\\${next}`;
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
      }
      if (!closed) {
        // A quote not closed on its own line skips that line only.
        continue;
      }
      skipToLineEnd();
      value = out;
    } else {
      skipToLineEnd();
      let raw = text.slice(afterEquals, i);
      const comment = /[ \t]#/.exec(raw);
      if (comment !== null) raw = raw.slice(0, comment.index);
      value = raw.trim();
    }
    if (KEY_PATTERN.test(key)) values.set(key, value);
  }
  return values;
}

export function checkKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new ToolError('env_key_invalid');
  }
}

/** Reads an email and a password from an env file inside `root`; the password is added to `scope`. */
export async function readAccountFromEnv(
  root: string,
  relPath: string,
  scope: SecretScope,
  options: EnvAccountKeys = {},
): Promise<EnvAccount> {
  const emailKey = options.emailKey ?? DEFAULT_EMAIL_KEY;
  const passwordKey = options.passwordKey ?? DEFAULT_PASSWORD_KEY;
  checkKey(emailKey);
  checkKey(passwordKey);

  const { text, shown } = await readEnvText(root, relPath);
  const values = parseEnv(text);
  const email = values.get(emailKey) ?? '';
  const password = values.get(passwordKey) ?? '';
  values.clear();

  const missing = [emailKey, passwordKey].filter((key, index) =>
    index === 0 ? email === '' : password === '',
  );
  if (missing.length > 0) {
    const names = missing.join(' and ');
    throw new ToolError('env_key_missing', {
      details: { file: shown, keys: missing },
      params: { file: shown, names },
    });
  }

  return {
    email,
    password: scope.add(password),
    keys: { email: emailKey, password: passwordKey },
  };
}

/**
 * The values of `keys` from an env file inside `root`, each added to `scope` (masked from then on).
 * A key that is absent or empty is left out of the answer: the caller names it in its own error.
 * `shown` is the path as the workspace spells it, for that error.
 */
export async function readEnvValues(
  root: string,
  relPath: string,
  keys: readonly string[],
  scope: SecretScope,
): Promise<{ values: Map<string, Secret>; shown: string }> {
  for (const key of keys) checkKey(key);
  const { text, shown } = await readEnvText(root, relPath);
  const parsed = parseEnv(text);
  const values = new Map<string, Secret>();
  for (const key of keys) {
    const value = parsed.get(key) ?? '';
    if (value !== '' && !values.has(key)) values.set(key, scope.add(value));
  }
  parsed.clear();
  return { values, shown };
}

/** Every non-empty value of an env file inside `root`; for masking, never for display. */
export async function readEveryEnvValue(root: string, relPath: string): Promise<string[]> {
  const { text } = await readEnvText(root, relPath);
  const parsed = parseEnv(text);
  const values = [...parsed.values()].filter((value) => value !== '');
  parsed.clear();
  return values;
}
