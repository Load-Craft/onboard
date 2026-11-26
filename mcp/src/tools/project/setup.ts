// The setup of a project in LoadCraft after its environments: the analysis of the documentation (or
// of the description) as a long operation, which proposes profile fields (`project_analyze_setup`),
// and applying the profile composed from the proposals, provisioning validators and test types, and
// reading back the documentation, the gate and the conformance of the default environment
// (`project_apply_setup`). Only what is missing is done. The end of the analysis is the operation's
// final step, so a call that waited too short and `process_wait` that finishes it later show the
// same text.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { getApiMap } from '../../api/apiMap.js';
import {
  listEnvironmentRecords,
  runConformance,
  type Conformance,
  type EnvironmentRecord,
} from '../../api/environments.js';
import { ToolError } from '../../errors.js';
import { withheldJobText } from '../../http/errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import {
  applyProfile,
  autoProvision,
  documentCommit,
  getAnalysisRun,
  getProfile,
  getSetupSnapshot,
  getStoredOpenapi,
  profileSchema,
  startAnalysis,
  type AnalysisInput,
  type FieldProposal,
  type ProjectProfile,
  type SetupSnapshot,
} from '../../api/setup.js';
import { UNSETTLED_STATUSES } from '../../contract/setupGate.js';
import {
  defineOperationKind,
  operationLost,
  parseHandle,
  startOrJoin,
  type OperationOutcome,
} from '../../ops/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import type { ProcessUpdateInput } from '../../workspace/reducer.js';
import type {
  AnalyzeSetupData,
  ApplySetupData,
  EnvironmentConformance,
  ProjectRef,
  ReviewField,
  SetupAnalysis,
  SetupResult,
} from '../../render/views/projectSetup.js';
import { renderAnalyzeSetup } from '../../render/views/projectSetup.js';
import { readTextAllowed, type AllowedFile } from '../../workspace/uploads.js';
import {
  openUncertain,
  PROFILE_CONFIDENCE_MIN,
  uncertainProblems,
  type UncertainField,
} from './profile.js';

/**
 * A proposal below this confidence is shown for review. The frontend's threshold for a "high
 * confidence" suggestion (`HIGH_CONFIDENCE_THRESHOLD`, `features/projects/types/suggestion.types.ts:39`
 * at `d93e08d80`).
 */
export const HIGH_CONFIDENCE = 0.8;

/** A phase name the model may see: a plain identifier, not text a body could fill. */
const PLAIN_PHASE = /^[a-z][a-z0-9_]{0,63}$/u;

function plainPhase(phase: string | undefined): string {
  return phase !== undefined && PLAIN_PHASE.test(phase) ? phase : 'failed';
}

// ---- composing the profile ------------------------------------------------------------------

/**
 * Profile fields the analysis proposes, by the path the backend gives them
 * (`_PROFILE_DRAFT_FIELDS`, `domain/services/project_setup_analyzer.py:59-71` at `d93e08d80`).
 * The schema of a field decides whether a proposed value is usable.
 */
const SUGGESTABLE = {
  auth_method: profileSchema.shape.auth_method,
  api_protocol: profileSchema.shape.api_protocol,
  app_architecture: profileSchema.shape.app_architecture,
  has_pagination: profileSchema.shape.has_pagination,
  has_file_uploads: profileSchema.shape.has_file_uploads,
  has_websockets: profileSchema.shape.has_websockets,
  has_sse: profileSchema.shape.has_sse,
  has_async_operations: profileSchema.shape.has_async_operations,
  uses_csrf: profileSchema.shape.uses_csrf,
  idp_domains: profileSchema.shape.idp_domains,
  known_third_party_domains: profileSchema.shape.known_third_party_domains,
} as const;

type SuggestableField = keyof typeof SUGGESTABLE;

/** A proposal the backend leaves out of its profile draft until the user confirms it. */
const NEEDS_CONFIRMATION = 'needs_confirmation';

/** An architecture the sources do not describe: a field to settle with the user. */
const isUnknownArchitecture = (field: string, value: unknown): boolean =>
  field === 'app_architecture' && value === 'unknown';

const PATH_PREFIX = 'project_profile.';

interface Chosen {
  readonly field: SuggestableField;
  readonly value: unknown;
  readonly proposal: FieldProposal;
}

const isSuggestable = (field: string): field is SuggestableField =>
  Object.hasOwn(SUGGESTABLE, field);

/**
 * One proposal per profile field: the most confident of those that are not rejected and carry a
 * value the field accepts. A field with no usable proposal is not in the result.
 */
function choose(proposals: readonly FieldProposal[]): Chosen[] {
  const best = new Map<SuggestableField, Chosen>();
  for (const proposal of proposals) {
    if (!proposal.path.startsWith(PATH_PREFIX) || proposal.status === 'rejected') continue;
    const field = proposal.path.slice(PATH_PREFIX.length);
    if (!isSuggestable(field) || proposal.value === undefined) continue;
    const checked = SUGGESTABLE[field].safeParse(proposal.value);
    if (!checked.success) continue;
    const known = best.get(field);
    if (known === undefined || proposal.confidence > known.proposal.confidence) {
      best.set(field, { field, value: checked.data, proposal });
    }
  }
  return [...best.values()];
}

/**
 * The fields whose chosen proposal is below `PROFILE_CONFIDENCE_MIN`, waits for the user's
 * confirmation (`needs_confirmation`), proposes an unknown architecture, or for which the analysis
 * reports a conflict between its sources (`conflicted` on any usable proposal of the field).
 */
export function uncertainOf(proposals: readonly FieldProposal[]): UncertainField[] {
  const conflicted = new Set(
    proposals
      .filter((proposal) => proposal.status === 'conflicted')
      .map((proposal) => proposal.path.slice(PATH_PREFIX.length)),
  );
  return choose(proposals)
    .filter(
      (item) =>
        item.proposal.confidence < PROFILE_CONFIDENCE_MIN ||
        conflicted.has(item.field) ||
        item.proposal.status === NEEDS_CONFIRMATION ||
        isUnknownArchitecture(item.field, item.value),
    )
    .map((item) => ({
      field: item.field,
      value: item.value,
      confidence: item.proposal.confidence,
      conflicted: conflicted.has(item.field),
      ...(item.proposal.status === NEEDS_CONFIRMATION ? { needsConfirmation: true } : {}),
    }));
}

/** Low confidence, or written by a model rather than read from evidence. */
function needsReview(proposal: FieldProposal): boolean {
  return proposal.confidence < HIGH_CONFIDENCE || proposal.sources.includes('llm');
}

interface Composed {
  /** Every field of the profile: the proposed value where there is one, the current one elsewhere. */
  readonly profile: ProjectProfile;
  readonly fieldsTotal: number;
  readonly review: readonly ReviewField[];
  /** Fields whose proposal waits for the user's confirmation and was left out (current value kept). */
  readonly held: readonly string[];
}

/** The usable proposals counted, and those a person should look at. */
export function proposalSummary(
  proposals: readonly FieldProposal[],
): Omit<Composed, 'profile' | 'held'> {
  const chosen = choose(proposals);
  const review = chosen
    .filter((item) => needsReview(item.proposal))
    .map((item) => ({
      field: item.field,
      value: item.value,
      source: item.proposal.sources.includes('llm')
        ? 'llm'
        : (item.proposal.sources[0] ?? 'unknown'),
    }));
  return { fieldsTotal: chosen.length, review };
}

/**
 * Applies the proposals to the current profile; the result is what `apply` is sent. A proposal that
 * waits for a confirmation (`needs_confirmation`, which the backend keeps out of its own draft) is
 * never applied here: the field keeps its current value and the user settles it through the consent
 * card of `project_set_profile`.
 */
export function composeProfile(
  current: ProjectProfile,
  proposals: readonly FieldProposal[],
): Composed {
  const chosen = choose(proposals);
  const waiting = (item: Chosen): boolean => item.proposal.status === NEEDS_CONFIRMATION;
  const profile: ProjectProfile = {
    ...current,
    ...Object.fromEntries(
      chosen.filter((item) => !waiting(item)).map((item) => [item.field, item.value]),
    ),
  };
  return {
    profile,
    held: chosen.filter(waiting).map((item) => item.field),
    ...proposalSummary(proposals),
  };
}

// ---- the analysis as a long operation -------------------------------------------------------

interface AnalysisState {
  readonly phase: 'running' | 'done' | 'failed';
  /** 0..100 */
  readonly progress: number;
  readonly step?: string;
  /** Backend phase of a failed run (`analysis_failed`, `persist_failed`). */
  readonly failedPhase?: string;
  readonly error?: string;
  readonly proposals?: readonly FieldProposal[];
  /** The specifications the finished analysis saved (the project's documentation now). */
  readonly specIds?: readonly string[];
}

const savedSchema = z.object({
  projectId: z.string(),
  /** Digest of what the analysis was asked to read (`requestDigest`): other material is another run. */
  request: z.string().default(''),
  /** The analysis was sent a document, or the project stored one: the project has documentation. */
  docs: z.boolean().default(false),
});

type Saved = z.infer<typeof savedSchema>;

/** Whether the backend's end state of a run is a finished analysis. */
const FINISHED = new Set(['awaiting_confirmation', 'completed']);

const SETUP_ANALYSIS = 'setup_analysis';

/** The state of an analysis run as the operation keeps it. */
function stateOf(run: Awaited<ReturnType<typeof getAnalysisRun>>): AnalysisState {
  if (run.status === 'failed') {
    return {
      phase: 'failed',
      progress: run.progress,
      failedPhase: run.phase,
      ...(run.error === null ? {} : { error: run.error }),
    };
  }
  if (FINISHED.has(run.status)) {
    return { phase: 'done', progress: 100, proposals: run.proposals ?? [], specIds: run.specIds };
  }
  return {
    phase: 'running',
    progress: run.progress,
    ...(run.step === null ? {} : { step: run.step }),
  };
}

function analysisFailed(ctx: ToolContext, state: AnalysisState): ToolError {
  return new ToolError('setup_analysis_failed', {
    params: {
      phase: plainPhase(state.failedPhase),
      message: withheldJobText(ctx, 'project_analyze_setup', state.error) ?? '—',
    },
  });
}

/**
 * What a finished analysis changes in the process: it ran, the documentation it was given, and the
 * specification it saved from it (the active documentation, when it names one).
 */
function analyzedUpdate(
  saved: Pick<Saved, 'docs'>,
  analysis: SetupAnalysis,
  specIds: readonly string[] = [],
): ProcessUpdateInput {
  const [docsId] = specIds;
  return {
    ...(docsId === undefined ? {} : { ids: { docs_id: docsId } }),
    checks: {
      project: {
        ...(saved.docs ? { docs_imported: { ok: true } } : {}),
        ...(analysis === 'none' ? {} : { setup_analyzed: { ok: true } }),
      },
    },
  };
}

export const setupAnalysisOperation = defineOperationKind({
  kind: SETUP_ANALYSIS,
  saved: savedSchema,
  initial: (): AnalysisState => ({ phase: 'running', progress: 0 }),
  recoverIsRead: true,
  // The run is read through REST only; a run the backend no longer knows (404) is a lost operation.
  async recover(ctx, id): Promise<AnalysisState> {
    return stateOf(await getAnalysisRun(ctx, id));
  },
  isTerminal: (state) => state.phase !== 'running',
  describe(state, t) {
    const fraction = Math.min(1, Math.max(0, state.progress / 100));
    if (state.step === undefined) {
      return {
        message: t(
          state.progress === 0 ? 'initProject.analysis.queued' : 'initProject.analysis.running',
        ),
        fraction,
      };
    }
    const key = `initProject.analysis.step.${state.step}`;
    return {
      message: t.has(key)
        ? t('initProject.analysis.progress', { label: t(key) })
        : t('initProject.analysis.running'),
      fraction,
    };
  },
  // The proposals are only shown here; `project_apply_setup` reads them again by the handle.
  finish(ctx, id, state, saved): Promise<DoneOutcome<AnalyzeSetupData>> {
    if (state.phase === 'failed') return Promise.reject(analysisFailed(ctx, state));
    const summary = proposalSummary(state.proposals ?? []);
    const uncertain = uncertainOf(state.proposals ?? []);
    return Promise.resolve({
      status: 'done',
      data: {
        analysis: 'analyzed',
        fieldsTotal: summary.fieldsTotal,
        needsReview: summary.review,
        ...(uncertain.length === 0 ? {} : { uncertain }),
        operation: `${SETUP_ANALYSIS}:${id}`,
      },
      update: {
        ...analyzedUpdate(saved, 'analyzed', state.specIds),
        // the warning names the fields of this analysis only: an older one is replaced
        problems: uncertainProblems(
          uncertain.map((item) => item.field),
          'project_analyze_setup',
        ),
      },
    });
  },
  view: renderAnalyzeSetup,
});

// ---- starting the analysis ------------------------------------------------------------------

export interface AnalyzeInput {
  readonly projectId: string;
  readonly openapi?: AllowedFile;
  readonly asyncapi?: AllowedFile;
  /** Overview text or description; the analysis reads it. */
  readonly description?: string;
  readonly maxWaitS: number;
}

/** The commit a local document names as its source; null when it is not JSON or names none. */
async function localCommit(file: AllowedFile): Promise<string | null> {
  try {
    return documentCommit(JSON.parse(await readTextAllowed(file)));
  } catch {
    return null;
  }
}

/** Equal for equal material (description, OpenAPI and AsyncAPI as given), whatever the project already stores. */
function requestDigest(input: AnalyzeInput): string {
  const material = JSON.stringify([
    input.description ?? null,
    input.openapi ?? null,
    input.asyncapi ?? null,
  ]);
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** The analysis request: the OpenAPI document is left out when the project stores the same one. */
async function analysisInput(ctx: ToolContext, input: AnalyzeInput): Promise<AnalysisInput> {
  let openapi = input.openapi;
  if (openapi !== undefined) {
    const local = await localCommit(openapi);
    const stored = local === null ? null : await getStoredOpenapi(ctx, input.projectId);
    if (local !== null && stored?.commit === local) openapi = undefined;
  }
  return {
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(openapi === undefined ? {} : { openapi }),
    ...(input.asyncapi === undefined ? {} : { asyncapi: input.asyncapi }),
  };
}

/**
 * Starts the analysis when the project has material for it and has not been analysed and set up
 * yet. Returns what it proposes, or the handle of the analysis when it was still running after
 * `maxWaitS`. A document sent here is saved by the analysis as the project's documentation.
 */
export async function analyzeSetup(
  ctx: ToolContext,
  input: AnalyzeInput,
): Promise<OperationOutcome<AnalyzeSetupData>> {
  const { projectId } = input;
  const snapshot = await getSetupSnapshot(ctx, projectId);
  const docs =
    input.openapi !== undefined ||
    input.asyncapi !== undefined ||
    snapshot.hasOpenapi ||
    snapshot.hasAsyncapi;
  const material = docs || input.description !== undefined || snapshot.hasDescription;
  const saved: Saved = { projectId, request: requestDigest(input), docs };

  // Nothing to analyse: the recording of a HAR session fills the profile later; not an error.
  if (!material) {
    return { status: 'done', data: { analysis: 'none', fieldsTotal: 0, needsReview: [] } };
  }
  if (snapshot.analysisDone && snapshot.profileApplied) {
    return {
      status: 'done',
      data: { analysis: 'kept', fieldsTotal: 0, needsReview: [] },
      update: analyzedUpdate(saved, 'kept'),
    };
  }

  const request = await analysisInput(ctx, input);
  // An analysis of this project that is still running over the same material is joined, not
  // started twice. Other material (a changed specification or description) starts its own run, so
  // the result is never about an older version than the one this call sent.
  const run = async (): Promise<OperationOutcome<AnalyzeSetupData>> =>
    startOrJoin(ctx, setupAnalysisOperation, {
      maxWaitS: input.maxWaitS,
      matches: (other) => other.projectId === projectId && other.request === saved.request,
      async start() {
        return { id: await startAnalysis(ctx, projectId, request), saved };
      },
    });
  try {
    return await run();
  } catch (error) {
    // The backend keeps runs in memory: after a restart the run is gone, and the analysis is
    // started once more. A second loss is reported.
    if (!(error instanceof ToolError) || error.code !== 'operation_lost') throw error;
    return run();
  }
}

// ---- applying the profile, provisioning, reporting ------------------------------------------

/**
 * The proposals of the finished analysis `handle` names, read again from LoadCraft. A run of another
 * project is `setup_analysis_other_project`, a run still going `setup_analysis_running`, a failed one
 * `setup_analysis_failed`, one the backend no longer knows (a restart) `operation_lost`.
 */
async function proposalsOf(
  ctx: ToolContext,
  handle: string,
  projectId: string,
): Promise<readonly FieldProposal[]> {
  const { kind, id } = parseHandle(handle);
  if (kind !== SETUP_ANALYSIS) {
    throw new ToolError('operation_kind_unsupported', { params: { value: handle, kind } });
  }
  let run: Awaited<ReturnType<typeof getAnalysisRun>>;
  try {
    run = await getAnalysisRun(ctx, id);
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw operationLost(handle, error);
    }
    throw error;
  }
  // A handle from another session or from before the repository was bound again: the proposals
  // describe another application and are never applied to this project.
  if (run.projectId !== null && run.projectId !== projectId) {
    throw new ToolError('setup_analysis_other_project', { params: { operation: handle } });
  }
  const state = stateOf(run);
  if (state.phase === 'failed') throw analysisFailed(ctx, state);
  if (state.phase === 'running') {
    throw new ToolError('setup_analysis_running', { params: { operation: handle } });
  }
  return state.proposals ?? [];
}

const toResult = (
  snapshot: SetupSnapshot,
  analysis: SetupAnalysis,
  docs: SetupResult['docs'],
  applied: { fieldsTotal: number; review: readonly ReviewField[]; profile?: ProjectProfile },
): SetupResult => ({
  docs,
  analysis,
  analysisPct: analysis === 'none' ? 0 : 100,
  fieldsTotal: applied.fieldsTotal,
  needsReview: applied.review,
  ...(applied.profile === undefined
    ? {}
    : {
        auth: {
          method: applied.profile.auth_method,
          ...(applied.profile.auth_token_endpoint === null ||
          applied.profile.auth_token_endpoint === ''
            ? {}
            : { tokenEndpoint: applied.profile.auth_token_endpoint }),
        },
      }),
  profileApplied: snapshot.profileApplied,
  validators: snapshot.validators.count,
  testTypes: snapshot.testTypes.count,
  testTypesToReview: snapshot.testTypes.needsReview,
  complete: snapshot.complete,
  missing: snapshot.missing,
});

/** The documentation as the project has it now: title and operations, and the areas of the map. */
async function documentation(ctx: ToolContext, projectId: string): Promise<SetupResult['docs']> {
  const map = await getApiMap(ctx, projectId);
  if (map?.title != null) {
    return { title: map.title, operations: map.operations, areas: map.areas };
  }
  const stored = await getStoredOpenapi(ctx, projectId);
  if (stored === null) return null;
  return map === null
    ? { title: stored.title, operations: stored.operations }
    : { title: stored.title, operations: map.operations, areas: map.areas };
}

/** Statuses that mean the token may not do this at all; the call fails instead of going on. */
const REFUSED = new Set([401, 403]);

/** Names of the fixed headers the environments of a project have (a child inherits its parent's). */
export function fixedHeaderNames(records: readonly EnvironmentRecord[]): ReadonlySet<string> {
  return new Set(
    records.flatMap((record) => Object.keys(record.headers)).map((name) => name.toLowerCase()),
  );
}

/**
 * The report of a conformance probe as the view shows it; undefined when nothing was probed. Of the
 * headers the probe reports as sent only the names of fixed headers of the project's environments
 * (`known`) are kept: anything else in that list is never shown, as it could be a value.
 */
export function conformanceResult(
  found: Conformance,
  known: ReadonlySet<string>,
): EnvironmentConformance | undefined {
  const unchecked = found.notProbedMethods + found.skippedParams + found.offHost;
  if (found.exists + found.missing + found.inconclusive + unchecked === 0) return undefined;
  const incomplete = found.reportStatus !== COMPLETE;
  return {
    state: 'checked',
    exists: found.exists,
    missing: found.missing,
    missingPaths: found.missingPaths,
    missingMore: Math.max(0, found.missing - found.missingPaths.length),
    inconclusive: found.inconclusive,
    notProbedMethods: found.notProbedMethods,
    skippedParams: found.skippedParams,
    ...(found.offHost === 0 ? {} : { offHost: found.offHost }),
    ...(found.headersSent === undefined
      ? {}
      : { headersSent: found.headersSent.filter((name) => known.has(name.toLowerCase())) }),
    ...(found.statuses.length === 0 ? {} : { statuses: found.statuses }),
    ...(incomplete ? { reportStatus: found.reportStatus } : {}),
  };
}

/** The status of a report the probe finished. */
const COMPLETE = 'complete';

/**
 * Conformance of the default environment against the documentation. A protected environment is
 * not probed (the check sends real requests to it). Returns the name of the environment the
 * result belongs to; undefined when the project has no default environment or nothing to probe.
 */
export async function checkConformance(
  ctx: ToolContext,
  projectId: string,
  /** The environments of the project, when the caller has just read them. */
  known?: readonly EnvironmentRecord[],
): Promise<{ environment: string; result: EnvironmentConformance } | undefined> {
  const records = known ?? (await listEnvironmentRecords(ctx, projectId));
  const target = records.find((item) => item.isDefault);
  if (target === undefined) return undefined;
  if (target.protected !== false) return { environment: target.name, result: { state: 'skipped' } };
  try {
    const result = conformanceResult(
      await runConformance(ctx, projectId, target.id),
      fixedHeaderNames(records),
    );
    return result === undefined ? undefined : { environment: target.name, result };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    const refused = error instanceof LoadcraftApiError && REFUSED.has(error.status);
    if (!(error instanceof ToolError) || refused) throw error;
    // The report is an extra: a probe that did not answer is shown as such, the setup is done.
    return { environment: target.name, result: { state: 'failed' } };
  }
}

/** Longest note of a check. */
const NOTE_LIMIT = 200;

/**
 * What a conformance probe says about `project.env_checked`: `ok` when the environment answered a
 * documented GET and lacks none; false when it lacks some; null (undecided: neither green nor a
 * blocker) when no documented GET was answered or missing, as when every probe got a 400.
 */
export interface ConformanceVerdict {
  readonly ok: boolean | null;
  readonly note: string;
}

/** The verdict and note of `project.env_checked` for a conformance probe that ran; undefined for none. */
export function conformanceNote(
  checked: { environment: string; result: EnvironmentConformance } | undefined,
): ConformanceVerdict | undefined {
  if (checked?.result.state !== 'checked') return undefined;
  const { exists, missing, inconclusive, statuses } = checked.result;
  const undecided = exists === 0 && missing === 0;
  const spread = (statuses ?? []).map((item) => `${String(item.status)} x${String(item.count)}`);
  const note = undecided
    ? `conformance of ${checked.environment}: no documented GET operation answered (${String(inconclusive)} inconclusive${spread.length === 0 ? '' : `: ${spread.join(', ')}`})`
    : `conformance of ${checked.environment}: ${String(exists)} documented GET operations answer, ${String(missing)} missing`;
  return { ok: missing > 0 ? false : undecided ? null : true, note: note.slice(0, NOTE_LIMIT) };
}

/** What decides the unsure fields after an apply. */
interface Unsure {
  /** The fields the open warning of the analysis names. */
  readonly open: readonly string[];
  /** Fields the backend recorded as applied without the user settling them. */
  readonly recorded: readonly string[];
  /** Fields whose proposal waits for a confirmation and was not applied. */
  readonly held: readonly string[];
  /** The applied profile names no architecture (`unknown`). */
  readonly unknownArchitecture: boolean;
}

/**
 * The unsure fields after an apply: those of the open warning the result does not list to check
 * (a listed one is settled with the user from the result), those the backend recorded as applied
 * without a confirmation, those left out for one, and an unknown architecture.
 */
export function unsureAfterApply(
  setup: Pick<SetupResult, 'needsReview'>,
  unsure: Unsure,
): string[] {
  const shown = new Set(setup.needsReview.map((item) => item.field));
  return [
    ...new Set([
      ...unsure.open.filter((field) => !shown.has(field)),
      ...unsure.recorded,
      ...unsure.held,
      ...(unsure.unknownArchitecture ? ['app_architecture'] : []),
    ]),
  ];
}

/**
 * What the applied setup changes in the process: the gate of the setup, the warning of the unsure
 * profile fields and, when the default environment was probed against the documentation, whether it
 * serves every documented GET operation. A probe that was skipped (protected) or did not answer
 * leaves the check as it is.
 */
function appliedUpdate(
  setup: SetupResult,
  checked: { environment: string; result: EnvironmentConformance } | undefined,
  open: readonly string[],
  next: readonly string[],
): ProcessUpdateInput {
  const probed = conformanceNote(checked);
  const same = open.length === next.length && open.every((field, i) => field === next[i]);
  return {
    ...(same ? {} : { problems: uncertainProblems(next, 'project_apply_setup') }),
    checks: {
      project: {
        setup_applied: { ok: setup.complete },
        ...(probed === undefined ? {} : { env_checked: { ok: probed.ok, note: probed.note } }),
      },
    },
  };
}

/**
 * Applies the profile composed from the proposals of the analysis `handle` names (none: the profile
 * is left as it is), provisions what is missing and reports the setup as LoadCraft now has it, with
 * the conformance of the default environment when the project has documentation.
 */
export async function applySetup(
  ctx: ToolContext,
  project: ProjectRef,
  handle: string | undefined,
): Promise<DoneOutcome<ApplySetupData>> {
  const projectId = project.id;
  let applied: {
    fieldsTotal: number;
    review: readonly ReviewField[];
    profile?: ProjectProfile;
    held?: readonly string[];
  } = {
    fieldsTotal: 0,
    review: [],
  };
  if (handle !== undefined) {
    const proposals = await proposalsOf(ctx, handle, projectId);
    const composed = composeProfile(await getProfile(ctx, projectId), proposals);
    await applyProfile(ctx, projectId, composed.profile);
    applied = composed;
  }
  let snapshot = await getSetupSnapshot(ctx, projectId);
  // Also without an analysis: the defaults come from LoadCraft's catalogue, not from a document, and
  // flows recorded from a HAR file need them (a realistic data mix names the negative and edge types).
  if (snapshot.validators.count === 0 || snapshot.testTypes.count === 0) {
    await autoProvision(ctx, projectId);
    snapshot = await getSetupSnapshot(ctx, projectId);
  }
  const analysis: SetupAnalysis =
    handle !== undefined ? 'analyzed' : snapshot.analysisDone ? 'kept' : 'none';
  const docs = snapshot.hasOpenapi ? await documentation(ctx, projectId) : null;
  // The documentation came with the analysis applied here, so the default environment is probed
  // against it now; documentation the project had before was probed by `project_check_env`.
  const checked =
    docs === null || handle === undefined ? undefined : await checkConformance(ctx, projectId);
  const setup = toResult(snapshot, analysis, docs, applied);
  const open = openUncertain(ctx.state.process());
  const unsure = unsureAfterApply(setup, {
    open,
    recorded: snapshot.provenance
      .filter((entry) => UNSETTLED_STATUSES.has(entry.status))
      .map((entry) => entry.field),
    held: applied.held ?? [],
    unknownArchitecture: applied.profile?.app_architecture === 'unknown',
  });
  return {
    status: 'done',
    data: {
      project,
      setup,
      ...(checked === undefined ? {} : { conformance: checked }),
      ...(unsure.length === 0 ? {} : { unsure }),
    },
    links: [ctx.services.links.projectProfile(projectId)],
    update: appliedUpdate(setup, checked, open, unsure),
  };
}
