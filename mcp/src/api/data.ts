// Reads and checks behind the data tools (`data_*`): the data slots of scenarios and compositions, the
// datasets of the project, the two read-only pre-flights and the data hub's proposal. This is the
// only code that calls the dataset and data-hub routes.
//
// The backend answers every dataset read with the dataset's content, passwords included. All
// dataset reads therefore go through `listDatasets`, which keeps a few facts about each dataset
// and drops the rest (`content`, the preview rows, the sample rows of a recipe) before anything
// else sees the answer; every value of a secret column it saw is registered in `ctx.secrets`.

import * as z from 'zod';

import type { ToolContext } from '../context.js';
import type { components } from '../http/generated/api.js';
import { ToolError } from '../errors.js';
import type { Profile } from '../profiles/presets.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { callOperation } from '../http/operation.js';
import { content } from '../tools/moduleCall.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import { csvRows } from '../security/datasetCells.js';
import { spentPoolOf, type SpentPool } from '../contract/spentPool.js';

export { csvRows };

/** An `api/*` function that reads datasets also needs the secrets of the call. */
export type DataApiContext = ApiContext & Pick<ToolContext, 'secrets'>;

/** Statuses of a slot as the feasibility engine reports them. */
export const SLOT_STATUSES = [
  'bound',
  'auto',
  'missing',
  'column_mismatch',
  'short_rows',
  'stale_pin',
  'empty_column',
  'parse_error',
] as const;

export type SlotStatus = (typeof SLOT_STATUSES)[number];

const isSlotStatus = (value: string): value is SlotStatus =>
  (SLOT_STATUSES as readonly string[]).includes(value);

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

// ---- datasets -----------------------------------------------------------------------------

export interface Dataset {
  readonly id: string;
  readonly name: string;
  readonly columns: string[];
  readonly rows: number | null;
  /** Every consumer takes its own rows (`consumption: exclusive`). */
  readonly exclusive: boolean;
  /** Label of the generator that fills a column, as the recipe names it. */
  readonly generators: { readonly column: string; readonly generator: string }[];
  /** Scenario the generation created the dataset for; null for a dataset someone uploaded. */
  readonly autoLinkedScenarioId: string | null;
}

const datasetList = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/feeders', 'get'>>()(
  z.object({
    feeders: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        columns: z.array(z.string()).catch([]),
        record_count: nullable(z.number()),
        consumption: nullable(z.string()),
        recipe_summary: z
          .array(z.object({ column_name: z.string(), generator: z.string() }))
          .catch([]),
        auto_linked_scenario_id: nullable(z.string()),
      }),
    ),
  }),
);

/** Names of columns that hold secret material (the one pattern; the masker and `apply` both use it). */
export const SECRET_NAME = /pass(word|wd)?|pwd|has[lł]o|secret|token|cvv|cvc|pin\b/iu;
/** Types, semantics and generators the backend gives a column that holds secret material. */
const SECRET_KIND = /pass|pwd|secret|token|card|cvv|cvc|pin\b|credential/iu;

/** A column is secret by its name or by the type, meaning or generator the slot or plan gives it. */
export const isSecretColumn = (name: string, kind?: string | null): boolean =>
  SECRET_NAME.test(name) || (kind != null && SECRET_KIND.test(kind));

/**
 * Every dataset of the project, narrowed to what the plan shows. The list carries no cells (no
 * content and no preview rows): a dataset's cells come only with a read of that dataset, whose
 * answer registers them (`credentialCells` in `callOperation`).
 */
export async function listDatasets(api: DataApiContext, projectId: string): Promise<Dataset[]> {
  const data = await callOperation(
    api.services.http,
    'list_feeders_api_v1_projects__project_id__gatling_feeders_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return datasetList.parse(data).feeders.map((feeder) => ({
    id: feeder.id,
    name: feeder.name,
    columns: feeder.columns,
    rows: feeder.record_count,
    exclusive: feeder.consumption === 'exclusive',
    generators: feeder.recipe_summary.map((entry) => ({
      column: entry.column_name,
      generator: entry.generator,
    })),
    autoLinkedScenarioId: feeder.auto_linked_scenario_id,
  }));
}

// ---- slots of a scenario and of a composition ------------------------------------------------

/** What a column spec adds to the column's name: card networks, a numeric range. */
export interface ColumnSpec {
  readonly name: string;
  /** The type the backend gives the column (`password`, `email`, …); null when it names none. */
  readonly type: string | null;
  readonly cardNetworks: string[];
  readonly min: number | null;
  readonly max: number | null;
}

export interface SlotSpec {
  readonly slot: string;
  /** The label the backend shows (the user may have renamed it); null when it has none. */
  readonly label: string | null;
  readonly columns: string[];
  /** Strategy the scenario is compiled with: `queue` hands every row out once. */
  readonly strategy: string;
  readonly identityKind: 'existing' | 'fresh' | null;
  /** The role the artifact stamped on the slot: `auth` (accounts), `data` (plain data), null on a legacy artifact. */
  readonly role: 'auth' | 'data' | null;
  readonly specs: ColumnSpec[];
}

/**
 * Whether the backend itself judged the slot to be plain data rather than accounts: no login or
 * register verdict (`identity_kind` null) and the resolver's role `data`. A slot with a verdict
 * is an account slot; a legacy artifact that carries neither stamp is an honest unknown, not a
 * data slot, and is not refused. Names of columns never decide it.
 * Rule copied from the backend: `_derive_feeder_slots` (the stamps `identity_kind` and `role`) and
 * `derive_identity_kind` (a `data` slot is always None, an `auth` slot never is).
 */
export const isPlainDataSlot = (spec: Pick<SlotSpec, 'identityKind' | 'role'>): boolean =>
  spec.identityKind === null && spec.role === 'data';

/**
 * Whether the backend itself judged the slot to hold NEW identities: the flow creates the account
 * (a sign-up), so the test invents each value, uses it once, and real accounts would collide with the
 * target's own (`identity_kind` `fresh`). The backend can make such rows (`generateSlotData`); the
 * slot's name never decides it.
 */
export const isFreshIdentitySlot = (spec: Pick<SlotSpec, 'identityKind'>): boolean =>
  spec.identityKind === 'fresh';

/** What the backend's verdicts say a slot holds, over every member that declares it. */
export type SlotIdentity = 'fresh' | 'existing' | 'mixed' | 'none';

/**
 * The one reading of `identity_kind` across the specs of one slot key: `fresh` (every verdict is new
 * identities), `existing` (every verdict is real accounts), `mixed` (one member signs in and another
 * signs up with the same key: no single dataset serves both) or `none` (no verdict: plain data or a
 * legacy artifact). Every tool that treats a slot as new identities asks this, not the spec of one member.
 */
export function identityOf(specs: readonly Pick<SlotSpec, 'identityKind'>[]): SlotIdentity {
  const kinds = new Set(specs.map((spec) => spec.identityKind).filter((kind) => kind !== null));
  if (kinds.has('fresh') && kinds.has('existing')) return 'mixed';
  if (kinds.has('fresh')) return 'fresh';
  if (kinds.has('existing')) return 'existing';
  return 'none';
}

export interface ScenarioSlots {
  readonly id: string;
  readonly name: string;
  readonly slots: SlotSpec[];
  /** The scenario's saved picks, slot to dataset id; a pin whose dataset is gone is not listed. */
  readonly bindings: Readonly<Record<string, string>>;
}

const columnSpec = z.object({
  name: z.string(),
  type: nullable(z.string()).catch(null),
  card_networks: z.array(z.string()).catch([]),
  minimum: nullable(z.number()).catch(null),
  maximum: nullable(z.number()).catch(null),
});

const scenarioDetail = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}', 'get'>
>()(
  z.object({
    id: z.string(),
    name: z.string(),
    slot_bindings: z.record(z.string(), z.string()).catch({}),
    feeder_slots: z
      .array(
        z.object({
          slot: z.string(),
          label: nullable(z.string()),
          columns: z.array(z.string()).catch([]),
          strategy: nullable(z.string()),
          identity_kind: z.enum(['existing', 'fresh']).nullish().catch(null),
          role: z.enum(['auth', 'data']).nullish().catch(null),
          column_specs: z.array(columnSpec).catch([]),
        }),
      )
      .catch([]),
  }),
);

/** The data slots of one scenario, from its detail (the artifact itself is not kept). */
export async function getScenarioSlots(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
): Promise<ScenarioSlots> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}', {
      params: { path: { project_id: projectId, scenario_id: scenarioId } },
      signal: api.signal,
    }),
  );
  const scenario = scenarioDetail.parse(data);
  return {
    id: scenario.id,
    name: scenario.name,
    bindings: scenario.slot_bindings,
    slots: scenario.feeder_slots.map((slot) => ({
      slot: slot.slot,
      label: slot.label,
      columns: slot.columns,
      strategy: slot.strategy ?? '',
      identityKind: slot.identity_kind ?? null,
      role: slot.role ?? null,
      specs: slot.column_specs.map((spec) => ({
        name: spec.name,
        type: spec.type,
        cardNetworks: spec.card_networks,
        min: spec.minimum,
        max: spec.maximum,
      })),
    })),
  };
}

export interface CompositionMembers {
  readonly id: string;
  readonly name: string;
  /** Enabled members in the order the composition runs them. */
  readonly scenarios: { readonly id: string; readonly name: string }[];
  /** The composition's own picks, slot to dataset id (its members' picks are not read by its run). */
  readonly bindings: Readonly<Record<string, string>>;
}

const compositionDetail = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/compositions/{composition_id}', 'get'>
>()(
  z.object({
    id: z.string(),
    name: z.string(),
    slot_bindings: z.record(z.string(), z.string()).catch({}),
    scenarios: z
      .array(
        z.object({
          scenario_id: z.string(),
          scenario_name: z.string(),
          enabled: z.boolean().catch(true),
          order_index: z.number().catch(0),
        }),
      )
      .catch([]),
  }),
);

export async function getCompositionMembers(
  api: SecretApiContext,
  projectId: string,
  compositionId: string,
): Promise<CompositionMembers> {
  const data = await callOperation(
    api.services.http,
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
    {
      path: { project_id: projectId, composition_id: compositionId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  const composition = compositionDetail.parse(data);
  return {
    id: composition.id,
    name: composition.name,
    scenarios: composition.scenarios
      .filter((member) => member.enabled)
      .sort((a, b) => a.order_index - b.order_index)
      .map((member) => ({ id: member.scenario_id, name: member.scenario_name })),
    bindings: composition.slot_bindings,
  };
}

// ---- pre-flights ----------------------------------------------------------------------------

export interface SlotVerdictState {
  readonly slot: string;
  readonly label: string | null;
  readonly status: SlotStatus;
  readonly datasetId: string | null;
  readonly datasetName: string | null;
  readonly rows: number | null;
  /** The columns the slot requires; for a composition, those of every member that declares it. */
  readonly columns: string[];
  /** Rows the pre-flight says the slot needs; null when it names none (no load was sent). */
  readonly need: number | null;
}

/** Verdict per slot of one scenario; nothing is saved and nothing is built. */
export async function preflightScenario(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
  environmentId?: string,
): Promise<SlotVerdictState[]> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/gatling/executions/preflight', {
      params: { path: { project_id: projectId } },
      body: {
        scenario_id: scenarioId,
        ...(environmentId === undefined ? {} : { environment_id: environmentId }),
      },
      signal: api.signal,
    }),
  );
  return (data.verdicts ?? []).map((verdict) => ({
    slot: verdict.slot,
    label: verdict.label ?? null,
    status: verdict.status,
    datasetId: verdict.dataset_id ?? null,
    datasetName: verdict.dataset_name ?? null,
    rows: verdict.have_rows ?? null,
    columns: verdict.required_columns ?? [],
    need: verdict.required_rows ?? null,
  }));
}

/**
 * Verdict per slot of a composition. The backend refuses a whole selection in one sentence; that
 * is an error here, with the sentence as the reason.
 */
export async function preflightComposition(
  api: ApiContext,
  projectId: string,
  compositionId: string,
): Promise<SlotVerdictState[]> {
  const data = await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/feeders/preflight',
      {
        params: { path: { project_id: projectId, composition_id: compositionId } },
        body: {},
        signal: api.signal,
      },
    ),
  );
  if (data.refused != null) {
    throw new ToolError('data_refused', { params: { reason: data.refused.message } });
  }
  return (data.checks ?? []).map((check) => ({
    slot: check.slot,
    label: check.label ?? null,
    status: check.status === 'ok' ? 'bound' : isSlotStatus(check.status) ? check.status : 'missing',
    datasetId: check.feeder_id ?? null,
    datasetName: check.feeder_name ?? null,
    rows: check.rows ?? null,
    columns: check.required_columns ?? [],
    need: check.recommended_row_count ?? null,
  }));
}

/** One data slot of a composition judged against a load profile. */
export interface SlotDemand {
  /** Key of the slot, the value of the `slot` parameter of the data tools. */
  readonly slot: string;
  readonly label: string;
  /** Status of the slot in the check (`ok`, `short_rows`, `missing`, …). */
  readonly status: string;
  readonly blocking: boolean;
  /** Name of the dataset the run reads for the slot; null when none is bound. */
  readonly dataset: string | null;
  /** Rows of the dataset bound to the slot; null when none is bound. */
  readonly have: number | null;
  /** Rows the profile needs; null when the slot does not consume rows one by one. */
  readonly need: number | null;
  /**
   * The backend's own sentence for the slot, its cause (a pool a run already drew from, no pool at
   * all): text of a third party, already masked and on one line (`content()`) when read; null when it has none.
   */
  readonly message?: string | null;
  /** The backend's verdict on the kind of identities the slot holds; null when it gave none. */
  readonly identityKind?: 'existing' | 'fresh' | null;
  /** The dataset the backend says to make again (its fix `regenerate_dataset`); null when none. */
  readonly regenerate?: SpentDataset | null;
  /** What earlier runs took from the slot's pool, read from the backend's sentence; null when it says nothing of it. */
  readonly spent?: SpentPool | null;
}

/**
 * A dataset whose values earlier runs spent while the run reads it from the start: the backend's
 * fix `regenerate_dataset`. New values start a new count.
 */
export interface SpentDataset {
  readonly datasetId: string;
  /** Its name, masked and on one line (`content()`); null when the fix names none. */
  readonly dataset: string | null;
}

/** An id the plugin may repeat as an argument; anything else in its place is dropped. */
const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DATASET_NAME_LIMIT = 120;

/**
 * The fix of a verdict the plugin shows: `regenerate_dataset` with an id. Every other kind, one a
 * later backend adds among them, and a fix that is not an object with string fields are left out,
 * so an unknown fix never changes the view.
 */
function regenerateOf(api: SecretApiContext, fixes: unknown): SpentDataset | null {
  if (!Array.isArray(fixes)) return null;
  for (const fix of fixes as unknown[]) {
    if (typeof fix !== 'object' || fix === null) continue;
    const { kind, dataset_id: id, dataset_name: name } = fix as Record<string, unknown>;
    if (kind !== 'regenerate_dataset' || typeof id !== 'string' || !DATASET_ID.test(id)) continue;
    const dataset = typeof name === 'string' ? content(api, name, DATASET_NAME_LIMIT) : '';
    return { datasetId: id, dataset: dataset === '' ? null : dataset };
  }
  return null;
}

/** What the data check says about one load profile. */
export interface DataDemand {
  /** A run with this profile would not be refused for data. */
  readonly ready: boolean;
  readonly slots: SlotDemand[];
  /** The sentence the run would refuse with, when the check carries one. */
  readonly refusal: string | null;
}

/**
 * The data check of a composition for one load profile: nothing is stored, built or started.
 * A refusal for data is an answer (`ready: false`), not an error.
 */
export async function preflightCompositionFor(
  api: SecretApiContext,
  projectId: string,
  compositionId: string,
  profile: Profile,
): Promise<DataDemand> {
  const data = await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/feeders/preflight',
      {
        params: { path: { project_id: projectId, composition_id: compositionId } },
        body: {
          workload: {
            type: profile.type,
            vusers: profile.vusers,
            ramp: profile.ramp ?? 0,
            hold: profile.hold ?? 0,
          },
        },
        signal: api.signal,
      },
    ),
  );
  // The check carries no kind of identities and no fixes; the verdicts of the same answer do.
  const verdicts = new Map(
    (data.verdicts ?? []).map((verdict) => [verdict.slot, verdict] as const),
  );
  return {
    ready: data.ready,
    refusal:
      data.refused === null || data.refused === undefined
        ? null
        : sentence(api, data.refused.message),
    slots: (data.checks ?? []).map((check) => ({
      slot: check.slot,
      // the names are shown in the views of the run (run_plan, run_start, the dry run): masked (FIX-78)
      label: shownName(api, check.label ?? check.slot),
      status: check.status,
      blocking: check.status !== 'ok' && check.status !== 'auto',
      dataset: check.feeder_name == null ? null : shownName(api, check.feeder_name),
      have: check.rows ?? null,
      need: check.recommended_row_count ?? null,
      message: check.message == null ? null : sentence(api, check.message),
      identityKind: verdicts.get(check.slot)?.identity_kind ?? null,
      regenerate: regenerateOf(api, verdicts.get(check.slot)?.fixes),
      spent: spentPoolOf(check.message),
    })),
  };
}

/** A name of a slot or a dataset as a view of the run shows it: masked, its secrets registered. */
const shownName = (api: SecretApiContext, name: string): string => content(api, name, 120);

/** The backend's sentence about a slot or a refusal: masked by shape, its secrets registered, one line. */
const sentence = (api: SecretApiContext, text: string): string => content(api, text, 520);

/** Verdict statuses of a slot that let a run start. */
const READY_VERDICTS: readonly string[] = ['bound', 'auto'];

/**
 * The data check of one scenario for one load profile on one environment: nothing is stored,
 * built or started. A refusal for data is an answer (`ready: false`), not an error.
 */
export async function preflightScenarioFor(
  api: SecretApiContext,
  projectId: string,
  scenarioId: string,
  profile: Profile,
  environmentId: string,
): Promise<DataDemand> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/gatling/executions/preflight', {
      params: { path: { project_id: projectId } },
      body: {
        scenario_id: scenarioId,
        environment_id: environmentId,
        workload: {
          type: profile.type,
          vusers: profile.vusers,
          ramp: profile.ramp ?? 0,
          hold: profile.hold ?? 0,
        },
      },
      signal: api.signal,
    }),
  );
  return {
    ready: data.ready,
    refusal:
      data.run_environment_refusal == null ? null : sentence(api, data.run_environment_refusal),
    slots: (data.verdicts ?? []).map((verdict) => ({
      slot: verdict.slot,
      // the names are shown in the views of the run (run_plan, run_start, the dry run): masked (FIX-78)
      label: shownName(api, verdict.label ?? verdict.slot),
      status: verdict.status,
      blocking: verdict.blocking === true || !READY_VERDICTS.includes(verdict.status),
      dataset: verdict.dataset_name == null ? null : shownName(api, verdict.dataset_name),
      have: verdict.have_rows ?? null,
      need: verdict.required_rows ?? null,
      message: sentence(api, verdict.message),
      identityKind: verdict.identity_kind ?? null,
      regenerate: regenerateOf(api, verdict.fixes),
      spent: spentPoolOf(verdict.message),
    })),
  };
}

// ---- the data hub's proposal -----------------------------------------------------------------

/** One action the data hub proposes. Nothing is applied; recipes and sample rows are not kept. */
export interface ProposedAction {
  readonly kind: string;
  readonly slot: string | null;
  readonly dataset: string | null;
  readonly name: string | null;
  readonly count: number | null;
  readonly strategy: string | null;
}

/** What the data hub answered: its actions and the first sentence of its reply (why, when it refuses). */
export interface HubProposal<A> {
  readonly actions: A[];
  /** The hub's own words (a model's text): shown through `inline()`, never trusted. */
  readonly reply: string | null;
}

const hubReply = reads<ResponseOf<'/api/v1/projects/{project_id}/data-hub/auto-plan', 'post'>>()(
  z.object({ reply: z.string().nullish().catch(null) }),
);

/** The first sentence of the hub's reply, on one line; null when it says nothing. */
function replyOf(data: unknown): string | null {
  const text = (hubReply.parse(data).reply ?? '').replace(/\s+/gu, ' ').trim();
  if (text === '') return null;
  const end = text.search(/[.!?](\s|$)/u);
  return end === -1 ? text : text.slice(0, end + 1);
}

const proposal = reads<ResponseOf<'/api/v1/projects/{project_id}/data-hub/auto-plan', 'post'>>()(
  z.object({
    actions: z
      .array(
        z.object({
          kind: z.string(),
          slot: nullable(z.string()),
          bind_to_slot: nullable(z.string()),
          dataset_id: nullable(z.string()),
          name: nullable(z.string()),
          label: nullable(z.string()),
          count: nullable(z.number()),
          row_count: nullable(z.number()),
          rows: nullable(z.number()),
          target_rows: nullable(z.number()),
          strategy: nullable(z.string()),
        }),
      )
      .catch([]),
  }),
);

/** The body of the data hub's plan for a scenario or a composition. */
const hubBody = (target: { readonly kind: 'scenario' | 'composition'; readonly id: string }) =>
  target.kind === 'scenario'
    ? { scenario_ids: [target.id] }
    : { scenario_ids: [], composition_id: target.id };

/** The proposals of an answer of the data hub, as the plan shows them. */
function proposedOf(data: unknown): ProposedAction[] {
  return proposal.parse(data).actions.map((action) => ({
    kind: action.kind,
    slot: action.slot ?? action.bind_to_slot,
    dataset: action.dataset_id,
    name: action.name ?? action.label,
    count: action.count ?? action.row_count ?? action.rows ?? action.target_rows,
    strategy: action.strategy,
  }));
}

/** The actions the data hub proposes for a scenario or a composition; this may call a model. */
export async function proposeActions(
  api: ApiContext,
  projectId: string,
  target: { readonly kind: 'scenario' | 'composition'; readonly id: string },
): Promise<HubProposal<ProposedAction>> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/data-hub/auto-plan', {
      params: { path: { project_id: projectId } },
      body: hubBody(target),
      signal: api.signal,
    }),
  );
  return { actions: proposedOf(data), reply: replyOf(data) };
}

// ---- account provisioning ---------------------------------------------------------------------

/** Accounts a provisioning call asks of the backend at once; a batch stays well inside its time limit. */
export const PROVISION_BATCH = 50;
/** Time limit of one batch: the target system may need seconds per account. */
const PROVISION_CALL_TIMEOUT_MS = 280_000;
/** Failures of a batch the plugin keeps; the rest is only counted. */
const FAILURES_KEPT = 5;

const projectSettings = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/project', 'get'>>()(
  z.object({ probes_enabled: z.boolean().catch(false) }),
);

/** Whether the project allows the platform to send requests to its target (probes and accounts). */
export async function getProbeConsent(api: SecretApiContext, projectId: string): Promise<boolean> {
  const data = await callOperation(
    api.services.http,
    'get_gatling_project_api_v1_projects__project_id__gatling_project_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return projectSettings.parse(data).probes_enabled;
}

const createdDataset = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/feeders', 'post'>>()(
  z.object({ id: z.string(), name: z.string() }),
);

/** A new, empty dataset with the given columns; the accounts are appended by the provisioning. */
export async function createAccountsDataset(
  api: SecretApiContext,
  projectId: string,
  dataset: {
    readonly name: string;
    readonly columns: readonly string[];
    readonly fileName: string;
  },
): Promise<{ id: string; name: string }> {
  const data = await callOperation(
    api.services.http,
    'create_feeder_api_v1_projects__project_id__gatling_feeders_post',
    {
      path: { project_id: projectId },
      body: {
        name: dataset.name,
        feeder_type: 'csv',
        strategy: 'queue',
        columns: [...dataset.columns],
        file_name: dataset.fileName,
        content: '',
        record_count: 0,
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return createdDataset.parse(data);
}

/** What one provisioning call did. Passwords are never part of it. */
export interface ProvisionBatch {
  readonly requested: number;
  readonly created: number;
  readonly failed: number;
  /** The backend stopped the series after a streak of failures. */
  readonly aborted: boolean;
  /** The failures the report lists, counted by the HTTP status the target answered with. */
  readonly failures: { readonly status: number | null; readonly count: number }[];
  /**
   * What the target said about the failures, one entry per distinct status and text. It comes from
   * the target application and can hold a value the plugin never saw (a password sent back), so
   * the caller writes it to the log of the call and never to a result.
   */
  readonly failureTexts: { readonly status: number | null; readonly text: string }[];
  /** Named by a report an answer of success carries; null for the report of a 502. */
  readonly environment: string | null;
  /** `METHOD:/path` of the register operation the accounts were created through; null for a 502. */
  readonly registerOperation: string | null;
}

const provisionReport = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/provision', 'post'>
>()(
  z.object({
    requested: z.number(),
    created: z.number(),
    failed: z.number().catch(0),
    aborted: z.boolean().catch(false),
    rows: z.array(z.record(z.string(), z.unknown())).catch([]),
    failures: z
      .array(z.object({ status: nullable(z.number()), detail: z.string().catch('') }))
      .catch([]),
    environment_name: nullable(z.string()),
    register_operation: nullable(z.string()),
  }),
);

/** Every value of a secret-named column in the rows of a report is registered before anything else sees it. */
function registerRowSecrets(api: DataApiContext, rows: readonly Record<string, unknown>[]): void {
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (SECRET_NAME.test(column) && typeof value === 'string' && value !== '') {
        api.secrets.add(value);
      }
    }
  }
}

/** Failures listed in a report, counted by status, and their texts once per status. */
function failuresOf(failures: readonly { status: number | null; detail: string }[]): {
  failures: ProvisionBatch['failures'];
  failureTexts: ProvisionBatch['failureTexts'];
} {
  const counts = new Map<number | null, number>();
  const texts: ProvisionBatch['failureTexts'] = [];
  for (const failure of failures) {
    counts.set(failure.status, (counts.get(failure.status) ?? 0) + 1);
    const known = texts.some(
      (item) => item.status === failure.status && item.text === failure.detail,
    );
    if (!known && failure.detail !== '' && texts.length < FAILURES_KEPT) {
      texts.push({ status: failure.status, text: failure.detail });
    }
  }
  return {
    failures: [...counts].map(([status, count]) => ({ status, count })),
    failureTexts: texts,
  };
}

/**
 * `refused` is true for the report a 502 carries: the answer is a server failure, so the names it
 * holds (`environment_name`, `register_operation`) are not read; the caller has them from the call.
 */
function batchOf(api: DataApiContext, body: unknown, refused = false): ProvisionBatch {
  const report = provisionReport.parse(body);
  registerRowSecrets(api, report.rows);
  return {
    requested: report.requested,
    created: report.created,
    failed: report.failed,
    aborted: report.aborted,
    ...failuresOf(report.failures),
    environment: refused ? null : report.environment_name,
    registerOperation: refused ? null : report.register_operation,
  };
}

/** The report the backend puts in a 502 when not one account could be created. */
function reportOfRefusal(error: unknown): unknown {
  if (!(error instanceof LoadcraftApiError) || error.status !== 502) return undefined;
  const details = error.details;
  return typeof details === 'object' && details !== null && 'requested' in details
    ? details
    : undefined;
}

/** The spec operations the backend offers when no register request is known (`register_operation_required`). */
export function registerCandidates(error: LoadcraftApiError): string[] {
  const details = error.details;
  const list =
    typeof details === 'object' && details !== null && 'candidates' in details
      ? details.candidates
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('register_operation' in item)) return [];
    return typeof item.register_operation === 'string' ? [item.register_operation] : [];
  });
}

export interface ProvisionRequest {
  /** Accounts to create in this call (at most `PROVISION_BATCH`). */
  readonly count: number;
  /** Environment the accounts are created on; without it, the project's default. */
  readonly environmentId?: string;
  /** A scenario whose flow holds the register request. */
  readonly scenarioId?: string;
  /** `METHOD:/path` or operation id of the project's API spec; replaces the flow's request. */
  readonly registerOperation?: string;
  /** The user agreed to create accounts on a protected environment; sent as `false` otherwise. */
  readonly confirmProtected?: boolean;
}

/**
 * `POST …/feeders/{id}/provision`: the backend creates the accounts at the target system and
 * appends them to the dataset. A 502 that carries a report (not one account was created) is a
 * result here, not an error.
 */
export async function provisionAccounts(
  api: DataApiContext,
  projectId: string,
  datasetId: string,
  request: ProvisionRequest,
): Promise<ProvisionBatch> {
  try {
    const data = await must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/provision',
        {
          params: { path: { project_id: projectId, feeder_id: datasetId } },
          body: {
            count: request.count,
            ...(request.environmentId === undefined
              ? {}
              : { environment_id: request.environmentId }),
            ...(request.scenarioId === undefined ? {} : { scenario_id: request.scenarioId }),
            ...(request.registerOperation === undefined
              ? {}
              : { register_operation: request.registerOperation }),
            confirm_protected: request.confirmProtected === true,
          },
          signal: api.signal,
          timeoutMs: PROVISION_CALL_TIMEOUT_MS,
        },
      ),
    );
    return batchOf(api, data);
  } catch (error) {
    const report = reportOfRefusal(error);
    if (report === undefined) throw error;
    return batchOf(api, report, true);
  }
}

/** Saves the whole set of a composition's own picks (the backend overwrites what was saved). */
export async function saveCompositionSlotBindings(
  api: ApiContext,
  projectId: string,
  compositionId: string,
  bindings: Readonly<Record<string, string>>,
): Promise<void> {
  await must(
    api.services.http.PUT(
      '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/slot-bindings',
      {
        params: { path: { project_id: projectId, composition_id: compositionId } },
        body: { bindings: { ...bindings } },
        signal: api.signal,
      },
    ),
  );
}

/** Saves the whole set of a scenario's picks (the backend overwrites what was saved). */
export async function saveSlotBindings(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
  bindings: Readonly<Record<string, string>>,
): Promise<void> {
  await must(
    api.services.http.PUT(
      '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slot-bindings',
      {
        params: { path: { project_id: projectId, scenario_id: scenarioId } },
        body: { bindings: { ...bindings } },
        signal: api.signal,
      },
    ),
  );
}

// ---- accounts from a file and the plan's own actions --------------------------------------------

/** Strategies a dataset can carry. */
export const DATASET_STRATEGIES = ['queue', 'random', 'shuffle', 'circular'] as const;
export type DatasetStrategy = (typeof DATASET_STRATEGIES)[number];

export const isDatasetStrategy = (value: string): value is DatasetStrategy =>
  (DATASET_STRATEGIES as readonly string[]).includes(value);

/** What the plugin keeps of a dataset the backend answered with; the content it sent back is dropped. */
const savedDataset = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/feeders', 'post'>>()(
  z.object({
    id: z.string(),
    name: z.string(),
    record_count: nullable(z.number()),
  }),
);

export interface SavedDataset {
  readonly id: string;
  readonly name: string;
  readonly rows: number | null;
}

const savedOf = (data: unknown): SavedDataset => {
  const dataset = savedDataset.parse(data);
  return { id: dataset.id, name: dataset.name, rows: dataset.record_count };
};

export interface DatasetContent {
  readonly columns: readonly string[];
  readonly fileName: string;
  /** CSV text with a header; the cells of secret columns are registered by the caller. */
  readonly content: string;
  /** Data rows of the content. */
  readonly rows: number;
}

/** A new dataset with the rows of a file (`POST …/gatling/feeders`, inline content). */
export async function uploadDataset(
  api: SecretApiContext,
  projectId: string,
  dataset: DatasetContent & { readonly name: string; readonly strategy: DatasetStrategy },
): Promise<SavedDataset> {
  const data = await callOperation(
    api.services.http,
    'create_feeder_api_v1_projects__project_id__gatling_feeders_post',
    {
      path: { project_id: projectId },
      body: {
        name: dataset.name,
        feeder_type: 'csv',
        strategy: dataset.strategy,
        columns: [...dataset.columns],
        file_name: dataset.fileName,
        content: dataset.content,
        record_count: dataset.rows,
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return savedOf(data);
}

/**
 * New content for an existing dataset: the backend keeps the old one as an earlier revision. A
 * dataset several consumers share is cloned instead, and the answer names the clone.
 */
export async function replaceDatasetContent(
  api: SecretApiContext,
  projectId: string,
  datasetId: string,
  dataset: Pick<DatasetContent, 'content' | 'fileName'>,
): Promise<SavedDataset> {
  const data = await callOperation(
    api.services.http,
    'replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put',
    {
      path: { project_id: projectId, feeder_id: datasetId },
      body: { content: dataset.content, file_name: dataset.fileName },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return savedOf(data);
}

/** One column rule of a dataset made from rules, as the backend takes it. */
export type RecipeColumn = components['schemas']['FeederRecipeColumn'];

const recipeColumn = z.object({
  column_name: z.string(),
  // The backend checks the generator against its own catalog; the plugin passes the name on.
  generation_hint: z.custom<RecipeColumn['generation_hint']>((value) => typeof value === 'string'),
  pattern: nullable(z.string()),
  min_value: nullable(z.number()),
  max_value: nullable(z.number()),
  enum_values: z.array(z.string()).catch([]),
  ref_feeder: nullable(z.string()),
  ref_column: nullable(z.string()),
  semantics: z.custom<RecipeColumn['semantics']>().nullish().catch(null),
  card_networks: z.array(z.custom<NonNullable<RecipeColumn['card_networks']>[number]>()).catch([]),
});

/** An action of the data hub's last plan, narrowed to the kinds the plugin applies. */
export type PlanAction =
  | {
      readonly kind: 'create_dataset';
      readonly name: string;
      readonly slot: string | null;
      readonly rows: number | null;
      readonly columns: RecipeColumn[];
    }
  | { readonly kind: 'bind'; readonly slot: string; readonly datasetId: string }
  | { readonly kind: 'provision_accounts'; readonly datasetId: string | null }
  | { readonly kind: string; readonly slot: string | null; readonly datasetId: string | null };

const rawAction = reads<
  NonNullable<
    ResponseOf<'/api/v1/projects/{project_id}/data-hub/auto-plan', 'post'>['actions']
  >[number]
>()(
  z.object({
    kind: z.string(),
    slot: nullable(z.string()),
    bind_to_slot: nullable(z.string()),
    dataset_id: nullable(z.string()),
    name: nullable(z.string()),
    row_count: nullable(z.number()),
    recipe: z.object({ columns: z.array(recipeColumn).catch([]) }).nullish(),
  }),
);

/** The actions of an answer of the data hub, with what applying them needs. */
function planActionsOf(data: unknown): PlanAction[] {
  const planReply = reads<ResponseOf<'/api/v1/projects/{project_id}/data-hub/auto-plan', 'post'>>()(
    z.object({ actions: z.array(rawAction).catch([]) }),
  );
  return planReply.parse(data).actions.map((action): PlanAction => {
    if (action.kind === 'create_dataset') {
      return {
        kind: 'create_dataset',
        name: action.name ?? '',
        slot: action.bind_to_slot,
        rows: action.row_count,
        columns: (action.recipe?.columns ?? []).map((column) => ({
          column_name: column.column_name,
          generation_hint: column.generation_hint,
          pattern: column.pattern,
          min_value: column.min_value,
          max_value: column.max_value,
          enum_values: column.enum_values,
          ref_feeder: column.ref_feeder,
          ref_column: column.ref_column,
          semantics: column.semantics ?? null,
          card_networks: column.card_networks,
        })),
      };
    }
    if (action.kind === 'bind' && action.slot !== null && action.dataset_id !== null) {
      return { kind: 'bind', slot: action.slot, datasetId: action.dataset_id };
    }
    return {
      kind: action.kind,
      slot: action.slot ?? action.bind_to_slot,
      datasetId: action.dataset_id,
    };
  });
}

/** One answer of the data hub read two ways: as the plan shows it and as its actions are applied. */
export interface HubSuggestion extends HubProposal<ProposedAction> {
  readonly applicable: PlanAction[];
}

/**
 * The data hub's plan for a scenario or composition (this may call a model), asked once: its
 * proposals as the plan shows them and its actions with what applying them needs.
 */
export async function suggestActions(
  api: ApiContext,
  projectId: string,
  target: { readonly kind: 'scenario' | 'composition'; readonly id: string },
): Promise<HubSuggestion> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/data-hub/auto-plan', {
      params: { path: { project_id: projectId } },
      body: hubBody(target),
      signal: api.signal,
    }),
  );
  return { actions: proposedOf(data), applicable: planActionsOf(data), reply: replyOf(data) };
}

/** Rows a dataset made from rules gets when the plan names no count, and the most the backend makes. */
export const RULE_ROWS_DEFAULT = 100;
const RULE_ROWS_MAX = 20_000;

/** Rows within what the backend makes (1 to 20 000), the default when none is named. */
const ruleRows = (rows: number | null): number =>
  Math.min(RULE_ROWS_MAX, Math.max(1, Math.round(rows ?? RULE_ROWS_DEFAULT)));

/**
 * Rows for the columns of one scenario's slot (`POST …/scenarios/{id}/slots/{slot}/generate-feeder`),
 * saved by the backend as the dataset `<slot> data` with the file `<slot>.csv`; a repeat refreshes
 * that dataset. `enrich_with_llm` is always false: the plugin never asks the backend's model for
 * column rules. The route writes a dataset and sends no request to the target system. The content
 * the backend answers with is dropped here.
 */
export async function generateSlotData(
  api: SecretApiContext,
  projectId: string,
  scenarioId: string,
  slot: string,
  rows: number | null,
): Promise<SavedDataset> {
  const data = await callOperation(
    api.services.http,
    'generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post',
    {
      path: { project_id: projectId, scenario_id: scenarioId, slot },
      body: { row_count: ruleRows(rows), enrich_with_llm: false },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return savedOf(data);
}

/** A dataset made from per-column rules, without a model (`POST …/feeders/generate-from-rules`). */
export async function generateDatasetFromRules(
  api: SecretApiContext,
  projectId: string,
  dataset: {
    readonly name: string;
    readonly columns: readonly RecipeColumn[];
    readonly rows: number | null;
  },
): Promise<SavedDataset> {
  const data = await callOperation(
    api.services.http,
    'generate_feeder_from_rules_api_v1_projects__project_id__gatling_feeders_generate_from_rules_post',
    {
      path: { project_id: projectId },
      body: {
        name: dataset.name,
        columns: [...dataset.columns],
        row_count: ruleRows(dataset.rows),
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return savedOf(data);
}
