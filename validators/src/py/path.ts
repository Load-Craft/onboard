// The part of `pathlib.PurePosixPath` the validators use: normalisation, `name`, `suffix`, `parent`
// and the ordering of paths, which compares component by component and not as plain strings.

import { compareStr } from './str.ts';

// On Windows `pathlib` reads both separators, prints backslashes and orders paths without regard to
// case; elsewhere a backslash is an ordinary character of a name. `flavour` follows the platform; the
// tests switch it to exercise both.
let windows = process.platform === 'win32';

/** Selects the path flavour of every `PyPath` made afterwards (the platform's own unless a test says so). */
export function setPathFlavour(flavour: 'windows' | 'posix'): void {
  windows = flavour === 'windows';
}

export class PyPath {
  /** The normalised path with `/` as the separator on every platform: for logic and file access. */
  readonly text: string;
  private readonly windows: boolean;

  constructor(raw: string) {
    this.windows = windows;
    this.text = normalize(this.windows ? raw.replaceAll('\\', '/') : raw);
  }

  /** `str(path)`: what a message shows (backslashes on Windows). */
  get display(): string {
    return this.windows ? this.text.replaceAll('/', '\\') : this.text;
  }

  toString(): string {
    return this.display;
  }

  private get parts(): string[] {
    return this.text.split('/');
  }

  get name(): string {
    if (this.text === '.') return '';
    const at = this.text.lastIndexOf('/');
    const last = at === -1 ? this.text : this.text.slice(at + 1);
    return last;
  }

  get suffix(): string {
    const name = this.name;
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot) : '';
  }

  get parent(): PyPath {
    if (this.text === '.' || this.text === '/' || this.text === '//') return this;
    const at = this.text.lastIndexOf('/');
    if (at === -1) return new PyPath('.');
    if (at === 0) return new PyPath('/');
    if (at === 1 && this.text.startsWith('//')) return new PyPath('//');
    return new PyPath(this.text.slice(0, at));
  }

  join(child: string): PyPath {
    return new PyPath(child.startsWith('/') ? child : `${this.text}/${child}`);
  }

  equals(other: PyPath): boolean {
    return this.text === other.text;
  }

  /** The order of `PurePath.__lt__`: the normalised string split on `/`, compared as lists. */
  static compare(a: PyPath, b: PyPath): number {
    const fold = (path: PyPath): string[] =>
      path.windows ? path.text.toLowerCase().split('/') : path.parts;
    const left = fold(a);
    const right = fold(b);
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i += 1) {
      const order = compareStr(left[i] as string, right[i] as string);
      if (order !== 0) return order;
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  }
}

function normalize(raw: string): string {
  if (raw === '') return '.';
  let root = '';
  if (raw.startsWith('/')) root = raw.startsWith('//') && !raw.startsWith('///') ? '//' : '/';
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  return root + parts.join('/') || '.';
}
