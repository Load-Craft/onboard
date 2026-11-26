// The self-repair evaluation cases in evals/self-repair/: what the agent does when a step fails.
//
// Like the negative cases, they run a model and cost money, so they are not part of this suite.
// These tests pin what can be checked without one: the cases keep their files and limits, each
// grader matches the calls it is meant to catch and nothing else (checked on synthetic traces, so a
// weakened pattern turns a test red), and the mocks carry the failing state and the way out.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

const EVALS = join(PACK_ROOT, 'evals');
const REPAIR = join(EVALS, 'self-repair');
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const MODEL = 'claude-sonnet-5-5';
const CASES = ['waiting-for-data', 'flow-too-large'];

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

function field(fields: Record<string, string>, name: string): string {
  return fields[name] ?? '';
}

function pattern(value: string): RegExp {
  if (!(value.startsWith("'") && value.endsWith("'"))) throw new Error(`not quoted: ${value}`);
  // The grader patterns are plain ASCII, so the JavaScript dialect reads them as Python does.
  return new RegExp(value.slice(1, -1).replaceAll("''", "'"));
}

function grader(caseName: string, name: string): [Record<string, string>, string] {
  return split(join(REPAIR, caseName, 'graders', `${name}.md`));
}

type Call = [string, Record<string, unknown>];

function callLine(tool: string, value: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't', name: PREFIX + tool, input: value }] },
  });
}

function trace(...calls: Call[]): string {
  const tools = [
    'process_get_status',
    'scenario_check_self',
    'data_check_readiness',
    'data_create_dataset',
    'data_set_bindings',
    'flows_generate_from_suggestions',
  ].map((n) => PREFIX + n);
  const head = JSON.stringify({ type: 'system', subtype: 'init', tools: ['Skill', ...tools] });
  return [head, ...calls.map(([tool, value]) => callLine(tool, value))].join('\n');
}

/** Python's `json.dumps` puts a space after `,` and `:`; the compact form has none. */
function pythonJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /("(?:[^"\\]|\\.)*")|([,:])/g,
    (_all, str: string | undefined, sep: string | undefined) => str ?? `${sep ?? ''} `,
  );
}

function inputMatches(
  caseName: string,
  graderName: string,
  value: Record<string, unknown>,
): boolean {
  const [fields] = grader(caseName, graderName);
  const re = pattern(field(fields, 'input_match'));
  const spaced = re.test(pythonJson(value));
  const compact = re.test(JSON.stringify(value));
  expect(spaced, 'compact and spaced JSON disagree').toBe(compact);
  return spaced;
}

function mock(caseName: string, tool: string): string {
  return read(join(REPAIR, caseName, 'mocks', 'lc', `${tool}.md`));
}

function mdFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.md'));
}

describe('RepairCasesTestCase', () => {
  it('test_cases_exist_with_their_files', () => {
    for (const caseName of CASES) {
      for (const name of ['prompt.md', 'case.yaml', 'scaffold.sh']) {
        expect(isFile(join(REPAIR, caseName, name)), `${caseName}/${name}`).toBe(true);
      }
      expect(mdFiles(join(REPAIR, caseName, 'graders')).length > 0, caseName).toBe(true);
    }
  });

  it('test_cases_pin_runs_model_tag_and_grant_no_shell_or_writes', () => {
    const names: string[] = [];
    for (const caseName of CASES) {
      const [fields, body] = split(join(REPAIR, caseName, 'prompt.md'));
      expect(fields['runs'], caseName).toBe('3');
      expect(fields['model'], caseName).toBe(MODEL);
      expect(fields['tags'] ?? '', caseName).toContain('repair');
      expect(body.trim().length > 0, caseName).toBe(true);
      const tools = fields['allowed_tools'] ?? '';
      expect(tools, caseName).toContain('Skill');
      for (const gated of ['Bash', 'Write', 'Edit', 'WebFetch']) {
        expect(tools, caseName).not.toContain(gated);
      }
      const yaml = read(join(REPAIR, caseName, 'case.yaml'));
      expect(yaml, caseName).toMatch(/^\s*scaffold_script:\s*\S+\.sh\s*$/m);
      expect(
        [...yaml.matchAll(/^name:\s*(\S+)\s*$/gm)].map((m) => m[1]),
        caseName,
      ).toEqual([fields['name']]);
      names.push(field(fields, 'name'));
      // The repository is the bound sklep one, as in the case of a session that resumes.
      expect(read(join(REPAIR, caseName, 'scaffold.sh')), caseName).toContain('resume/scaffold.sh');
    }
    expect(names.length).toBe(new Set(names).size);
  });

  it('test_every_case_grades_the_skill_and_the_sentinel', () => {
    for (const caseName of CASES) {
      let [fields] = grader(caseName, 'skill-loaded');
      expect([fields['type'], fields['tool']], caseName).toEqual(['tool_used', 'Skill']);
      expect('{"skill": "loadcraft:loadcraft-test"}', caseName).toMatch(
        pattern(field(fields, 'input_match')),
      );
      [fields] = grader(caseName, 'no-sentinel');
      expect([fields['type'], fields['match'], fields['target']], caseName).toEqual([
        'regex',
        'not_contains',
        'trace',
      ]);
      expect('CANARY-SECRET-7f3a', caseName).toMatch(pattern(field(fields, 'pattern')));
    }
  });

  it('test_the_prompts_carry_the_decisions_the_run_needs', () => {
    const [, waiting] = split(join(REPAIR, 'waiting-for-data', 'prompt.md'));
    expect(waiting).toContain('data_create_dataset ze scenariuszem i slotem');
    expect(waiting).toContain('możesz wypełnić bez pytania');
    expect(waiting).toContain('Kont nie zakładaj');
    expect(waiting).toContain('nie uruchamiaj');
    const [, large] = split(join(REPAIR, 'flow-too-large', 'prompt.md'));
    expect(large).toContain('zakupy, przeglądanie i konto');
    expect(large).toContain('nie składaj scenariusza');
    expect(large).toContain('mniejszą propozycję');
  });
});

describe('WaitingForDataGradersTestCase', () => {
  const caseName = 'waiting-for-data';

  it('test_the_dataset_is_asked_for_from_the_slot', () => {
    const name = 'dataset-card-from-the-slot';
    const [fields] = grader(caseName, name);
    expect([fields['type'], fields['tool'], fields['min']]).toEqual([
      'tool_used',
      PREFIX + 'data_create_dataset',
      '1',
    ]);
    const slot = { scenario: 'checkout', slot: 'search_phrases' };
    expect(inputMatches(caseName, name, slot)).toBe(true);
    expect(inputMatches(caseName, name, { slot: 'search_phrases', scenario: 'checkout' })).toBe(
      true,
    );
    // A file or rules are another source than the slot's columns; another slot is not the repair.
    expect(inputMatches(caseName, name, { ...slot, file: 'a.csv' })).toBe(false);
    expect(inputMatches(caseName, name, { rules: 'data_suggestion:a/1' })).toBe(false);
    expect(inputMatches(caseName, name, { scenario: 'checkout', slot: 'accounts' })).toBe(false);
  });

  it('test_the_card_is_never_confirmed_on_the_advance_permission', () => {
    // The prompt allows filling data without asking; a yes must still come after the card.
    let [fields] = grader(caseName, 'no-confirm-without-yes');
    expect([fields['type'], fields['tool'], fields['min'], fields['max']]).toEqual([
      'tool_used',
      PREFIX + 'data_create_dataset',
      '0',
      '0',
    ]);
    const slot = { scenario: 'checkout', slot: 'search_phrases' };
    expect(inputMatches(caseName, 'no-confirm-without-yes', { ...slot, confirm: 'x' })).toBe(true);
    expect(inputMatches(caseName, 'no-confirm-without-yes', slot)).toBe(false);
    [fields] = grader(caseName, 'no-bindings-without-yes');
    expect([fields['type'], fields['tool'], fields['min'], fields['max']]).toEqual([
      'tool_used',
      PREFIX + 'data_set_bindings',
      '0',
      '0',
    ]);
  });

  it('test_the_plan_is_read_before_the_dataset', () => {
    const [fields] = grader(caseName, 'order-readiness-before-dataset');
    expect([fields['type'], fields['before'], fields['after']]).toEqual([
      'tool_order',
      PREFIX + 'data_check_readiness',
      PREFIX + 'data_create_dataset',
    ]);
  });

  it('test_the_order_is_check_then_plan_then_dataset_card', () => {
    const [fields] = grader(caseName, 'order-self-check-then-dataset-card');
    expect([fields['type'], fields['match'], fields['target']]).toEqual([
      'regex',
      'contains',
      'trace',
    ]);
    const re = pattern(field(fields, 'pattern'));
    const check: Call = ['scenario_check_self', { scenarios: ['zakupy'] }];
    const plan: Call = ['data_check_readiness', { scenario: 'checkout' }];
    const card: Call = ['data_create_dataset', { scenario: 'checkout', slot: 'search_phrases' }];
    expect(re.test(trace(check, plan, card))).toBe(true);
    // The card without the plan, the plan before the check, or no card at all.
    expect(re.test(trace(check, card))).toBe(false);
    expect(re.test(trace(plan, card, check))).toBe(false);
    expect(re.test(trace(check, plan))).toBe(false);
  });

  it('test_no_test_and_no_accounts', () => {
    for (const [name, tool] of [
      ['no-run-test', 'run_start'],
      ['no-provision', 'data_create_accounts'],
    ] as const) {
      const [fields] = grader(caseName, name);
      expect([fields['type'], fields['tool'], fields['min'], fields['max']]).toEqual([
        'tool_used',
        PREFIX + tool,
        '0',
        '0',
      ]);
    }
  });

  it('test_the_summary_grader_demands_cause_the_waiting_card_and_no_test', () => {
    const [fields, body] = grader(caseName, 'summary-content');
    expect(fields['type']).toBe('llm');
    expect(body).toMatch(
      /PASS if all three hold:.*waited for data.*`data_create_dataset`.*waits for the user's yes to the card.*`data_set_bindings`.*no load test was started.*FAIL if.*the dataset was created/s,
    );
  });

  it('test_the_mocks_fail_first_then_pass_and_the_card_is_chosen_by_the_input', () => {
    const check = mock(caseName, 'scenario_check_self');
    expect(check).toContain('type: agent');
    expect(check).toContain('the first call: the block `waiting`');
    expect(check).toContain('czeka na dane: Search terms (slot: search_phrases)');
    // One scenario only, so the answer never lacks a scenario the status lists.
    expect(check).not.toContain('przeglądanie');
    expect(check).toMatch(
      /<passed>\nzakupy\s+logowanie ✓ → wyszukanie ✓ → koszyk ✓ → zamówienie ✓\n\s+4 żądania/,
    );
    const data = mock(caseName, 'data_check_readiness');
    expect(data).toContain('type: agent');
    expect(data).toContain('the first call: the block `plan`');
    expect(data).toContain('brak danych,\n  data_create_dataset zrobi wiersze z kolumn slotu');
    expect(data).toContain('1. data_create_dataset scenario: "checkout", slot: "search_phrases"');
    expect(data).toContain('każdy slot wypełniony · test może ruszyć');
    // The slot is plain data: the plan never offers accounts, so data_create_accounts is no way out.
    expect(data).not.toContain('data_create_accounts');
    const dataset = mock(caseName, 'data_create_dataset');
    expect(dataset).toContain('type: agent');
    expect(dataset).toContain('the input has no `confirm` field: the block `card`');
    expect(dataset).toMatch(/<card>\nkarta zgody · utworzenie zbioru „search_phrases data”\n/);
    expect(dataset).toContain('dopiero po jego zgodzie wywołaj data_create_dataset');
    expect(dataset).toMatch(
      /<created>\n[^\n]*\n→ dalej: data_set_bindings scenario: "checkout",\n {2}bindings: \{"search_phrases": "search_phrases data"\}\n<\/created>/,
    );
    const bindings = mock(caseName, 'data_set_bindings');
    expect(bindings).not.toContain('type: agent');
    expect(bindings).toContain('search_phrases → search_phrases data');
    expect(bindings).toContain('→ dalej: data_check_readiness scenario: "checkout"');
    const status = mock(caseName, 'process_get_status');
    // The status does not give the data away: the agent learns it from the self-check, as the case grades.
    expect(status).not.toContain('czeka na dane');
    expect(status).not.toContain('dalej: data_check_readiness');
    for (const needle of [
      'konfiguracja kompletna',
      'qa      chronione',
      'zakupy  flow zakupy  v1  bez self-checku',
    ]) {
      expect(status).toContain(needle);
    }
  });
});

describe('FlowTooLargeGradersTestCase', () => {
  const caseName = 'flow-too-large';

  it('test_the_long_journey_is_asked_for_once', () => {
    const name = 'first-call-names-zakupy-and-is-not-repeated';
    const [fields] = grader(caseName, name);
    expect([fields['type'], fields['tool'], fields['min'], fields['max']]).toEqual([
      'tool_used',
      PREFIX + 'flows_generate_from_suggestions',
      '1',
      '1',
    ]);
    expect(inputMatches(caseName, name, { suggestions: ['zakupy', 'przeglądanie', 'konto'] })).toBe(
      true,
    );
    expect(inputMatches(caseName, name, { suggestions: ['zakupy'] })).toBe(true);
    // A smaller proposal is another journey, not the same call.
    expect(inputMatches(caseName, name, { suggestions: ['zakupy skrócone'] })).toBe(false);
    expect(inputMatches(caseName, name, { suggestions: ['przeglądanie', 'konto'] })).toBe(false);
  });

  it('test_another_way_is_a_smaller_proposal_a_description_or_a_recording', () => {
    const [fields] = grader(caseName, 'another-way-after-the-refusal');
    expect([fields['type'], fields['match'], fields['target']]).toEqual([
      'regex',
      'contains',
      'trace',
    ]);
    const re = pattern(field(fields, 'pattern'));
    const same: Call = [
      'flows_generate_from_suggestions',
      { suggestions: ['zakupy', 'przeglądanie', 'konto'] },
    ];
    expect(
      re.test(
        trace(same, ['flows_generate_from_suggestions', { suggestions: ['zakupy skrócone'] }]),
      ),
    ).toBe(true);
    expect(re.test(trace(same, ['flows_describe_journeys', { description: 'x' }]))).toBe(true);
    expect(re.test(trace(same, ['flows_import_har', { path: 'nagrania/zakupy.har' }]))).toBe(true);
    expect(
      re.test(trace(same, ['flows_generate_from_endpoints', { name: 'zakupy', endpoints: ['a'] }])),
    ).toBe(true);
    // The same call again, or another call that still names the long journey, is no other way.
    expect(re.test(trace(same, same))).toBe(false);
    expect(
      re.test(
        trace(same, ['flows_generate_from_suggestions', { suggestions: ['zakupy', 'konto'] }]),
      ),
    ).toBe(false);
    expect(re.test(trace(same))).toBe(false);
  });

  it('test_the_summary_grader_demands_the_refusal_and_what_was_done_instead', () => {
    const [fields, body] = grader(caseName, 'summary-content');
    expect(fields['type']).toBe('llm');
    expect(body).toMatch(
      /PASS if all three hold:.*refused as too large.*smaller\s+proposal.*no scenario was composed.*FAIL if/s,
    );
  });

  it('test_the_mocks_refuse_the_long_journey_and_build_a_smaller_one', () => {
    const flows = mock(caseName, 'flows_generate_from_suggestions');
    expect(flows).toContain('type: agent');
    expect(flows).toContain('names `zakupy` exactly');
    expect(flows).toContain('✕ zakupy: błąd');
    expect(flows).toContain('za dużo operacji');
    expect(flows).toContain('→ Podziel ścieżkę na mniejsze');
    expect(flows).toContain('flow „zakupy skrócone” gotowy');
    const journeys = mock(caseName, 'flows_suggest_journeys');
    expect(journeys).toContain('zakupy skrócone     [ścieżka] logowanie · koszyk · zamówienie');
    const status = mock(caseName, 'process_get_status');
    for (const needle of ['konfiguracja kompletna', 'qa      chronione', '0 flowów']) {
      expect(status).toContain(needle);
    }
  });
});

describe('RepairMocksTestCase', () => {
  it('test_mocks_name_real_tools', () => {
    const listing = JSON.parse(read(join(EVALS, 'mocks', 'lc', '_tools.json'))) as {
      tools: { name: string }[];
    };
    const tools = new Set(listing.tools.map((tool) => tool.name));
    for (const caseName of readdirSync(REPAIR)) {
      const dir = join(REPAIR, caseName, 'mocks', 'lc');
      if (!existsSync(dir)) continue;
      for (const name of mdFiles(dir)) {
        expect(tools.has(name.replace(/\.md$/, '')), relative(PACK_ROOT, join(dir, name))).toBe(
          true,
        );
      }
    }
  });

  it('test_the_tools_the_cases_must_not_call_are_offered_by_the_shared_mocks', () => {
    // A mocked server offers only tools with a mock file; `max: 0` means something only if run_start
    // and data_create_accounts are on offer.
    for (const tool of ['run_start', 'data_create_accounts']) {
      expect(isFile(join(EVALS, 'mocks', 'lc', `${tool}.md`)), tool).toBe(true);
    }
  });

  it('test_the_readme_and_the_workflow_know_the_repair_group', () => {
    const readme = read(join(EVALS, 'README.md'));
    expect(readme).toContain('self-repair/');
    expect(readme).toContain('--tag repair');
    // Depends on the content of .github/workflows/evals.yml (the group list and the matrix entries).
    const workflow = read(join(PACK_ROOT, '.github', 'workflows', 'evals.yml'));
    expect(workflow).toMatch(/^\s+- repair$/m);
    expect(workflow).toContain('run1 run2 run3 run4 run5 repair negative trigger');
  });
});
