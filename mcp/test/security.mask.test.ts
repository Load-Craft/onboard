import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { loadConfig } from '../src/config.js';
import { defineTool } from '../src/registry.js';
import { createServer } from '../src/server.js';
import { connect } from './helpers/mcp.js';
import { createLogger, MIN_SECRET_LENGTH } from '../src/log.js';
import { Masker, REDACTED, needlesFor } from '../src/security/mask.js';
import { CallSecretScope } from '../src/workspace/secrets.js';

// One table, three maskers: the logger, the per-call scope and the bare Masker must hide the same forms.
const PASSWORD = 'Zażółć-pass/42+x';
const ASCII = 'hunter2-Secret';

interface Case {
  name: string;
  secret: string;
  text: (secret: string) => string;
}

const unicodeEscaped = (value: string, upper: boolean): string =>
  value.replace(/[^\x20-\x7e]/g, (ch) => {
    const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${upper ? hex.toUpperCase() : hex}`;
  });

const CASES: Case[] = [
  { name: 'raw value', secret: ASCII, text: (s) => `password=${s}` },
  { name: 'url-encoded', secret: PASSWORD, text: (s) => `?p=${encodeURIComponent(s)}` },
  {
    name: 'JSON \\uXXXX lower case',
    secret: PASSWORD,
    text: (s) => `{"p":"${unicodeEscaped(s, false)}"}`,
  },
  {
    name: 'JSON \\uXXXX upper case',
    secret: PASSWORD,
    text: (s) => `{"p":"${unicodeEscaped(s, true)}"}`,
  },
  { name: 'base64', secret: ASCII, text: (s) => Buffer.from(s).toString('base64') },
  {
    name: 'Basic header, 2-byte prefix (1 mod 3)',
    secret: ASCII,
    text: (s) => `Authorization: Basic ${Buffer.from(`a:${s}`).toString('base64')}`,
  },
  {
    name: 'Basic header, 4-byte prefix (2 mod 3)',
    secret: ASCII,
    text: (s) => `Basic ${Buffer.from(`abc:${s}`).toString('base64')}`,
  },
  {
    name: 'Basic header, 3-byte prefix (0 mod 3)',
    secret: ASCII,
    text: (s) => `Basic ${Buffer.from(`ab:${s}`).toString('base64')}`,
  },
  {
    name: 'base64url',
    secret: PASSWORD,
    text: (s) => Buffer.from(s).toString('base64url'),
  },
  { name: 'hex of the UTF-8 bytes', secret: ASCII, text: (s) => Buffer.from(s).toString('hex') },
  {
    name: 'hex, upper case',
    secret: ASCII,
    text: (s) => Buffer.from(s).toString('hex').toUpperCase(),
  },
];

function viaLogger(secret: string, text: string): string {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  log.registerSecret(secret);
  log.info('x', { text });
  return lines.join('\n');
}

function viaScope(secret: string, text: string): string {
  const log = createLogger({ level: 'debug', sink: () => undefined });
  const scope = new CallSecretScope(log);
  scope.add(secret);
  return scope.scrub(text);
}

function viaMasker(secret: string, text: string): string {
  const masker = new Masker();
  masker.add(secret);
  return masker.text(text);
}

describe.each([
  ['logger', viaLogger],
  ['call scope', viaScope],
  ['masker', viaMasker],
])('masking through the %s', (_name, mask) => {
  it.each(CASES)('hides: $name', ({ secret, text }) => {
    const out = mask(secret, text(secret));
    expect(out).toContain(REDACTED);
    for (const needle of needlesFor(secret)) expect(out).not.toContain(needle);
  });

  it('leaves unrelated text alone', () => {
    expect(mask(ASCII, 'nothing to see here')).toContain('nothing to see here');
  });
});

describe('logger hides what the call scope hides (regression: B9)', () => {
  it('writes no \\uXXXX form of the password to the log', () => {
    const out = viaLogger(PASSWORD, unicodeEscaped(PASSWORD, false));
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('\\u017c');
  });

  it('writes no Basic header fragment to the log', () => {
    const basic = Buffer.from(`alice:${ASCII}`).toString('base64');
    const out = viaLogger(ASCII, `Basic ${basic}`);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(basic.slice(-12));
  });
});

describe('Masker', () => {
  it('ignores values shorter than MIN_SECRET_LENGTH', () => {
    const masker = new Masker();
    masker.add('x'.repeat(MIN_SECRET_LENGTH - 1));
    expect(masker.text('xxx')).toBe('xxx');
  });

  it('masks the longest secret first when one contains another', () => {
    const masker = new Masker();
    masker.add('token');
    masker.add('token-and-more');
    expect(masker.text('a token-and-more b')).toBe(`a ${REDACTED} b`);
  });

  it('a forked masker sees the parent needles, also added later, but never the other way round', () => {
    const parent = new Masker();
    const child = parent.fork();
    child.add('child-secret');
    parent.add('parent-secret');
    expect(child.text('child-secret parent-secret')).toBe(`${REDACTED} ${REDACTED}`);
    expect(parent.text('child-secret parent-secret')).toBe(`child-secret ${REDACTED}`);
  });

  it('masks the whole stretch two overlapping secrets cover, not only the longer one', () => {
    const masker = new Masker();
    masker.add('ab12-short');
    masker.add('12-short-and-longer');
    // The longer secret starts inside the shorter one: neither may leave a piece of the other.
    expect(masker.text('x ab12-short-and-longer y')).toBe(`x ${REDACTED} y`);
  });
});

describe('Masker: a secret the view cut short (`…`)', () => {
  const TOKEN = 'CANARY-SECRET-7f3a';

  it.each([4, 8, 16, 17])('masks a prefix of %i characters that ends at the cut mark', (kept) => {
    const masker = new Masker();
    masker.add(TOKEN);
    const out = masker.text(`Backend said: token ${TOKEN.slice(0, kept)}…`);
    expect(out).toBe(`Backend said: token ${REDACTED}…`);
  });

  it('leaves a prefix shorter than MIN_SECRET_LENGTH and a prefix not followed by the cut mark', () => {
    const masker = new Masker();
    masker.add(TOKEN);
    expect(masker.text(`a ${TOKEN.slice(0, MIN_SECRET_LENGTH - 1)}…`)).toBe(
      `a ${TOKEN.slice(0, MIN_SECRET_LENGTH - 1)}…`,
    );
    expect(masker.text(`a ${TOKEN.slice(0, 10)} b`)).toBe(`a ${TOKEN.slice(0, 10)} b`);
  });

  it('masks a cut prefix of an encoded form too', () => {
    const masker = new Masker();
    masker.add(TOKEN);
    const hex = Buffer.from(TOKEN).toString('hex');
    expect(masker.text(`bytes ${hex.slice(0, 20)}…`)).toBe(`bytes ${REDACTED}…`);
  });

  it('does not report a cut prefix as a secret it holds (has stays whole-value)', () => {
    const masker = new Masker();
    masker.add(TOKEN);
    expect(masker.has(`${TOKEN.slice(0, 12)}…`)).toBe(false);
    expect(masker.has(`x ${TOKEN} y`)).toBe(true);
  });
});

describe('Masker: a secret as inline() shows it on one line', () => {
  it.each([
    ['a tab', 'Pw\tSklep-2026!', 'Pw Sklep-2026!'],
    ['two spaces', 'correct  horse battery', 'correct horse battery'],
    ['a line break', 'line one\nline two', 'line one line two'],
    ['spaces at the ends', '  padded secret  ', 'padded secret'],
    ['a zero-width space', 'ab\u200bcdefgh1Zq', 'abcdefgh1Zq'],
    ['a right-to-left override', 'Pw\u202eSklep-2026', 'PwSklep-2026'],
    ['a bell', 'Pw\u0007Sklep-2026', 'PwSklep-2026'],
    ['an escape sequence', 'Pw\u001b[31mSklep-2026', 'PwSklep-2026'],
  ])('masks the value with %s in its one-line form', (_name, secret, shown) => {
    const masker = new Masker();
    masker.add(secret);
    expect(masker.text(`said: ${shown} end`)).toBe(`said: ${REDACTED} end`);
  });
});

describe('Masker: a short secret is masked as a word, never inside one (D5)', () => {
  it.each([
    ['a tool name', 'test', 'call run_start next', 'call run_start next'],
    ['a handle', '1234', 'wait {operation: "e-3f912345"}', 'wait {operation: "e-3f912345"}'],
    ['a longer word', 'pass', 'the step passed', 'the step passed'],
  ])('keeps %s that holds the value whole', (_name, secret, text, expected) => {
    const masker = new Masker();
    masker.add(secret);
    expect(masker.text(text)).toBe(expected);
  });

  it.each([
    ['between spaces', 'test', 'password test rejected', `password ${REDACTED} rejected`],
    ['in quotes', '1234', 'pin "1234" rejected', `pin "${REDACTED}" rejected`],
    ['at the ends', 'test', 'test', REDACTED],
    ['next to punctuation', 'pw-1', 'pw-1, pw-1.', `${REDACTED}, ${REDACTED}.`],
    ['in a query', 'test', '?p=test&q=1', `?p=${REDACTED}&q=1`],
  ])('masks the value standing %s', (_name, secret, text, expected) => {
    const masker = new Masker();
    masker.add(secret);
    expect(masker.text(text)).toBe(expected);
  });

  it.each([
    ['starts with a sign', '!Pass12', 'zz!Pass12', `zz${REDACTED}`],
    ['ends with a sign', 'Pass12!', 'Pass12!zz', `${REDACTED}zz`],
    ['is signs only', '!#$%&', 'a!#$%&b', `a${REDACTED}b`],
  ])(
    'asks for a word boundary only on a side where the value has a word character (%s)',
    (_name, secret, text, expected) => {
      const masker = new Masker();
      masker.add(secret);
      expect(masker.text(text)).toBe(expected);
    },
  );

  it('still keeps a value whose word side touches a word (`!Pass12` in `zz!Pass12x`)', () => {
    const masker = new Masker();
    masker.add('!Pass12');
    expect(masker.text('zz!Pass12x')).toBe('zz!Pass12x');
  });

  it('masks a value of eight characters or more anywhere, also inside a word', () => {
    const masker = new Masker();
    masker.add('12345678');
    expect(masker.text('e-a12345678b')).toBe(`e-a${REDACTED}b`);
  });

  it('a short value in a Basic header is still masked through its base64 form', () => {
    const masker = new Masker();
    masker.add('test');
    const header = `Basic ${Buffer.from('user:test').toString('base64')}`;
    expect(masker.text(header)).toContain(REDACTED);
  });
});

/**
 * The budget of a timed check, in units of a fixed piece of work done on the same thread: 1 unit is
 * about 5 ms on an idle machine, and it takes as many times longer as the machine is busy, so a
 * budget of `100 * unit` is the 500 ms of an idle machine and does not tighten when it is not. The
 * unit is the shortest of several runs, taken before and after the measured work.
 */
function workUnit(): number {
  const words = Array.from({ length: 5000 }, (_, i) => `Pw-sklep-${String(i).padStart(6, '0')}!x`);
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    for (let pass = 0; pass < 20; pass += 1) words.join(' ').split(' ');
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/** Runs `work` and returns its time with the unit of the machine around it. */
function timed(work: () => void): { elapsed: number; unit: number } {
  const before = workUnit();
  const started = performance.now();
  work();
  const elapsed = performance.now() - started;
  return { elapsed, unit: Math.min(before, workUnit()) };
}

describe('Masker: many registered values', () => {
  // Accounts a tool creates share a long prefix (`Pw-sklep-000123!x`): the cost of a text must not
  // grow with the number of values that share the characters it holds.
  const SHARED = Array.from({ length: 5000 }, (_, i) => `Pw-sklep-${String(i).padStart(6, '0')}!x`);

  it('masks 5000 values that share a prefix in 100 KB of text that hits it everywhere', () => {
    const masker = new Masker();
    for (const value of SHARED) masker.add(value);
    // Every value once, then the shared head without a whole value, up to 100 KB.
    let text = SHARED.join(' ');
    while (text.length < 100_000) text += ' Pw-sklep-00';
    let out = '';
    const { elapsed, unit } = timed(() => {
      out = masker.text(text);
    });
    expect(out).not.toContain('Pw-sklep-000123!x');
    expect(out.split(REDACTED)).toHaveLength(SHARED.length + 1);
    expect(elapsed).toBeLessThan(100 * unit);
  });

  it('registers 2000 values one by one with a text between each without slowing down', () => {
    const masker = new Masker();
    const { elapsed, unit } = timed(() => {
      for (const value of SHARED.slice(0, 2000)) {
        masker.add(value);
        masker.text(`progress ${value} done`);
      }
    });
    expect(masker.text(`x ${SHARED[1999] ?? ''} y`)).toBe(`x ${REDACTED} y`);
    expect(elapsed).toBeLessThan(100 * unit);
  });

  it('masks the many short strings of view data without a pass per registered value', () => {
    // The data of a view is scrubbed string by string before it is drawn: a dataset registers up to
    // a thousand passwords (some twenty forms each) and a view holds thousands of short strings.
    const masker = new Masker();
    const values = Array.from({ length: 1000 }, (_, i) => `pw-${String(i).padStart(4, '0')}-sklep`);
    for (const value of values) masker.add(value);
    const strings = Array.from(
      { length: 5000 },
      (_, i) => `step ${String(i)} of the checkout journey for sklep, ok`,
    );
    const { elapsed, unit } = timed(() => {
      for (const text of strings) masker.text(text);
    });
    expect(masker.text(`x ${values[500] ?? ''} y`)).toBe(`x ${REDACTED} y`);
    // An index by the first characters needs milliseconds; a search per needle needs seconds.
    expect(elapsed).toBeLessThan(200 * unit);
  });
});

describe('logger scopes (B10)', () => {
  it('secrets registered on a scope stay out of the process logger', () => {
    const lines: string[] = [];
    const root = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    root.registerSecret('process-token');
    const call = root.scope({ tool: 't' });
    call.registerSecret('call-password');
    call.info('in call', { a: 'process-token call-password' });
    root.info('outside', { a: 'process-token call-password' });
    const [inCall, outside] = lines;
    expect(inCall).not.toContain('process-token');
    expect(inCall).not.toContain('call-password');
    expect(inCall).toContain('"tool":"t"');
    expect(outside).not.toContain('process-token');
    expect(outside).toContain('call-password');
  });

  it('children of a scope share the scope secrets', () => {
    const lines: string[] = [];
    const root = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    const call = root.scope({});
    const child = call.child({ component: 'c' });
    call.registerSecret('call-password');
    child.info('x', { a: 'call-password' });
    expect(lines[0]).not.toContain('call-password');
  });
});

describe('tool call uses a logger scope (B10)', () => {
  it('a password added during a call is not kept by the process logger', async () => {
    const lines: string[] = [];
    const root = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    root.registerSecret('process-token');
    const config = loadConfig({ LOADCRAFT_API_TOKEN: 'process-token' }, process.cwd());
    const addsPassword = defineTool({
      name: 'adds_password',
      title: 'Adds password',
      description: 'Adds: registers a password in the call scope. Does not modify anything.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run(ctx) {
        ctx.secrets.add('call-password');
        ctx.log.info('in call', { v: 'call-password' });
        return Promise.resolve({ status: 'done' as const, data: {} });
      },
      render: () => 'ok',
    });
    const session = await connect(() => createServer({ config, log: root, tools: [addsPassword] }));
    try {
      await session.call('adds_password', {});
    } finally {
      await session.close();
    }
    root.info('after', { v: 'call-password process-token' });
    const inCall = lines.find((line) => line.includes('"in call"')) ?? '';
    expect(inCall).not.toContain('call-password');
    const after = lines.find((line) => line.includes('"after"')) ?? '';
    expect(after).toContain('call-password');
    expect(after).not.toContain('process-token');
  });
});

describe('registering the same value again', () => {
  const VALUE = 'repeat-secret-value-91';

  it('masks as before when a value is added twice, also through a fork', () => {
    const parent = new Masker();
    parent.add(VALUE);
    parent.add(VALUE);
    const child = parent.fork();
    child.add(VALUE);
    for (const masker of [parent, child]) {
      expect(masker.text(`x ${VALUE} y`)).toBe(`x ${REDACTED} y`);
    }
  });

  it('a fork keeps its own value to itself and sees a value the parent learns later', () => {
    const parent = new Masker();
    const child = parent.fork();
    child.add(VALUE);
    parent.add(VALUE);
    expect(child.text(VALUE)).toBe(REDACTED);
    expect(parent.text(VALUE)).toBe(REDACTED);
    const other = new Masker();
    const own = other.fork();
    own.add('only-in-the-fork-77');
    expect(other.text('only-in-the-fork-77')).toBe('only-in-the-fork-77');
  });
});
