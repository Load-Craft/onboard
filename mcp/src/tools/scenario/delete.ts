// `scenario_delete` (module scenario): Delete a scenario or a composition. Past runs stay.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 3, `delete` (docs/consent-card.md). The first call reads what disappears and
// makes the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// One object per card: exactly one of scenario_id and composition_id, never a default from the
// state (a deletion names its target). Nothing is sent while a test or an operation of this
// workspace still runs on the object (`delete_busy`), or when that cannot be checked
// (`delete_unchecked`).
// The card lists what goes: a scenario with its versions (the backend cascades versions, baselines
// and composition links); the compositions it leaves; a composition with its member links, and its
// member scenarios, which stay. Runs, datasets and the flow stay.
// Log: args "Delete {kind}: {names}", result "{count} {kind} deleted". No undo (permanent).
// Arguments (the catalog's): scenario_id, composition_id; exactly one.

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewScenarioDelete,
  renderScenarioDelete,
  type DeleteKind,
  type ScenarioDeleteData,
  type ScenarioDeleteFacts,
} from '../../render/scenario/delete.js';
import type { ToolContext } from '../../context.js';
import { busy, liveOperation, readRuns, testName, unchecked } from '../delete/checks.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  settleAll,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { getComposition } from './getComposition.js';
import { getScenario } from './get.js';
import { listScenarioVersions } from './getVersions.js';
import { listCompositions } from './listCompositions.js';
import { SCENARIO_DELETE } from './meta.generated.js';

/** DELETE /projects/{project_id}/gatling/scenarios/{scenario_id} (REST API v1) */
export function deleteScenario(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'delete_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/gatling/compositions/{composition_id} (REST API v1) */
export function deleteComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'delete_composition_api_v1_projects__project_id__gatling_compositions__composition_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_composition_api_v1_projects__project_id__gatling_compositions__composition_id__delete',
    { path },
  );
}

const NAME_LIMIT = 120;
const SHOWN = 20;
/** The most compositions one read lists (the page of the list). */
const COMPOSITIONS_PAGE = 200;

/** The count of one read that may fail: null when it did (shown as unknown, never guessed). */
async function tried<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** Refuses while a test or an operation of this workspace runs on what the card would delete. */
async function refuseWhileBusy(
  ctx: ToolContext,
  projectId: string,
  target: string,
  uses: (test: { scenarioId: string | null; compositeId: string | null }) => boolean,
): Promise<void> {
  const operation = liveOperation(ctx, projectId);
  if (operation !== undefined) throw busy(operation, target);
  const runs = await readRuns(ctx, projectId);
  const running = runs.running.find(uses);
  if (running !== undefined) throw busy(testName(running), target);
  if (!runs.known) throw unchecked(target);
}

const kindOf = (args: {
  readonly scenario_id?: string | undefined;
  readonly composition_id?: string | undefined;
}): DeleteKind => {
  if (args.scenario_id !== undefined && args.composition_id !== undefined) {
    refuseRule('delete_one_of');
  }
  if (args.scenario_id === undefined && args.composition_id === undefined) {
    refuseRule('delete_at_least_one');
  }
  return args.scenario_id === undefined ? 'composition' : 'scenario';
};

export const scenarioDelete = moduleTool(SCENARIO_DELETE, {
  title: 'Delete a scenario or a composition',
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario to delete; give this or composition_id.'),
    composition_id: uuidArgument()
      .optional()
      .describe('The composition to delete; give this or scenario_id.'),
  },
  async card(ctx, args) {
    const kind = kindOf(args);
    const projectId = projectIdOf(ctx, undefined);
    if (kind === 'scenario') {
      const id = (args.scenario_id ?? '').toLowerCase();
      const path = { project_id: projectId, scenario_id: id };
      const scenario = await getScenario(ctx, path);
      const names = thirdParty(ctx, scenario.name, NAME_LIMIT);
      const [versions, all] = await settleAll([
        tried(() => listScenarioVersions(ctx, path)),
        tried(() => listCompositions(ctx, { project_id: projectId }, { limit: COMPOSITIONS_PAGE })),
      ]);
      const holding =
        all === null || all.total > all.compositions.length
          ? null
          : all.compositions.filter((composition) =>
              composition.scenarios.some((member) => member.scenario_id === id),
            );
      await refuseWhileBusy(
        ctx,
        projectId,
        `scenario "${names}"`,
        (test) =>
          test.scenarioId === id ||
          holding === null ||
          holding.some((composition) => composition.id === test.compositeId),
      );
      const facts: ScenarioDeleteFacts = {
        kind,
        names,
        id,
        versions: versions === null ? null : versions.versions.length,
        compositions:
          holding === null
            ? null
            : holding
                .slice(0, SHOWN)
                .map((composition) => thirdParty(ctx, composition.name, NAME_LIMIT)),
        ...(holding === null ? {} : { compositions_count: holding.length }),
      };
      return { facts };
    }
    const id = (args.composition_id ?? '').toLowerCase();
    const composition = await getComposition(ctx, { project_id: projectId, composition_id: id });
    const names = thirdParty(ctx, composition.name, NAME_LIMIT);
    await refuseWhileBusy(
      ctx,
      projectId,
      `composition "${names}"`,
      (test) => test.compositeId === id,
    );
    const facts: ScenarioDeleteFacts = {
      kind,
      names,
      id,
      members: composition.scenarios
        .slice(0, SHOWN)
        .map((member) => thirdParty(ctx, member.scenario_name ?? member.scenario_id, LIMITS.name)),
      members_count: composition.scenarios.length,
    };
    return { facts };
  },
  cardView: cardViewScenarioDelete,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    if (facts.kind === 'scenario') {
      await deleteScenario(ctx, { project_id: projectId, scenario_id: facts.id });
    } else {
      await deleteComposition(ctx, { project_id: projectId, composition_id: facts.id });
    }
    const data: ScenarioDeleteData = {
      kind: facts.kind,
      id: facts.id,
      names: facts.names,
      count: 1,
    };
    const stateComposition = ctx.state.process()?.ids.composition_id;
    return {
      status: 'done',
      data,
      update: {
        ...(facts.kind === 'composition' && stateComposition === facts.id
          ? { unset: ['composition_id' as const] }
          : {}),
        log: { values: { names: facts.names, kind: facts.kind, count: 1 } },
      },
    };
  },
  render: renderScenarioDelete,
});
