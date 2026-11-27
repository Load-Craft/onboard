import { readFileSync } from 'node:fs';

/**
 * Golden texts of LoadCraft tool results (language `pl`), one directory per mock-up run.
 *
 * A run lists its tool results in call order. A result that is identical in several runs lives
 * once, in the directory of the first run that shows it; later runs point to that file.
 * File name: `<nn>-<tool>[-<variant>].pl.txt`, where `nn` is the call number in the run that owns
 * the file. A `-postep` variant is the progress notification of the call with the same `nn`.
 * Every deliberate difference from the mock-up is listed in `ROZNICE.md`.
 */
export const GOLDEN_RUNS = ['run1', 'run2', 'run3', 'run4', 'run5'] as const;

export type GoldenRun = (typeof GOLDEN_RUNS)[number];

/** Identifiers of the `sklep` world that appear in the golden texts (links and handles). */
export const SKLEP_IDS = {
  project: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61',
  flowZakupy: 'a7d2e914-3c5b-4e8f-b061-9f4c2d7e8a35',
  selfCheckExecution: 'c7702e5a-4b1f-4d93-a6c8-3e9f0b2d7c14',
  executionPerf: '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42',
  executionQa: '8c2d4f17-5e9a-4b3c-9d06-7a1e3f5b2c88',
  recordRun: '2481a3f0-9e6c-4d5b-b7a2-1f8e3c0d6a94',
  setupAnalysis: '6e3f9a1c-2b7d-4c58-8a04-d1f5b9e2c763',
} as const;

const RUN1 = [
  'run1/01a-project_create.pl.txt',
  'run1/01b-project_save_env.pl.txt',
  'run1/01c-project_check_env.pl.txt',
  'run1/01d-project_analyze_setup.pl.txt',
  'run1/01e-project_apply_setup.pl.txt',
  'run1/02-project_connect_telemetry.pl.txt',
  'run1/03-flows_suggest_journeys.pl.txt',
  'run1/04-flows_generate_from_suggestions.pl.txt',
  'run1/05-scenario_suggest_split-propozycja.pl.txt',
  'run1/06-scenario_generate-generowanie.pl.txt',
  'run1/07-data_check_readiness-plan.pl.txt',
  'run1/08-data_create_accounts.pl.txt',
  'run1/08a-data_create_dataset-konta-z-pliku.pl.txt',
  'run1/08b-data_suggest_actions-apply.pl.txt',
  'run1/09-scenario_check_self.pl.txt',
  'run1/09a-run_plan.pl.txt',
  'run1/10-run_start-postep.pl.txt',
  'run1/10-run_start.pl.txt',
  'run1/11-results_get_report.pl.txt',
  'run1/12-results_analyze_run.pl.txt',
] as const;

/** The setup of the project with the documentation (step 01, five results) shared by runs 1-3 and 5. */
const SETUP_WITH_DOCS = [
  'run1/01a-project_create.pl.txt',
  'run1/01b-project_save_env.pl.txt',
  'run1/01c-project_check_env.pl.txt',
  'run1/01d-project_analyze_setup.pl.txt',
  'run1/01e-project_apply_setup.pl.txt',
] as const;

/** Scenario and data provisioning (steps 04-05) shared by runs 1-4; self-check differs per run. */
const SHARED_SCENARIO_AND_DATA = [
  'run1/05-scenario_suggest_split-propozycja.pl.txt',
  'run1/06-scenario_generate-generowanie.pl.txt',
  'run1/07-data_check_readiness-plan.pl.txt',
  'run1/08-data_create_accounts.pl.txt',
] as const;

/** Run, report and diagnosis (steps 06-08) shared by runs 1-4. */
const SHARED_RUN_REPORT_DIAGNOSIS = [
  'run1/09a-run_plan.pl.txt',
  'run1/10-run_start-postep.pl.txt',
  'run1/10-run_start.pl.txt',
  'run1/11-results_get_report.pl.txt',
  'run1/12-results_analyze_run.pl.txt',
] as const;

/** Run → golden files in the order the tool results appear in that run. */
export const GOLDEN_FILES: Readonly<Record<GoldenRun, readonly string[]>> = {
  run1: RUN1,
  run2: [
    ...SETUP_WITH_DOCS,
    'run1/02-project_connect_telemetry.pl.txt',
    'run2/03-flows_generate_from_endpoints.pl.txt',
    'run1/03-flows_suggest_journeys.pl.txt',
    'run2/05-flows_generate_from_suggestions.pl.txt',
    ...SHARED_SCENARIO_AND_DATA,
    'run2/10-scenario_check_self-naprawa.pl.txt',
    ...SHARED_RUN_REPORT_DIAGNOSIS,
  ],
  run3: [
    ...SETUP_WITH_DOCS,
    'run1/02-project_connect_telemetry.pl.txt',
    'run3/03-flows_describe_journeys.pl.txt',
    'run3/04-flows_record_journeys-postep.pl.txt',
    'run3/04-flows_record_journeys.pl.txt',
    ...SHARED_SCENARIO_AND_DATA,
    'run3/09-scenario_check_self-rabat.pl.txt',
    ...SHARED_RUN_REPORT_DIAGNOSIS,
  ],
  run4: [
    'run1/01a-project_create.pl.txt',
    'run1/01b-project_save_env.pl.txt',
    'run1/01c-project_check_env.pl.txt',
    'run4/01d-project_analyze_setup-without-docs.pl.txt',
    'run4/01e-project_apply_setup-without-docs.pl.txt',
    'run1/02-project_connect_telemetry.pl.txt',
    'run4/03-flows_import_har.pl.txt',
    'run4/04-flows_generate_from_har.pl.txt',
    ...SHARED_SCENARIO_AND_DATA,
    'run1/09-scenario_check_self.pl.txt',
    ...SHARED_RUN_REPORT_DIAGNOSIS,
  ],
  run5: [
    ...SETUP_WITH_DOCS,
    'run1/02-project_connect_telemetry.pl.txt',
    'run5/03-project_import_docs.pl.txt',
    'run5/03-flows_suggest_journeys-po-aktualizacji.pl.txt',
    'run1/04-flows_generate_from_suggestions.pl.txt',
    'run1/05-scenario_suggest_split-propozycja.pl.txt',
    'run1/06-scenario_generate-generowanie.pl.txt',
    'run5/08-data_check_readiness-plan-qa.pl.txt',
    'run5/08a-data_create_accounts-qa.pl.txt',
    'run1/09-scenario_check_self.pl.txt',
    'run5/09a-run_plan-qa.pl.txt',
    'run5/11-run_start-qa-postep.pl.txt',
    'run5/11-run_start-qa.pl.txt',
    'run5/12-results_get_report-qa.pl.txt',
  ],
};

const SUFFIX = '.pl.txt';

/** Base name of a golden file: `run1/04-flows_generate_from_suggestions.pl.txt` → `04-flows_generate_from_suggestions`. */
export function goldenName(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith(SUFFIX) ? base.slice(0, -SUFFIX.length) : base;
}

/** Absolute URL of a golden file given as `runN/<name>.pl.txt`. */
export function goldenUrl(file: string): URL {
  return new URL(`./${file}`, import.meta.url);
}

/**
 * Expected text of a tool result in a run. `name` is the base name as listed for that run
 * (e.g. `goldenText('run2', '03-flows_suggest_journeys')` reads the file shared with run 1).
 */
export function goldenText(run: GoldenRun, name: string): string {
  const wanted = goldenName(name);
  const file = GOLDEN_FILES[run].find((f) => goldenName(f) === wanted);
  if (file === undefined) {
    throw new Error(`no golden file "${wanted}" in ${run}`);
  }
  return readFileSync(goldenUrl(file), 'utf8');
}
