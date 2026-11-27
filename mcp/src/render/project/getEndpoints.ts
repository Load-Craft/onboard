// The view of `project_get_endpoints`: one line per endpoint of the list, or the parameters, the
// body, the responses and the validator bindings of one. Schemas are short: a type and the names of
// the top-level properties. The texts arrive made one line and masked by the tool (`content` of
// tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

export interface SchemaShape {
  readonly type: string | null;
  /** The names of the top-level properties. */
  readonly properties: readonly string[];
  /** The type of the items of an array. */
  readonly items: string | null;
}

export interface EndpointItem {
  readonly id: string;
  /** Upper case. */
  readonly method: string;
  readonly path: string;
  readonly operation_id: string | null;
  readonly summary: string | null;
  readonly tags: readonly string[];
  readonly parameters_count: number;
  readonly has_request_body: boolean;
  readonly crud_operation: string | null;
  readonly async_pattern: string;
}

export interface ParameterItem {
  readonly name: string;
  readonly in: string;
  readonly type: string;
  readonly required: boolean;
}

export interface ResponseItem {
  readonly status: number;
  readonly content_type: string | null;
  readonly schema: SchemaShape;
}

export interface EndpointDetail extends EndpointItem {
  readonly description: string | null;
  readonly deprecated: boolean;
  readonly security: readonly string[];
  readonly parameters: readonly ParameterItem[];
  readonly request_body: {
    readonly content_type: string;
    readonly required: boolean;
    readonly schema: SchemaShape;
  } | null;
  readonly responses: readonly ResponseItem[];
}

export interface Bindings {
  readonly expected_statuses: readonly number[];
  readonly response_schemas: readonly { readonly status: string; readonly schema: SchemaShape }[];
  readonly assertions: readonly { readonly type: string; readonly description: string }[];
}

export interface EndpointsData {
  readonly mode: 'list' | 'one';
  readonly project_id: string;
  readonly docs_id: string;
  /** The endpoints that match the filters; 1 for one. */
  readonly count: number;
  /** The endpoints of the version. */
  readonly total: number;
  readonly shown: number;
  readonly endpoints: readonly EndpointItem[];
  readonly detail: EndpointDetail | null;
  readonly bindings: Bindings | null;
  readonly bindings_state: 'none' | 'read' | 'unavailable';
}

function schemaText(schema: SchemaShape, t: Translator): string {
  const base =
    schema.type === 'array' && schema.items !== null
      ? t('project_get_endpoints.array_of', { type: schema.items })
      : (schema.type ?? '');
  const names = schema.properties.length === 0 ? '' : `{${schema.properties.join(', ')}}`;
  return [base, names].filter((part) => part !== '').join(' ');
}

function listLine(item: EndpointItem, index: number): string {
  const summary = item.summary === null || item.summary === '' ? '' : ` — ${item.summary}`;
  const operation = item.operation_id === null ? '' : ` [${item.operation_id}]`;
  return `${String(index + 1)}. ${item.method} ${item.path}${summary}${operation}`;
}

function renderList(data: EndpointsData, t: Translator): string {
  if (data.total === 0) return t('project_get_endpoints.none');
  if (data.count === 0) return t('project_get_endpoints.no_match', { total: data.total });
  const filtered = data.count < data.total;
  const lines = [
    filtered
      ? t('project_get_endpoints.header_filtered', { count: data.count, total: data.total })
      : t.plural('project_get_endpoints.header', data.count),
  ];
  data.endpoints.forEach((item, index) => lines.push(listLine(item, index)));
  if (data.shown < data.count) {
    lines.push(t('project_get_endpoints.more', { shown: data.shown, count: data.count }));
  }
  return lines.join('\n');
}

function renderBindings(data: EndpointsData, t: Translator): string[] {
  if (data.bindings_state === 'unavailable')
    return [t('project_get_endpoints.bindings_unavailable')];
  const { bindings } = data;
  if (bindings === null) return [];
  const lines = [t('project_get_endpoints.bindings')];
  // The statuses the docs declare: a 2xx/3xx is what a call succeeds with (and what the assertions
  // check), a 4xx/5xx an error the API may answer with; one list read as "expected" mixes both.
  const success = bindings.expected_statuses.filter((status) => status < 400);
  const errors = bindings.expected_statuses.filter((status) => status >= 400);
  lines.push(
    `  ${t('project_get_endpoints.success_statuses', { statuses: success.join(', ') || '-' })}`,
  );
  if (errors.length > 0) {
    lines.push(`  ${t('project_get_endpoints.error_statuses', { statuses: errors.join(', ') })}`);
  }
  if (bindings.response_schemas.length > 0) {
    const shapes = bindings.response_schemas
      .map((entry) => `${entry.status} ${schemaText(entry.schema, t)}`.trim())
      .join('; ');
    lines.push(`  ${t('project_get_endpoints.response_schemas', { shapes })}`);
  }
  if (bindings.assertions.length > 0) {
    lines.push(`  ${t('project_get_endpoints.assertions')}`);
    for (const assertion of bindings.assertions) {
      lines.push(`    ${assertion.type} — ${assertion.description}`);
    }
  }
  return lines;
}

function renderOne(data: EndpointsData, detail: EndpointDetail, t: Translator): string {
  const summary = detail.summary === null || detail.summary === '' ? '' : ` — ${detail.summary}`;
  const lines = [`${detail.method} ${detail.path}${summary}`];
  const facts = [`id: ${detail.id}`];
  if (detail.operation_id !== null) {
    facts.push(t('project_get_endpoints.operation_id', { value: detail.operation_id }));
  }
  if (detail.tags.length > 0) {
    facts.push(t('project_get_endpoints.tags', { names: detail.tags.join(', ') }));
  }
  if (detail.deprecated) facts.push(t('project_get_endpoints.deprecated'));
  lines.push(facts.join(', '));
  if (detail.description !== null && detail.description !== '') lines.push(detail.description);
  if (detail.parameters.length > 0) {
    lines.push(t('project_get_endpoints.parameters', { count: detail.parameters.length }));
    for (const parameter of detail.parameters) {
      const flags = [
        parameter.type,
        ...(parameter.required ? [t('project_get_endpoints.required')] : []),
      ];
      lines.push(`  ${parameter.in} ${parameter.name} (${flags.join(', ')})`);
    }
  }
  if (detail.request_body !== null) {
    const body = detail.request_body;
    const required = body.required ? ` (${t('project_get_endpoints.required')})` : '';
    lines.push(
      `${t('project_get_endpoints.body')} ${body.content_type}${required} ${schemaText(body.schema, t)}`.trimEnd(),
    );
  }
  if (detail.responses.length > 0) {
    lines.push(t('project_get_endpoints.responses'));
    for (const response of detail.responses) {
      const parts = [
        String(response.status),
        response.content_type ?? '',
        schemaText(response.schema, t),
      ];
      lines.push(`  ${parts.filter((part) => part !== '').join(' ')}`);
    }
  }
  if (detail.security.length > 0) {
    lines.push(t('project_get_endpoints.security', { names: detail.security.join(', ') }));
  }
  lines.push(...renderBindings(data, t));
  return lines.join('\n');
}

export function renderGetEndpoints(data: EndpointsData, t: Translator): string {
  return data.mode === 'one' && data.detail !== null
    ? renderOne(data, data.detail, t)
    : renderList(data, t);
}
