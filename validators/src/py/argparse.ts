// The slice of `argparse` the validators use: positionals (one, or one or more), `store_true`
// flags, one `type=int` option, `-h`, abbreviated long options, `--opt=value`, `--`, negative numbers
// as values, and argparse's own wording for usage errors (exit status 2).

import { parseInt10, reprStr } from './str.ts';

export type OptionSpec =
  | { flag: string; kind: 'bool'; dest: string }
  | { flag: string; kind: 'int'; dest: string; metavar: string };
export type PositionalSpec = { dest: string; many: boolean };
export type ParserSpec = {
  usage: string;
  help: string;
  positionals: PositionalSpec[];
  options: OptionSpec[];
};
export type Parsed = Record<string, bigint | boolean | string | string[]>;

/** A finished program: what to print, where, and the exit status. */
export class Exit extends Error {
  constructor(
    readonly status: number,
    readonly stdout = '',
    readonly stderr = '',
  ) {
    super(`exit ${status}`);
  }
}

const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

export function parseArgs(spec: ParserSpec, prog: string, argv: string[]): Parsed {
  function fail(message: string): never {
    throw new Exit(
      2,
      '',
      `${spec.usage}${prog}: error: ${message}
`,
    );
  }
  const longFlags = [...spec.options.map((o) => o.flag), '--help'];
  const result: Parsed = {};
  for (const option of spec.options) result[option.dest] = option.kind === 'bool' ? false : '';
  const extras: string[] = [];
  const positionalValues: string[] = [];
  let positionalsDone = false;
  let consumedPositionals = 0;
  let afterDoubleDash = false;
  let seenDoubleDash = false;

  const classify = (arg: string): 'A' | 'O' => {
    if (afterDoubleDash) return 'A';
    if (!arg.startsWith('-') || arg === '-') return 'A';
    if (arg === '--') return 'O';
    if (NEGATIVE_NUMBER.test(arg)) return 'A';
    if (arg.includes(' ') && !longFlags.includes(arg.split('=')[0] as string)) return 'A';
    return 'O';
  };

  const resolveFlag = (arg: string): { flag: string | undefined; explicit?: string } => {
    const [head, ...rest] = arg.split('=');
    const explicit = rest.length > 0 ? rest.join('=') : undefined;
    const name = head as string;
    if (longFlags.includes(name))
      return explicit === undefined ? { flag: name } : { flag: name, explicit };
    // `-hx`: the cluster starts with -h, so the help runs before argparse looks at the rest.
    if (name === '-h' || (!name.startsWith('--') && name.length > 2 && name[1] === 'h')) {
      return explicit === undefined || name !== '-h'
        ? { flag: '--help' }
        : { flag: '--help', explicit };
    }
    if (name.startsWith('--')) {
      const matches = longFlags.filter((flag) => flag.startsWith(name));
      if (matches.length > 1) {
        fail(`ambiguous option: ${name} could match ${matches.join(', ')}`);
      }
      if (matches.length === 1) {
        return explicit === undefined ? { flag: matches[0] } : { flag: matches[0], explicit };
      }
    }
    return { flag: undefined };
  };

  const takePositionals = (from: number): number => {
    // Greedy, like argparse's `consume_positionals`: a run of positional words at `from`.
    let at = from;
    const run: string[] = [];
    while (at < argv.length && classify(argv[at] as string) === 'A') {
      run.push(argv[at] as string);
      at += 1;
    }
    if (run.length === 0 || positionalsDone) return from;
    const wanted = spec.positionals.slice(consumedPositionals);
    if (wanted.length === 0) return from;
    const first = wanted[0] as PositionalSpec;
    const used = first.many ? run.length : 1;
    positionalValues.push(...run.slice(0, used));
    consumedPositionals += 1;
    if (consumedPositionals >= spec.positionals.length) positionalsDone = true;
    return from + used;
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (arg === '--' && !afterDoubleDash) {
      afterDoubleDash = true;
      seenDoubleDash = true;
      i += 1;
      continue;
    }
    if (classify(arg) === 'A') {
      const next = takePositionals(i);
      if (next === i) {
        extras.push(arg);
        i += 1;
      } else i = next;
      continue;
    }
    const { flag, explicit } = resolveFlag(arg);
    if (flag === undefined) {
      extras.push(arg);
      i += 1;
      continue;
    }
    if (flag === '--help') {
      if (explicit !== undefined)
        fail(`argument -h/--help: ignored explicit argument ${reprStr(explicit)}`);
      throw new Exit(0, `${spec.usage}\n${spec.help}`);
    }
    const option = spec.options.find((o) => o.flag === flag) as OptionSpec;
    if (option.kind === 'bool') {
      if (explicit !== undefined)
        fail(`argument ${flag}: ignored explicit argument ${reprStr(explicit)}`);
      result[option.dest] = true;
      i += 1;
      continue;
    }
    let value = explicit;
    let step = 1;
    if (value === undefined) {
      const following = argv[i + 1];
      if (following === undefined || classify(following) !== 'A')
        fail(`argument ${flag}: expected one argument`);
      value = following;
      step = 2;
    }
    const parsed = parseInt10(value);
    if (parsed === undefined) fail(`argument ${flag}: invalid int value: ${reprStr(value)}`);
    result[option.dest] = parsed;
    i += step;
  }

  void seenDoubleDash;
  const missing = spec.positionals.slice(consumedPositionals).map((p) => p.dest);
  if (missing.length > 0) fail(`the following arguments are required: ${missing.join(', ')}`);
  if (extras.length > 0) fail(`unrecognized arguments: ${extras.join(' ')}`);
  for (const [index, positional] of spec.positionals.entries()) {
    result[positional.dest] = positional.many
      ? positionalValues.slice(index)
      : (positionalValues[index] as string);
  }
  return result;
}
