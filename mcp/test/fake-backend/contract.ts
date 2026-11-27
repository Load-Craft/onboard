// Contract check of the fake backend: every response it sends is validated against the response
// schema of the same operation in contracts/loadcraft-openapi.json, so a fake that answers
// differently from the described backend fails the test instead of hiding a broken tool.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

export const SNAPSHOT_PATH = fileURLToPath(
  new URL('../../../contracts/loadcraft-openapi.json', import.meta.url),
);
const SNAPSHOT_NAME = 'contracts/loadcraft-openapi.json';

/** Base URI under which the snapshot's component schemas are registered with the validator. */
const SCHEMA_ID = 'https://contract.invalid/loadcraft-openapi.json';
const COMPONENT_REF = '#/components/schemas/';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Success responses that the snapshot leaves untyped (an empty JSON schema or a non-JSON body),
 * as `METHOD path status`. Their bodies cannot be checked and are skipped; every other response
 * is validated. A test keeps this list equal to the snapshot, so a refresh that types one of
 * them (or drops a type) shows up as a failing test, not as a silently skipped check.
 */
export const UNTYPED_SUCCESS_RESPONSES: readonly string[] = [
  'DELETE /api/v1/projects/{project_id}/gatling/environments/{env_id} 200',
  'GET /api/v1/injector-agents/jobs/{job_id}/bundle 200',
  'GET /api/v1/projects/{project_id}/gatling/environments 200',
  'GET /api/v1/projects/{project_id}/gatling/environments/{env_id} 200',
  'GET /api/v1/projects/{project_id}/gatling/executions/{execution_id}/logs/download 200',
  'GET /api/v1/projects/{project_id}/gatling/executions/{execution_id}/report/{filepath} 200',
  'GET /api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/export 200',
  'GET /api/v1/projects/{project_id}/generate-payloads/{run_id}/download 200',
  'GET /api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/paths/{path_index}/attempts/{attempt}/snapshot 200',
  'GET /api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/stills/{still_id} 200',
  'POST /api/v1/projects/{project_id}/gatling/environments 200',
  'POST /api/v1/projects/{project_id}/generate-payloads 200',
  'POST /api/v1/projects/{project_id}/har/{har_session_id}/generate-multi 200',
  'POST /api/v1/projects/{project_id}/har/{har_session_id}/refine 200',
  'POST /api/v1/projects/{project_id}/har/{har_session_id}/split 200',
  'PUT /api/v1/projects/{project_id}/gatling/environments/{env_id} 200',
];

/**
 * Error responses the snapshot types as FastAPI's validation list while the route answers with an
 * object under `detail` (`{code, message, endpoint_ids}`) or with a text under `detail` (the
 * refusals of `generate_slot_feeder`, `HTTPException(422, …)`). They are checked against the error
 * envelope instead, as `METHOD path status`.
 */
export const ERROR_ENVELOPE_RESPONSES: readonly string[] = [
  'POST /api/v1/projects/{project_id}/flows/generate-async 422',
  'POST /api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slots/{slot}/generate-feeder 422',
];

/**
 * Error envelope of the backend for statuses the snapshot does not type. FastAPI documents only
 * 422; every `HTTPException` (401, 403, 404, 409, 502, ...) answers `{"detail": ...}`, and the
 * custom exception handlers add keys next to `detail`.
 */
const ERROR_ENVELOPE = {
  type: 'object',
  required: ['detail'],
  properties: { detail: {} },
} as const;

interface OpenApiMedia {
  schema?: unknown;
}
interface OpenApiResponse {
  content?: Record<string, OpenApiMedia>;
}
interface OpenApiOperation {
  operationId?: string;
  responses?: Record<string, OpenApiResponse>;
}
export interface OpenApiDocument {
  paths: Record<string, Partial<Record<Lowercase<HttpMethod>, OpenApiOperation>>>;
  components: { schemas: Record<string, unknown> };
}

/** How the body of one declared status is checked. */
type ResponseRule =
  { kind: 'json'; validate: ValidateFunction } | { kind: 'empty' } | { kind: 'untyped' };

export interface ContractOperation {
  readonly method: HttpMethod;
  /** Path template as written in the snapshot, e.g. `/api/v1/projects/{project_id}`. */
  readonly path: string;
  readonly operationId: string;
  /** `METHOD path (operationId)` — how messages name the operation. */
  readonly label: string;
  /** Problems of a response with this status and (already JSON round-tripped) body; empty = valid. */
  check(status: number, body: unknown): string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a schema that constrains nothing (only annotations). */
function isUntypedSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return true;
  return Object.keys(schema).every((key) => key === 'title' || key === 'description');
}

/** Rewrites `#/components/schemas/X` to an absolute reference into the registered components. */
function absoluteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(absoluteRefs);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      key === '$ref' && typeof item === 'string' && item.startsWith(COMPONENT_REF)
        ? `${SCHEMA_ID}#/$defs/${item.slice(COMPONENT_REF.length)}`
        : absoluteRefs(item);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pydantic writes naive datetimes without an offset, so the offset is optional here.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/;

function createValidator(doc: OpenApiDocument): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    // Pydantic output trips these style checks (nullable unions, tuples without bounds) while
    // being valid JSON Schema; unknown keywords stay strict.
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
  });
  // OpenAPI's `discriminator` is an annotation; the `oneOf` next to it does the validating.
  ajv.addKeyword({ keyword: 'discriminator' });
  // `x-secret` (true or "by-name") marks secret fields for the plugin's mask; it says nothing about
  // what a value may be. The generator of the secret paths refuses any other value of it.
  ajv.addKeyword({ keyword: 'x-secret' });
  ajv.addFormat('uuid', UUID);
  // `format: password` only says the value is a secret to hide; any string is one.
  ajv.addFormat('password', true);
  ajv.addFormat('date-time', {
    validate: (value: string) => DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)),
  });
  ajv.addSchema({ $id: SCHEMA_ID, $defs: absoluteRefs(doc.components.schemas) });
  return ajv;
}

function describeError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '/' : error.instancePath;
  const params: Record<string, unknown> = error.params;
  let detail = '';
  if (error.keyword === 'additionalProperties') {
    detail = ` (${String(params.additionalProperty)})`;
  } else if (error.keyword === 'enum') {
    detail = ` (${JSON.stringify(params.allowedValues)})`;
  } else if (error.keyword === 'const') {
    detail = ` (${JSON.stringify(params.allowedValue)})`;
  }
  return `${where} ${error.message ?? error.keyword}${detail}`;
}

const MAX_PROBLEMS = 8;

function problemsOf(validate: ValidateFunction, body: unknown): string[] {
  if (validate(body)) return [];
  const unique = [...new Set((validate.errors ?? []).map(describeError))];
  return unique.length > MAX_PROBLEMS
    ? [...unique.slice(0, MAX_PROBLEMS), `... ${String(unique.length - MAX_PROBLEMS)} more`]
    : unique;
}

/**
 * Path parameters the backend declares with FastAPI's `:path` converter, so they match several
 * segments (`assets/js/app.js`, an endpoint name with slashes). The snapshot writes them as plain
 * `{name}`.
 */
export const PATH_CONVERTER_PARAMS: Readonly<Record<string, string>> = {
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}/percentiles':
    'name',
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}': 'name',
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/report/{filepath}': 'filepath',
};

/** Matcher of a path template: one segment per parameter, several for a path-converter one. */
export function compileTemplate(template: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const multiSegment = PATH_CONVERTER_PARAMS[template];
  const pattern = template
    .split('/')
    .map((segment) => {
      const name = /^\{([^}]+)\}$/.exec(segment)?.[1];
      if (name === undefined) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(name);
      return name === multiSegment ? '(.+)' : '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${pattern}$`), names };
}

/** Number of literal segments; a literal segment wins over a parameter, as in the backend. */
export function literalSegments(template: string): number {
  return template.split('/').filter((segment) => !segment.startsWith('{')).length;
}

export class Contract {
  readonly #doc: OpenApiDocument;
  readonly #operations = new Map<string, ContractOperation>();
  readonly #templates: { path: string; regex: RegExp }[];
  #ajv: Ajv2020 | undefined;

  constructor(doc: OpenApiDocument) {
    this.#doc = doc;
    this.#templates = Object.keys(doc.paths)
      .map((path) => ({ path, regex: compileTemplate(path).regex }))
      .sort((a, b) => literalSegments(b.path) - literalSegments(a.path));
  }

  has(method: string, path: string): boolean {
    return this.#raw(method, path) !== undefined;
  }

  /** The operation for a path template; throws when the snapshot does not have it. */
  operation(method: string, path: string): ContractOperation {
    const key = `${method} ${path}`;
    const cached = this.#operations.get(key);
    if (cached !== undefined) return cached;
    const raw = this.#raw(method, path);
    if (raw === undefined) {
      throw new Error(`${key} is not in ${SNAPSHOT_NAME}; refresh the snapshot before faking it`);
    }
    const operation = this.#build(method as HttpMethod, path, raw);
    this.#operations.set(key, operation);
    return operation;
  }

  /** The operation whose template matches a concrete request path, if any. */
  match(method: string, concretePath: string): ContractOperation | undefined {
    for (const { path, regex } of this.#templates) {
      if (regex.test(concretePath) && this.has(method, path)) return this.operation(method, path);
    }
    return undefined;
  }

  get document(): OpenApiDocument {
    return this.#doc;
  }

  #raw(method: string, path: string): OpenApiOperation | undefined {
    if (!(HTTP_METHODS as readonly string[]).includes(method)) return undefined;
    return this.#doc.paths[path]?.[method.toLowerCase() as Lowercase<HttpMethod>];
  }

  #build(method: HttpMethod, path: string, raw: OpenApiOperation): ContractOperation {
    this.#ajv ??= createValidator(this.#doc);
    const ajv = this.#ajv;
    const operationId = raw.operationId ?? `${method} ${path}`;
    const label = `${method} ${path} (${operationId})`;
    const rules = new Map<number, ResponseRule>();
    for (const [code, response] of Object.entries(raw.responses ?? {})) {
      const status = Number(code);
      const content = response.content;
      if (content === undefined || Object.keys(content).length === 0) {
        rules.set(status, { kind: 'empty' });
        continue;
      }
      const schema = content['application/json']?.schema;
      rules.set(
        status,
        schema === undefined || isUntypedSchema(schema)
          ? { kind: 'untyped' }
          : { kind: 'json', validate: ajv.compile(absoluteRefs(schema) as object) },
      );
    }
    const envelope = ajv.compile(ERROR_ENVELOPE);
    const envelopeOnly = new Set(
      ERROR_ENVELOPE_RESPONSES.filter((entry) => entry.startsWith(`${method} ${path} `)).map(
        (entry) => Number(entry.slice(entry.lastIndexOf(' ') + 1)),
      ),
    );
    const skipped = new Set(
      UNTYPED_SUCCESS_RESPONSES.filter((entry) => entry.startsWith(`${method} ${path} `)).map(
        (entry) => Number(entry.slice(entry.lastIndexOf(' ') + 1)),
      ),
    );

    return {
      method,
      path,
      operationId,
      label,
      check(status, body) {
        const rule = rules.get(status);
        const isError = status >= 400;
        if (rule?.kind === 'json' && !envelopeOnly.has(status)) {
          return problemsOf(rule.validate, body);
        }
        if (isError) return problemsOf(envelope, body);
        if (rule === undefined) {
          const declared = [...rules.keys()].filter((code) => code < 400).join(', ');
          return [`status ${String(status)} is not declared (declared: ${declared})`];
        }
        if (rule.kind === 'empty') {
          return body === undefined ? [] : [`/ must be empty for status ${String(status)}`];
        }
        if (skipped.has(status)) return [];
        return [
          `status ${String(status)} is untyped in the snapshot but missing from UNTYPED_SUCCESS_RESPONSES`,
        ];
      },
    };
  }
}

/** Success responses the snapshot leaves untyped, in the format of `UNTYPED_SUCCESS_RESPONSES`, sorted. */
export function untypedSuccessResponses(contract: Contract): string[] {
  const found: string[] = [];
  for (const [path, operations] of Object.entries(contract.document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = operations[method.toLowerCase() as Lowercase<HttpMethod>];
      for (const [code, response] of Object.entries(operation?.responses ?? {})) {
        if (!code.startsWith('2') || response.content === undefined) continue;
        if (isUntypedSchema(response.content['application/json']?.schema)) {
          found.push(`${method} ${path} ${code}`);
        }
      }
    }
  }
  return found.sort();
}

let shared: Contract | undefined;

/** The snapshot contract, parsed once per test file. */
export function loadContract(): Contract {
  shared ??= new Contract(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as OpenApiDocument);
  return shared;
}
