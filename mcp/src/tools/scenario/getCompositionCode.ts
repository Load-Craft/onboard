// `scenario_get_composition_code` (module scenario): Get the Gatling project generated for a
// composition: the file tree, or one file by path (literals masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The tree is read first and a file only when its path is one of the tree's: no path of the
// model's own goes to the backend as a file name. The paths pass `content` (the project is generated,
// but its names come from scenarios), a file's text is a recorded body and passes `body` (masked, or
// hidden whole when the mask cannot read it) and is cut at a fixed length.
// Log: args "{composition_id} {path}", result "{files} files": the log values carry the id as
// resolved, the path ("tree" for the tree) and the number of files of the project.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderCompositionCode,
  type CompositionCodeData,
  type FileView,
} from '../../render/scenario/getCompositionCode.js';
import { body, callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { compositionIdOf } from './compositionRef.js';
import { SCENARIO_GET_COMPOSITION_CODE } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/compositions/{composition_id}/project-structure (REST API v1) */
export function getProjectStructure(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'get_project_structure_api_v1_projects__project_id__gatling_compositions__composition_id__project_structure_get'>
> {
  return callBackend(
    ctx,
    'get_project_structure_api_v1_projects__project_id__gatling_compositions__composition_id__project_structure_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/compositions/{composition_id}/file-content (REST API v1) */
export function getFileContent(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
  query: QueryOf<'get_file_content_api_v1_projects__project_id__gatling_compositions__composition_id__file_content_get'>,
): Promise<
  OpOutput<'get_file_content_api_v1_projects__project_id__gatling_compositions__composition_id__file_content_get'>
> {
  return callBackend(
    ctx,
    'get_file_content_api_v1_projects__project_id__gatling_compositions__composition_id__file_content_get',
    { path, query },
  );
}

const TREE_SHOWN = 200;
const FILE_LIMIT = 8000;
const DEPTH_LIMIT = 16;

type Node =
  OpOutput<'get_project_structure_api_v1_projects__project_id__gatling_compositions__composition_id__project_structure_get'>['root'];
type FileAnswer =
  OpOutput<'get_file_content_api_v1_projects__project_id__gatling_compositions__composition_id__file_content_get'>;

/** A relative path the tree could hold: no escape, no absolute path, no backslash, no NUL. */
function isPlainPath(path: string): boolean {
  return (
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

/** Every file of the tree, depth first, as the backend lists them (directories first, then by name). */
function filesOf(node: Node, depth = 0): { path: string; size_bytes: number | null }[] {
  if (node.type === 'file') return [{ path: node.path, size_bytes: node.size_bytes ?? null }];
  if (depth >= DEPTH_LIMIT) return [];
  return (node.children ?? []).flatMap((child) => {
    const type = child['type'];
    const path = child['path'];
    if ((type !== 'file' && type !== 'directory') || typeof path !== 'string') return [];
    return filesOf(child as Node, depth + 1);
  });
}

const MEDIA = {
  json: 'application/json',
  xml: 'application/xml',
} as const;

function fileOf(ctx: CallContext, file: FileAnswer): FileView {
  const path = content(ctx, file.path, 200);
  const type =
    file.language === 'json' || file.language === 'xml' ? MEDIA[file.language] : 'text/plain';
  const shown = body(ctx, file.content, type);
  if (shown.kind === 'hidden') {
    return { kind: 'hidden', path, language: file.language, bytes: shown.bytes };
  }
  const cut = shown.text.length > FILE_LIMIT;
  return {
    kind: 'shown',
    path,
    language: file.language,
    text: (cut ? shown.text.slice(0, FILE_LIMIT) : shown.text).trimEnd(),
    truncated: cut,
  };
}

export const scenarioGetCompositionCode = moduleTool(SCENARIO_GET_COMPOSITION_CODE, {
  title: 'Get the Gatling project generated for a composition',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
    path: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'One file of the project by its path in the tree (as listed); without it, the file tree.',
      ),
  },
  async run(ctx, args) {
    const wanted = args.path;
    if (wanted !== undefined && !isPlainPath(wanted)) {
      throw new ToolError('invalid', {
        params: { detail: 'path is a relative path from the project tree, with no .. or \\' },
      });
    }
    const projectId = projectIdOf(ctx, undefined);
    const compositionId = await compositionIdOf(ctx, projectId, args.composition_id);
    const ids = { project_id: projectId, composition_id: compositionId };
    const { root } = await getProjectStructure(ctx, ids);
    const paths = filesOf(root);
    const base = {
      project_id: projectId,
      composition_id: compositionId,
      files: paths.length,
    } as const;
    const logFor = (path: string) => ({
      log: { values: { composition_id: compositionId, path, files: paths.length } },
    });
    if (wanted === undefined) {
      const shown = paths.slice(0, TREE_SHOWN);
      const data: CompositionCodeData = {
        ...base,
        mode: 'tree',
        tree: shown.map((file) => ({
          path: content(ctx, file.path, 200),
          size_bytes: file.size_bytes,
        })),
        tree_truncated: shown.length < paths.length,
        file: null,
      };
      return { status: 'done', data, update: logFor('tree') };
    }
    if (!paths.some((file) => file.path === wanted)) {
      throw new ToolError('not_found', { params: { available: '' } });
    }
    const file = await getFileContent(ctx, ids, { path: wanted });
    const data: CompositionCodeData = {
      ...base,
      mode: 'file',
      tree: [],
      tree_truncated: false,
      file: fileOf(ctx, file),
    };
    return { status: 'done', data, update: logFor(content(ctx, wanted, 200)) };
  },
  render: renderCompositionCode,
});
