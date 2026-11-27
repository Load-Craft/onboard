// The view of `functional_save_template`: the template that was created or changed, which fields were written and what the
// undo can and cannot put back. The name arrives masked and made one line; nothing else of the template is shown.

import type { Translator } from '../../context.js';

/** What the log keeps for taking the change back. */
export type TemplateUndo = 'kept' | 'partial' | 'none' | 'withheld' | 'too_large';

export interface SaveTemplateData {
  readonly template: { readonly id: string };
  readonly name: string;
  readonly created: boolean;
  /** The fields written (`name`, `api_description`, …); empty when nothing differed. */
  readonly changed: readonly string[];
  readonly assertions: number;
  /** Changed fields the backend cannot put back (it ignores a null). */
  readonly not_undoable: readonly string[];
  readonly undo: TemplateUndo;
}

export function renderSaveTemplate(data: SaveTemplateData, t: Translator): string {
  if (data.created) {
    return t('functional_save_template.created', { name: data.name, id: data.template.id });
  }
  if (data.changed.length === 0)
    return t('functional_save_template.unchanged', { name: data.name });
  const lines = [
    t('functional_save_template.updated', { name: data.name, fields: data.changed.join(', ') }),
  ];
  if (data.not_undoable.length > 0) {
    lines.push(
      t('functional_save_template.not_undoable', { fields: data.not_undoable.join(', ') }),
    );
  }
  if (data.undo === 'withheld') lines.push(t('functional_save_template.withheld'));
  if (data.undo === 'too_large') lines.push(t('functional_save_template.too_large'));
  return lines.join('\n');
}
