// The view of `scenario_get_composition_code`: the file tree of the Gatling project generated for a
// composition (one path per line with its size), or one file of it (its masked text). The paths and the
// text arrive made safe by the tool (`content` and `body` of tools/moduleCall.ts); the view adds no
// text of the backend of its own.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

export interface TreeFile {
  /** The path in the project, relative to its root. */
  readonly path: string;
  readonly size_bytes: number | null;
}

export type FileView =
  | {
      readonly kind: 'shown';
      readonly path: string;
      readonly language: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'hidden';
      readonly path: string;
      readonly language: string;
      readonly bytes: number;
    };

export interface CompositionCodeData {
  readonly mode: 'tree' | 'file';
  readonly project_id: string;
  readonly composition_id: string;
  /** How many files the project has. */
  readonly files: number;
  /** The files the data lists (the tree, at most 200); empty for one file. */
  readonly tree: readonly TreeFile[];
  readonly tree_truncated: boolean;
  readonly file: FileView | null;
}

export function renderCompositionCode(data: CompositionCodeData, t: Translator): string {
  if (data.mode === 'file' && data.file !== null) {
    const f = data.file;
    if (f.kind === 'hidden') {
      return [
        t('scenario_get_composition_code.file_header', { path: f.path, language: f.language }),
        t('scenario_get_composition_code.hidden', { bytes: num(f.bytes, t.locale) }),
      ].join('\n');
    }
    return [
      t('scenario_get_composition_code.file_header', { path: f.path, language: f.language }),
      f.text,
      ...(f.truncated ? [t('scenario_get_composition_code.cut')] : []),
    ].join('\n');
  }
  if (data.files === 0) return t('scenario_get_composition_code.empty');
  const lines = [t.plural('scenario_get_composition_code.header', data.files)];
  for (const file of data.tree) {
    lines.push(
      file.size_bytes === null
        ? `  ${file.path}`
        : `  ${file.path} (${num(file.size_bytes, t.locale)} B)`,
    );
  }
  if (data.tree_truncated) {
    lines.push(
      t('scenario_get_composition_code.more', { shown: data.tree.length, total: data.files }),
    );
  }
  lines.push(t('scenario_get_composition_code.hint'));
  return lines.join('\n');
}
