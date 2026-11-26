// Finds the API routes the plugin calls, from its own sources: the `GET`/`POST`/... calls of the typed
// client and the `uploadFile` calls, whose path is a string literal, a constant of the same file or
// a template. Paths are matched against the document's paths, so a template such as
// `/api/v1/items/${id}/tags` finds `/api/v1/items/{item_id}/tags`. A route is tied to the tools that
// reach the file holding the call through imports.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface PluginRoute {
  readonly method: string;
  readonly path: string;
  /** Source files (relative to the sources folder) that make the call. */
  readonly files: readonly string[];
  /** Tools (snake_case) that reach one of those files through imports; may be empty. */
  readonly tools: readonly string[];
}

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

function sourcesOf(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const full = join(entry.parentPath, entry.name);
    const rel = relative(dir, full);
    if (rel.startsWith(`http${'/'}generated`) || /\.(test|d)\.ts$/.test(entry.name)) continue;
    out.push(rel);
  }
  return out.sort();
}

/** `const NAME = '…' | `…${OTHER}…` [as const];` of one file, with template constants resolved. */
function constantsOf(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /\bconst\s+(\w+)\s*=\s*(?:'([^'\n]*)'|`([^`]*)`)/g;
  for (const match of text.matchAll(pattern)) {
    const [, id = '', literal, template] = match;
    found.set(id, literal ?? template ?? '');
  }
  const resolveOne = (value: string, depth: number): string =>
    depth > 8
      ? value
      : value.replace(/\$\{(\w+)\}/g, (whole, id: string) => {
          const inner = found.get(id);
          return inner === undefined ? whole : resolveOne(inner, depth + 1);
        });
  for (const [id, value] of found) found.set(id, resolveOne(value, 0));
  return found;
}

/** A path with `${…}` holes becomes a pattern for the path parameters of the document. */
function matchPaths(expression: string, paths: readonly string[]): string[] {
  if (!expression.includes('${')) return paths.filter((path) => path === expression);
  const source = expression
    .split(/\$\{[^}]*\}/)
    .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  const pattern = new RegExp(`^${source.replace(/\{/g, '\\{').replace(/\}/g, '\\}')}$`);
  return paths.filter((path) => pattern.test(path));
}

interface Call {
  readonly method: string;
  readonly expression: string;
}

function callsOf(text: string): Call[] {
  const constants = constantsOf(text);
  const calls: Call[] = [];
  const typed = new RegExp(
    `\\b(${METHODS})\\(\\s*(?:'([^'\\n]*)'|\`([^\`]*)\`|([A-Za-z_]\\w*))`,
    'g',
  );
  for (const match of text.matchAll(typed)) {
    const [, method = '', literal, template, id] = match;
    const expression = literal ?? template ?? (id === undefined ? undefined : constants.get(id));
    if (expression !== undefined)
      calls.push({ method, expression: expandTemplate(expression, constants) });
  }
  const upload = /\buploadFile\([^]*?\burl:\s*(?:'([^'\n]*)'|`([^`]*)`|([A-Za-z_]\w*))/g;
  for (const match of text.matchAll(upload)) {
    const [, literal, template, id] = match;
    const expression = literal ?? template ?? (id === undefined ? undefined : constants.get(id));
    if (expression !== undefined)
      calls.push({ method: 'POST', expression: expandTemplate(expression, constants) });
  }
  return calls;
}

function expandTemplate(expression: string, constants: ReadonlyMap<string, string>): string {
  return expression.replace(/\$\{(\w+)\}/g, (whole, id: string) => constants.get(id) ?? whole);
}

function importsOf(file: string, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
    const target = (match[1] ?? '').replace(/\.(js|ts)$/, '');
    out.push(resolve(dirname(file), `${target}.ts`));
  }
  return out;
}

/** `listItems` -> `list_items`. */
function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Tool name -> source files the tool reaches. A tool is an import of `tools/index.ts`; its files are
 * its own entry, the folder of the same name, and shared files of `tools/` (other tools stay out).
 */
function toolFiles(dir: string, files: readonly string[]): Map<string, Set<string>> {
  const index = files.find((file) => file === join('tools', 'index.ts'));
  const result = new Map<string, Set<string>>();
  if (index === undefined) return result;
  const names = [...readFileSync(join(dir, index), 'utf8').matchAll(/from\s+'\.\/(\w+)(?:\.js)?'/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== '');
  const entries = new Set(names);
  for (const name of names) {
    const reached = new Set<string>();
    const queue = [resolve(dir, 'tools', `${name}.ts`)];
    while (queue.length > 0) {
      const current = queue.pop() ?? '';
      if (reached.has(current)) continue;
      reached.add(current);
      const rel = relative(dir, current);
      if (rel.startsWith('api') || !files.includes(rel)) continue;
      for (const next of importsOf(current, readFileSync(current, 'utf8'))) {
        const nextRel = relative(dir, next);
        const [top, second] = nextRel.split('/');
        if (top === 'tools' && second !== undefined) {
          const base = second.replace(/\.ts$/, '');
          if (entries.has(base) && base !== name) continue;
          if (nextRel === join('tools', 'index.ts')) continue;
        }
        queue.push(next);
      }
    }
    result.set(
      snake(name),
      new Set([...reached].map((full) => relative(dir, full)).filter((rel) => files.includes(rel))),
    );
  }
  return result;
}

/** Routes of `sourcesDir` (the plugin's `src`) that exist among `specPaths`; sorted by method and path. */
export function findPluginRoutes(sourcesDir: string, specPaths: readonly string[]): PluginRoute[] {
  const files = sourcesOf(sourcesDir);
  const found = new Map<string, Set<string>>();
  for (const file of files) {
    for (const call of callsOf(readFileSync(join(sourcesDir, file), 'utf8'))) {
      for (const path of matchPaths(call.expression, specPaths)) {
        const key = `${call.method} ${path}`;
        (found.get(key) ?? found.set(key, new Set()).get(key))?.add(file);
      }
    }
  }
  const tools = toolFiles(sourcesDir, files);
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, owners]) => {
      const [method = '', path = ''] = key.split(' ');
      const names = [...tools.entries()]
        .filter(([, reached]) => [...owners].some((file) => reached.has(file)))
        .map(([tool]) => tool)
        .sort();
      return { method, path, files: [...owners].sort(), tools: names };
    });
}

/** Tool names whose files reach `file` (used to tie a compile error to a tool). */
export function toolsReaching(sourcesDir: string, file: string): string[] {
  const files = sourcesOf(sourcesDir);
  return [...toolFiles(sourcesDir, files).entries()]
    .filter(([, reached]) => reached.has(file))
    .map(([tool]) => tool)
    .sort();
}
