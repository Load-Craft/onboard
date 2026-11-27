// The view of `flows_export_walk_image`: that the image was saved, how big it is and where. The image
// itself is never read; the path is relative to the workspace and built from numbers and a checked id.

import type { Translator } from '../../context.js';

export interface WalkImageData {
  readonly project_id: string;
  readonly walk: { readonly id: string; readonly handle: string };
  readonly kind: 'snapshot' | 'still';
  /** Relative to the workspace: `loadcraft/walks/<handle>/<name>.<ext>`. */
  readonly path: string;
  /** The exact size of the file. */
  readonly bytes: number;
  readonly type: string;
  readonly path_index?: number;
  readonly attempt?: number;
  readonly still_id?: string;
}

/** `12.3 KB`: the size as a view rounds it. */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderWalkImage(data: WalkImageData, t: Translator): string {
  const what =
    data.kind === 'snapshot'
      ? t('flows_export_walk_image.snapshot', {
          step: data.path_index ?? 0,
          attempt: data.attempt ?? 1,
          handle: data.walk.handle,
          size: sizeOf(data.bytes),
        })
      : t('flows_export_walk_image.still', {
          still: data.still_id ?? '',
          handle: data.walk.handle,
          size: sizeOf(data.bytes),
        });
  return [what, t('flows_export_walk_image.ignored'), `open: ${data.path}`].join('\n');
}
