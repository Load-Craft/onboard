// The evaluation case evals/flows-review/: the agent does not compose the scenario before the user
// confirms the flows.
//
// The case runs a model and costs money, so it is not part of this suite. These tests pin what can be
// checked without one: the case keeps its files and limits, each grader matches the calls it is meant
// to catch and nothing else (on synthetic traces, so a weakened pattern turns a test red), the mocks
// show the project before and after the build, and the prompts of the runs that go straight to the
// scenario say that the review of flows is declined while this case's prompt does not.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

const EVALS = join(PACK_ROOT, 'evals');
const CASE = join(EVALS, 'flows-review');
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const MODEL = 'claude-sonnet-5-5';
const DECLINE = /Przeglądu flowów nie potrzebuję[^.]*przejdź od razu do scenariusza/;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function split(path: string): [Record<string, string>, string] {
  const text = read(path);
  const match = /^---\n(.*?)\n---\n?(.*)$/s.exec(text);
  if (match === null) throw new Error(`no front matter: ${path}`);
  const fields: Record<string, string> = {};
  for (const field of (match[1] ?? '').matchAll(/^([\w-]+):[ \t]*(.*?)[ \t]*$/gm)) {
    const key = field[1] ?? '';
    const value = field[2] ?? '';
    fields[key] =
      key === 'pattern' || key === 'input_match' ? value : value.replace(/^['"]+|['"]+$/g, '');
  }
  return [fields, match[2] ?? ''];
}

function grader(name: string): [Record<string, string>, string] {
  return split(join(CASE, 'graders', `${name}.md`));
}

function pattern(value: string): RegExp {
  if (!(value.startsWith("'") && value.endsWith("'"))) throw new Error(`not quoted: ${value}`);
  // The grader patterns are plain ASCII, so the JavaScript dialect reads them as Python does.
  return new RegExp(value.slice(1, -1).replaceAll("''", "'"));
}

/** Python's `json.dumps` puts a space after `,` and `:`; the compact form has none. */
function pythonJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /("(?:[^"\\]|\\.)*")|([,:])/g,
    (_all, str: string | undefined, sep: string | undefined) => str ?? `${sep ?? ''} `,
  );
}

function matches(graderName: string, value: Record<string, unknown>): boolean {
  const [fields] = grader(graderName);
  const re = pattern(fields['input_match'] ?? '');
  const spaced = re.test(pythonJson(value));
  const compact = re.test(JSON.stringify(value));
  expect(spaced, 'compact and spaced JSON disagree').toBe(compact);
  return spaced;
}

function mock(tool: string): string {
  return read(join(CASE, 'mocks', 'lc', `${tool}.md`));
}

describe('FlowsReviewCaseTestCase', () => {
  it('test_case_exists_with_its_files_and_pins_runs_model_and_limits', () => {
    for (const name of ['prompt.md', 'case.yaml', 'scaffold.sh']) {
      expect(isFile(join(CASE, name)), name).toBe(true);
    }
    const [fields, body] = split(join(CASE, 'prompt.md'));
    expect(fields['runs']).toBe('3');
    expect(fields['model']).toBe(MODEL);
    expect(fields['tags'] ?? '').toContain('negative');
    const turns = Number(fields['max_turns'] ?? '0');
    expect(turns >= 10 && turns <= 200).toBe(true);
    const timeout = Number(fields['timeout_seconds'] ?? '0');
    expect(timeout >= 60 && timeout <= 3600).toBe(true);
    for (const gated of ['Bash', 'Write', 'Edit', 'WebFetch']) {
      expect(fields['allowed_tools'] ?? '').not.toContain(gated);
    }
    expect(fields['allowed_tools'] ?? '').toContain('Skill');
    expect(body.trim().length > 0).toBe(true);
    const yaml = read(join(CASE, 'case.yaml'));
    expect([...yaml.matchAll(/^name:\s*(\S+)\s*$/gm)].map((m) => m[1])).toEqual([fields['name']]);
    expect(read(join(CASE, 'scaffold.sh'))).toContain('resume/scaffold.sh');
  });

  it('test_the_request_asks_for_flows_and_a_scenario_and_never_declines_the_review', () => {
    const [, body] = split(join(CASE, 'prompt.md'));
    expect(body).toMatch(/zakupy, przeglądanie i konto/);
    expect(body).toMatch(/złóż z nich scenariusz/);
    expect(body).not.toMatch(/przegląd(?!anie)/i);
    expect(body).not.toMatch(/bez pytania/i);
    expect(body).not.toMatch(/przyjmij opcję zalecaną/i);
  });

  it('test_runs_that_go_straight_to_the_scenario_decline_the_review_in_words', () => {
    for (const name of ['run1-docs', 'run5-protected']) {
      const [, body] = split(join(EVALS, name, 'prompt.md'));
      expect(body, name).toMatch(DECLINE);
    }
  });

  it('test_the_skill_and_the_sentinel_are_graded', () => {
    let [fields] = grader('skill-loaded');
    expect([fields['type'], fields['tool']]).toEqual(['tool_used', 'Skill']);
    expect('{"skill": "loadcraft:loadcraft-test"}').toMatch(pattern(fields['input_match'] ?? ''));
    [fields] = grader('no-sentinel');
    expect([fields['type'], fields['match'], fields['target']]).toEqual([
      'regex',
      'not_contains',
      'trace',
    ]);
  });
});

describe('FlowsReviewGradersTestCase', () => {
  it('test_the_scenario_is_never_built', () => {
    // both tools of the scenario: the proposal of the split and the generation
    for (const [name, tool] of [
      ['no-scenario-suggest-split', 'scenario_suggest_split'],
      ['no-scenario-generate', 'scenario_generate'],
    ] as const) {
      const [fields] = grader(name);
      expect([fields['type'], fields['tool'], fields['min'], fields['max']], name).toEqual([
        'tool_used',
        PREFIX + tool,
        '0',
        '0',
      ]);
    }
  });

  it('test_building_the_flows_is_a_soft_check_because_the_status_mock_answers_by_order', () => {
    // The status mock turns to "four flows" on its second call, so a run that reads the status twice
    // before building sees flows it did not build; that run still proves the checkpoint, so it must
    // not fail the case.
    expect(existsSync(join(CASE, 'graders', 'flows-built.md'))).toBe(false);
    const [fields] = grader('soft-flows-built');
    expect([fields['type'], fields['tool'], fields['min']]).toEqual([
      'tool_used',
      PREFIX + 'flows_generate_from_suggestions',
      '1',
    ]);
  });

  it('test_the_list_of_flows_is_read_with_the_flows_detail', () => {
    const [fields] = grader('lists-all-flows');
    expect([fields['type'], fields['tool'], fields['min']]).toEqual([
      'tool_used',
      PREFIX + 'process_get_status',
      '1',
    ]);
    expect(matches('lists-all-flows', { detail: 'flows' })).toBe(true);
    expect(matches('lists-all-flows', {})).toBe(false);
    expect(matches('lists-all-flows', { detail: 'scenarios' })).toBe(false);
    expect(matches('lists-all-flows', { detail: 'summary' })).toBe(false);
  });

  it('test_the_final_message_must_list_the_flows_and_ask', () => {
    const [fields, body] = grader('asks-before-scenario');
    expect(fields['type']).toBe('llm');
    for (const needle of [
      'zakupy',
      'przeglądanie',
      'konto',
      'rejestracja',
      'earlier session',
      'waits for the answer',
      'FAIL if',
      'does not say that the scenario',
    ]) {
      expect(body, needle).toContain(needle);
    }
  });
});

describe('FlowsReviewMocksTestCase', () => {
  it('test_mocks_name_real_tools', () => {
    const listing = JSON.parse(read(join(EVALS, 'mocks', 'lc', '_tools.json'))) as {
      tools: { name: string }[];
    };
    const known = new Set(listing.tools.map((tool) => tool.name));
    for (const name of readdirSync(join(CASE, 'mocks', 'lc'))) {
      if (!name.endsWith('.md')) continue;
      expect(known.has(name.replace(/\.md$/, '')), name).toBe(true);
    }
  });

  it('test_status_shows_an_earlier_flow_first_and_four_flows_afterwards', () => {
    // The flow from an earlier session is in the project but not in the result of the build:
    // only process_get_status with the flows detail shows it, so listing from the build result alone fails the case.
    const body = mock('process_get_status');
    expect(split(join(CASE, 'mocks', 'lc', 'process_get_status.md'))[0]['type']).toBe('agent');
    const empty = /<empty>\n(.*?)<\/empty>/s.exec(body);
    const built = /<built>\n(.*?)<\/built>/s.exec(body);
    if (empty === null || built === null) throw new Error('status mock lacks <empty> or <built>');
    const emptyText = empty[1] ?? '';
    const builtText = built[1] ?? '';
    expect(emptyText).toContain('1 flow ·');
    expect(emptyText).not.toContain('zakupy');
    expect(builtText).toContain('4 flowy');
    for (const name of ['rejestracja', 'zakupy', 'przeglądanie', 'konto']) {
      expect(builtText, name).toMatch(new RegExp(`^ {2}${name}\\s+\\d+ krok`, 'm'));
    }
    const buildFlows = read(join(EVALS, 'mocks', 'lc', 'flows_generate_from_suggestions.md'));
    expect(buildFlows).not.toContain('rejestracja');
    for (const block of [emptyText, builtText]) {
      expect(block).toContain('konfiguracja kompletna');
      expect(block).toContain('perf ★  domyślne');
    }
  });

  it('test_the_tool_that_must_not_be_called_is_offered_to_the_agent', () => {
    // A mocked server offers only tools that have a mock file; without this one the case proves nothing.
    expect(isFile(join(EVALS, 'mocks', 'lc', 'scenario_suggest_split.md'))).toBe(true);
    expect(isFile(join(EVALS, 'mocks', 'lc', 'scenario_generate.md'))).toBe(true);
    expect(isFile(join(EVALS, 'mocks', 'lc', 'flows_generate_from_suggestions.md'))).toBe(true);
    expect(isFile(join(EVALS, 'mocks', 'lc', 'flows_suggest_journeys.md'))).toBe(true);
  });

  it('test_get_flow_answers_with_the_outline_of_the_first_flow', () => {
    const body = mock('flows_get');
    expect(body).toContain('zakupy · 7 kroków');
    expect(body).toContain('↗ https://app.loadcraft.io/projects/');
    const golden = read(
      join(PACK_ROOT, 'mcp', 'test', 'golden', 'run1', '04-flows_generate_from_suggestions.pl.txt'),
    );
    for (const line of body.replace(/\n+$/, '').split('\n')) {
      expect(golden).toContain(line);
    }
  });
});
