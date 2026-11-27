// `functional_delete` (module functional): Delete functional items (kind + id): flow, template,
// test_type, validator, run, or a custom catalog entry.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 3, `delete` (docs/consent-card.md): one item per card (`item_id`, with its
// `kind`). The first call reads the item (its name, and a few facts that say what goes) and makes
// the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// A run that has not finished is refused before the card (`delete_busy`). Operations by kind: flow,
// template, test_type, validator, run (the project's executions), and the three shared catalogs.
// Log: args "Delete {kind}: {names}", result "{count} {kind} deleted". No undo (permanent). A run
// the state holds as the current one of the functional step is dropped from `ids.functional_run_id`.
// Arguments (the catalog's): kind, item_id.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewFunctionalDelete,
  renderFunctionalDelete,
  type DeleteKind,
  type FunctionalDeleteData,
  type FunctionalDeleteFacts,
} from '../../render/functional/delete.js';
import { callBackend, projectIdOf, thirdParty, type CallContext } from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { getAssertionType, getBaseTestType, getBaseValidator } from './getCatalog.js';
import { getTestFlow } from './getFlows.js';
import { getExecution } from './getRuns.js';
import { getTestTemplate } from './getTemplates.js';
import { getTestType } from './getTestTypes.js';
import { getValidator } from './getValidators.js';
import { FUNCTIONAL_DELETE } from './meta.generated.js';

/** DELETE /test-flows/{flow_id} (REST API v1) */
export function deleteTestFlow(
  ctx: CallContext,
  path: { readonly flow_id: string },
): Promise<OpOutput<'delete_test_flow_api_v1_test_flows__flow_id__delete'>> {
  return callBackend(ctx, 'delete_test_flow_api_v1_test_flows__flow_id__delete', { path });
}

/** DELETE /test-templates/{template_id} (REST API v1) */
export function deleteTestTemplate(
  ctx: CallContext,
  path: { readonly template_id: string },
): Promise<OpOutput<'delete_test_template_api_v1_test_templates__template_id__delete'>> {
  return callBackend(ctx, 'delete_test_template_api_v1_test_templates__template_id__delete', {
    path,
  });
}

/** DELETE /projects/{project_id}/test-types/{test_type_id} (REST API v1) */
export function deleteTestType(
  ctx: CallContext,
  path: { readonly project_id: string; readonly test_type_id: string },
): Promise<
  OpOutput<'delete_test_type_api_v1_projects__project_id__test_types__test_type_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_test_type_api_v1_projects__project_id__test_types__test_type_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/validators/{validator_id} (REST API v1) */
export function deleteValidator(
  ctx: CallContext,
  path: { readonly project_id: string; readonly validator_id: string },
): Promise<
  OpOutput<'delete_validator_api_v1_projects__project_id__validators__validator_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_validator_api_v1_projects__project_id__validators__validator_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/executions/{execution_id} (REST API v1) */
export function deleteExecution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'delete_execution_api_v1_projects__project_id__executions__execution_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_execution_api_v1_projects__project_id__executions__execution_id__delete',
    { path },
  );
}

/** DELETE /assertion-types/{type_id} (REST API v1) */
export function deleteAssertionType(
  ctx: CallContext,
  path: { readonly type_id: string },
): Promise<OpOutput<'delete_assertion_type_api_v1_assertion_types__type_id__delete'>> {
  return callBackend(ctx, 'delete_assertion_type_api_v1_assertion_types__type_id__delete', {
    path,
  });
}

/** DELETE /base-test-types/{test_type_id} (REST API v1) */
export function deleteBaseTestType(
  ctx: CallContext,
  path: { readonly test_type_id: string },
): Promise<OpOutput<'delete_base_test_type_api_v1_base_test_types__test_type_id__delete'>> {
  return callBackend(ctx, 'delete_base_test_type_api_v1_base_test_types__test_type_id__delete', {
    path,
  });
}

/** DELETE /base-validators/{validator_id} (REST API v1) */
export function deleteBaseValidator(
  ctx: CallContext,
  path: { readonly validator_id: string },
): Promise<OpOutput<'delete_base_validator_api_v1_base_validators__validator_id__delete'>> {
  return callBackend(ctx, 'delete_base_validator_api_v1_base_validators__validator_id__delete', {
    path,
  });
}

const NAME_LIMIT = 120;
const FINISHED = new Set(['completed', 'failed', 'cancelled']);

const KINDS = [
  'flow',
  'template',
  'test_type',
  'validator',
  'run',
  'catalog_test_type',
  'catalog_validator',
  'catalog_assertion_type',
] as const;

/** Reads the item and returns what the card freezes; throws `delete_busy` for a run still going. */
async function factsOf(
  ctx: CallContext,
  projectId: () => string,
  kind: DeleteKind,
  id: string,
): Promise<FunctionalDeleteFacts> {
  const shown = (text: string): string => thirdParty(ctx, text, NAME_LIMIT);
  switch (kind) {
    case 'flow': {
      const flow = await getTestFlow(ctx, { flow_id: id });
      return {
        kind,
        names: shown(flow.name),
        item_id: id,
        version: shown(flow.version),
        blocks: flow.blocks_count,
      };
    }
    case 'template': {
      const template = await getTestTemplate(ctx, { template_id: id });
      return { kind, names: shown(template.name), item_id: id };
    }
    case 'test_type': {
      const type = await getTestType(ctx, { project_id: projectId(), test_type_id: id });
      return { kind, names: shown(type.effective_name), item_id: id };
    }
    case 'validator': {
      const validator = await getValidator(ctx, { project_id: projectId(), validator_id: id });
      return { kind, names: shown(validator.effective_name), item_id: id };
    }
    case 'run': {
      const run = await getExecution(ctx, { project_id: projectId(), execution_id: id });
      const names = shown(run.template_name ?? id);
      if (!FINISHED.has(run.status)) {
        throw new ToolError('delete_busy', {
          params: { operation: `the run (${run.status})`, target: `run "${names}"` },
        });
      }
      return { kind, names, item_id: id, status: shown(run.status) };
    }
    case 'catalog_test_type': {
      const entry = await getBaseTestType(ctx, { test_type_id: id });
      return { kind, names: shown(entry.name), item_id: id, builtin: entry.is_builtin };
    }
    case 'catalog_validator': {
      const entry = await getBaseValidator(ctx, { validator_id: id });
      return { kind, names: shown(entry.name), item_id: id, builtin: entry.is_builtin };
    }
    case 'catalog_assertion_type': {
      const entry = await getAssertionType(ctx, { type_id: id });
      return { kind, names: shown(entry.name), item_id: id, builtin: entry.is_builtin };
    }
  }
}

export const functionalDelete = moduleTool(FUNCTIONAL_DELETE, {
  title: 'Delete a functional item',
  input: {
    kind: z.enum(KINDS).describe('What to delete.'),
    item_id: uuidArgument().describe('The item to delete (one per call).'),
  },
  async card(ctx, args) {
    const facts = await factsOf(
      ctx,
      () => projectIdOf(ctx, undefined),
      args.kind,
      args.item_id.toLowerCase(),
    );
    return { facts };
  },
  cardView: cardViewFunctionalDelete,
  async run(ctx, args, facts) {
    const id = facts.item_id;
    const project_id = (): string => projectIdOf(ctx, undefined);
    switch (args.kind) {
      case 'flow':
        await deleteTestFlow(ctx, { flow_id: id });
        break;
      case 'template':
        await deleteTestTemplate(ctx, { template_id: id });
        break;
      case 'test_type':
        await deleteTestType(ctx, { project_id: project_id(), test_type_id: id });
        break;
      case 'validator':
        await deleteValidator(ctx, { project_id: project_id(), validator_id: id });
        break;
      case 'run':
        await deleteExecution(ctx, { project_id: project_id(), execution_id: id });
        break;
      case 'catalog_test_type':
        await deleteBaseTestType(ctx, { test_type_id: id });
        break;
      case 'catalog_validator':
        await deleteBaseValidator(ctx, { validator_id: id });
        break;
      case 'catalog_assertion_type':
        await deleteAssertionType(ctx, { type_id: id });
        break;
    }
    const data: FunctionalDeleteData = {
      kind: facts.kind,
      item_id: id,
      names: facts.names,
      count: 1,
    };
    const current = ctx.state.process()?.ids.functional_run_id;
    return {
      status: 'done',
      data,
      update: {
        ...(facts.kind === 'run' && current === id
          ? { unset: ['functional_run_id' as const] }
          : {}),
        log: { values: { names: facts.names, kind: facts.kind, count: 1 } },
      },
    };
  },
  render: renderFunctionalDelete,
});
