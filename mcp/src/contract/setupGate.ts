// The steps of the setup gate and which of them a setup status leaves unmet, judged as the gate
// judges them: an empty category or a missing time stamp is unmet, `needs_review` is not; and where
// the applied profile fields came from (`profile.field_provenance`). Pure functions of the answer of
// `GET …/setup/status`, shared by the readers of that answer.

import type { components } from '../http/generated/api.js';

/** Steps of the setup gate, in the backend's order. */
export const SETUP_STEPS = [
  'environments',
  'evidence',
  'analysis',
  'profile',
  'validators',
  'test_types',
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

type SetupStatus = components['schemas']['SetupStatusResponse'];

/** The unmet steps of a setup status, in the gate's order. */
export function unmetSteps(
  data: Pick<
    SetupStatus,
    'environments' | 'evidence' | 'analysis' | 'profile' | 'validators' | 'test_types'
  >,
): SetupStep[] {
  const unmet: Record<SetupStep, boolean> = {
    environments: (data.environments?.count ?? 0) === 0,
    evidence: data.evidence?.state !== 'good',
    analysis: data.analysis?.completed_at == null,
    profile: data.profile?.applied_at == null,
    validators: data.validators.count === 0,
    test_types: data.test_types.count === 0,
  };
  return SETUP_STEPS.filter((step) => unmet[step]);
}

/** Where an applied profile field's value came from, as the backend recorded it at apply. */
export interface FieldProvenance {
  readonly field: string;
  /** `user`, `har`, `openapi`, `asyncapi`, `postman`, `preset`, `llm`. */
  readonly sources: readonly string[];
  /** 0..1; null when the value is the user's. */
  readonly confidence: number | null;
  /** Text of the analysis (at most 500 characters, credentials redacted); null when none. */
  readonly rationale: string | null;
  /** `accepted`, `edited`, or the suggestion's `needs_confirmation`, `conflicted`, `defaulted`. */
  readonly status: string;
}

/** Statuses of a recorded field the user has not settled: applied without a confirmation. */
export const UNSETTLED_STATUSES: ReadonlySet<string> = new Set([
  'needs_confirmation',
  'conflicted',
  'defaulted',
]);

type ProvenanceMap = NonNullable<SetupStatus['profile']>['field_provenance'];

/** The recorded provenance in the order of the field names. */
export function provenanceOf(map: ProvenanceMap): FieldProvenance[] {
  return Object.entries(map ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, entry]) => ({
      field,
      sources: entry.source_kinds ?? [],
      confidence: entry.confidence ?? null,
      rationale: entry.rationale == null || entry.rationale === '' ? null : entry.rationale,
      status: entry.status ?? 'accepted',
    }));
}
