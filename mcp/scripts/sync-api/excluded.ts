// Operations of the backend that the plugin's public snapshot of the contract leaves out. The
// snapshot is published with the plugin, and the backend exports every operation it has; an
// operation that is no business of a client and only describes how to get a session without a
// credential has no place in it. `npm run sync:api` drops these on every import, so a later
// synchronisation never brings one back.

import type { Spec } from './diff.ts';

export interface ExcludedOperation {
  /** The backend's operationId; the catalog lists it among its excluded operations. */
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly why: string;
}

export const EXCLUDED_OPERATIONS: readonly ExcludedOperation[] = [
  {
    operationId: 'dev_login_api_v1_auth_dev_login_post',
    method: 'post',
    path: '/api/v1/auth/dev-login',
    why:
      'A session for any user without a credential, for local development only; the plugin ' +
      'signs in with an API token, and the public snapshot does not document how to obtain a ' +
      'session without one.',
  },
];

const SCHEMA_REF = /"#\/components\/schemas\/([^"]+)"/gu;

function schemaRefs(value: unknown): Set<string> {
  return new Set([...JSON.stringify(value ?? null).matchAll(SCHEMA_REF)].map((m) => m[1] ?? ''));
}

/**
 * `spec` without the excluded operations (a path item left empty goes too) and without the
 * component schemas only they used. Other schemas, used or not, stay as the backend wrote them.
 */
export function withoutExcludedOperations(spec: Spec): Spec {
  const paths: Record<string, Record<string, unknown>> = {};
  const removed: unknown[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const kept: Record<string, unknown> = {};
    for (const [method, operation] of Object.entries(item)) {
      const excluded = EXCLUDED_OPERATIONS.some(
        (entry) => entry.path === path && entry.method === method.toLowerCase(),
      );
      if (excluded) removed.push(operation);
      else kept[method] = operation;
    }
    if (Object.keys(kept).length > 0) paths[path] = kept;
  }
  if (removed.length === 0) return spec;
  const next: Record<string, unknown> = { ...spec, paths };
  const schemas = spec.components?.['schemas'];
  if (schemas !== undefined) {
    const candidates = schemaRefs(removed);
    const kept = { ...schemas };
    // A schema the removed operations named goes only when nothing that stays names it.
    let changed = true;
    while (changed) {
      changed = false;
      const used = schemaRefs({ ...next, components: { ...spec.components, schemas: kept } });
      for (const name of [...candidates]) {
        if (name in kept && !used.has(name)) {
          // What it named is a candidate too: a schema reached only through it goes with it.
          for (const inner of schemaRefs(kept[name])) candidates.add(inner);
          delete kept[name];
          changed = true;
        }
      }
    }
    next['components'] = { ...spec.components, schemas: kept };
  }
  return next as Spec;
}
