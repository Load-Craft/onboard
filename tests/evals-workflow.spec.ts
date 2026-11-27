// The workflow that runs the plugin evaluations (.github/workflows/evals.yml).
//
// The evaluations cost money and use an API key, so the workflow must start by hand only, keep a hard
// cost ceiling, take the key from the repository secrets and upload its results as artifacts. These
// tests read the workflow as text and run its gate script on synthetic results.
//
// The workflow-dependent parts: every test of "WorkflowShape" and "GateScript" reads evals.yml; the
// "GateScript" tests also run the embedded gate script with node (heredoc `GATE`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

const WORKFLOW = join(PACK_ROOT, '.github', 'workflows', 'evals.yml');
const EVALS = join(PACK_ROOT, 'evals');
const GROUPS = ['run1', 'run2', 'run3', 'run4', 'run5', 'repair', 'negative', 'trigger'];

function text(): string {
  return readFileSync(WORKFLOW, 'utf8');
}

/** Every file named `name` under `dir` (`Path.rglob`). */
function rglob(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...rglob(path, name));
    else if (entry === name) found.push(path);
  }
  return found;
}

function onBlock(source: string): string {
  const match = /^on:\n((?:[ \t]+.*\n|\n)*)/m.exec(source);
  if (match === null) throw new Error('no top-level `on:` block');
  return match[1] ?? '';
}

/** `textwrap.dedent`: drops the whitespace prefix common to every non-blank line. */
function dedent(source: string): string {
  const lines = source.split('\n');
  let common: string | undefined;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (common === undefined) {
      common = indent;
      continue;
    }
    let length = 0;
    while (length < common.length && length < indent.length && common[length] === indent[length]) {
      length += 1;
    }
    common = common.slice(0, length);
  }
  const prefix = common ?? '';
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(prefix.length))).join('\n');
}

function gateScript(): string {
  const match = /<<'GATE'\n(.*?)\n[ \t]*GATE\n/s.exec(text());
  if (match === null) throw new Error('no gate script (heredoc GATE) in the workflow');
  return dedent(match[1] ?? '');
}

type Grader = { name: string; passed: boolean };
type EvalCase = {
  name: string;
  aggregates: { passRate: number };
  arms: { with: { graders: Grader[] }[] };
};

/** Runs the embedded gate script (a Node ES module) and returns its exit status. */
function runGate(group: string, cases: EvalCase[]): number {
  const tmp = mkdtempSync(join(tmpdir(), 'lc-gate-'));
  try {
    const script = join(tmp, 'gate.mjs');
    writeFileSync(script, gateScript(), 'utf8');
    const result = join(tmp, 'aggregate-result.json');
    writeFileSync(result, JSON.stringify({ cases }), 'utf8');
    const run = spawnSync(process.execPath, [script, group, result], { encoding: 'utf8' });
    if (run.error !== undefined) throw run.error;
    return run.status ?? -1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function makeCase(
  name: string,
  runs: [string, boolean][][],
  passRate: number | undefined = undefined,
): EvalCase {
  const arms = runs.map((graders) => ({
    graders: graders.map(([graderName, passed]) => ({ name: graderName, passed })),
  }));
  const rate =
    passRate ??
    runs.filter((graders) => graders.every(([, passed]) => passed)).length / runs.length;
  return { name, aggregates: { passRate: rate }, arms: { with: arms } };
}

function repeat<T>(item: T, times: number): T[] {
  return Array.from({ length: times }, () => item);
}

describe('WorkflowShape', () => {
  it('test_exists', () => {
    expect(statSync(WORKFLOW).isFile()).toBe(true);
  });

  it('test_starts_by_hand_only', () => {
    const block = onBlock(text());
    expect(block).toContain('workflow_dispatch');
    for (const trigger of [
      'push',
      'pull_request',
      'schedule',
      'workflow_run',
      'release',
      'tags',
      'workflow_call',
    ]) {
      expect(block, `\`${trigger}\` would start the evaluations by itself`).not.toMatch(
        new RegExp(`\\b${trigger}\\b`),
      );
    }
  });

  it('test_read_only_token', () => {
    expect(text()).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(text()).not.toMatch(/^\s+(contents|actions|packages|id-token): write/m);
  });

  it('test_hard_cost_ceiling', () => {
    const source = text();
    expect(source).toContain('--max-cost-usd');
    expect(source).toMatch(/^\s+max_cost_usd:\n(?:\s+.*\n)*?\s+default: ['"]?\d+/m);
    expect(source).toMatch(/HARD_CEILING_USD: ['"]?\d+/);
    expect(source).toContain('exceeds the ceiling');
    expect(source).toMatch(/timeout-minutes: \d+/);
  });

  it('test_cost_flag_is_in_every_eval_call', () => {
    const calls = text().match(/^\s+claude plugin eval \.(?:[^\n\\]|\\\n)*/gm) ?? [];
    expect(calls.length > 0).toBe(true);
    for (const call of calls) {
      expect(call).toContain('--max-cost-usd');
      expect(call).toContain('--no-publish');
      expect(call).toContain('--trust-plugin');
      expect(call).toContain('--scaffold');
      expect(call).toContain('--ablation none');
    }
  });

  it('test_pinned_model_and_cli', () => {
    const source = text();
    const pinned = new Set(
      rglob(EVALS, 'prompt.md').map((prompt) => {
        const match = /^model: (\S+)/m.exec(readFileSync(prompt, 'utf8'));
        if (match === null) throw new Error(`no model in ${prompt}`);
        return match[1] ?? '';
      }),
    );
    expect(pinned.size, [...pinned].join(',')).toBe(1);
    const [model] = [...pinned];
    expect(source).toContain(`default: ${model}`);
    expect(source).toMatch(/CLAUDE_CODE_VERSION: \d+\.\d+\.\d+\n/);
    expect(source).toContain('@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"');
    expect(source).not.toMatch(/claude-code@(latest|next)/);
  });

  it('test_secret_comes_from_the_secret_store_only', () => {
    const source = text();
    expect(source).toContain('${{ secrets.ANTHROPIC_API_KEY }}');
    const refs = new Set([...source.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]));
    expect(refs).toEqual(new Set(['ANTHROPIC_API_KEY']));
    expect(source).not.toMatch(/sk-ant-|sk-[A-Za-z0-9]{20,}/);
    expect(source).not.toMatch(/ANTHROPIC_API_KEY:\s*['"]?[A-Za-z0-9_-]{8,}['"]?\s*$/);
    expect(source).toMatch(/::error::[^\n]*ANTHROPIC_API_KEY/);
  });

  it('test_results_go_to_artifacts_not_the_repo', () => {
    const source = text();
    expect(source).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}/);
    expect(source).toMatch(/if: always\(\)/);
    expect(source).toMatch(/retention-days: \d+/);
    expect(source).not.toMatch(/git (add|commit|push)/);
  });

  it('test_actions_are_pinned_to_a_commit', () => {
    const uses = [...text().matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? '');
    expect(uses.length > 0).toBe(true);
    for (const ref of uses) {
      expect(ref).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('test_inputs_never_reach_a_shell_directly', () => {
    text()
      .split('\n')
      .forEach((line, index) => {
        if (line.includes('${{ inputs.') || line.includes('${{ github.event.inputs.')) {
          expect(line, `line ${index + 1}: ${line}`).toMatch(
            /^\s+[A-Z_]+: \$\{\{ (github\.event\.)?inputs\.\w+ \}\}\s*$/,
          );
        }
      });
  });

  it('test_public_repo_no_private_references', () => {
    const source = text();
    for (const privatePart of [
      '/home/',
      'docs/plugin-mcp',
      'web/docs',
      'loadcraft-wt',
      'onboard-wt',
      '_koord',
    ]) {
      expect(source).not.toContain(privatePart);
    }
  });

  it('test_groups_match_the_tags_of_the_cases', () => {
    const tags = new Set<string>();
    for (const prompt of rglob(EVALS, 'prompt.md')) {
      const match = /^tags: \[(.*)\]/m.exec(readFileSync(prompt, 'utf8'));
      if (match !== null) {
        for (const tag of (match[1] ?? '').split(',')) tags.add(tag.trim());
      }
    }
    const source = text();
    for (const group of GROUPS) {
      expect(tags.has(group), `no case carries the tag ${group}`).toBe(true);
      expect(source).toMatch(new RegExp(`\\b${group}\\b`));
    }
    expect(source).toMatch(/--tag "?\$/);
  });

  it('test_no_shell_grant_and_no_unneeded_installs', () => {
    const source = text();
    expect(source).not.toContain('--allow-tools');
    expect(source).not.toContain('bubblewrap');
  });
});

describe('GateScript', () => {
  it('test_rate_groups', () => {
    const ok = makeCase('run2-manual', repeat([['a', true]], 3));
    const twoOfThree = makeCase('run2-manual', [[['a', true]], [['a', true]], [['a', false]]]);
    const oneOfThree = makeCase('run2-manual', [[['a', true]], [['a', false]], [['a', false]]]);
    expect(runGate('run2', [ok])).toBe(0);
    expect(runGate('run2', [twoOfThree])).toBe(0);
    expect(runGate('run2', [oneOfThree])).not.toBe(0);
    expect(runGate('run2', [])).not.toBe(0);
  });

  it('test_negative_hard_graders', () => {
    const good = makeCase(
      'secret-stays-local-env-account',
      repeat(
        [
          ['skill-loaded', true],
          ['soft-no-env-read', false],
        ],
        3,
      ),
    );
    const bad = makeCase('secret-stays-local-env-account', [
      [['skill-loaded', true]],
      [['no-sentinel', false]],
      [['skill-loaded', true]],
    ]);
    expect(runGate('negative', [good])).toBe(0);
    expect(runGate('negative', [bad])).not.toBe(0);
  });

  it('test_trigger_groups', () => {
    const positives = (passing: number): EvalCase[] =>
      Array.from({ length: 6 }, (_, i) =>
        makeCase(
          `trigger-positive-${i}`,
          repeat([['skill-loaded', i < passing]], 3),
          i < passing ? 1.0 : 0.0,
        ),
      );
    const negative = makeCase(
      'trigger-negative-x',
      repeat(
        [
          ['skill-not-loaded', true],
          ['no-loadcraft-tool', true],
        ],
        3,
      ),
    );
    const negativeBad = makeCase(
      'trigger-negative-x',
      repeat(
        [
          ['skill-not-loaded', true],
          ['no-loadcraft-tool', false],
        ],
        3,
      ),
    );
    expect(runGate('trigger', [...positives(6), negative])).toBe(0);
    expect(runGate('trigger', [...positives(5), negative])).toBe(0);
    expect(runGate('trigger', [...positives(4), negative])).not.toBe(0);
    expect(runGate('trigger', [...positives(6), negativeBad])).not.toBe(0);
  });
});

describe('Documented', () => {
  it('test_readme_describes_the_workflow', () => {
    const readme = readFileSync(join(EVALS, 'README.md'), 'utf8');
    expect(readme).toContain('evals.yml');
    expect(readme).toContain('ANTHROPIC_API_KEY');
    expect(readme).toContain('workflow_dispatch');
  });
});
