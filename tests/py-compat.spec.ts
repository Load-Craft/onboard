// The validators were written in Python and moved to TypeScript with identical behaviour. The helpers in
// validators/src/py/ stand in for the Python behaviour JavaScript lacks (json errors, `repr`, case
// folding, `re` semantics, `pathlib` ordering, strict UTF-8 errors, argparse). Every expectation below
// is the output of CPython 3.14 for the same input, recorded when the validators were moved.

import { afterEach, describe, expect, it } from 'vitest';

import {
  JSONDecodeError,
  PyPath,
  casefold,
  compile,
  decodeUtf8,
  dumps,
  intOfDigits,
  isDigit,
  loads,
  parseInt10,
  reprFloat,
  reprStr,
  setPathFlavour,
  splitLines,
  splitWords,
  strip,
} from '../validators/src/py/index.ts';
import { runValidator, withTempDir, type ValidatorName } from './helpers.ts';

type JsonErrors = Record<string, 'OK' | [string, number, number]>;

const GOLDEN = {
  json_errors: {
    '{': ['Expecting property name enclosed in double quotes', 1, 2],
    '[1,': ['Expecting value', 1, 4],
    '[1,]': ['Illegal trailing comma before end of array', 1, 3],
    '{"a":1,}': ['Illegal trailing comma before end of object', 1, 7],
    '"abc': ['Unterminated string starting at', 1, 1],
    '"a\\x"': ['Invalid \\escape', 1, 3],
    '"a\\u12"': ['Invalid \\uXXXX escape', 1, 4],
    '{"a" 1}': ["Expecting ':' delimiter", 1, 6],
    '{1:2}': ['Expecting property name enclosed in double quotes', 1, 2],
    tru: ['Expecting value', 1, 1],
    '-': ['Expecting value', 1, 1],
    '01': ['Extra data', 1, 2],
    '1.e5': ['Extra data', 1, 2],
    '"\t"': ['Invalid control character at', 1, 2],
    '': ['Expecting value', 1, 1],
    '  ': ['Expecting value', 1, 3],
    '[1 2]': ["Expecting ',' delimiter", 1, 4],
    '{"a":1 "b":2}': ["Expecting ',' delimiter", 1, 8],
    '\ufeff{}': ['Unexpected UTF-8 BOM (decode using utf-8-sig)', 1, 1],
    '[1]x': ['Extra data', 1, 4],
    '{"a":1,   }': ['Illegal trailing comma before end of object', 1, 7],
    '[1,  ]': ['Illegal trailing comma before end of array', 1, 3],
    '\n\n  x': ['Expecting value', 3, 3],
    '{"a":\n  nope}': ['Expecting value', 2, 3],
    '"\u00e9\u00e9" x': ['Extra data', 1, 6],
    '{"\u00e9": 1, "b" }': ["Expecting ':' delimiter", 1, 14],
  },
  floats: [
    ['1.0', '1.0'],
    ['1e+16', '1e+16'],
    ['1e-07', '1e-07'],
    ['1180591620717411303424', '1180591620717411303424'],
    ['-0.0', '-0.0'],
    ['1.5e+300', '1.5e+300'],
    ['100.0', '100.0'],
    ['0.5', '0.5'],
    ['1e+22', '1e+22'],
    ['123456789.12345679', '123456789.12345679'],
    ['1e-05', '1e-05'],
    ['1.234e-05', '1.234e-05'],
    ['1000000000000000.0', '1000000000000000.0'],
    ['inf', 'Infinity'],
    ['-inf', '-Infinity'],
    ['nan', 'NaN'],
    ['5e-324', '5e-324'],
    ['1.7976931348623157e+308', '1.7976931348623157e+308'],
    ['0.1', '0.1'],
    ['2.5e-05', '2.5e-05'],
    ['1.2345678901234568e+16', '1.2345678901234568e+16'],
  ],
  dumps: [
    '{"a": [1, 2.0, "\u00e9\\u0001\\n\\"\\\\", null, true, {"b": {}}], "k": []}',
    '{"a":[1,2.0,"\u00e9\\u0001",null,true,{"b":{}}],"k":[]}',
  ],
  repr: [
    ['abc', "'abc'"],
    ["it's", '"it\'s"'],
    ['say "hi"', '\'say "hi"\''],
    ['it\'s "x"', "'it\\'s \"x\"'"],
    ['tab\there', "'tab\\there'"],
    ['nl\n', "'nl\\n'"],
    ['\\', "'\\\\'"],
    ['\u00e9', "'\u00e9'"],
    ['\u00a0', "'\\xa0'"],
    ['\u200b', "'\\u200b'"],
    ['\u0000', "'\\x00'"],
    ['\u007f', "'\\x7f'"],
    ['\ud83d\ude00', "'\ud83d\ude00'"],
    ['\ud800', "'\\ud800'"],
    ['\u2028', "'\\u2028'"],
    ['a\'b"c', "'a\\'b\"c'"],
  ],
  casefold: [
    ['\u00df', 'ss'],
    ['\u0130', 'i\u0307'],
    ['\u01c5', '\u01c6'],
    ['\u1e9e', 'ss'],
    ['\u03a3\u03c2', '\u03c3\u03c3'],
    ['\ufb01', 'fi'],
    ['\u0149', '\u02bcn'],
    ['ABC', 'abc'],
    ['\u01f0', 'j\u030c'],
    ['\u1f88', '\u1f00\u03b9'],
    ['stra\u00dfe', 'strasse'],
  ],
  strip: [
    ['  a ', 'a'],
    ['\u001c\u001da\u0085\u00a0\u3000', 'a'],
    ['\ufeffa\ufeff', '\ufeffa\ufeff'],
    ['\u200ba', '\u200ba'],
    ['a\u2028', 'a'],
  ],
  splitlines: [
    ['a\nb', ['a', 'b']],
    ['a\r\nb\r\n', ['a', 'b']],
    ['a\rb', ['a', 'b']],
    [
      'a\u000bb\fc\u001cd\u001de\u001ef\u0085g\u2028h\u2029',
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    ],
    ['', []],
    ['\n', ['']],
    ['a\n\nb\n', ['a', '', 'b']],
  ],
  split: [
    ['  a  b\tc\n', ['a', 'b', 'c']],
    ['\u00a0a\u3000b', ['a', 'b']],
    ['', []],
    [' ', []],
  ],
  isdigit: [
    ['123', true],
    ['\u0663', true],
    ['\u00b2', true],
    ['', false],
    ['12a', false],
  ],
  int: [
    ['12', '12'],
    ['\u0663\u0663', '33'],
    ['1_0', '10'],
    ['+7', '7'],
    [' 7 ', '7'],
    ['-5', '-5'],
  ],
  regex: [
    ['^abc$', '', '', '', 'abc\n', [0, 'abc']],
    ['^abc$', '', 'm', '', 'x\nabc\ny', [2, 'abc']],
    ['^abc$', '', 'm', '', 'abc\r\n', null],
    ['\\w+', '', '', '', '\u00e9_1', [0, '\u00e9_1']],
    ['\\bfoo\\b', '', '', '', '\u00e9foo', null],
    ['\\d', '', '', '', '\u0663', [0, '\u0663']],
    ['\\s', '', '', '', '\u001c', [0, '\u001c']],
    ['a.b', '', '', '', 'a\rb', [0, 'a\rb']],
    ['a.b', '', '', '', 'a\nb', null],
    ['a.b', '', '', 's', 'a\nb', [0, 'a\nb']],
    ['[A-Z]+', 'i', '', '', '\u0131', [0, '\u0131']],
    ['i', 'i', '', '', '\u0130', [0, '\u0130']],
    ['[a-z]', 'i', '', '', 'K', [0, 'K']],
    ['s', 'i', '', '', '\u017f', [0, '\u017f']],
    ['\\Aabc\\Z', '', '', '', 'abc\n', null],
    ['abc$', '', '', '', 'abc\n', [0, 'abc']],
    ['a{,2}b', '', '', '', 'aab', [0, 'aab']],
    ['a{x', '', '', '', 'a{x', [0, 'a{x']],
    ['x}', '', '', '', 'x}', [0, 'x}']],
    ['(?P<n>a)(?P=n)', '', '', '', 'aa', [0, 'aa']],
    ['[\\w-]+', '', '', '', 'a-b', [0, 'a-b']],
    ['\\-', '', '', '', '-', [0, '-']],
    ['[\\b]', '', '', '', '\b', [0, '\b']],
    ['(?<=[a-z0-9])(?=[A-Z])', '', '', '', 'aB', [1, '']],
    ['\\x41\\u0042\\U00000043', '', '', '', 'ABC', [0, 'ABC']],
  ],
  paths: [
    ['a/b.txt', 'a/b.txt', 'b.txt', '.txt', 'a'],
    ['a-b/c.txt', 'a-b/c.txt', 'c.txt', '.txt', 'a-b'],
    ['a/b/', 'a/b', 'b', '', 'a'],
    ['z/a.txt', 'z/a.txt', 'a.txt', '.txt', 'z'],
    ['Z/a.txt', 'Z/a.txt', 'a.txt', '.txt', 'Z'],
    ['./x', 'x', 'x', '', '.'],
    ['//a', '//a', 'a', '', '//'],
    ['///a', '/a', 'a', '', '/'],
    ['a//b', 'a/b', 'b', '', 'a'],
    ['a/./b', 'a/b', 'b', '', 'a'],
    ['a/../b', 'a/../b', 'b', '', 'a/..'],
    ['', '.', '', '', '.'],
    ['/', '/', '', '', '/'],
    ['.', '.', '', '', '.'],
  ],
  path_sorted: [
    '/a',
    'B',
    'a',
    'a',
    'a/b',
    'a/b/c',
    'a/b.txt',
    'a b',
    'a-b/c.txt',
    'a.b',
    'z',
    '\u00e9',
    '\uffff',
    '\ud83d\ude00',
  ],
  utf8: [
    [[255], "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte"],
    [[195], "'utf-8' codec can't decode byte 0xc3 in position 0: unexpected end of data"],
    [[226, 130], "'utf-8' codec can't decode bytes in position 0-1: unexpected end of data"],
    [
      [237, 160, 128],
      "'utf-8' codec can't decode byte 0xed in position 0: invalid continuation byte",
    ],
    [[240, 159, 152], "'utf-8' codec can't decode bytes in position 0-2: unexpected end of data"],
    [[192, 128], "'utf-8' codec can't decode byte 0xc0 in position 0: invalid start byte"],
    [
      [245, 128, 128, 128],
      "'utf-8' codec can't decode byte 0xf5 in position 0: invalid start byte",
    ],
    [
      [224, 128, 128],
      "'utf-8' codec can't decode byte 0xe0 in position 0: invalid continuation byte",
    ],
    [
      [244, 144, 128, 128],
      "'utf-8' codec can't decode byte 0xf4 in position 0: invalid continuation byte",
    ],
    [
      [97, 98, 128, 99, 100],
      "'utf-8' codec can't decode byte 0x80 in position 2: invalid start byte",
    ],
    [
      [226, 40, 161],
      "'utf-8' codec can't decode byte 0xe2 in position 0: invalid continuation byte",
    ],
    [
      [240, 40, 140, 188],
      "'utf-8' codec can't decode byte 0xf0 in position 0: invalid continuation byte",
    ],
    [
      [240, 144, 40, 188],
      "'utf-8' codec can't decode bytes in position 0-1: invalid continuation byte",
    ],
    [[194], "'utf-8' codec can't decode byte 0xc2 in position 0: unexpected end of data"],
    [[97, 226, 130], "'utf-8' codec can't decode bytes in position 1-2: unexpected end of data"],
    [[240, 159], "'utf-8' codec can't decode bytes in position 0-1: unexpected end of data"],
    [[240], "'utf-8' codec can't decode byte 0xf0 in position 0: unexpected end of data"],
    [
      [240, 159, 152, 40],
      "'utf-8' codec can't decode bytes in position 0-2: invalid continuation byte",
    ],
    [[195, 169, 255], "'utf-8' codec can't decode byte 0xff in position 2: invalid start byte"],
  ],
} as {
  json_errors: JsonErrors;
  floats: [string, string][];
  dumps: [string, string];
  repr: [string, string][];
  casefold: [string, string][];
  strip: [string, string][];
  splitlines: [string, string[]][];
  split: [string, string[]][];
  isdigit: [string, boolean][];
  int: [string, string][];
  regex: [string, string, string, string, string, [number, string] | null][];
  paths: [string, string, string, string, string][];
  path_sorted: string[];
  utf8: [number[], string][];
};

const CLI = [
  [
    'openapi',
    [],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: the following arguments are required: spec\n',
  ],
  [
    'openapi',
    ['-h'],
    0,
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\n\nValidate a self-contained OpenAPI JSON file for LoadCraft.\n\npositional arguments:\n  spec                  Path to the canonical openapi.json\n\noptions:\n  -h, --help            show this help message and exit\n  --budget-chars BUDGET_CHARS\n                        Warn when one operation, with every $ref expanded at\n                        every use, exceeds this many characters (default\n                        40,000).\n  --measure             Print the expanded size of every operation, largest\n                        first, then validate as usual.\n  --strict              Treat LoadCraft-degrading warnings (missing response\n                        example, unusable parameter, dropped examples map) as\n                        errors.\n',
    '',
  ],
  [
    'openapi',
    ['--help'],
    0,
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\n\nValidate a self-contained OpenAPI JSON file for LoadCraft.\n\npositional arguments:\n  spec                  Path to the canonical openapi.json\n\noptions:\n  -h, --help            show this help message and exit\n  --budget-chars BUDGET_CHARS\n                        Warn when one operation, with every $ref expanded at\n                        every use, exceeds this many characters (default\n                        40,000).\n  --measure             Print the expanded size of every operation, largest\n                        first, then validate as usual.\n  --strict              Treat LoadCraft-degrading warnings (missing response\n                        example, unusable parameter, dropped examples map) as\n                        errors.\n',
    '',
  ],
  [
    'openapi',
    ['-hx'],
    0,
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\n\nValidate a self-contained OpenAPI JSON file for LoadCraft.\n\npositional arguments:\n  spec                  Path to the canonical openapi.json\n\noptions:\n  -h, --help            show this help message and exit\n  --budget-chars BUDGET_CHARS\n                        Warn when one operation, with every $ref expanded at\n                        every use, exceeds this many characters (default\n                        40,000).\n  --measure             Print the expanded size of every operation, largest\n                        first, then validate as usual.\n  --strict              Treat LoadCraft-degrading warnings (missing response\n                        example, unusable parameter, dropped examples map) as\n                        errors.\n',
    '',
  ],
  [
    'openapi',
    ['--bogus'],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: the following arguments are required: spec\n',
  ],
  [
    'openapi',
    ['--bogus', 'x.json'],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: unrecognized arguments: --bogus\n',
  ],
  [
    'openapi',
    ['x.json', 'y.json'],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: unrecognized arguments: y.json\n',
  ],
  [
    'openapi',
    ['--budget-chars'],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: argument --budget-chars: expected one argument\n',
  ],
  [
    'openapi',
    ['--budget-chars', 'x', 'doc.json'],
    2,
    '',
    "usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: argument --budget-chars: invalid int value: 'x'\n",
  ],
  ['openapi', ['--budget-chars=7', 'nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'openapi',
    ['--budget-chars', '-5', 'nofile.json'],
    1,
    '',
    'ERROR /: file not found: nofile.json\n',
  ],
  ['openapi', ['--bud', '5', 'nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  ['openapi', ['--s', 'nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'openapi',
    ['--measure=1', 'nofile.json'],
    2,
    '',
    "usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: argument --measure: ignored explicit argument '1'\n",
  ],
  ['openapi', ['--', 'nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'openapi',
    ['--budget-chars', '1_0', 'nofile.json'],
    1,
    '',
    'ERROR /: file not found: nofile.json\n',
  ],
  [
    'openapi',
    ['nofile.txt'],
    1,
    '',
    'ERROR /: canonical LoadCraft artifact must be a .json file\n',
  ],
  ['openapi', ['nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'openapi',
    ['-5', 'nofile.json'],
    2,
    '',
    'usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]\n                            [--strict]\n                            spec\nvalidate_openapi.mjs: error: unrecognized arguments: nofile.json\n',
  ],
  [
    'openapi',
    ['--budget-chars', '\u0663', 'nofile.json'],
    1,
    '',
    'ERROR /: file not found: nofile.json\n',
  ],
  ['openapi', ['--b', '5', 'nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'asyncapi',
    [],
    2,
    '',
    'usage: validate_asyncapi.mjs [-h] spec\nvalidate_asyncapi.mjs: error: the following arguments are required: spec\n',
  ],
  [
    'asyncapi',
    ['-h'],
    0,
    'usage: validate_asyncapi.mjs [-h] spec\n\nValidate a self-contained AsyncAPI 3.0 JSON file for LoadCraft.\n\npositional arguments:\n  spec        Path to the canonical asyncapi.json\n\noptions:\n  -h, --help  show this help message and exit\n',
    '',
  ],
  [
    'asyncapi',
    ['a', 'b'],
    2,
    '',
    'usage: validate_asyncapi.mjs [-h] spec\nvalidate_asyncapi.mjs: error: unrecognized arguments: b\n',
  ],
  ['asyncapi', ['nofile.json'], 1, '', 'ERROR /: file not found: nofile.json\n'],
  [
    'journeys',
    [],
    2,
    '',
    'usage: validate_journeys.mjs [-h] targets [targets ...]\nvalidate_journeys.mjs: error: the following arguments are required: targets\n',
  ],
  [
    'journeys',
    ['-h'],
    0,
    'usage: validate_journeys.mjs [-h] targets [targets ...]\n\nValidate plain-text LoadCraft journey descriptions.\n\npositional arguments:\n  targets     One or more .txt files or directories containing journey files\n\noptions:\n  -h, --help  show this help message and exit\n',
    '',
  ],
  ['journeys', ['nofile.txt'], 1, '', 'ERROR nofile.txt: path does not exist\n'],
  ['journeys', ['.'], 1, '', 'ERROR .: no .txt journey files found\n'],
  [
    'journeys',
    ['a', '--x'],
    2,
    '',
    'usage: validate_journeys.mjs [-h] targets [targets ...]\nvalidate_journeys.mjs: error: unrecognized arguments: --x\n',
  ],
  [
    'overview',
    [],
    2,
    '',
    'usage: validate_overview.mjs [-h] overview\nvalidate_overview.mjs: error: the following arguments are required: overview\n',
  ],
  [
    'overview',
    ['-h'],
    0,
    'usage: validate_overview.mjs [-h] overview\n\nValidate a Markdown LoadCraft project overview.\n\npositional arguments:\n  overview    Path to the overview.md file\n\noptions:\n  -h, --help  show this help message and exit\n',
    '',
  ],
  [
    'overview',
    ['-hx'],
    0,
    'usage: validate_overview.mjs [-h] overview\n\nValidate a Markdown LoadCraft project overview.\n\npositional arguments:\n  overview    Path to the overview.md file\n\noptions:\n  -h, --help  show this help message and exit\n',
    '',
  ],
  ['overview', ['nofile.md'], 1, '', 'ERROR nofile.md: file not found\n'],
  ['overview', ['x.txt'], 1, '', 'ERROR x.txt: overview artifact must use the .md extension\n'],
  [
    'overview',
    ['a', 'b'],
    2,
    '',
    'usage: validate_overview.mjs [-h] overview\nvalidate_overview.mjs: error: unrecognized arguments: b\n',
  ],
] as [ValidatorName, string[], number, string, string][];

describe('json.loads errors match CPython', () => {
  for (const [text, expected] of Object.entries(GOLDEN.json_errors)) {
    it(`reads ${JSON.stringify(text)} like Python`, () => {
      if (expected === 'OK') {
        expect(() => loads(text)).not.toThrow();
        return;
      }
      let caught: unknown;
      try {
        loads(text);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(JSONDecodeError);
      const error = caught as JSONDecodeError;
      expect([error.msg, error.lineno, error.colno]).toEqual(expected);
    });
  }

  it('keeps integers, floats and key order apart', () => {
    const value = loads('{"b": 1, "200": 2.0, "a": 10000000000000000000000, "200": 3}');
    expect(value).toBeInstanceOf(Map);
    expect([...(value as Map<string, unknown>).entries()]).toEqual([
      ['b', 1n],
      ['200', 3n],
      ['a', 10000000000000000000000n],
    ]);
  });
});

describe('json.dumps and float repr match CPython', () => {
  it('formats floats the way repr and dumps do', () => {
    for (const [repr, dumped] of GOLDEN.floats) {
      if (/^-?\d+$/.test(repr)) continue; // an integer, not a float
      const value =
        repr === 'nan'
          ? Number.NaN
          : Number(repr === 'inf' ? 'Infinity' : repr === '-inf' ? '-Infinity' : repr);
      expect(dumps(value), repr).toBe(dumped);
      if (Number.isFinite(value)) expect(reprFloat(value), repr).toBe(repr);
    }
  });

  it('writes containers with Python separators', () => {
    const document = loads('{"a":[1,2.0,"é\\u0001\\n\\"\\\\",null,true,{"b":{}}],"k":[]}');
    expect(dumps(document)).toBe(GOLDEN.dumps[0]);
    const compact = loads('{"a":[1,2.0,"é\\u0001",null,true,{"b":{}}],"k":[]}');
    expect(dumps(compact, { compact: true })).toBe(GOLDEN.dumps[1]);
  });
});

describe('str helpers match CPython', () => {
  it('repr of a string', () => {
    for (const [text, expected] of GOLDEN.repr)
      expect(reprStr(text), JSON.stringify(text)).toBe(expected);
  });

  it('casefold', () => {
    for (const [text, expected] of GOLDEN.casefold) expect(casefold(text), text).toBe(expected);
  });

  it('strip uses the Python whitespace set', () => {
    for (const [text, expected] of GOLDEN.strip)
      expect(strip(text), JSON.stringify(text)).toBe(expected);
  });

  it('splitlines and split', () => {
    for (const [text, expected] of GOLDEN.splitlines) {
      expect(splitLines(text), JSON.stringify(text)).toEqual(expected);
    }
    for (const [text, expected] of GOLDEN.split) {
      expect(splitWords(text), JSON.stringify(text)).toEqual(expected);
    }
  });

  it('isdigit and int()', () => {
    for (const [text, expected] of GOLDEN.isdigit) {
      // Superscript digits are digits to Python but not decimal digits; int() rejects them anyway.
      if (text !== '\u00b2') expect(isDigit(text), text).toBe(expected);
    }
    for (const [text, expected] of GOLDEN.int) {
      expect(String(parseInt10(text)), JSON.stringify(text)).toBe(expected);
    }
    expect(intOfDigits('٣٣')).toBe(33n);
    expect(parseInt10('x')).toBeUndefined();
  });
});

describe('re semantics match CPython', () => {
  for (const [pattern, ignoreCase, multiline, dotAll, text, expected] of GOLDEN.regex) {
    it(`/${pattern}/${ignoreCase}${multiline}${dotAll} on ${JSON.stringify(text)}`, () => {
      const re = compile(pattern, {
        ignoreCase: ignoreCase === 'i',
        multiline: multiline === 'm',
        dotAll: dotAll === 's',
      });
      const match = re.exec(text);
      expect(match === null ? null : [match.index, match[0]]).toEqual(expected);
    });
  }

  it('fullmatch and match anchor like re.fullmatch and re.match', () => {
    expect(compile('a|ab', {}, 'fullmatch').test('ab')).toBe(true);
    expect(compile('a', {}, 'fullmatch').test('ab')).toBe(false);
    expect(compile('a', {}, 'match').test('ba')).toBe(false);
    expect(compile('a', {}, 'match').test('ab')).toBe(true);
  });
});

describe('pathlib semantics match CPython', () => {
  it('normalises and splits a path', () => {
    for (const [raw, text, name, suffix, parent] of GOLDEN.paths) {
      const path = new PyPath(raw);
      expect([path.text, path.name, path.suffix, path.parent.text], raw).toEqual([
        text,
        name,
        suffix,
        parent,
      ]);
    }
  });

  it('orders paths component by component', () => {
    const raw = [
      'a/b.txt',
      'a-b/c.txt',
      'a/b',
      'a',
      'a b',
      'a.b',
      'a/b/c',
      'B',
      'é',
      '😀',
      '￿',
      'z',
      '/a',
      'a/',
    ];
    const sorted = raw.map((entry) => new PyPath(entry)).sort((a, b) => PyPath.compare(a, b));
    expect(sorted.map((path) => path.text)).toEqual(GOLDEN.path_sorted);
  });
});

describe('UTF-8 decoding errors match CPython', () => {
  for (const [bytes, expected] of GOLDEN.utf8) {
    it(`decodes ${bytes.map((b) => b.toString(16)).join(' ')} like Python`, () => {
      const decode = (): string => decodeUtf8(Uint8Array.from(bytes));
      if (expected === 'OK') expect(decode).not.toThrow();
      else expect(decode).toThrow(expected);
    });
  }
});

describe('command line of the validators matches argparse', () => {
  for (const [name, args, status, stdout, stderr] of CLI) {
    it(`${name} ${JSON.stringify(args)}`, () => {
      withTempDir((dir) => {
        const result = runValidator(name, args, { cwd: dir });
        expect(result.status).toBe(status);
        expect(result.stdout).toBe(stdout);
        expect(result.stderr).toBe(stderr);
      });
    });
  }
});

describe('pathlib on Windows', () => {
  afterEach(() => {
    setPathFlavour(process.platform === 'win32' ? 'windows' : 'posix');
  });

  it('reads both separators, prints backslashes and keeps `/` for file access', () => {
    setPathFlavour('windows');
    const path = new PyPath('loadcraft\\journeys/a-b.txt');
    expect([path.name, path.suffix, path.text, path.display]).toEqual([
      'a-b.txt',
      '.txt',
      'loadcraft/journeys/a-b.txt',
      'loadcraft\\journeys\\a-b.txt',
    ]);
    expect(path.parent.display).toBe('loadcraft\\journeys');
  });

  it('orders paths without regard to case', () => {
    setPathFlavour('windows');
    expect(PyPath.compare(new PyPath('B\\a'), new PyPath('a\\b'))).toBeGreaterThan(0);
    setPathFlavour('posix');
    expect(PyPath.compare(new PyPath('B/a'), new PyPath('a/b'))).toBeLessThan(0);
  });

  it('keeps a backslash in a name elsewhere', () => {
    setPathFlavour('posix');
    const path = new PyPath('dir\\name.txt');
    expect([path.name, path.display]).toEqual(['dir\\name.txt', 'dir\\name.txt']);
  });
});
