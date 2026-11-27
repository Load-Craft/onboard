// The repository is public; the LoadCraft backend and frontend are not. A tracked file says what the
// backend does ("the backend answers 409 when the name is taken"), never where in its code that is:
// no path of a backend file (with or without a line), no commit of its history, no name of a
// private branch and no local path of a machine. The names of the applications the tests were tried
// on are kept out by tests/no-target-names.spec.ts.
// Every exception is listed below with the reason it is one.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

const SHA = String.raw`[0-9a-f]{9,40}`;

const RULES: readonly Rule[] = [
  // `backend/api/routes/x.py:123`, `api/routes/x.py`, `config_generator.py:676-683`, `setup_gate.py`.
  { name: 'backend file', pattern: /[\w./-]*[\w-]+\.py\b(?::\d+)?/gu },
  // `frontend/src/…`, `Component.tsx:20`: the frontend is not public either.
  { name: 'frontend file', pattern: /\bfrontend\/src\/[\w./-]+|\b[\w-]+\.tsx:\d+/gu },
  // `loadcraft @ d93e08d80`, `commit 6f9a42e45`, `at loadcraft 7d383e0ec`, `"commit": "448dd…"`.
  {
    name: 'backend commit',
    pattern: new RegExp(
      String.raw`(?:loadcraft\x60?|backend|(?<![A-Za-z])commit"?:?|last changed in|@|\bat)\s+\x60?"?${SHA}\b|backend_ref`,
      'giu',
    ),
  },
  // The integration branch of the backend and the branches of the work on it.
  { name: 'private branch', pattern: /\bcc-plugin\b(?!-)|\bmcp\/integracja\b|\bjarek\/[\w-]+/gu },
  { name: 'local path', pattern: /\/home\/[\w.-]+|\b(?:loadcraft|onboard)-wt\b/gu },
];

interface Exception {
  /** A tracked path, or a prefix of paths that ends with `/`. */
  readonly path: string;
  readonly rules: readonly string[];
  /** The matched text, when the exception is one value and not the whole file. */
  readonly text?: RegExp;
  readonly why: string;
}

const EXCEPTIONS: readonly Exception[] = [
  {
    path: 'contracts/loadcraft-openapi.json',
    rules: ['backend file'],
    why: 'the backend exports its OpenAPI document with its own docstrings; `npm run sync:api` writes it unchanged, so a file name in a description is fixed in the backend',
  },
  {
    path: 'mcp/src/http/generated/api.d.ts',
    rules: ['backend file'],
    why: 'generated from contracts/loadcraft-openapi.json (same text, same fix)',
  },
  {
    path: 'mcp/dist/',
    rules: ['backend file'],
    why: 'dist is built from the sources this guard reads and embeds the OpenAPI snapshot, whose descriptions are the backend’s own text (`check:dist` keeps it equal to them)',
  },
  {
    path: 'tests/fixtures/',
    rules: ['backend file'],
    why: 'the example applications of the skill tests are Python files of this repository',
  },
  {
    path: '',
    rules: ['backend file'],
    text: /^(?:[\w./-]*\/)?(?:quick_validate|validate_plugin|export_openapi|app|consumer|test_evals|test_evals_negative|test_playbook_skill)\.py$/u,
    why: 'own tools and tests of this repository and of the skill creator, and the export script the sync runs in a backend tree the user names',
  },
  {
    path: 'skills/loadcraft-overview/references/loadcraft-overview-contract.md',
    rules: ['backend file'],
    text: /^path\/file\.py:123$/u,
    why: 'the example of a reference the skill forbids',
  },
  {
    path: 'tests/overview-rules.spec.ts',
    rules: ['backend file'],
    text: /^models\/order\.py:42$/u,
    why: 'a test input the overview rules must refuse',
  },
  {
    path: 'tests/validators.spec.ts',
    rules: ['frontend file'],
    text: /^OrdersPage\.tsx:42$/u,
    why: 'a test input the validator must refuse',
  },
  {
    path: 'mcp/test/syncApi.run.test.ts',
    rules: ['backend commit'],
    text: /aaaaaaaaa$/u,
    why: 'a placeholder in a README the test writes, to prove the sync records no commit of its own',
  },
  {
    path: 'mcp/test/http.apiError.test.ts',
    rules: ['backend file'],
    text: /^\/srv\/app\/main\.py$/u,
    why: 'a made-up server path an error may quote, which the client must not show',
  },
  {
    path: 'mcp/test/tools.flowsGenerateFromSuggestions.test.ts',
    rules: ['backend file'],
    text: /^\/srv\/app\/gen\.py$/u,
    why: 'a made-up traceback of a 5xx answer, which the tool must not show',
  },
  {
    path: 'tests/evals',
    rules: ['local path'],
    why: 'the evaluation tests assert that these paths never reach an answer',
  },
  {
    path: 'mcp/test/architecture.publicRepo.test.ts',
    rules: ['backend file', 'frontend file', 'backend commit', 'private branch', 'local path'],
    why: 'this guard names what it looks for',
  },
];

/** Binary and lock files say nothing of the backend. */
const SKIPPED = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|zip|gz|lock)$|(?:^|\/)package-lock\.json$/u;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && !SKIPPED.test(path));
}

function excepted(path: string, rule: string, text: string): boolean {
  return EXCEPTIONS.some(
    (exception) =>
      path.startsWith(exception.path) &&
      exception.rules.includes(rule) &&
      (exception.text === undefined || exception.text.test(text)),
  );
}

interface Finding {
  readonly where: string;
  readonly rule: string;
  readonly text: string;
}

function findings(): Finding[] {
  const found: Finding[] = [];
  for (const path of trackedFiles()) {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, path), 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;
    content.split('\n').forEach((line, index) => {
      for (const rule of RULES) {
        for (const match of line.matchAll(rule.pattern)) {
          const text = match[0];
          if (excepted(path, rule.name, text)) continue;
          found.push({ where: `${path}:${String(index + 1)}`, rule: rule.name, text });
        }
      }
    });
  }
  return found;
}

describe('the public repository names nothing private', () => {
  it('has no backend file, backend commit, private branch or local path', () => {
    expect(findings().map((item) => `${item.where} [${item.rule}] ${item.text}`)).toEqual([]);
  });

  it.each([
    ['backend file', '// as `api/routes/gatling.py:974-1082` says'],
    ['backend file', 'the gate (`setup_gate.py`)'],
    ['frontend file', 'see frontend/src/features/x/y.ts'],
    ['frontend file', 'as `CorrelationPreview.tsx:20` shows'],
    ['backend commit', 'loadcraft @ d93e08d80'],
    ['backend commit', '(commit 6f9a42e45)'],
    ['backend commit', '"commit": "448dd18de665a349360fcfcee6337f08866c744c"'],
    ['backend commit', 'Source references are backend file:line, see backend_ref'],
    ['private branch', 'merged on cc-plugin'],
    ['local path', '/home/someone/www/x'],
  ])('catches a %s: %s', (rule, line) => {
    const pattern = RULES.find((item) => item.name === rule)?.pattern;
    expect(pattern).toBeDefined();
    expect([...line.matchAll(pattern ?? /$^/u)]).not.toHaveLength(0);
  });

  it.each([
    ['private branch', 'the guard cc-plugin-sec-default of Claude Code'],
    ['backend commit', 'a UUID 6f1d2a40-5b8c-4e7a-9d13-2c0a8e4b7f51'],
    ['frontend file', 'src/render/views/run.ts:72'],
    ['backend commit', '"previousCommit": "a41f9c2d83b05e17c6a94f0b2d38e5a1c7f09b46"'],
  ])('lets a look-alike pass (%s): %s', (rule, line) => {
    const pattern = RULES.find((item) => item.name === rule)?.pattern;
    expect([...line.matchAll(pattern ?? /$^/u)]).toHaveLength(0);
  });

  it('says why for every exception', () => {
    for (const exception of EXCEPTIONS) expect(exception.why.length).toBeGreaterThan(20);
    expect(basename(import.meta.filename)).toBe('architecture.publicRepo.test.ts');
  });
});
