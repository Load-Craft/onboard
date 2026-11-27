// The view of `project_list`: the projects the caller sees, one line each, or the hits of a search by
// text across projects, flows, scenarios and runs. Names, descriptions and addresses are texts a
// person wrote: they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, num } from '../primitives.js';

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** `api`, `frontend`, `both`. */
  readonly type: string;
  readonly baseUrl: string | null;
  readonly active: boolean;
  readonly flows: number;
  readonly testTypes: number;
  readonly validators: number;
  readonly hasOpenapi: boolean;
  readonly hasAsyncapi: boolean;
  readonly updatedAt: string;
  /** Whether it is the project this workspace is bound to. */
  readonly current: boolean;
}

export interface SearchHit {
  /** `page`, `project`, `scenario` (a flow or a load scenario), `execution`, or `other`. */
  readonly type: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly id: string;
  /** The handle of a load run (`e-1a2b3c4d`) for an `execution` hit. */
  readonly run: string | null;
  readonly createdAt: string | null;
}

export type ProjectListData =
  | {
      readonly mode: 'list';
      /** How many projects match the filter (the log slot `{count}`), and how many the data lists. */
      readonly count: number;
      readonly shown: number;
      readonly limit: number;
      readonly isActive: boolean | null;
      readonly items: readonly ProjectRow[];
    }
  | {
      readonly mode: 'search';
      /** The text searched, masked. */
      readonly query: string;
      /** How many hits the backend returned (at most `limit`: more may exist). */
      readonly count: number;
      readonly shown: number;
      readonly limit: number;
      readonly items: readonly SearchHit[];
    };

const day = (at: string): string => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? at;

export function renderProjectList(data: ProjectListData, t: Translator): string {
  if (data.mode === 'search') {
    if (data.count === 0) return t('project_list.search.none', { query: data.query });
    const lines = [t.plural('project_list.search', data.count, { query: data.query })];
    lines.push(
      ...columns(
        data.items.map((hit) => [
          t(`project_list.hit.${hit.type}`),
          hit.run ?? hit.title,
          hit.subtitle ?? '',
        ]),
      ).map((row) => `  ${row}`),
    );
    if (data.count >= data.limit) lines.push(t('project_list.search.limit', { limit: data.limit }));
    return lines.join('\n');
  }
  if (data.count === 0) return t('project_list.none');
  const lines = [t.plural('project_list.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((project) => [
        `${project.current ? '* ' : '  '}${project.name}`,
        t(`project_list.type.${project.type}`),
        t(project.active ? 'project_list.active' : 'project_list.inactive'),
        t('project_list.counts', {
          flows: num(project.flows, t.locale),
          types: num(project.testTypes, t.locale),
          validators: num(project.validators, t.locale),
        }),
        day(project.updatedAt),
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.items.some((project) => project.current)) lines.push(t('project_list.current'));
  if (data.shown < data.count) {
    lines.push(t('project_list.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
