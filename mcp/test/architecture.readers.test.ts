// Every Zod reader of a backend answer or frame, in src/api and src/ws, is registered with the
// contract check: wrapped in `reads()`, `readsTable()` or `sendsTable()`. A reader nobody
// registered would not notice when the contract changes. Where the contract is an open object
// (`{[key: string]: unknown}`) the check has nothing to compare, and that is fine: the reader is
// registered and starts to work when the contract is described.
//
// A reader is a Zod value that is parsed: a declared one (at the top of a file or in a function,
// written with `z.` or built by a helper) that no other Zod value or registered reader uses, one
// that is parsed with `.parse()` / `.safeParse()` on its own even if it is also a part of a
// bigger reader, or a Zod expression parsed on the spot. The exceptions below say why one is not
// data of the backend.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { findReaders } from './helpers/readerScan.js';

const SRC = resolve(import.meta.dirname, '..', 'src');

/** `file:name` (or `file:inline@line`) -> why it is not a reader of a backend answer. */
const EXCEPTIONS: Readonly<Record<string, string>> = {};

function filesOf(dir: string): string[] {
  return readdirSync(join(SRC, dir))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(SRC, dir, name));
}

describe('every reader of a backend answer or frame is registered with the contract check', () => {
  const all = findReaders([...filesOf('api'), ...filesOf('ws')], SRC);

  it('finds the readers', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('has none outside reads(), readsTable() and sendsTable() but the listed exceptions', () => {
    const loose = all
      .filter((reader) => !reader.wrapped && !(reader.key in EXCEPTIONS))
      .map((r) => r.key);
    expect(loose).toEqual([]);
  });

  it('lists no exception that is no longer a reader', () => {
    const keys = new Set(all.map((reader) => reader.key));
    expect(Object.keys(EXCEPTIONS).filter((key) => !keys.has(key))).toEqual([]);
  });
});

describe('the reader scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-readers-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const PLANTED = `
import * as z from 'zod';
import { reads } from '${SRC}/contract/reads.ts';

interface Answer { id: string; item: { name: string } }

const nullable = <T extends z.ZodType>(schema: T) => schema.nullish();

// registered, with a part that only it uses
const itemPart = z.object({ name: z.string() });
const registered = reads<Answer>()(z.object({ id: z.string(), item: itemPart }));

// a part of a registered reader that is also parsed on its own
const sharedPart = z.object({ name: z.string() });
const holder = reads<Answer>()(z.object({ item: sharedPart }));

// a part used in shorthand
const name = z.string();
const shorthand = reads<Answer>()(z.object({ id: z.string(), item: z.object({ name }) }));

// a table of registered readers, and one of loose ones
const registeredTable = { answer: registered, none: {} } as const;
const REGISTRY: Record<string, unknown> = registeredTable;
const looseTable = { answer: z.object({ id: z.string() }) };

// built by a helper, not by a chain from z
const viaHelper = nullable(z.object({ id: z.string() }));

export function readAll(data: unknown): unknown {
  // declared in a function
  const local = z.object({ id: z.string() });
  // declared in a function and registered
  const localOk = reads<Answer>()(z.object({ id: z.string() }));
  // looked up in a table of registered readers, and in one of loose readers
  const fromRegistry = (REGISTRY['answer'] as typeof registered);
  const fromLoose = looseTable['answer'];
  return [
    registered.parse(data),
    holder.parse(data),
    sharedPart.parse(data),
    viaHelper.parse(data),
    local.parse(data),
    localOk.parse(data),
    shorthand.parse(data),
    fromRegistry.parse(data),
    fromLoose.parse(data),
    z.object({ id: z.string() }).parse(data),
  ];
}
`;

  const file = join(dir, 'planted.ts');
  writeFileSync(file, PLANTED);
  const found = new Map(findReaders([file], dir).map(({ key, wrapped }) => [key, wrapped]));
  const lineOf = (text: string): number =>
    PLANTED.split('\n').findIndex((line) => line.includes(text)) + 1;

  it('finds the registered readers and not their parts', () => {
    expect(found.get('planted.ts:registered')).toBe(true);
    expect(found.get('planted.ts:holder')).toBe(true);
    expect(found.has('planted.ts:itemPart')).toBe(false);
  });

  it('finds a reader declared in a function', () => {
    expect(found.get(`planted.ts:local@${lineOf('const local =')}`)).toBe(false);
    expect(found.get(`planted.ts:localOk@${lineOf('const localOk =')}`)).toBe(true);
  });

  it('sees a part used in shorthand', () => {
    expect(found.has('planted.ts:name')).toBe(false);
    expect(found.get('planted.ts:shorthand')).toBe(true);
  });

  it('takes a reader looked up in a table of registered readers as registered', () => {
    expect(found.get(`planted.ts:fromRegistry@${lineOf('const fromRegistry =')}`)).toBe(true);
    expect(found.get(`planted.ts:fromLoose@${lineOf('const fromLoose =')}`)).toBe(false);
  });

  it('finds a reader built by a helper', () => {
    expect(found.get('planted.ts:viaHelper')).toBe(false);
  });

  it('finds a part that is also parsed on its own', () => {
    expect(found.get('planted.ts:sharedPart')).toBe(false);
  });

  it('finds a Zod expression parsed on the spot', () => {
    expect(found.get(`planted.ts:inline@${lineOf('z.object({ id: z.string() }).parse')}`)).toBe(
      false,
    );
  });
});
