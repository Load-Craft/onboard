// `data_create_accounts`: creates accounts in the customer's system through the register request, in
// batches, saves them in the slot's dataset and pins that dataset to the slot. Every step that
// sends something to the target comes after the checks that can refuse it.
//
// The dataset's row count is the truth about how many accounts exist: an interrupted series is
// resumed by the same call with the same count, which adds only the missing ones.

import * as z from 'zod';

import {
  PROVISION_BATCH,
  createAccountsDataset,
  getProbeConsent,
  isPlainDataSlot,
  provisionAccounts,
  registerCandidates,
  type DataApiContext,
  type Dataset,
  type ProvisionBatch,
  type ProvisionRequest,
} from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { Logger } from '../../log.js';
import { cutForLog, LoadcraftApiError } from '../../http/apiError.js';
import { listEnvironmentStates } from '../../api/status.js';
import { hasCapability, requireCapability } from '../../http/compat.js';
import { inline } from '../../render/primitives.js';
import type { ProvisionConfirmView, ProvisionView } from '../../render/views/data.js';
import type { Handle, RunTarget } from '../../resolve/handles.js';
import { BLOCKING, dataSlotRemedy } from '../data/plan.js';
import {
  askHub,
  planOf,
  readPlan,
  readSlots,
  type PlanRead,
  type SlotsRead,
} from '../data/readPlan.js';
import { datasetNameFor, fileNameOf, pinSlot } from '../data/slotDataset.js';

export interface ProvisionArgs {
  readonly projectId: string;
  readonly target: RunTarget;
  /** The environment the call named; without it the project's default one is meant. */
  readonly environment?: Handle;
  readonly slot: string;
  readonly count: number;
  readonly register_operation?: string | undefined;
  /** The user agreed to create accounts on a protected environment. */
  readonly confirm_protected?: boolean | undefined;
}

/** Codes the backend gives to a register operation it cannot use; their texts live in the dictionaries. */
const REGISTER_REFUSALS: ReadonlySet<string> = new Set([
  'register_operation_not_in_spec',
  'register_operation_method_not_allowed',
  'register_operation_unfillable',
  'register_operation_dataset_mismatch',
]);

/** Distinct failure reasons shown. */
const MAX_FAILURES = 5;

const ADVICE =
  'Update the LoadCraft server, or load the accounts from a file (data_create_dataset with file and slot).';

/**
 * Where a provisioning stands, kept between calls in the `accountSeries` section of the workspace state under the
 * id of the dataset: the rows the dataset had at the start and the count asked.
 */
const progressEntry = z.object({ baseline: z.number(), count: z.number() });

/** The section of the workspace state that keeps the series between calls. */
export const SERIES_SECTION = 'accountSeries';

/** What the operation entry of a series keeps: enough to show it, read it after a restart, and finish it. */
export const provisionSaved = z.object({
  projectId: z.string(),
  target: z.object({
    kind: z.enum(['composition', 'scenario']),
    id: z.string(),
    name: z.string(),
  }),
  environment: z.object({ id: z.string(), name: z.string() }).nullable(),
  slot: z.string(),
  count: z.number().int(),
  registerOperation: z.string().nullable(),
  dataset: z.object({ id: z.string(), name: z.string() }),
  /** Rows of the dataset before this provisioning began (the start of an interrupted one included). */
  baseline: z.number().int(),
  /** Accounts of this provisioning an earlier, interrupted series had created. */
  earlier: z.number().int(),
  /** The scenarios of the target that read the slot. */
  scenarioIds: z.array(z.string()),
  startedAtMs: z.number(),
});

export type ProvisionSaved = z.infer<typeof provisionSaved>;

/** What a series needs: the call's data API and the log that masks the secrets it registered. */
export type SeriesApi = DataApiContext & { readonly log: Logger };

/** What a series did so far. Passwords are never part of it. */
export interface SeriesResult {
  readonly created: number;
  readonly failed: number;
  /** Batches that created accounts. */
  readonly ran: number;
  readonly aborted: boolean;
  readonly failures: readonly ProvisionBatch['failures'][number][];
  /** Named by a report an answer of success carried; null until one did. */
  readonly environment: string | null;
  readonly registerOperation: string | null;
  /** The dataset is pinned to every scenario that reads the slot. */
  readonly pinned: boolean;
}

/** A series ready to run: nothing has been sent to the target yet. */
export interface SeriesPlan {
  readonly saved: ProvisionSaved;
  readonly before: PlanRead;
  /** Everything of a provision request but the count. */
  readonly request: Omit<ProvisionRequest, 'count'>;
  /** Accounts the series is to create. */
  readonly missing: number;
}

const sameColumns = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name) => b.includes(name));

/** A backend refusal that asks for a decision, as the plugin's own error with its text. */
export function refusal(error: unknown, ctx: ToolContext): unknown {
  if (!(error instanceof LoadcraftApiError)) return error;
  if (error.code === 'register_operation_required') {
    const candidates = registerCandidates(error);
    return new ToolError('register_operation_required', {
      params: {
        candidates:
          candidates.length === 0 ? ctx.t('data.provision.noCandidates') : candidates.join(', '),
      },
      details: { candidates },
      cause: error,
    });
  }
  if (REGISTER_REFUSALS.has(error.code)) {
    return new ToolError(error.code, { params: { detail: error.message }, cause: error });
  }
  return error;
}

/** The dataset the accounts go to: the one pinned to the slot, a leftover empty one, or a new one. */
async function datasetFor(
  ctx: ToolContext,
  args: ProvisionArgs,
  plan: PlanRead,
  columns: readonly string[],
): Promise<{ dataset: Pick<Dataset, 'id' | 'name'>; rows: number }> {
  const verdict = plan.verdicts.find((item) => item.slot === args.slot);
  const pinned = plan.datasets.find((item) => item.id === verdict?.datasetId);
  if (pinned !== undefined) return { dataset: pinned, rows: pinned.rows ?? 0 };

  const name = datasetNameFor(plan, args.slot);
  // A first call that was refused before any account existed left an empty dataset: use it again.
  const leftover = plan.datasets.find(
    (item) => item.name === name && (item.rows ?? 0) === 0 && sameColumns(item.columns, columns),
  );
  if (leftover !== undefined) return { dataset: leftover, rows: 0 };
  const created = await createAccountsDataset(ctx, args.projectId, {
    name,
    columns,
    fileName: fileNameOf(args.slot),
  });
  return { dataset: created, rows: 0 };
}

/**
 * The refusal of a slot of plain data, with the one way on that fills it: a slot that is not
 * missing needs nothing, `apply` only when `apply` makes its rows, otherwise a file with its
 * columns. The data hub is not asked, so `apply` is never named for an action of the hub's plan.
 */
function notAccounts(ctx: ToolContext, slot: string, slots: SlotsRead): ToolError {
  const verdict = slots.verdicts.find((item) => item.slot === slot);
  const remedy =
    verdict?.status === 'missing'
      ? dataSlotRemedy(slot, {
          verdicts: slots.verdicts,
          members: slots.scenarios,
          proposed: [],
          hubReply: null,
        })
      : undefined;
  const blocking = verdict !== undefined && BLOCKING.has(verdict.status);
  const columns =
    remedy?.kind === 'file_only'
      ? remedy.columns
      : (verdict?.columns ?? []).length > 0
        ? (verdict?.columns ?? [])
        : [
            ...new Set(
              slots.scenarios.flatMap((scenario) =>
                scenario.slots.filter((item) => item.slot === slot).flatMap((item) => item.columns),
              ),
            ),
          ];
  const next = !blocking ? 'filled' : remedy?.kind === 'slot_generates' ? 'generate' : 'file';
  return new ToolError('slot_not_accounts', {
    params: {
      slot,
      next: ctx.t(`error.slot_not_accounts.next.${next}`, {
        columns: columns.map((column) => inline(column)).join(', '),
      }),
    },
  });
}

/**
 * Every check before the first account: the backend's abilities, the project's consent to send
 * requests to its target, the user's consent for a protected environment, the slot. Ends with a
 * request for consent, or with a series ready to run; the progress entry of the dataset is saved.
 */
export async function prepareSeries(
  ctx: ToolContext,
  args: ProvisionArgs,
): Promise<
  | { readonly kind: 'confirm'; readonly data: ProvisionConfirmView }
  | { readonly kind: 'series'; readonly plan: SeriesPlan }
> {
  // The slot is checked first: a slot the call may not fill with accounts is refused before any
  // consent is asked for and before anything is sent, and before the data hub is asked (it may
  // call a model): the check needs only the slots and their verdicts.
  const { projectId, target, environment } = args;
  const request = { projectId, target, ...(environment === undefined ? {} : { environment }) };
  const slots = await readSlots(ctx, request);
  const users = slots.scenarios.filter((scenario) =>
    scenario.slots.some((candidate) => candidate.slot === args.slot),
  );
  const spec = users[0]?.slots.find((candidate) => candidate.slot === args.slot);
  if (spec === undefined) {
    throw new ToolError('slot_unknown', {
      params: { slot: args.slot, available: slots.verdicts.map((item) => item.slot).join(', ') },
    });
  }
  const specs = users.flatMap((scenario) => scenario.slots.filter((c) => c.slot === args.slot));
  if (specs.some(isPlainDataSlot)) throw notAccounts(ctx, args.slot, slots);
  const before = planOf(request, slots, await askHub(ctx, request, slots));

  if (args.environment !== undefined) {
    await requireCapability(ctx.services.http, 'provision_environment', ADVICE);
  }
  if (args.register_operation !== undefined) {
    await requireCapability(ctx.services.http, 'provision_register_operation', ADVICE);
  }
  if (!(await getProbeConsent(ctx, args.projectId))) {
    throw new ToolError('probes_disabled', {
      params: { url: ctx.services.links.projectProfile(args.projectId).url },
    });
  }

  // Creating accounts on a protected environment needs the same consent as running a test there.
  const states = await listEnvironmentStates(ctx, projectId);
  const aimed =
    environment === undefined
      ? states.find((item) => item.isDefault)
      : states.find((item) => item.name === environment.name);
  if (aimed?.protected === true && args.confirm_protected !== true) {
    return {
      kind: 'confirm',
      data: {
        needsConfirmation: true,
        slot: args.slot,
        environment: aimed.name,
        count: args.count,
        target: target.name,
      },
    };
  }
  const { dataset, rows } = await datasetFor(ctx, args, before, spec.columns);
  const saved = progressEntry.safeParse(ctx.state.get(SERIES_SECTION, dataset.id)?.value);
  const resumed = saved.success && saved.data.count === args.count && saved.data.baseline <= rows;
  const baseline = resumed ? saved.data.baseline : rows;
  const earlier = Math.max(0, rows - baseline);
  await ctx.state.set(SERIES_SECTION, dataset.id, { baseline, count: args.count });

  // The consent goes to the server only for a protected environment and a server that takes it.
  const sendConsent =
    aimed?.protected === true &&
    (await hasCapability(ctx.services.http, 'provision_protected_confirmation'));
  return {
    kind: 'series',
    plan: {
      saved: {
        projectId,
        target: { kind: target.kind, id: target.id, name: target.name },
        environment:
          environment === undefined ? null : { id: environment.id, name: environment.name },
        slot: args.slot,
        count: args.count,
        registerOperation: args.register_operation ?? null,
        dataset: { id: dataset.id, name: dataset.name },
        baseline,
        earlier,
        scenarioIds: users.map((scenario) => scenario.id),
        startedAtMs: ctx.clock.now(),
      },
      before,
      request: {
        ...(sendConsent ? { confirmProtected: true } : {}),
        ...(environment === undefined ? {} : { environmentId: environment.id }),
        ...(args.register_operation === undefined
          ? users[0] === undefined
            ? {}
            : { scenarioId: users[0].id }
          : { registerOperation: args.register_operation }),
      },
      missing: Math.max(0, args.count - earlier),
    },
  };
}

/**
 * The batches of a series, one after another, with `onBatch` told after each. Runs in the server
 * process, outside any call: `api.signal` stops it, and failure texts leave scrubbed by
 * `api.secrets`, which holds every password the answers carried. Errors are thrown as they came.
 */
export async function runSeries(
  api: SeriesApi,
  plan: SeriesPlan,
  onBatch: (result: SeriesResult) => void,
): Promise<SeriesResult> {
  const { saved, before, request, missing } = plan;
  const planned = Math.ceil(missing / PROVISION_BATCH);
  let created = 0;
  let failed = 0;
  let ran = 0;
  let aborted = false;
  let pinned = false;
  const failures: { status: number | null; count: number }[] = [];
  const logged = new Set<string>();
  let reportedEnvironment: string | null = null;
  let reportedOperation: string | null = null;
  const result = (): SeriesResult => ({
    created,
    failed,
    ran,
    aborted,
    failures: failures.map((item) => ({ ...item })),
    environment: reportedEnvironment,
    registerOperation: reportedOperation,
    pinned,
  });

  for (let index = 0; index < planned && !aborted && !api.signal.aborted; index += 1) {
    const batch = await provisionAccounts(api, saved.projectId, saved.dataset.id, {
      count: Math.min(PROVISION_BATCH, missing - created),
      ...request,
    });
    if (batch.created > 0) ran += 1;
    created += batch.created;
    failed += batch.failed;
    aborted = batch.aborted || batch.created === 0;
    // The same status counts once per line however many batches it came from; what the target
    // said goes to the log, masked with what the call registered, and never to the result.
    for (const failure of batch.failures) {
      const known = failures.find((item) => item.status === failure.status);
      if (known !== undefined) known.count += failure.count;
      else if (failures.length < MAX_FAILURES) {
        failures.push({ status: failure.status, count: failure.count });
      }
    }
    for (const item of batch.failureTexts) {
      const key = `${String(item.status)} ${item.text}`;
      if (logged.has(key)) continue;
      logged.add(key);
      api.log.warn('provision failure text', {
        status: item.status,
        text: cutForLog(item.text),
      });
    }
    if (batch.environment !== null) reportedEnvironment = batch.environment;
    if (batch.registerOperation !== null) reportedOperation = batch.registerOperation;
    if (batch.created > 0 && !pinned) {
      await pinSlot(api, saved.projectId, before, saved.slot, saved.dataset.id);
      pinned = true;
    }
    onBatch(result());
  }
  // The dataset is pinned for every scenario that reads the slot, also when a series made no new account.
  if (!pinned && !api.signal.aborted && saved.earlier + created > 0) {
    await pinSlot(api, saved.projectId, before, saved.slot, saved.dataset.id);
    pinned = true;
  }
  return result();
}

/** The view of a series that ran to its end (or to a stop of the backend); the plan is read again. */
export async function provisionView(
  ctx: ToolContext,
  saved: ProvisionSaved,
  series: SeriesResult,
): Promise<ProvisionView> {
  const total = saved.earlier + series.created;
  const complete = total >= saved.count;
  if (complete) await ctx.state.delete(SERIES_SECTION, saved.dataset.id);
  const after = await readPlan(ctx, {
    projectId: saved.projectId,
    target: saved.target,
    ...(saved.environment === null ? {} : { environment: saved.environment }),
  });
  const named = series.environment ?? saved.environment?.name ?? null;
  return {
    slot: saved.slot,
    dataset: saved.dataset.name,
    requested: saved.count,
    created: series.created,
    earlier: saved.earlier,
    failed: series.failed,
    batches: series.ran,
    batchSize: PROVISION_BATCH,
    registerOperation: series.registerOperation ?? saved.registerOperation,
    environment: saved.environment === null ? null : named,
    masked: true,
    aborted: series.aborted,
    ready: after.view.ready && complete && !series.aborted,
    failures: [...series.failures],
    plan: after.view,
  };
}
