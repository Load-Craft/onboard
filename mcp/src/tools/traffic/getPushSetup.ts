// `traffic_get_push_setup` (module traffic): Get the setup for pushing traffic from production:
// sender address and recipe, excluded run windows, existing push tokens (no secrets).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "", result "{tokens} push tokens": the data of the result carries the fields.
// Arguments: the catalog names none, so the tool takes none but `format`.
// The token list never holds a secret (only the prefix of a token); every text of the recipe (the
// command, the scripts' purposes and commands, reasons, notes, labels, targets) passes `content()`,
// and the text of a script is never read into the data (only its number of lines). The token list
// is an auxiliary read: its API error leaves the recipe (docs/tools/traffic/get-push-setup.md).

import { runHandle } from '../../contract/spentPool.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderGetPushSetup,
  type PushSetupData,
  type PushToken,
} from '../../render/traffic/getPushSetup.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { TRAFFIC_GET_PUSH_SETUP } from './meta.generated.js';

/** GET /projects/{project_id}/production-traffic/recipe (REST API v1) */
export function getIngestRecipe(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'get_ingest_recipe_api_v1_projects__project_id__production_traffic_recipe_get'>
> {
  return callBackend(
    ctx,
    'get_ingest_recipe_api_v1_projects__project_id__production_traffic_recipe_get',
    { path },
  );
}

/** GET /projects/{project_id}/production-traffic/tokens (REST API v1) */
export function listIngestTokens(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get'>
> {
  return callBackend(
    ctx,
    'list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get',
    { path },
  );
}

type Recipe =
  OpOutput<'get_ingest_recipe_api_v1_projects__project_id__production_traffic_recipe_get'>;
type Tokens =
  OpOutput<'list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get'>;

const TEXT_LIMIT = 300;
const COMMAND_LIMIT = 400;
const NAME_LIMIT = 120;
const URL_LIMIT = 200;
const SCRIPTS_SHOWN = 10;
const WINDOWS_SHOWN = 10;
const RUNS_SHOWN = 10;
const TOKENS_SHOWN = 20;
const CODES_SHOWN = 5;

/** An address without userinfo, query and fragment, masked; a text that is no URL is masked whole. */
function addressOf(ctx: CallContext, raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return content(ctx, `${url.origin}${path}`, URL_LIMIT);
  } catch {
    return content(ctx, raw.split(/[?#]/u)[0] ?? '', URL_LIMIT);
  }
}

const text = (
  ctx: CallContext,
  value: string | null | undefined,
  max = TEXT_LIMIT,
): string | null => (value == null || value.trim() === '' ? null : content(ctx, value, max));

async function readTokens(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<Tokens | null> {
  try {
    return await listIngestTokens(ctx, path);
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

function tokenOf(ctx: CallContext, token: NonNullable<Tokens['tokens']>[number]): PushToken {
  return {
    id: token.id,
    label: content(ctx, token.label, NAME_LIMIT),
    prefix: content(ctx, token.prefix, 16),
    created_at: token.created_at,
    last_used_at: token.last_used_at ?? null,
    revoked_at: token.revoked_at ?? null,
    last_outcome: token.last_outcome ?? null,
    last_refusal_codes: (token.last_refusal_codes ?? [])
      .slice(0, CODES_SHOWN)
      .map((code) => content(ctx, code, 60)),
  };
}

function dataOf(
  ctx: CallContext,
  projectId: string,
  recipe: Recipe,
  tokens: Tokens | null,
): PushSetupData {
  const limits = tokens?.limits ?? recipe.limits;
  const windows = recipe.excluded_windows ?? [];
  const runs = recipe.runs_without_window ?? [];
  const all = tokens?.tokens ?? [];
  return {
    project_id: projectId,
    address: recipe.public_base_url == null ? null : addressOf(ctx, recipe.public_base_url),
    warning: text(ctx, recipe.warning),
    command: text(ctx, recipe.curl, COMMAND_LIMIT) ?? '',
    scripts: (recipe.scripts ?? []).slice(0, SCRIPTS_SHOWN).map((script) => ({
      name: content(ctx, script.name, NAME_LIMIT),
      purpose: content(ctx, script.purpose, TEXT_LIMIT),
      command: text(ctx, script.command, COMMAND_LIMIT) ?? '',
      lines: script.script.split('\n').filter((line) => line !== '').length,
    })),
    excluded_windows: {
      count: windows.length,
      items: windows.slice(0, WINDOWS_SHOWN).map((window) => ({
        start: window.start,
        end: window.end,
        reason: content(ctx, window.reason, TEXT_LIMIT),
      })),
    },
    runs_without_window: {
      count: runs.length,
      items: runs.slice(0, RUNS_SHOWN).map((run) => ({
        run: runHandle(run.execution_id),
        start: run.start,
        target: run.target == null ? null : addressOf(ctx, run.target),
      })),
    },
    runs_without_window_note: text(ctx, recipe.runs_without_window_note),
    tokens: all.length,
    active_tokens: all.filter((token) => token.revoked_at == null).length,
    token_list: all.slice(0, TOKENS_SHOWN).map((token) => tokenOf(ctx, token)),
    tokens_state: tokens === null ? 'unavailable' : 'read',
    limits: {
      packets_per_token_per_hour: limits?.packets_per_token_per_hour ?? 0,
      max_window_days: limits?.max_window_days ?? 0,
      max_rows: limits?.max_rows ?? 0,
      max_routes: limits?.max_routes ?? 0,
      max_packet_bytes: limits?.max_packet_bytes ?? 0,
    },
  };
}

export const trafficGetPushSetup = moduleTool(TRAFFIC_GET_PUSH_SETUP, {
  title: 'Get the setup for pushing traffic from production',
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const [recipe, tokens] = await settleAll([getIngestRecipe(ctx, path), readTokens(ctx, path)]);
    return { status: 'done', data: dataOf(ctx, projectId, recipe, tokens) };
  },
  render: renderGetPushSetup,
});
