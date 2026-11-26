// Structure check of an OpenAPI 3.0 document: the `struct` rule of Redocly's openapi-core, run on the
// same type tree (`Oas3Types`), so a field the 3.0 object does not define, a value of the wrong type
// and a missing required field are found the way the official tooling finds them. Only the walk is
// written here; the type tree is the library's (MIT, bundled into the validator).

import { normalizeTypes } from '../../mcp/node_modules/@redocly/openapi-core/lib/types/index.js';
import { Oas3Types } from '../../mcp/node_modules/@redocly/openapi-core/lib/types/oas3.js';

import type { PyValue } from './py/index.ts';

type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };
type PropType = TypeNode | ((value: Plain, key: string) => PropType | undefined) | null | undefined;
type Schema = {
  type?: string;
  enum?: unknown[];
  items?: { type?: string; enum?: unknown[] };
  resolvable?: boolean;
  minimum?: number;
  name?: string;
};
type TypeNode = Schema & {
  properties: Record<string, PropType>;
  additionalProperties?: PropType;
  items?: TypeNode;
  required?: string[] | ((node: Plain, key: string) => string[]);
  requiredOneOf?: string[];
  allowed?: (node: Plain) => string[];
  extensionsPrefix?: string;
};

export type StructIssue = { pointer: string; message: string };

const TYPES = normalizeTypes(Oas3Types) as unknown as Record<string, TypeNode>;

function toPlain(value: PyValue): Plain {
  if (value instanceof Map) {
    const out: { [key: string]: Plain } = {};
    for (const [key, child] of value) out[key] = toPlain(child);
    return out;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'bigint') return Number(value);
  return value;
}

const isObject = (value: Plain | undefined): value is { [key: string]: Plain } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function oasTypeOf(value: Plain | undefined): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: Plain | undefined, type: string): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'null':
      return value === null;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

const isNamed = (type: PropType): type is TypeNode =>
  typeof type === 'object' && type !== null && typeof type.name === 'string';

function pointerOf(parent: string, child: string): string {
  const escaped = child.replaceAll('~', '~0').replaceAll('/', '~1');
  return `${parent}/${escaped}`;
}

function resolveLocal(root: Plain, ref: string): { node: Plain; pointer: string } | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: Plain | undefined = root;
  let pointer = '';
  for (const raw of ref.slice(2).split('/')) {
    const part = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) current = /^\d+$/.test(part) ? current[Number(part)] : undefined;
    else if (isObject(current) && Object.hasOwn(current, part)) current = current[part];
    else return undefined;
    if (current === undefined) return undefined;
    pointer = pointerOf(pointer, part);
  }
  return { node: current, pointer };
}

/** Structure errors of an OpenAPI 3.0 document; `$ref`s are followed once per type and target. */
export function checkOas3Structure(document: PyValue): StructIssue[] {
  const root = toPlain(document);
  const issues: StructIssue[] = [];
  const seen = new Set<string>();
  const report = (pointer: string, message: string): void => {
    issues.push({ pointer: pointer === '' ? '/' : pointer, message });
  };

  const visit = (rawNode: Plain, type: TypeNode, rawPointer: string, key: string): void => {
    let node = rawNode;
    let pointer = rawPointer;
    if (isObject(node) && typeof node['$ref'] === 'string') {
      const target = resolveLocal(root, node['$ref']);
      if (target === undefined) return;
      const id = `${type.name ?? ''}|${target.pointer}`;
      if (seen.has(id)) return;
      seen.add(id);
      node = target.node;
      pointer = target.pointer;
    }
    if (type.items) {
      if (!Array.isArray(node)) {
        report(
          pointer,
          `Expected type \`${type.name ?? ''}\` (array) but got \`${oasTypeOf(node)}\``,
        );
        return;
      }
      node.forEach((item, index) => {
        visit(item, type.items as TypeNode, pointerOf(pointer, String(index)), String(index));
      });
      return;
    }
    if (!isObject(node)) {
      report(
        pointer,
        `Expected type \`${type.name ?? ''}\` (object) but got \`${oasTypeOf(node)}\``,
      );
      return;
    }
    const required = typeof type.required === 'function' ? type.required(node, key) : type.required;
    for (const name of required ?? []) {
      if (!Object.hasOwn(node, name))
        report(pointer, `The field \`${name}\` must be present on this level.`);
    }
    const allowed = type.allowed?.(node);
    if (allowed) {
      for (const name of Object.keys(node)) {
        if (
          allowed.includes(name) ||
          (type.extensionsPrefix !== undefined && name.startsWith(type.extensionsPrefix)) ||
          !Object.keys(type.properties).includes(name)
        ) {
          continue;
        }
        report(pointerOf(pointer, name), `The field \`${name}\` is not allowed here.`);
      }
    }
    if (type.requiredOneOf && !type.requiredOneOf.some((name) => Object.hasOwn(node, name))) {
      report(
        pointer,
        `Must contain at least one of the following fields: ${type.requiredOneOf.join(', ')}.`,
      );
    }

    for (const name of Object.keys(node)) {
      const childPointer = pointerOf(pointer, name);
      let value = node[name] as Plain;
      let propType: PropType = type.properties[name];
      if (propType === undefined) propType = type.additionalProperties;
      if (typeof propType === 'function') propType = propType(value, name);
      if (isNamed(propType)) {
        visit(value, propType, childPointer, name);
        continue;
      }
      if (propType === undefined) {
        if (!name.startsWith('x-'))
          report(childPointer, `Property \`${name}\` is not expected here.`);
        continue;
      }
      if (propType === null) continue;
      const schema = propType as Schema;
      if (schema.resolvable !== false && isObject(value) && typeof value['$ref'] === 'string') {
        const target = resolveLocal(root, value['$ref']);
        if (target === undefined) continue;
        value = target.node;
      }
      if (schema.items?.enum && Array.isArray(value)) {
        for (const item of value) {
          if (!schema.items.enum.includes(item)) {
            report(
              childPointer,
              `\`${name}\` can be one of the following only: ${schema.items.enum.map((entry) => `"${String(entry)}"`).join(', ')}.`,
            );
          }
        }
      }
      if (schema.enum) {
        if (!schema.enum.includes(value)) {
          report(
            childPointer,
            `\`${name}\` can be one of the following only: ${schema.enum.map((entry) => `"${String(entry)}"`).join(', ')}.`,
          );
        }
      } else if (schema.type && !matchesType(value, schema.type)) {
        report(childPointer, `Expected type \`${schema.type}\` but got \`${oasTypeOf(value)}\`.`);
      } else if (Array.isArray(value) && schema.items?.type) {
        const itemsType = schema.items.type;
        value.forEach((item, index) => {
          if (!matchesType(item, itemsType)) {
            report(
              pointerOf(childPointer, String(index)),
              `Expected type \`${itemsType}\` but got \`${oasTypeOf(item)}\`.`,
            );
          }
        });
      }
      if (
        typeof schema.minimum === 'number' &&
        typeof value === 'number' &&
        schema.minimum > value
      ) {
        report(
          childPointer,
          `The value of the ${name} field must be greater than or equal to ${String(schema.minimum)}`,
        );
      }
      if (name === 'nullable' && !node['type']) {
        report(childPointer, 'The `type` field must be defined when the `nullable` field is used.');
      }
    }
  };

  visit(root, TYPES['Root'] as TypeNode, '', '');
  return issues;
}
