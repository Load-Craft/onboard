// Compositions of the LoadCraft REST API: finding one by name, its members, creating one and
// replacing its members. A member is a scenario with a share of the traffic as a fraction (0..1);
// the composition document carries every member's full artifact, of which only the source flow and
// the resolved data mix leave this file.

import * as z from 'zod';

import { callOperation } from '../http/operation.js';
import type { SecretApiContext } from './context.js';
import { listCompositions, type Named } from './lookup.js';
import { reads, type ResponseOf } from '../contract/reads.js';

export interface CompositionMember {
  readonly scenarioId: string;
  readonly scenarioName: string;
  /** Second half of the member's key; `''` for a scenario linked once. */
  readonly variantLabel: string;
  readonly proportion: number;
  /** A member the user switched off stays off: the value is sent back as it was read. */
  readonly enabled: boolean;
  readonly sourceFlowId: string | null;
  readonly classMix: Readonly<Record<string, number>> | null;
}

/**
 * A member as it is written: the scenario, its key, its share and whether it is on. The other
 * settings of a kept member (overrides, data bindings) are left out, so the backend keeps them.
 */
export interface MemberWrite {
  readonly scenarioId: string;
  readonly variantLabel: string;
  readonly proportion: number;
  readonly enabled: boolean;
}

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const metadata = z
  .object({
    source_flow_id: nullable(z.string()),
    resolved_class_mix: z.record(z.string(), z.number()).nullish().catch(null),
  })
  .nullish()
  .catch(null);

const composition = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/compositions/{composition_id}', 'get'>
>()(
  z.object({
    id: z.string(),
    name: z.string(),
    scenarios: z
      .array(
        z.object({
          scenario_id: z.string(),
          scenario_name: nullable(z.string()),
          variant_label: nullable(z.string()),
          proportion: z.number(),
          enabled: z.boolean().nullish().catch(null),
          scenario_artifact: z.object({ generation_metadata: metadata }).nullish().catch(null),
        }),
      )
      .catch([]),
  }),
);

const created = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/compositions', 'post'>>()(
  z.object({ id: z.string() }),
);

/** The composition with exactly this name, or `null`. */
export async function findComposition(
  api: SecretApiContext,
  projectId: string,
  name: string,
): Promise<Named | null> {
  const all = await listCompositions(api, projectId);
  return all.find((item) => item.name === name) ?? null;
}

export async function readCompositionMembers(
  api: SecretApiContext,
  projectId: string,
  compositionId: string,
): Promise<CompositionMember[]> {
  const data = await callOperation(
    api.services.http,
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
    {
      path: { project_id: projectId, composition_id: compositionId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return composition.parse(data).scenarios.map((member) => ({
    scenarioId: member.scenario_id,
    scenarioName: member.scenario_name ?? member.scenario_id,
    variantLabel: member.variant_label ?? '',
    proportion: member.proportion,
    enabled: member.enabled ?? true,
    sourceFlowId: member.scenario_artifact?.generation_metadata?.source_flow_id ?? null,
    classMix: member.scenario_artifact?.generation_metadata?.resolved_class_mix ?? null,
  }));
}

/** A new parallel composition of `members`; returns its id. */
export async function createComposition(
  api: SecretApiContext,
  projectId: string,
  name: string,
  members: readonly MemberWrite[],
): Promise<{ id: string }> {
  const data = await callOperation(
    api.services.http,
    'create_composition_api_v1_projects__project_id__gatling_compositions_post',
    {
      path: { project_id: projectId },
      // The backend's defaults, written out because the request model lists them as fields.
      body: {
        name,
        composition_mode: 'parallel',
        pause_distribution: 'uniform',
        normal_pause_std_dev_percent: 20,
        scenarios: members.map((member) => ({
          scenario_id: member.scenarioId,
          variant_label: member.variantLabel,
          proportion: member.proportion,
          enabled: member.enabled,
        })),
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return { id: created.parse(data).id };
}

/**
 * Replaces the members of a composition. The list is the whole membership: a member left out is
 * removed; the other fields of a kept member keep their values.
 */
export async function replaceCompositionMembers(
  api: SecretApiContext,
  projectId: string,
  compositionId: string,
  members: readonly MemberWrite[],
): Promise<void> {
  await callOperation(
    api.services.http,
    'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put',
    {
      path: { project_id: projectId, composition_id: compositionId },
      body: {
        scenarios: members.map((member) => ({
          scenario_id: member.scenarioId,
          variant_label: member.variantLabel,
          proportion: member.proportion,
          enabled: member.enabled,
        })),
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
}
