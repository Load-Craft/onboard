// The setup of a project in LoadCraft: the state of its gate, the documentation it stores, the
// analysis run that proposes a profile, applying a profile and provisioning validators and test
// types. Each function keeps only what the setup tools show or send: the analysis answer carries
// evidence of every source, which never leaves this file.

import * as z from 'zod';

import type { components } from '../http/generated/api.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { uploadFile } from '../http/upload.js';
import type { AllowedFile } from '../workspace/uploads.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import { provenanceOf, type FieldProvenance } from '../contract/setupGate.js';
import { SETUP_STEPS, type SetupStep } from './status.js';

// ---- the state of the setup gate ------------------------------------------------------------

export interface SetupCategory {
  readonly count: number;
  /** Items LoadCraft created (or a person left) marked for review. */
  readonly needsReview: number;
}

export interface SetupSnapshot {
  readonly complete: boolean;
  /** Unmet gate steps, in the gate's order. */
  readonly missing: readonly SetupStep[];
  readonly analysisDone: boolean;
  readonly profileApplied: boolean;
  readonly hasOpenapi: boolean;
  readonly hasAsyncapi: boolean;
  readonly hasDescription: boolean;
  readonly validators: SetupCategory;
  readonly testTypes: SetupCategory;
  /** The provenance of the applied profile, by field name; empty before an apply recorded one. */
  readonly provenance: readonly FieldProvenance[];
}

/**
 * `GET …/setup/status`. The gate's unmet steps are judged as the gate judges them
 * (`setup_gate.py:64-106`): an empty category or a missing time stamp is unmet, `needs_review` is not.
 */
export async function getSetupSnapshot(api: ApiContext, projectId: string): Promise<SetupSnapshot> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/setup/status', {
      params: { path: { project_id: projectId } },
      signal: api.signal,
    }),
  );
  const unmet: Record<SetupStep, boolean> = {
    environments: (data.environments?.count ?? 0) === 0,
    evidence: data.evidence?.state !== 'good',
    analysis: data.analysis?.completed_at == null,
    profile: data.profile?.applied_at == null,
    validators: data.validators.count === 0,
    test_types: data.test_types.count === 0,
  };
  return {
    complete: data.setup_complete,
    missing: SETUP_STEPS.filter((step) => unmet[step]),
    analysisDone: data.analysis?.completed_at != null,
    profileApplied: data.profile?.applied_at != null,
    hasOpenapi: data.evidence?.has_openapi === true,
    hasAsyncapi: data.evidence?.has_asyncapi === true,
    hasDescription: data.evidence?.has_description === true,
    validators: { count: data.validators.count, needsReview: data.validators.needs_review },
    testTypes: { count: data.test_types.count, needsReview: data.test_types.needs_review },
    provenance: provenanceOf(data.profile?.field_provenance),
  };
}

// ---- the stored documentation ---------------------------------------------------------------

export interface StoredOpenapi {
  readonly id: string;
  readonly title: string;
  /** `info.version` of the stored document. */
  readonly version: string;
  readonly operations: number;
  /** `info.x-loadcraft-source.commit` of the stored document; null when it carries none. */
  readonly commit: string | null;
  /** The stored document as parsed JSON, for comparing it with a local one. */
  readonly content: unknown;
}

const sourceMark = reads<
  ResponseOf<'/api/v1/projects/{project_id}/openapi', 'get'>['spec_content']
>()(
  z
    .object({
      info: z
        .object({
          'x-loadcraft-source': z.object({ commit: z.string().nullish() }).partial().nullish(),
        })
        .partial()
        .nullish(),
    })
    .partial()
    .nullish(),
);

const storedOpenapi = reads<ResponseOf<'/api/v1/projects/{project_id}/openapi', 'get'>>()(
  z.object({
    id: z.string(),
    title: z.string(),
    version: z.string().default(''),
    endpoints: z.array(z.unknown()),
    spec_content: z.unknown(),
  }),
);

/** The commit a document names as its source (`info.x-loadcraft-source.commit`), or null. */
export function documentCommit(document: unknown): string | null {
  const parsed = sourceMark.safeParse(document);
  const commit = parsed.success ? parsed.data?.info?.['x-loadcraft-source']?.commit : undefined;
  return typeof commit === 'string' && commit !== '' ? commit : null;
}

/** `GET …/openapi`: the project's current OpenAPI document, or null when it has none (404). */
export async function getStoredOpenapi(
  api: ApiContext,
  projectId: string,
): Promise<StoredOpenapi | null> {
  try {
    const data = storedOpenapi.parse(
      await must(
        api.services.http.GET('/api/v1/projects/{project_id}/openapi', {
          params: { path: { project_id: projectId } },
          signal: api.signal,
        }),
      ),
    );
    return {
      id: data.id,
      title: data.title,
      version: data.version,
      operations: data.endpoints.length,
      commit: documentCommit(data.spec_content),
      content: data.spec_content,
    };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return null;
    throw error;
  }
}

// ---- the analysis run -----------------------------------------------------------------------

/** One proposal of the analysis for a field of the project. */
export interface FieldProposal {
  /** Path as the backend names it, e.g. `project_profile.auth_method`. */
  readonly path: string;
  readonly value: unknown;
  /** 0..1 */
  readonly confidence: number;
  /** `suggested`, `accepted`, `edited`, `rejected`, `defaulted`, `conflicted`. */
  readonly status: string;
  /** `user`, `har`, `openapi`, `asyncapi`, `postman`, `preset`, `llm`. */
  readonly sources: readonly string[];
}

export interface AnalysisRun {
  /** `queued`, `analyzing`, `awaiting_confirmation` (the end of a successful analysis), `failed`… */
  readonly status: string;
  /** `analysis_failed` or `persist_failed` when `status` is `failed`. */
  readonly phase: string;
  /** 0..100 */
  readonly progress: number;
  /** Node of the analysis graph under way, e.g. `enrich_profile`. */
  readonly step: string | null;
  readonly error: string | null;
  /** Present once the analysis has finished. */
  readonly proposals: readonly FieldProposal[] | null;
  /** The specifications the analysis saved from the documents it was sent. */
  readonly specIds: readonly string[];
  /** The project the run analyses; null when the backend does not say. */
  readonly projectId: string | null;
}

const runSchema = reads<ResponseOf<'/api/v1/project-setup/runs/{run_id}', 'get'>>()(
  z.object({
    status: z.string(),
    phase: z.string().default(''),
    progress: z.number().default(0),
    current_step: z.string().nullish(),
    error: z.string().nullish(),
    openapi_spec_ids: z.array(z.string()).default([]),
    project_id: z.string().nullish(),
    result: z
      .object({
        suggestions: z
          .array(
            z.object({
              field_path: z.string(),
              value: z.unknown(),
              confidence: z.number().default(0),
              status: z.string().default('suggested'),
              source_kinds: z.array(z.string()).default([]),
            }),
          )
          .default([]),
      })
      .nullish(),
  }),
);

/**
 * `GET /api/v1/project-setup/runs/{run_id}`. The run lives in the memory of the backend process:
 * after a restart the answer is 404 (a `LoadcraftApiError`), which the caller treats as a lost run.
 */
export async function getAnalysisRun(api: ApiContext, runId: string): Promise<AnalysisRun> {
  const data = runSchema.parse(
    await must(
      api.services.http.GET('/api/v1/project-setup/runs/{run_id}', {
        params: { path: { run_id: runId } },
        signal: api.signal,
      }),
    ),
  );
  return {
    status: data.status,
    phase: data.phase,
    progress: data.progress,
    step: data.current_step ?? null,
    error: data.error ?? null,
    specIds: data.openapi_spec_ids,
    projectId: data.project_id ?? null,
    proposals:
      data.result == null
        ? null
        : data.result.suggestions.map((item) => ({
            path: item.field_path,
            value: item.value,
            confidence: item.confidence,
            status: item.status,
            sources: item.source_kinds,
          })),
  };
}

export interface AnalysisInput {
  /** Becomes the project's description and the text the analysis reads (`metadata.app_summary`). */
  readonly description?: string;
  readonly openapi?: AllowedFile;
  readonly asyncapi?: AllowedFile;
}

const runStarted = reads<ResponseOf<'/api/v1/projects/{project_id}/setup/analyze', 'post'>>()(
  z.object({ run_id: z.string() }),
);

const NO_FILES: components['schemas']['Body_analyze_project_setup_for_project_api_v1_projects__project_id__setup_analyze_post'] =
  {
    metadata: '{}',
    asyncApiFiles: [],
    'asyncApiFiles[]': [],
    asyncApiUrls: [],
    'asyncApiUrls[]': [],
    docsUrls: [],
    'docsUrls[]': [],
    harFiles: [],
    'harFiles[]': [],
    openApiFiles: [],
    'openApiFiles[]': [],
    openApiUrls: [],
    'openApiUrls[]': [],
    postmanFiles: [],
    'postmanFiles[]': [],
  };

/**
 * `POST …/setup/analyze`: starts an analysis and returns the id of its run. A document sent here is
 * saved by the analysis as the project's current specification, so no separate upload is made.
 */
export async function startAnalysis(
  api: ApiContext,
  projectId: string,
  input: AnalysisInput,
): Promise<string> {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/setup/analyze`;
  const metadata = JSON.stringify(
    input.description === undefined ? {} : { app_summary: input.description },
  );
  const files: { field: string; file: AllowedFile }[] = [
    ...(input.openapi === undefined ? [] : [{ field: 'openApiFiles', file: input.openapi }]),
    ...(input.asyncapi === undefined ? [] : [{ field: 'asyncApiFiles', file: input.asyncapi }]),
  ];
  const [first, ...more] = files;
  if (first !== undefined) {
    return runStarted.parse(
      await uploadFile(api.services.http, {
        url: path,
        field: first.field,
        file: first.file,
        moreFiles: more,
        fields: { metadata },
        signal: api.signal,
      }),
    ).run_id;
  }
  const form = new FormData();
  form.set('metadata', metadata);
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/setup/analyze', {
      params: { path: { project_id: projectId } },
      body: NO_FILES,
      bodySerializer: () => form,
      signal: api.signal,
    }),
  );
  return data.run_id;
}

// ---- the profile ----------------------------------------------------------------------------

type Profile = components['schemas']['ProjectProfile'];

// Choices of the profile (`ProjectProfile`, `domain/models/project_profile.py:181-223`).
const API_PROTOCOLS = ['rest', 'graphql', 'grpc_web', 'soap', 'mixed'] as const;
// `unknown`: the sources do not say how the client is built; it never stands for a known value.
const ARCHITECTURES = ['spa', 'mpa', 'ssr', 'mobile', 'mixed', 'unknown'] as const;
const AUTH_METHODS = [
  'bearer_jwt',
  'session_cookie',
  'oauth2_code',
  'oauth2_pkce',
  'api_key',
  'basic',
  'saml',
  'none',
] as const;

const isRecord = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const flag = z.boolean().default(false);
const names = z.array(z.string()).default([]);

/**
 * The profile as the backend stores it, every field with the value the backend gives a field that
 * is left out. `apply` replaces the whole profile (a field not sent takes its default), so a
 * profile is always read in full, changed and sent back in full.
 */
export const profileSchema = reads<
  NonNullable<ResponseOf<'/api/v1/projects/{project_id}', 'get'>['project_profile']>
>()(
  z.object({
    additional_notes: z.string().nullable().default(null),
    agent_guidance: z
      .array(z.custom<NonNullable<Profile['agent_guidance']>[number]>(isRecord))
      .default([]),
    api_area_prefixes: z.array(z.string()).nullable().default(null),
    api_protocol: z.enum(API_PROTOCOLS).default('rest'),
    app_architecture: z.enum(ARCHITECTURES).default('spa'),
    app_description: z
      .custom<NonNullable<Profile['app_description']>>(isRecord)
      .nullable()
      .default(null),
    auth_method: z.enum(AUTH_METHODS).default('bearer_jwt'),
    auth_token_endpoint: z.string().nullable().default(null),
    graphql_endpoint: z.string().nullable().default(null),
    has_async_operations: flag,
    has_file_uploads: flag,
    has_mfa: flag,
    has_multi_tenant: flag,
    has_pagination: flag,
    has_presigned_urls: flag,
    has_sse: flag,
    has_websockets: flag,
    idp_domains: names,
    known_third_party_domains: names,
    self_check_enabled: z.boolean().default(true),
    uses_csrf: flag,
  }),
);

export type ProjectProfile = z.infer<typeof profileSchema>;

const projectProfile = reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(
  z.object({ project_profile: z.unknown().nullish() }),
);

/** The profile of the project as stored; a project that has none gets the defaults. */
export async function getProfile(
  api: SecretApiContext,
  projectId: string,
): Promise<ProjectProfile> {
  const data = await callOperation(
    api.services.http,
    'get_project_api_v1_projects__project_id__get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  const stored = projectProfile.parse(data).project_profile;
  return profileSchema.parse(stored ?? {});
}

/**
 * `POST …/setup/apply` with the whole profile. It also stamps the profile as applied and records
 * where each field came from. No field is named as confirmed by the user: a confirmation goes
 * through the consent card of `project_set_profile`.
 */
export async function applyProfile(
  api: SecretApiContext,
  projectId: string,
  profile: ProjectProfile,
): Promise<void> {
  await callOperation(
    api.services.http,
    'apply_setup_api_v1_projects__project_id__setup_apply_post',
    {
      path: { project_id: projectId },
      body: { project_profile: profile },
    },
    { signal: api.signal, secrets: api.secrets },
  );
}

// ---- provisioning ---------------------------------------------------------------------------

export interface Provisioned {
  readonly validatorsCreated: number;
  readonly testTypesCreated: number;
}

/**
 * `POST …/setup/auto-provision`: validators and test types for a project that has none; a
 * category that already has items is left as it is.
 */
export async function autoProvision(api: ApiContext, projectId: string): Promise<Provisioned> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/setup/auto-provision', {
      params: { path: { project_id: projectId } },
      // `force: false` is the backend's default; the contract lists the field as required.
      body: { force: false },
      signal: api.signal,
    }),
  );
  return { validatorsCreated: data.validators_created, testTypesCreated: data.test_types_created };
}
