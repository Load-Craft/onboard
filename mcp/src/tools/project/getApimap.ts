// `project_get_apimap` (module project): Get the API map: areas and operation kinds of the project's API.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the
// view. The catalog names no arguments: the map is the project's saved areas, else the detected
// ones (the preview of other prefixes is not this tool's). The title, the area names and the
// operations come from the documentation and pass `content`; the parts and the cost of each
// operation in a prompt are not read.
// Log: args "", result "{areas} areas": the data carries `areas`.

import type { OpOutput } from '../../http/operation.js';
import { renderGetApimap, type ApimapData, type AreaItem } from '../../render/project/getApimap.js';
import {
  callBackend,
  projectIdOf,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_GET_APIMAP } from './meta.generated.js';

/** GET /projects/{project_id}/api-map (REST API v1) */
export function getProject(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_project_api_map_api_v1_projects__project_id__api_map_get'>,
): Promise<OpOutput<'get_project_api_map_api_v1_projects__project_id__api_map_get'>> {
  return callBackend(ctx, 'get_project_api_map_api_v1_projects__project_id__api_map_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

const AREAS_SHOWN = 50;
const OPERATIONS_SHOWN = 5;
const PREFIXES_SHOWN = 30;

type ApiMap = OpOutput<'get_project_api_map_api_v1_projects__project_id__api_map_get'>;

function areaOf(ctx: CallContext, area: NonNullable<ApiMap['areas']>[number]): AreaItem {
  const operations = area.operations ?? [];
  return {
    name: thirdParty(ctx, area.name, 100),
    prefix: thirdParty(ctx, area.prefix, 100),
    operations_count: operations.length,
    operations: operations
      .slice(0, OPERATIONS_SHOWN)
      .map((operation) => thirdParty(ctx, operation, 150)),
    sign_in: area.sign_in_endpoint_id !== null && area.sign_in_endpoint_id !== undefined,
    token_operations: area.token_operations?.length ?? 0,
  };
}

export const projectGetApimap = moduleTool(PROJECT_GET_APIMAP, {
  title: 'Get the API map',
  // the catalog names no arguments: the project is the one this workspace works on
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const map = await getProject(ctx, { project_id: projectId });
    const areas = map.areas ?? [];
    const shown = areas.slice(0, AREAS_SHOWN).map((area) => areaOf(ctx, area));
    // An area borrows the general sign-in when it has none of its own: the backend names that endpoint for
    // every such area. The operations that issue a token tell whose it is, so only those areas keep the
    // mark; when no area issues a token (nothing tells them apart) the backend's answer stands.
    const anyIssuesToken = areas.some((area) => (area.token_operations?.length ?? 0) > 0);
    const items = shown.map((item) =>
      anyIssuesToken && item.token_operations === 0 ? { ...item, sign_in: false } : item,
    );
    const saved = map.saved_area_prefixes;
    const data: ApimapData = {
      project_id: projectId,
      title: map.title === null || map.title === undefined ? null : thirdParty(ctx, map.title, 150),
      area_rule: map.area_rule,
      total_operations: map.total_operations,
      areas: areas.length,
      shown: items.length,
      items,
      outside_area: map.outside_area?.length ?? 0,
      saved_prefixes:
        saved === null || saved === undefined
          ? null
          : saved.slice(0, PREFIXES_SHOWN).map((prefix) => thirdParty(ctx, prefix, 100)),
      empty_prefixes: (map.empty_area_prefixes ?? [])
        .slice(0, PREFIXES_SHOWN)
        .map((prefix) => thirdParty(ctx, prefix, 100)),
      whole_api_chars: map.budget.whole_api_chars,
    };
    return { status: 'done', data };
  },
  render: renderGetApimap,
});
