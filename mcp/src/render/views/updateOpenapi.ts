// View of `project_import_docs`: whether a new version of the documentation went to LoadCraft, how many
// operations it has now and how that changed, what the earlier versions leave behind (the flows still
// pinned to one of them, by name, with the migration as the next step), the conformance of one
// environment, and what is not refreshed by the new version.

import type { Translator } from '../../context.js';
import { inline, visibleWidth, VIEW_WIDTH, wrap } from '../primitives.js';
import { oldDocsLines } from './oldDocs.js';
import { conformanceText, type EnvironmentConformance } from './projectSetup.js';

/** What the new documentation does not update by itself. */
export type UpdateOpenapiNote = 'profile_and_test_types_not_refreshed';

export interface UpdateOpenapiData {
  /** False: the file had the same content as the stored version and nothing was sent. */
  readonly changed: boolean;
  /** Operations of the current version (OPTIONS and HEAD not counted); null when the map is gone. */
  readonly operations: number | null;
  /** Change against the previous version; null when there was none or it is not known. */
  readonly delta: number | null;
  /** `info.x-loadcraft-source.commit` of the version that was current before. */
  readonly previousCommit?: string;
  /** `info.version` of the version that was current before; absent when the project had none. */
  readonly previousVersion?: string;
  /**
   * Flows pinned to a docs version other than the new current one (the previous version or any
   * earlier): the flows to migrate.
   */
  readonly flowsOnPrevious: number;
  /** The project has more flows than were read: `flowsOnPrevious` is a lower bound. */
  readonly flowsOnPreviousPartial: boolean;
  /** Names of those flows, sorted; absent when there is none. */
  readonly oldFlows?: readonly string[];
  readonly conformance?: { readonly environment: string; readonly result: EnvironmentConformance };
  readonly notes: readonly UpdateOpenapiNote[];
}

const NAME_LIMIT = 80;
const COMMIT_SHOWN = 7;
const GAP = '  ';

/** The previous version as a person names it: the short commit, else `version 2.14.0`. */
function versionLabel(data: UpdateOpenapiData, t: Translator): string | undefined {
  if (data.previousCommit !== undefined) {
    return inline(data.previousCommit.slice(0, COMMIT_SHOWN), COMMIT_SHOWN);
  }
  if (data.previousVersion !== undefined && data.previousVersion !== '') {
    return t('updateOpenapi.version', { version: inline(data.previousVersion, NAME_LIMIT) });
  }
  return undefined;
}

function operationsText(data: UpdateOpenapiData, t: Translator): string | undefined {
  if (data.operations === null) return undefined;
  const count = t.plural('updateOpenapi.operations', data.operations);
  if (data.delta === null || data.delta === 0) return count;
  const sign = data.delta > 0 ? '+' : '-';
  return `${count} (${sign}${String(Math.abs(data.delta))})`;
}

export function renderUpdateOpenapi(data: UpdateOpenapiData, t: Translator): string {
  const label = versionLabel(data, t);
  const operations = operationsText(data, t);
  const lines: string[] = [];
  if (!data.changed) {
    lines.push(
      operations === undefined
        ? t('updateOpenapi.unchanged')
        : t('updateOpenapi.unchangedWith', { operations }),
    );
    if (label !== undefined) lines.push(t('updateOpenapi.sameAs', { previous: label }));
  } else {
    lines.push(
      operations === undefined
        ? t('updateOpenapi.current')
        : t('updateOpenapi.currentWith', { operations }),
    );
    const hadPrevious = label !== undefined || data.previousVersion !== undefined;
    if (hadPrevious) {
      const flows = t(
        data.flowsOnPreviousPartial ? 'updateOpenapi.flows.atLeast' : 'updateOpenapi.flows',
        { count: data.flowsOnPrevious },
      );
      lines.push(
        label === undefined
          ? t('updateOpenapi.previousUnnamed', { flows })
          : t('updateOpenapi.previous', { previous: label, flows }),
      );
    }
  }
  const text = lines.flatMap((line) => wrap(line, VIEW_WIDTH, 2));
  if (data.changed && data.oldFlows !== undefined) {
    text.push(...oldDocsLines(data.oldFlows, 0, 'list', t));
  }
  if (data.conformance !== undefined) {
    // `qa  conformance: …`: the name, two spaces, and a long sentence continues under its start.
    const name = inline(data.conformance.environment, NAME_LIMIT);
    const lead = visibleWidth(name) + GAP.length;
    const [first = '', ...rest] = wrap(
      conformanceText(data.conformance.result, t),
      VIEW_WIDTH - lead,
    );
    text.push(`${name}${GAP}${first}`, ...rest.map((line) => ' '.repeat(lead) + line));
  }
  for (const note of data.notes) text.push(...wrap(t(`updateOpenapi.note.${note}`), VIEW_WIDTH, 2));
  return text.join('\n');
}
