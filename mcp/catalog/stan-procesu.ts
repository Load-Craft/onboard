// loadcraft/.cache/state.json — schemat 3 (katalog narzędzi, wersja 3).
// Stan procesu obok dzisiejszych sekcji cache. Słowa użytkownika: dataset, run, docs, env, walk.
// Nazwy backendu (feeder_id, execution_id, openapi_spec_id, environment_id) żyją tylko w kodzie klienta.
import * as z from 'zod';

// Limity listy. Reduktor PRZYCINA (pruneProcess) przed walidacją; schemat tylko pilnuje, że po przycięciu mieszczą się.
export const LIMITS = {
  log: 300, reads: 100, pending: 50, operations: 50, problems: 50,
  finished_card_hours: 24,                               // karty zakończone starsze niż tyle znikają
  finished_operation_hours: 24,                          // operacje done/failed/cancelled/lost starsze niż tyle znikają
  log_details: { hours: 24, entry_kb: 8, total_mb: 2 },  // sekcja cache logDetails: termin, rozmiar wpisu, razem
  options: 200, picked: 500, pending_options_total: 1000, // opcje jednej karty, zaznaczenia, opcje wszystkich kart razem
  op_payloads: 50, run_loads: 50, call_progress: 50,     // liczba wpisów sekcji cache
  call_progress_ttl_min: 10,                             // postęp wywołania bez uchwytu żyje tyle minut
  // widok self-checku (selfCheckViews): wpisy sekcji, scenariusze na widok, kroki na scenariusz i na widok, przebiegi, rundy
  // naprawy, rozmiar widoku w KB, termin w godzinach (widok zostaje po końcu operacji do następnej albo do terminu)
  self_check: { views: 10, scenarios: 20, steps: 60, steps_total: 400, runs: 4, repairs: 4, view_kb: 96, hours: 24 },
  // sekcje treści z terminem ważności i limitem liczby wpisów (KATALOG.md, sekcja 6: „trzymają treść z terminem ważności”)
  list_items: 1000, list_entry_kb: 256, suggestions_total_mb: 1,   // listy flowów i przebiegów w cache (ref + format=data)
  suggestions: { hours: 24, max: 50 }, harSessions: { hours: 24, max: 20 }, drafts: { hours: 168, max: 50 },
  account_series: { days: 7, max: 100 },                 // seria zakładania kont: baseline i count na zbiór
} as const;
// Kody błędów, które rzuca albo zwraca kod schematu (nie rejestr): jedna lista, żeby strażnik kodów pluginu obejmował też
// ten plik. SchemaError jest zgodny z ToolError: ma pole `code` (jeden z SCHEMA_ERROR_CODES) i `message` równy kodowi.
//   env_missing          brak środowiska w całym łańcuchu precedencji (freezeArgs, effectiveEnv)
//   new_project_pending  drugi project_create, gdy pod `_new` czeka już karta z project_create (canOpenProjectCard)
export const SCHEMA_ERROR_CODES = ['env_missing', 'new_project_pending'] as const;
export type SchemaErrorCode = (typeof SCHEMA_ERROR_CODES)[number];
export class SchemaError extends Error {
  readonly code: SchemaErrorCode;
  constructor(code: SchemaErrorCode) {
    super(code);
    this.name = 'SchemaError';
    this.code = code;
  }
}
// Klucz procesu przed utworzeniem projektu (pierwsza karta to project_create): po jego wykonaniu plugin (bindProject w
// rebind.ts) przenosi cały proces pod klucz projektu jednym zapisem; schemat nie ma własnej funkcji przenoszenia.
export const NEW_KEY = '_new';

const Uuid = z.string().uuid();
const Iso = z.string().datetime();
const Short = (max: number) => z.string().max(max);

export const MODULES = ['project', 'flows', 'scenario', 'data', 'run', 'results',
  'traffic', 'functional', 'github'] as const;
export const PIPELINE = ['project', 'flows', 'scenario', 'data', 'run', 'results'] as const;
const Module = z.enum(MODULES);
const Owner = Module.or(z.literal('process'));
const Level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
// Skąd wywołanie: serwer MCP nie zna „moda” ani subagentów. Argument `from_panel` jest WYCOFANY (PROJ-04: zgodę daje
// pytanie serwera, a nie okno moda), więc nikt nie ustawia 'panel'; wartość zostaje w enum, bo pole z jedną wartością
// jest zgodne ze starszymi plikami. Wszystko, co dociera do serwera, to 'model' (rozmowa główna albo subagent; ich nazwy
// serwer nie widzi, moduł karty mówi, czyja to praca). Odczyty moda rozpoznaje `format=data`.
const Origin = z.enum(['model', 'panel']);
const EscalationName = z.enum(['protected_env', 'secret_ref', 'scheduled_run', 'backend_question']);
const Reversible = z.enum(['yes', 'no', 'nothing']);     // nothing: narzędzie niczego trwałego nie zostawia

// ---- ids: wskaźniki, nie kopie danych backendu ------------------------------------------
// project_id jest opcjonalne tylko pod kluczem '_new' (State.superRefine wymaga go pod kluczem projektu).
const Ids = z.strictObject({
  project_id: Uuid.optional(),
  env_id: Uuid.optional(),                               // domyślne środowisko projektu
  docs_id: Uuid.optional(),                              // aktywna dokumentacja OpenAPI
  flow_ids: z.array(Uuid).default([]),
  har_session_id: Short(128).optional(),
  walk_id: Uuid.optional(),                              // bieg z opisu słownego
  split_draft_id: Short(128).optional(),
  scenario_ids: z.record(Uuid, Uuid).default({}),        // flow_id -> scenario_id
  composition_id: Uuid.optional(),
  dataset_ids: z.array(Uuid).default([]),
  run_id: Uuid.optional(),
  functional_run_id: Uuid.optional(),
});

// ---- labels: nazwy obiektów do wyświetlenia (pamięć podręczna, nie źródło prawdy) ---------
const Label = z.strictObject({
  name: Short(120),
  status: Short(40).optional(),                          // np. 'v4', 'self-check ok', 'running'
  link: z.string().url().optional(),                     // strona obiektu w aplikacji
  // Tylko dla env_id: flagi środowiska, z których mod rysuje „(chronione)”, a rejestr ustala eskalację
  // protected_env. Ustawiają je project_get_envs i project_save_env (P2-2c).
  env: z.strictObject({ protected: z.boolean(), default: z.boolean() }).optional(),
  at: Iso,
});

// ---- choices: decyzje użytkownika (poziom 1, cofane z dziennika) ------------------------
const Profile = z.strictObject({
  type: Short(32),                                       // nazwa profilu albo 'production'
  vusers: z.number().int().min(1).max(1_000_000),
  ramp: z.number().int().min(0).max(86_400).optional(),
  hold: z.number().int().min(0).max(86_400).optional(),
});
const Choices = z.strictObject({
  flows: z.strictObject({
    method: z.enum(['suggestions', 'endpoints', 'har', 'description']).optional(),
    journeys: z.array(Short(200)).optional(),
    har_split: z.boolean().optional(),
    account_ref: Short(200).optional(),                  // nazwa pliku env albo zbioru; nigdy hasło
  }).default({}),
  scenario: z.strictObject({
    split: z.record(Uuid, z.number().min(0).max(100)).optional(),
    data_mix: z.union([z.enum(['normal', 'realistic']), z.record(Short(64), z.number())]).optional(),
    composition_name: Short(200).optional(),
  }).default({}),
  run: z.strictObject({
    target: z.strictObject({ kind: z.enum(['scenario', 'composition']), id: Uuid }).optional(),
    env_id: Uuid.optional(),
    profile: Profile.optional(),
    traffic_snapshot_id: Uuid.optional(),
    compare_to: z.union([Uuid, z.literal('baseline')]).optional(),
  }).default({}),
  data: z.strictObject({
    needs_accounts: z.boolean().optional(),              // plan danych wymaga kont w systemie celu (ustawia data_suggest_actions)
  }).default({}),
  functional: z.strictObject({
    flow_ids: z.array(Uuid).optional(),
    test_type_ids: z.array(Uuid).optional(),
    env_id: Uuid.optional(),
  }).default({}),
});

// ---- steps: krótkie werdykty -------------------------------------------------------------
// required: true = wymagana zawsze; false = opcjonalna; obiekt `{ when, in }` = wymagana, gdy wartość pola stanu `when`
// (ścieżka w process, np. 'choices.flows.method') jest jedną z `in`; isRequired liczy to bez parsowania prozy.
// Krok jest `done`, gdy każda wymagana kontrola ma ok=true. Brak wymaganej kontroli to miękka bramka:
// narzędzie następnego kroku działa, a rejestr dopisuje ostrzeżenie do karty i do problems[].
export const CHECKS = {
  project: {
    created: { required: true },
    env_saved: { required: true },
    env_checked: { required: true },
    docs_imported: { required: { when: 'choices.flows.method', in: ['suggestions', 'endpoints'] } },
    setup_analyzed: { required: false },
    setup_applied: { required: true },
    telemetry: { required: false },
  },
  flows: {
    journeys_suggested: { required: { when: 'choices.flows.method', in: ['suggestions'] } },
    har_analyzed: { required: { when: 'choices.flows.method', in: ['har'] } },
    plan_described: { required: { when: 'choices.flows.method', in: ['description'] } },
    flows_built: { required: true },
    questions_answered: { required: true },
  },
  scenario: {
    generated: { required: true },
    self_check: { required: true },
    composition_valid: { required: true },
    compiled: { required: false },
    drift: { required: false },
  },
  data: {
    planned: { required: false },
    bindings_set: { required: true },
    datasets_ready: { required: true },
    accounts: { required: { when: 'choices.data.needs_accounts', in: [true] } },
  },
  run: {
    planned: { required: true },
    started: { required: true },
    finished: { required: true },
  },
  results: {
    report: { required: true },
    analysis: { required: false },
    production_verdict: { required: { when: 'choices.run.profile.type', in: ['production'] } },
  },
  functional: {
    test_types: { required: true },
    validators: { required: false },
    run_finished: { required: true },
  },
  traffic: {
    snapshot: { required: false },
  },
  github: {
    connected: { required: true },
    pushed: { required: false },
  },
} as const;
const Check = z.strictObject({
  ok: z.boolean().nullable(),                            // null = nieznane albo unieważnione
  at: Iso,
  by: Short(64),                                         // nazwa narzędzia albo 'invalidated:<narzędzie>'
  note: Short(200).optional(),
});
const step = <const M extends keyof typeof CHECKS>(module: M) =>
  z.strictObject({
    // todo/active/done wylicza reduktor z kontroli; `blocked` ustawia reduktor, gdy w problems[] jest otwarty
    // `blocker` tego modułu, i zdejmuje, gdy problem się zamknie (P3-10c). Narzędzia nie ustawiają statusu.
    status: z.enum(['todo', 'active', 'blocked', 'done']).default('todo'),
    checks: z.partialRecord(
      z.enum(Object.keys(CHECKS[module]) as [string, ...string[]]), Check).default({}),
  });
const Steps = z.strictObject({
  project: step('project'), flows: step('flows'), scenario: step('scenario'), data: step('data'),
  run: step('run'), results: step('results'), functional: step('functional'), traffic: step('traffic'),
  github: step('github'),
});

// ---- pending: karty do potwierdzenia ------------------------------------------------------
// Narzędzie poziomu 2/3 nie wykonuje się: rejestr zapisuje wywołanie tutaj. Wykonuje je process_answer,
// z zapisanymi argumentami, gdy decision.value = 'yes'. Pole decision zapisuje wyłącznie
// process_set_decision (woła je mod po kliknięciu); model nie ma jak go ustawić.
const Field = z.strictObject({ label: Short(40), value: Short(300) }); // wartości po masce sekretów
const Call = z.strictObject({
  n: z.number().int().min(1).max(8),
  tool: Short(64),
  title: Short(160),                                     // z szablonu karty narzędzia
  fields: z.array(Field).max(12).default([]),            // tabela pól: etykieta i wartość z argumentów
  // DOKŁADNE argumenty EFEKTYWNE, zamrożone przy zapisie karty (P2-1): `ids` z procesu i środowisko po precedencji
  // (freezeArgs) są już w args; process_answer wykonuje args bez ponownego czytania `choices` i `ids`, więc
  // process_set_choices między kartą a wykonaniem niczego nie zmienia. Sekretów nie ma (tylko wskazania plików).
  args: z.record(z.string(), z.unknown()),
  // Jedyny wyjątek: id obiektu, który powstaje wcześniejszym wywołaniem TEJ SAMEJ karty (np. project_id po
  // project_create). Jawny znacznik: argument, z którego wywołania (`from_call` < `n`); rejestr podstawia go po
  // wykonaniu tamtego wywołania. Każda inna wartość jest zamrożona.
  deferred: z.array(z.strictObject({ arg: Short(64), from_call: z.number().int().min(1).max(8) })).default([]),
  args_hash: Short(64),                                  // hash argumentów (nie obiektów, na które wskazują)
  snapshot: Short(64).optional(),                        // hash obiektów z `resolve` karty (P1-3); brak = karta bez resolve
  effect: z.enum(['write', 'costly', 'destructive']),
  cost: Short(160).optional(),
  reversible: Reversible,
  undo: Short(200).optional(),                           // jak cofnąć albo dlaczego się nie da, słowami
  status: z.enum(['queued', 'running', 'done', 'failed', 'skipped']).default('queued'),
  log_id: Short(16).optional(),                          // wpis dziennika po wykonaniu
  handle: Short(160).optional(),                         // gdy wywołanie zaczęło długą operację
});
const Decision = z.strictObject({
  value: z.enum(['yes', 'no', 'change']),
  at: Iso,
  // mod: decyzja z okna moda (rozwiązanie przejściowe); chat: tryb awaryjny bez moda; client_dialog: pytanie serwera
  // (elicitation MCP) w oknie klienta: usunięcia (requiresUserInteraction), „Stop test” i docelowo karty poziomu 2 i 3
  via: z.enum(['mod', 'chat', 'client_dialog']),
  surface: z.enum(['terminal', 'desktop', 'vscode']).optional(),
  picked: z.array(Short(200)).max(LIMITS.picked).optional(), // review: opcje zaznaczone (identyfikatory, mało danych)
  note: Short(200).optional(),                           // co zmienić (value = change)
});
const Question = z.strictObject({                        // pytanie backendu albo propozycja do przejrzenia
  source: z.enum(['backend_rest', 'backend_ws', 'tool']),
  code: Short(64),
  // Opcje karty. Do LIMITS.options pozycji leżą w stanie; dłuższa lista leży w sekcji cache `suggestions`, a karta
  // odwołuje się do niej przez Pending.ref (`total` = ile pozycji ma pełna lista, mod czyta ją przez format=data).
  options: z.array(Short(200)).max(LIMITS.options).default([]),
  total: z.number().int().min(0).optional(),
  resume: Short(120),                                    // co zrobi process_answer (ramka albo flaga potwierdzenia)
});
const PendingBase = z.strictObject({
  id: Short(16),                                         // p-xxxxxxxx
  kind: z.enum(['consent', 'question', 'review', 'needs_user']),
  level: Level,                                          // consent: 2 albo 3; review propozycji narzędzia: 1 (wybór)
  module: Owner,
  origin: Origin,                                        // 'panel' tylko dla „Cofnij” z panelu; poza tym 'model'
  title: Short(160),                                     // jedno wywołanie: jego tytuł; kilka: tytuł zakresu
  fields: z.array(Field).max(16).default([]),            // karty bez wywołań (pytanie, przegląd, czynność człowieka)
  calls: z.array(Call).max(8).default([]),               // consent: zapisane wywołania (poziom 3: dokładnie jedno)
  scope: Short(160).optional(),                          // <moduł>:<grupa>[:<cel>] — co karta obejmuje
  cost: Short(200).optional(),                           // suma kosztów wywołań, słowami
  reversible: Reversible.default('no'),                  // najsłabsze z wywołań: no < yes < nothing
  why: Short(120).optional(),                            // poziom 3: powód (ruch, usuwanie, sekret, chronione…)
  warnings: z.array(Short(200)).max(8).default([]),      // miękkie bramki: brakujące kontrole
  covers: z.strictObject({                               // poziom 2: co zgoda obejmuje po „tak”
    tools: z.array(Short(64)).max(12),                   // wyłącznie następne kroki z katalogu (FOLLOW_UPS), nie cała grupa
                                                         // i nie same wywołania karty; bez nadpisania i destructive.
                                                         // Ponowienie po failed rozstrzyga coverDecision (args_hash)
    calls_left: z.number().int().min(0).max(8),          // ile dalszych wywołań zakresu przejdzie bez nowej karty
    ttl_min: z.number().int().min(1).max(240),           // jak długo zgoda obowiązuje po „tak” (mod nie powiela stałej)
    target: z.strictObject({ key: Short(32), id: Short(128) }).optional(), // typowany cel zakresu (np. flow_id), jeśli jest
    expires_at: Iso.optional(),                          // ustawiane przy „tak”: decyzja + ttl_min
  }).optional(),
  question: Question.optional(),
  ref: z.strictObject({ section: Short(32), key: Short(128) }).optional(), // treść propozycji w cache
  link: z.string().url().optional(),                     // needs_user: strona aplikacji
  undo_of: Short(16).optional(),                         // karta powstała z „Cofnij” wpisu dziennika
  stale_of: Short(16).optional(),                        // karta powstała po consent_stale: zastępuje kartę o tym id
  decision: Decision.optional(),
  status: z.enum(['open', 'granted', 'running', 'done', 'failed', 'denied', 'expired', 'stale']).default('open'),
  created_at: Iso,
  expires_at: Iso.optional(),
  resolved_at: Iso.optional(),
});
const Pending = PendingBase.superRefine((c, ctx) => {
  // lista dłuższa niż opcje w stanie wymaga odwołania do pełnej listy w cache (`ref`)
  if (c.question?.total !== undefined && c.question.total > c.question.options.length && c.ref === undefined) {
    ctx.addIssue({ code: 'custom', path: ['ref'], message: 'total > options: pełna lista musi być w cache (ref)' });
  }
});

// ---- log i reads: dziennik zapisów, kosztów, błędów i decyzji; osobno pierścień odczytów ----
// Zapisuje je centralnie warstwa rejestracji, nie narzędzie. Pełne żądanie i odpowiedź (po masce) leżą
// w sekcji cache `logDetails` pod kluczem id, z terminem ważności.
// Wpis dostaje: zapis, koszt, błąd, decyzję (także z moda: process_set_decision, kliknięcie „Stop”).
// Wpisu NIE dostaje: udane wywołanie z format=data (błąd takiego wywołania idzie do `log`) ani żaden odczyt z origin
// 'panel' (odpytywanie panelu): nie zapisują stanu i nie zmieniają rev. Udany odczyt z rozmowy trafia do pierścienia `reads` (LIMITS.reads) i do licznika
// `reads_total`, więc nie wypiera z `log` zapisów, o które użytkownikowi chodzi (P1-2).
const LogEntry = z.strictObject({
  id: Short(16),                                         // l-xxxxxxxx
  at: Iso,
  ms: z.number().int().min(0),
  module: Owner,
  tool: Short(64),
  level: Level,
  effect: z.enum(['read', 'write', 'costly', 'destructive']),
  origin: Origin,                                        // 'model' (wartość 'panel' wycofana razem z from_panel)
  args: Short(200),                                      // streszczenie argumentów (szablon narzędzia, maska)
  result: Short(200),                                    // streszczenie wyniku
  status: z.enum(['ok', 'error', 'queued', 'denied', 'cancelled']),
  error_code: Short(64).optional(),
  consent: z.strictObject({
    pending_id: Short(16).optional(),                    // brak przy via 'client_dialog' (pytanie serwera nie zostawia karty)
    via: z.enum(['mod', 'chat', 'client_dialog']),
    covered: z.boolean().optional(),                     // wywołanie objęte wcześniejszą kartą zakresu
  }).optional(),
  ref: z.strictObject({ kind: Short(32), id: Short(128) }).optional(),    // obiekt, którego dotyczy
  link: z.string().url().optional(),                     // strona obiektu w aplikacji
  handle: Short(160).optional(),
  has_detail: z.boolean().default(false),
  undo: z.strictObject({                                 // brak = nie da się cofnąć
    tool: Short(64),
    args: z.record(z.string(), z.unknown()),             // gotowe argumenty cofnięcia (bez sekretów)
    level: Level,
    note: Short(160).optional(),
    done_by: Short(16).optional(),                       // wpis dziennika, który cofnął
  }).optional(),
});

// ---- operations: uchwyty długich operacji -------------------------------------------------
export const OPERATION_KINDS = ['setup_analysis', 'refine', 'batch_generation', 'flow_generation',
  'har_generation', 'har_split', 'record_run', 'scenario_generation', 'self_check', 'drift_check',
  'dataset_generation', 'account_provision', 'test_run', 'analysis', 'test_types_generation',
  'functional_run', 'payload_generation'] as const;
const Operation = z.strictObject({
  handle: Short(160),                                    // <kind>:<id>
  kind: z.enum(OPERATION_KINDS),
  module: Module,
  tool: Short(64),
  label: Short(120).optional(),                          // nazwa obiektu do paska postępu
  status: z.enum(['running', 'waiting_user', 'done', 'failed', 'cancelled', 'lost']),
  progress: z.strictObject({
    stage: Short(80).optional(),
    percent: z.number().min(0).max(100).optional(),
    counter: Short(40).optional(),                       // np. "3/7"
  }).optional(),
  pending_id: Short(16).optional(),                      // karta, na którą operacja czeka (waiting_user)
  expected_s: z.number().int().optional(),
  started_at: Iso,
  updated_at: Iso,
  expires_at: Iso.optional(),                            // wynik trzymany w pamięci backendu
});

// ---- problems ------------------------------------------------------------------------------
const ProblemBase = z.strictObject({
  flow_ids: z.array(Uuid).min(1).max(100).optional(),    // flows_on_old_docs: flowy przypięte do innej wersji dokumentacji
  definite_count: z.number().int().min(0).optional(),    // flows_need_input: ile pozycji jest pewnych (definite): kroki dostaną 401
  field_paths: z.array(Short(64)).min(1).max(40).optional(), // profile_fields_uncertain: ścieżki pól profilu o niskiej pewności
  id: Short(16),
  module: Owner,
  tool: Short(64),
  code: Short(64),                                       // np. gate_run_planned, env_missing, walk_interrupted
  severity: z.enum(['blocker', 'warning']),
  message: Short(300),
  ref: z.strictObject({ kind: Short(32), id: Short(128) }).optional(),
  at: Iso,
});
const Problem = ProblemBase.superRefine((p, ctx) => {
  // kody ze stałymi regułami (PROBLEM_RULES): flows_on_old_docs to OSTRZEŻENIE (nie blokada) z listą flow_ids
  if (p.code === 'flows_on_old_docs' && (p.severity !== 'warning' || p.flow_ids === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'flows_on_old_docs: warning z flow_ids' });
  }
  if (p.code === 'flows_need_input' && (p.severity !== 'warning' || p.flow_ids === undefined || p.definite_count === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'flows_need_input: warning z flow_ids i definite_count' });
  }
  if (p.code === 'profile_fields_uncertain' && (p.severity !== 'warning' || p.field_paths === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'profile_fields_uncertain: warning z field_paths' });
  }
});

// ---- process[project_id | '_new'] ------------------------------------------------------------
export const Process = z.strictObject({
  rev: z.number().int().min(0),
  updated_at: Iso,
  step: z.enum(PIPELINE),
  ids: Ids,
  labels: z.record(Short(64), Label).default({}),        // klucz: identyfikator z ids
  choices: Choices.default({ flows: {}, scenario: {}, run: {}, data: {}, functional: {} }),
  steps: Steps,
  pending: z.array(Pending).max(LIMITS.pending).default([]),
  operations: z.array(Operation).max(LIMITS.operations).default([]),
  problems: z.array(Problem).max(LIMITS.problems).default([]),
  log: z.array(LogEntry).max(LIMITS.log).default([]),
  reads: z.array(LogEntry).max(LIMITS.reads).default([]), // udane odczyty z rozmowy; bez odczytów moda
  reads_total: z.number().int().min(0).default(0),       // ile odczytów z rozmowy było łącznie (pierścień się zawija)
}).superRefine((p, ctx) => {
  // opcje wszystkich kart razem: stan jest przepisywany w całości, więc jego rozmiar ma sufit (przeglądy dłuższych list: ref)
  const optionsTotal = p.pending.reduce((n, c) => n + (c.question?.options.length ?? 0), 0);
  if (optionsTotal > LIMITS.pending_options_total) {
    ctx.addIssue({ code: 'custom', path: ['pending'], message: 'opcje kart razem ponad limit' });
  }
  p.log.forEach((e, i) => {
    if (e.effect === 'read' && e.status === 'ok') {
      ctx.addIssue({ code: 'custom', path: ['log', i], message: 'udany odczyt idzie do reads, nie do log' });
    }
    if (e.origin === 'panel' && e.effect === 'read') {
      ctx.addIssue({ code: 'custom', path: ['log', i], message: 'odczyt moda nie ma wpisu' });
    }
  });
  p.reads.forEach((e, i) => {
    if (e.effect !== 'read' || e.status !== 'ok' || e.origin === 'panel') {
      ctx.addIssue({ code: 'custom', path: ['reads', i], message: 'reads: tylko udane odczyty z rozmowy' });
    }
  });
});
export type Process = z.infer<typeof Process>;

// ---- częściowa aktualizacja zwracana przez narzędzie (wejście reduktora) -------------------
// Narzędzie nie zapisuje pending[] ani log[]: zwraca skutek, a rejestr dopisuje kartę albo wpis.
export const ProcessUpdate = z.strictObject({
  ids: Ids.omit({ flow_ids: true, dataset_ids: true }).partial().optional(), // podmiana; scenario_ids scalane
  unset: z.array(Ids.keyof()).optional(),
  add: z.strictObject({ flow_ids: z.array(Uuid), dataset_ids: z.array(Uuid) }).partial().optional(),
  remove: z.strictObject({ flow_ids: z.array(Uuid), dataset_ids: z.array(Uuid) }).partial().optional(),
  labels: z.record(Short(64), Label.omit({ at: true })).optional(), // nazwy obiektów, które narzędzie zwróciło
  choices: Choices.partial().optional(),                 // scalanie głębokie; unieważnia kontrole (tabela)
  checks: z.partialRecord(Module, z.record(Short(32), Check.omit({ at: true, by: true }))).optional(),
  operations: z.array(Operation.partial().required({ handle: true })).optional(), // upsert po handle
  problems: z.strictObject({
    open: z.array(ProblemBase.omit({ id: true, at: true })),
    close: z.array(z.strictObject({ code: Short(64), ref_id: Short(128).optional() })),
  }).partial().optional(),
  question: Question.extend({                            // pytanie backendu: rejestr zrobi z niego kartę
    title: Short(160),
    link: z.string().url().optional(),
  }).optional(),
  log: z.strictObject({                                  // wkład narzędzia do wpisu dziennika
    values: z.record(Short(32), z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
    ref: z.strictObject({ kind: Short(32), id: Short(128) }).optional(),
    undo_args: z.record(z.string(), z.unknown()).optional(), // np. poprzednie wartości, poprzednia wersja
  }).optional(),
});

// ---- wejście process_set_decision (woła mod) ------------------------------------------------
export const DecisionInput = z.union([
  z.strictObject({ id: Short(16), value: z.enum(['yes', 'no', 'change']),
    picked: z.array(Short(200)).max(LIMITS.picked).optional(), note: Short(200).optional() }),
  z.strictObject({ log_id: Short(16), value: z.literal('undo') }),         // tworzy kartę cofnięcia
]);

// ---- plik stanu ----------------------------------------------------------------------------
// Klucz wpisu sekcji cache: niepusty i nigdy z prefiksem `@` (prefiksy typu `@op:` w drafts to wymieszane dane
// operacji; mają własne sekcje).
// Każda sekcja cache używa CacheKey jako klucza, więc zakaz prefiksu `@` obejmuje je wszystkie.
const CacheKey = z.string().min(1).max(160).refine((k) => !k.startsWith('@'), 'klucz sekcji nie zaczyna się od @');
const CacheEntry = z.strictObject({ savedAt: Iso, value: z.unknown() });

// ---- listy dla moda: strona w wyniku process_get_status, pełna lista w cache przez ref (MODV-20) ---------------------------
// `process_get_status` z detail=flows albo runs zwraca stronę (offset, limit: domyślnie 20, najwyżej 100) z `total` i
// `next_offset`; gdy total > strony, pełna lista (najwyżej LIMITS.list_items pozycji, `partial` gdy backend ma więcej)
// leży w sekcji `suggestions` pod kluczem `list:flows:<project_id>` albo `list:runs:<project_id>`, a wynik niesie `ref`.
// Mod czyta ją przez process_get_status {format: 'data', view: 'list', ref}. Kluczem pozycji jest ID (nazwa to tylko
// etykieta: do narzędzi i do wiadomości dla modelu idzie id).
export const FlowListItem = z.strictObject({
  id: Uuid, name: Short(160), steps: z.number().int().min(0),
  specStatus: z.enum(['current', 'outdated', 'unpinned']),   // spec_status z odczytu listy flowów
  version: z.number().int().min(1).optional(),
  needsData: z.boolean().optional(),                         // czeka na dane (sloty scenariuszy tego flowu bez zbioru); brak: nieznane
  needsDataSlots: z.array(Short(64)).max(10).optional(),
  needsInputCount: z.number().int().min(0).default(0),       // FlowSummary.needs_input_count
  needsInputDefiniteCount: z.number().int().min(0).default(0),
});
export const RunListItem = z.strictObject({
  handle: Short(160), runId: Short(64).optional(),
  target: z.strictObject({ kind: z.enum(['scenario', 'composition']), id: Short(64), name: Short(160) }),
  verdict: Short(40), when: Iso,
});
export const ListPayload = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('flows'), total: z.number().int().min(0), partial: z.boolean().default(false),
    fetchedAt: Iso, items: z.array(FlowListItem).max(LIMITS.list_items) }),
  z.strictObject({ kind: z.literal('runs'), total: z.number().int().min(0), partial: z.boolean().default(false),
    fetchedAt: Iso, items: z.array(RunListItem).max(LIMITS.list_items) }),
]);
export const LIST_KEY = /^list:(flows|runs):[A-Za-z0-9_-]{1,64}$/;
// Zarys kroku flowu po masce (flows_get, structuredContent obok tekstu): nagłówki jako NAZWY, ciało po masce sekretów.
// Ciało, którego plugin nie umie rozpoznać strukturalnie, jest ukrywane w CAŁOŚCI (hidden), nigdy częściowo.
export const StepView = z.strictObject({
  index: z.number().int().min(1), kind: Short(32), method: Short(10).optional(), path: Short(300).optional(),
  name: Short(160).optional(),
  request: z.strictObject({
    headerNames: z.array(Short(64)).max(40).default([]),
    body: z.strictObject({
      contentType: Short(80).optional(),
      text: Short(4000).optional(),                         // po masce; brak przy hidden
      truncated: z.boolean().default(false),
      hidden: z.enum(['unrecognized', 'secret']).optional(), // unrecognized: ciała nie rozpoznano; secret: samo sekrety
    }).optional(),
  }).optional(),
});
const AccountSeriesEntry = z.strictObject({
  savedAt: Iso, value: z.strictObject({ baseline: z.number().int().min(0), count: z.number().int().min(0) }),
});
// ---- widok self-checku: kroki z planu, faza przebiegu, wyniki kroków po każdym przebiegu, rundy naprawy -------------
// Backend nie ma kanału self-checku (stan to pole `self_check` scenariusza, czytane przez REST); plan kroków i wyniki
// przebiegów (`/endpoints`) plugin składa sam. Pola oznaczone „full” wypełni dopiero wariant pełny (kroki na żywo z WS,
// kolejność wykonania i status HTTP z backendu); są opcjonalne, więc dodanie ich nie wymaga schematu 4.
const CheckPhase = z.enum(['queued', 'compiling', 'running', 'judging', 'repairing', 'finished']);
const HttpStatuses = z.array(z.number().int().min(100).max(599)).max(4);
const CheckStep = z.strictObject({
  name: Short(120), method: Short(10).optional(), path: Short(200).optional(),   // z planu (request_sequence)
  result: z.enum(['ok', 'failed', 'skipped']).optional(),   // wynik ostatniego przebiegu; brak: nieznany albo nieosiągnięty
  http: HttpStatuses.optional(),                            // statusy z http_status_counts kroku
  live: z.enum(['pending', 'running', 'ok', 'failed']).optional(),   // full: ramki live_per_request / live_error
  runName: Short(160).optional(),                           // full: nazwa kroku tak, jak widział ją przebieg (preflighty, klasy danych)
});
const StepResult = z.strictObject({
  step: z.number().int().min(0), result: z.enum(['ok', 'failed', 'skipped']), http: HttpStatuses.optional(),
  reason: Short(120).optional(),                            // krótka przyczyna po masce
});
const CheckRun = z.strictObject({                           // jeden przebieg scenariusza (od kroku 1; naprawa = nowy przebieg)
  run: z.number().int().min(1), version: z.number().int().min(1).optional(), executionId: Short(64).optional(),
  phase: CheckPhase.optional(), verdict: Short(40).optional(),
  startedAt: Iso.optional(), finishedAt: Iso.optional(),
  results: z.array(StepResult).max(LIMITS.self_check.steps),
});
const CheckRepair = z.strictObject({
  round: z.number().int().min(1), outcome: z.enum(['repaired', 'refused']),
  text: Short(300),                                         // changes_summary albo refused_reason, po masce
  version: z.number().int().min(1).optional(),              // wersja scenariusza po naprawie
  verdict: Short(40).optional(),                            // wynik przebiegu wersji po naprawie
  reasonCode: Short(40).optional(),                         // full: krótki kod odmowy z backendu
  changedSteps: z.array(z.number().int().min(0)).max(LIMITS.self_check.steps).optional(),   // full: których kroków dotyczyła zmiana
});
const ScenarioCheckView = z.strictObject({
  id: Short(64), name: Short(120), status: Short(40),       // status: self_check.status scenariusza
  phase: CheckPhase.optional(), version: z.number().int().min(1).optional(),
  run: z.number().int().min(0),                             // numer bieżącego przebiegu (0: jeszcze nie ruszył)
  steps: z.array(CheckStep).max(LIMITS.self_check.steps),
  moreSteps: z.number().int().min(0).default(0),            // ile kroków planu nie zmieściło się w steps
  failure: z.strictObject({ step: Short(120).optional(), http: z.number().int().min(100).max(599).optional(), message: Short(300) }).optional(),
  runs: z.array(CheckRun).max(LIMITS.self_check.runs),
  repairs: z.array(CheckRepair).max(LIMITS.self_check.repairs),
  repairLimit: z.number().int().min(1).max(10).default(2),  // limit rund naprawy (dziś stała; backend poda go w wariancie pełnym)
  repairStartedAt: Iso.optional(),                          // full: początek bieżącej rundy z backendu
  startedAt: Iso.optional(), phaseAt: Iso.optional(), finishedAt: Iso.optional(),
});
const SelfCheckView = z.strictObject({
  environment: Short(120).optional(), scenarios: z.array(ScenarioCheckView).max(LIMITS.self_check.scenarios),
});
const SelfCheckEntry = z.strictObject({ savedAt: Iso, value: SelfCheckView });
const LogDetail = z.strictObject({ savedAt: Iso, truncated: z.boolean().optional(), value: z.unknown() });
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v) ?? '').length;
const OpPayload = z.strictObject({ savedAt: Iso, value: z.unknown() });   // ładunek `saved`, z którego wznawia process_wait
const RunLoad = z.strictObject({                         // obciążenie przycięte przez plugin
  run_id: Short(64), requested_vu: z.number().int().min(0), effective_vu: z.number().int().min(0),
});
const RunLoadEntry = z.strictObject({ savedAt: Iso, value: RunLoad });
// Wpis istnieje, dopóki trwa wywołanie (rejestr usuwa go przy końcu); TTL LIMITS.call_progress_ttl_min sprząta osierocone.
const CallProgress = z.strictObject({                    // postęp wywołania bez uchwytu operacji
  tool: Short(64),                                       // narzędzie czekającego wywołania (np. process_wait, run_start)
  handle: Short(160).optional(),                         // uchwyt operacji, na którą wywołanie czeka
  stage: Short(80), percent: z.number().min(0).max(100).optional(), counter: Short(40).optional(),
  startedAt: Iso, updatedAt: Iso,
});

export const State = z.object({
  schema: z.literal(3),
  bound_project_id: Uuid.optional(),                     // projekt katalogu roboczego (ustawia plugin przy przeniesieniu procesu: bindProject)
  process: z.record(z.string(), Process).default({}),    // klucz: project_id albo '_new' (przed utworzeniem projektu)
  // sekcje cache (TTL, prune): treść propozycji, sesje HAR, szkice, szczegóły dziennika
  // Wpis każdej z tych sekcji to {savedAt, value}; termin i limit liczby wpisów przycina pruneCache (LIMITS).
  suggestions: z.record(CacheKey, CacheEntry).default({}),   // klucze `list:*` to ListPayload (superRefine)
  harSessions: z.record(CacheKey, CacheEntry).default({}),
  drafts: z.record(CacheKey, CacheEntry).default({}),
  // Seria zakładania kont testowych (zamiast kluczy `provision:<id>` w drafts): klucz to id zbioru (dataset_id), wartość
  // to stan serii między wywołaniami: ile wierszy zbiór miał na starcie (baseline) i ile kont zlecono (count).
  accountSeries: z.record(CacheKey, AccountSeriesEntry).default({}),
  // Szczegóły wpisów dziennika (żądanie i odpowiedź po masce), klucz: id wpisu `log[]`. TTL, osierocone, 8 KB na wpis i
  // 2 MB łącznie przycina pruneCache; schemat pilnuje limitów (wpis ponad 8 KB ma `truncated: true` i skrót).
  logDetails: z.record(CacheKey, LogDetail).default({}),
  // Dane operacji mają własne sekcje (nie `drafts` pod prefiksami). Postęp operacji z uchwytem leży w
  // process[…].operations[i].progress, nie tutaj.
  opPayloads: z.record(CacheKey, OpPayload).default({}),     // prune przy końcu operacji, najwyżej LIMITS.op_payloads
  runLoads: z.record(CacheKey, RunLoadEntry).default({}),    // przeżywa operację, najwyżej LIMITS.run_loads
  callProgress: z.record(CacheKey, CallProgress).default({}), // TTL LIMITS.call_progress_ttl_min, najwyżej call_progress
  // Operacje (uchwyty), które trwające wywołanie już zakończyło, wg id wywołania (klucz callProgress). Ich wiersze
  // mówią `running`, dopóki rejestr nie zapisze końca wywołania (jeden zapis: koniec operacji i wpis dziennika razem), a
  // czytnik pasków ich nie rysuje. Osobna sekcja, nie pole CallProgress: wtyczka w starszej wersji zachowuje nieznany
  // klucz i nadal czyta plik. Zapisywana tylko gdy ma wpisy (pole opcjonalne); klucz musi istnieć w callProgress, a wpis
  // znika razem z paskiem swojego wywołania (pruneCache).
  callEnded: z.record(CacheKey, z.array(Short(160)).min(1).max(LIMITS.operations)).optional(),
  // Widok self-checku dla zakładki Przebieg moda (mod czyta tylko stan, przez process_get_status). Klucz: uchwyt operacji
  // self_check albo id wywołania (scenario_generate odpala self-check bez własnej operacji). To sekcja cache, nie pole wiersza
  // operacji, więc zasada „koniec operacji jednym zapisem” zostaje: w trakcie rejestr zapisuje tylko tę sekcję (przy zmianie,
  // nie co 3 s), a końcowy widok wchodzi do jednego zapisu końca wywołania. Widok zostaje po końcu operacji do terminu.
  selfCheckViews: z.record(CacheKey, SelfCheckEntry).default({}),
}).superRefine((s, ctx) => {
  for (const call of Object.keys(s.callEnded ?? {})) {
    if (!(call in s.callProgress)) {
      ctx.addIssue({ code: 'custom', path: ['callEnded', call], message: 'callEnded bez paska wywołania w callProgress' });
    }
  }
  let detailTotal = 0;
  for (const [id, d] of Object.entries(s.logDetails)) {
    const n = bytes(d.value);
    detailTotal += n;
    if (n > LIMITS.log_details.entry_kb * 1024) {
      ctx.addIssue({ code: 'custom', path: ['logDetails', id], message: 'szczegóły wpisu ponad limit na wpis' });
    }
  }
  if (detailTotal > LIMITS.log_details.total_mb * 1024 * 1024) {
    ctx.addIssue({ code: 'custom', path: ['logDetails'], message: 'szczegóły dziennika ponad limit łączny' });
  }
  let listBytes = 0;
  for (const [key, entry] of Object.entries(s.suggestions)) {
    if (!key.startsWith('list:')) continue;
    if (!LIST_KEY.test(key)) ctx.addIssue({ code: 'custom', path: ['suggestions', key], message: 'klucz listy: list:flows|runs:<id>' });
    const parsed = ListPayload.safeParse(entry.value);
    if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['suggestions', key], message: 'wartość listy nie jest ListPayload' });
    const n = bytes(entry.value);
    listBytes += n;
    if (n > LIMITS.list_entry_kb * 1024) ctx.addIssue({ code: 'custom', path: ['suggestions', key], message: 'lista ponad limit rozmiaru' });
  }
  if (listBytes > LIMITS.suggestions_total_mb * 1024 * 1024) {
    ctx.addIssue({ code: 'custom', path: ['suggestions'], message: 'listy w cache ponad limit łączny' });
  }
  let stepsSeen = 0;
  for (const [key, entry] of Object.entries(s.selfCheckViews)) {
    const steps = entry.value.scenarios.reduce((n, sc) => n + sc.steps.length, 0);
    stepsSeen += steps;
    if (steps > LIMITS.self_check.steps_total) {
      ctx.addIssue({ code: 'custom', path: ['selfCheckViews', key], message: 'kroków w widoku ponad limit' });
    }
    if (bytes(entry.value) > LIMITS.self_check.view_kb * 1024) {
      ctx.addIssue({ code: 'custom', path: ['selfCheckViews', key], message: 'widok self-checku ponad limit rozmiaru' });
    }
  }
  const caps = [['selfCheckViews', LIMITS.self_check.views], ['opPayloads', LIMITS.op_payloads], ['runLoads', LIMITS.run_loads], ['callProgress', LIMITS.call_progress],
    ['suggestions', LIMITS.suggestions.max], ['harSessions', LIMITS.harSessions.max], ['drafts', LIMITS.drafts.max],
    ['accountSeries', LIMITS.account_series.max]] as const;
  for (const [name, max] of caps) {
    if (Object.keys(s[name]).length > max) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'więcej wpisów niż limit sekcji' });
    }
  }
  for (const [key, p] of Object.entries(s.process)) {
    if (key === NEW_KEY) continue;                       // pusty `ids` dopuszczony: projektu jeszcze nie ma
    if (!Uuid.safeParse(key).success) {
      ctx.addIssue({ code: 'custom', path: ['process', key], message: "klucz to project_id albo '_new'" });
    } else if (p.ids.project_id !== key) {
      ctx.addIssue({ code: 'custom', path: ['process', key, 'ids', 'project_id'],
        message: 'pod kluczem projektu ids.project_id jest wymagane i równe kluczowi' });
    }
  }
});
export type State = z.infer<typeof State>;

// logDetails (decyzja 7): wpis starszy niż LIMITS.log_details.hours od savedAt znika; szczegóły osierocone (id, którego nie
// ma w log[] żadnego procesu) znikają; wpis ponad entry_kb dostaje `truncated: true` i skrót JSON (value to napis);
// gdy suma przekracza total_mb, najstarsze odpadają. Przycięcie jest jawne (truncated), nie ciche.
// Przycinanie sekcji cache (reduktor, przed walidacją): ładunek w opPayloads ginie tylko wtedy, gdy wiersz jego operacji
// (w którymkolwiek procesie) ma status końcowy (OP_ENDED: done, failed, cancelled, lost, czyli statusy schematu Operation
// poza running i waiting_user); ładunek bez wiersza (jeszcze niezapisanego albo odrzuconego) żyje najwyżej
// LIMITS.finished_operation_hours od savedAt; potem najstarsze ponad limit. runLoads: tylko limit (przeżywają operację);
// callProgress: po TTL, potem najstarsze ponad limit.
export const OP_ENDED: ReadonlySet<string> = new Set(
  Operation.shape.status.options.filter((st) => st !== 'running' && st !== 'waiting_user'));
export function pruneCache(s: State, nowMs: number): State {
  const statusOf = new Map(Object.values(s.process).flatMap((p) => p.operations.map((o) => [o.handle, o.status] as const)));
  const logIds = new Set(Object.values(s.process).flatMap((p) => p.log.map((e) => e.id)));
  const detailCutoff = nowMs - LIMITS.log_details.hours * 3_600_000;
  const maxEntry = LIMITS.log_details.entry_kb * 1024;
  const fit = (d: z.infer<typeof LogDetail>): z.infer<typeof LogDetail> => {
    if (bytes(d.value) <= maxEntry) return d;
    let text = JSON.stringify(d.value) ?? '';
    while (bytes(text) > maxEntry) text = text.slice(0, Math.floor(text.length * 0.9));
    return { ...d, truncated: true, value: text };
  };
  let detailBytes = 0;
  const details = Object.fromEntries(Object.entries(s.logDetails)
    .filter(([id, d]) => logIds.has(id) && Date.parse(d.savedAt) >= detailCutoff)
    .map(([id, d]) => [id, fit(d)] as const)
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .filter(([, d]) => (detailBytes += bytes(d.value)) <= LIMITS.log_details.total_mb * 1024 * 1024));
  const orphanCutoff = nowMs - LIMITS.finished_operation_hours * 3_600_000;
  const keepPayload = ([h, v]: [string, { savedAt: string }]) => {
    const st = statusOf.get(h);
    return st === undefined ? Date.parse(v.savedAt) >= orphanCutoff : !OP_ENDED.has(st);
  };
  const newest = <V extends { savedAt?: string; updatedAt?: string }>(rec: Record<string, V>, max: number) =>
    Object.fromEntries(Object.entries(rec)
      .sort(([, a], [, b]) => Date.parse(b.savedAt ?? b.updatedAt ?? '') - Date.parse(a.savedAt ?? a.updatedAt ?? ''))
      .slice(0, max));
  // listy flowów i przebiegów (`list:*`): pozycje ponad LIMITS.list_items odpadają z `partial: true`, a przy przekroczeniu
  // sumy rozmiaru odpadają najstarsze listy
  const capLists = (rec: Record<string, { savedAt: string; value: unknown }>) => {
    const out: typeof rec = {};
    let total = 0;
    for (const [k, e] of Object.entries(rec).sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))) {
      let v = e.value;
      if (k.startsWith('list:') && v && typeof v === 'object' && Array.isArray((v as { items?: unknown[] }).items)) {
        const p = v as { items: unknown[]; partial?: boolean };
        if (p.items.length > LIMITS.list_items) v = { ...p, items: p.items.slice(0, LIMITS.list_items), partial: true };
      }
      const n = k.startsWith('list:') ? bytes(v) : 0;
      if (k.startsWith('list:') && (total + n > LIMITS.suggestions_total_mb * 1024 * 1024 || n > LIMITS.list_entry_kb * 1024)) continue;
      total += n;
      out[k] = { ...e, value: v };
    }
    return out;
  };
  const aged = <V extends { savedAt: string }>(rec: Record<string, V>, maxAgeMs: number, max: number) =>
    newest(Object.fromEntries(Object.entries(rec).filter(([, v]) => Date.parse(v.savedAt) >= nowMs - maxAgeMs)), max);
  const ttl = nowMs - LIMITS.call_progress_ttl_min * 60_000;
  const kept: State = {
    ...s,
    logDetails: details,
    opPayloads: newest(Object.fromEntries(Object.entries(s.opPayloads).filter(keepPayload)), LIMITS.op_payloads),
    runLoads: newest(s.runLoads, LIMITS.run_loads),
    suggestions: capLists(aged(s.suggestions, LIMITS.suggestions.hours * 3_600_000, LIMITS.suggestions.max)),
    harSessions: aged(s.harSessions, LIMITS.harSessions.hours * 3_600_000, LIMITS.harSessions.max),
    drafts: aged(s.drafts, LIMITS.drafts.hours * 3_600_000, LIMITS.drafts.max),
    accountSeries: aged(s.accountSeries, LIMITS.account_series.days * 86_400_000, LIMITS.account_series.max),
    callProgress: newest(Object.fromEntries(Object.entries(s.callProgress).filter(([, c]) => Date.parse(c.updatedAt) >= ttl)),
      LIMITS.call_progress),
  };
  // widok self-checku: termin, limit wpisów, a przy przekroczeniu rozmiaru najpierw kroki i przebiegi scenariuszy zakończonych
  // sukcesem (zostaje nagłówek z werdyktem i `moreSteps`), potem nic więcej: widok scenariusza, który padł albo trwa, zostaje
  const viewCutoff = nowMs - LIMITS.self_check.hours * 3_600_000;
  const slim = (v: z.infer<typeof SelfCheckView>): z.infer<typeof SelfCheckView> => {
    if (bytes(v) <= LIMITS.self_check.view_kb * 1024 && v.scenarios.reduce((n, sc) => n + sc.steps.length, 0) <= LIMITS.self_check.steps_total) return v;
    return { ...v, scenarios: v.scenarios.map((sc) => sc.status === 'passed' || sc.status === 'passed_after_repair'
      ? { ...sc, moreSteps: sc.moreSteps + sc.steps.length, steps: [], runs: [] } : sc) };
  };
  const views = newest(Object.fromEntries(Object.entries(s.selfCheckViews ?? {})
    .filter(([, e]) => Date.parse(e.savedAt) >= viewCutoff).map(([k, e]) => [k, { ...e, value: slim(e.value) }] as const)),
    LIMITS.self_check.views);
  kept.selfCheckViews = views;
  // callEnded znika razem z paskiem wywołania; sekcja bez wpisów jest pomijana
  const callEnded = Object.entries(s.callEnded ?? {}).filter(([call, ended]) => call in kept.callProgress && ended.length > 0);
  if (callEnded.length > 0) return { ...kept, callEnded: Object.fromEntries(callEnded) };
  const rest = { ...kept };
  delete rest.callEnded;
  return rest;
}

// ---- reduktor: przycinanie przed walidacją i dwa przejścia, które wiąże schemat -----------------
// Przycinanie jest częścią zapisu: reduktor woła pruneProcess na wyniku, dopiero potem Process.parse.
// Karty `open`, `granted` i `running` nigdy nie są usuwane; gdy jest ich ponad LIMITS.pending, nowa karta
// jest odrzucana kodem pending_full, a nie kasowana.
type Prunable = {
  log: unknown[]; reads: unknown[];
  pending: { status: string; created_at: string; resolved_at?: string | undefined; covers?: { expires_at?: string | undefined } | undefined }[];
  operations: { status: string; updated_at: string }[];
  problems: { code: string; at: string; ref?: { id: string } | undefined }[];
};
export function pruneProcess<T extends Prunable>(p: T, nowMs: number): T {
  const live = new Set(['open', 'granted', 'running']);
  const cutoff = nowMs - LIMITS.finished_card_hours * 3_600_000;
  const when = (c: { created_at: string; resolved_at?: string | undefined }) => Date.parse(c.resolved_at ?? c.created_at);
  // karta zakończona, ale z aktywnym covers (zgoda trwa do expires_at), zostaje: mod pokazuje ją do wygaśnięcia
  const covering = (c: { covers?: { expires_at?: string | undefined } | undefined }) => c.covers?.expires_at !== undefined && Date.parse(c.covers.expires_at) > nowMs;
  let pending = p.pending.filter((c) => live.has(c.status) || covering(c) || when(c) >= cutoff);
  if (pending.length > LIMITS.pending) {                 // dalej za dużo: najpierw najstarsze zakończone
    const drop = new Set(pending.filter((c) => !live.has(c.status) && !covering(c))
      .sort((a, b) => when(a) - when(b)).slice(0, pending.length - LIMITS.pending));
    pending = pending.filter((c) => !drop.has(c));
  }
  // operacje: trwające (running, waiting_user) zostają; zakończone starsze niż N godzin znikają, potem najstarsze
  const opLive = new Set(['running', 'waiting_user']);
  const opCutoff = nowMs - LIMITS.finished_operation_hours * 3_600_000;
  let operations = p.operations.filter((o) => opLive.has(o.status) || Date.parse(o.updated_at) >= opCutoff);
  if (operations.length > LIMITS.operations) {
    const drop = new Set(operations.filter((o) => !opLive.has(o.status))
      .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)).slice(0, operations.length - LIMITS.operations));
    operations = operations.filter((o) => !drop.has(o));
  }
  // problemy: ten sam code + ref zostaje raz (najnowszy); zamknięte reduktor usuwa już przy zamknięciu;
  // gdy nadal za dużo, odpadają najstarsze
  const seen = new Map<string, (typeof p.problems)[number]>();
  for (const pr of p.problems) {
    const k = pr.code + '|' + (pr.ref?.id ?? '');
    const prev = seen.get(k);
    if (!prev || Date.parse(pr.at) >= Date.parse(prev.at)) seen.set(k, pr);
  }
  let problems = p.problems.filter((pr) => seen.get(pr.code + '|' + (pr.ref?.id ?? '')) === pr);
  if (problems.length > LIMITS.problems) {
    problems = [...problems].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-LIMITS.problems);
  }
  return { ...p, pending, operations, problems, log: p.log.slice(-LIMITS.log), reads: p.reads.slice(-LIMITS.reads) };
}

// Zapis jednego wywołania w stanie (rejestr). Odczyt z format=data albo z origin 'panel' zwraca ten sam obiekt:
// bez wpisu, bez zapisu pliku (P1-2). recordCall NIE zmienia rev: właścicielem rev jest magazyn, który podbija go
// przy każdym zapisie pliku (zapis z nieaktualnym rev jest odrzucany i ponawiany), więc wywołujący nie podbija go
// drugi raz ani nie przywraca. Udany odczyt z rozmowy zmienia tylko reads/reads_total.
export function recordCall(p: Process, call: { entry: z.input<typeof LogEntry>; format?: string | undefined }, nowIso: string): Process {
  const e = LogEntry.parse(call.entry);
  if ((call.format === 'data' && e.status === 'ok') || (e.origin === 'panel' && e.effect === 'read')) return p;
  const next = { ...p, updated_at: nowIso };
  if (e.effect === 'read' && e.status === 'ok') {
    next.reads = [...p.reads, e];
    next.reads_total = p.reads_total + 1;
  } else {
    next.log = [...p.log, e];
  }
  return pruneProcess(next, Date.parse(nowIso));
}

// Ile projektów może czekać na utworzenie: najwyżej jeden project_create pod `_new`. Drugie wywołanie, gdy pod
// `_new` jest już karta z project_create (open, granted, running), jest odrzucane kodem new_project_pending.
// Wykonanie jest jednym zapisem: plugin po wyniku project_create przenosi proces (bindProject w rebind.ts), a karta, która właśnie
// działa (status running), przechodzi pod klucz projektu razem z resztą; jej kolejne wywołania (np.
// project_save_env) czytają ids.project_id już spod nowego klucza (Call.deferred wskazuje to wywołanie).
// `bound_project_id` ustawia wyłącznie przeniesienie procesu (bindProject, także gdy proces projektu już istnieje i
// oba procesy są scalane jednym zapisem). W katalogu związanym z projektem (ma project.json) plugin scala każde `_new`
// do procesu projektu tego katalogu (bindProject), więc `_new` nie przeżywa zapisu; klucz `_new` ma tylko katalog
// niezwiązany z żadnym projektem albo związany z inną instancją (inny backend), i wtedy bound_project_id się nie zmienia.
export function canOpenProjectCard(s: State): 'ok' | Extract<SchemaErrorCode, 'new_project_pending'> {
  const fresh = s.process[NEW_KEY];
  const busy = new Set(['open', 'granted', 'running']);
  const hit = fresh?.pending.some((c) => busy.has(c.status) && c.calls.some((k) => k.tool === 'project_create'));
  return hit ? 'new_project_pending' : 'ok';
}

// Precedencja środowisk (P2-5, P2-1): wynik zamraża rejestr w args przy zapisie karty. `kind` to wiersz tabeli:
// 'run' (argument env, choices.run.env_id, ids.env_id), 'functional' (argument env, choices.functional.env_id,
// ids.env_id), 'probe' (argument env, ids.env_id), 'self_check' (zawsze ids.env_id: brak argumentu env).
export function effectiveEnv(kind: 'run' | 'functional' | 'probe' | 'self_check', args: { env?: string | undefined }, p: Process): string {
  const chain = kind === 'run' ? [args.env, p.choices.run.env_id, p.ids.env_id]
    : kind === 'functional' ? [args.env, p.choices.functional.env_id, p.ids.env_id]
    : kind === 'probe' ? [args.env, p.ids.env_id]
    : [p.ids.env_id];
  const hit = chain.find((x) => x !== undefined);
  if (!hit) throw new SchemaError('env_missing');
  return hit;
}
// Zamrażanie WSZYSTKIEGO, co narzędzie czyta ze stanu (P2-1): `freeze` to lista z katalogu (`consent.freeze`):
// ścieżka w stanie -> nazwa argumentu. Argument podany przez model wygrywa (poza `explicit: false`, np. self-check
// bierze zawsze środowisko domyślne), potem choices.*, potem ids.* (kolejność listy). Wynik wchodzi do `calls[].args`;
// process_answer go nie przelicza, więc późniejsze process_set_choices niczego nie zmienia.
export type Required = boolean | { readonly when: string; readonly in: readonly (string | boolean)[] };
const readPathOf = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root);
export function isRequired(r: Required, p: Process): boolean {
  if (typeof r === 'boolean') return r;
  const v = readPathOf(p, r.when);
  return (typeof v === 'string' || typeof v === 'boolean') && r.in.includes(v);
}
export type Freeze = { path: string; arg: string; explicit: boolean }[];
const readPath = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root);
export function freezeArgs(freeze: Freeze, args: Record<string, unknown>, p: Process): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const f of freeze) if (!f.explicit) delete out[f.arg];
  for (const f of freeze) {
    if (out[f.arg] !== undefined) continue;
    const v = readPath(p, f.path);
    if (v !== undefined) out[f.arg] = v;
  }
  if (freeze.some((f) => f.arg === 'env') && out.env === undefined) throw new SchemaError('env_missing');
  return out;
}

// Czy wywołanie jest objęte zgodą karty (P2-3). Zgoda obowiązuje, gdy decision=yes, status karty to granted, done
// albo failed (karta po process_answer dalej niesie zgodę) i expires_at jest w przyszłości. Objęte jest tylko:
// (a) następny krok z covers.tools, i to dopiero po `done` wywołania, które go zadeklarowało (`followUps`: deklarujący
// -> następne kroki z katalogu), albo (b) ponowienie TEGO SAMEGO narzędzia z tym samym args_hash, wyłącznie po failed.
// Wywołanie objęte zgodą przechodzi ponownie podniesienia (protected_env, secret_ref, scheduled_run,
// backend_question): przy trafieniu dostaje nową kartę. Cel (covers.target) musi się zgadzać.
export function coverDecision(
  card: z.infer<typeof Pending>,
  call: { tool: string; args_hash: string; target?: { key: string; id: string } | undefined },
  nowMs: number,
  escalations: z.infer<typeof EscalationName>[],
  followUps: Record<string, string[]>,
): 'covered' | 'new_card' {
  const c = card.covers;
  if (!c || !card.decision || card.decision.value !== 'yes') return 'new_card';
  if (!['granted', 'done', 'failed'].includes(card.status)) return 'new_card';
  if (!c.expires_at || nowMs >= Date.parse(c.expires_at) || c.calls_left < 1) return 'new_card';
  if (escalations.length > 0) return 'new_card';
  if (c.target && (call.target?.key !== c.target.key || call.target?.id !== c.target.id)) return 'new_card';
  const retry = card.calls.some((k) => k.tool === call.tool && k.args_hash === call.args_hash && k.status === 'failed');
  const next = c.tools.includes(call.tool)
    && card.calls.some((k) => k.status === 'done' && (followUps[k.tool] ?? []).includes(call.tool));
  return next || retry ? 'covered' : 'new_card';
}
