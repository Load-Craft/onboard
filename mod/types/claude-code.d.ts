// The part of the `claude-code` module the mod imports. Claude Code writes the full declarations
// beside a mod only when it loads the mod from a folder in an interactive session, so type
// checking here (and in CI) uses this subset; it follows `UpdateFunction`, `ReadFunction` and
// `AtomFunction` of the declarations of Claude Code 2.1.325. `PluginState` is filled in by
// mod/types/index.d.ts.
declare module 'claude-code' {
  export interface PluginState {}

  export interface Atom<T> {
    readonly initial: T;
  }

  export function atom<
    P extends keyof PluginState & string,
    K extends keyof PluginState[P] & string,
  >(
    ref: { readonly plugin: P; readonly key: K },
    initial: PluginState[P][K],
  ): Atom<PluginState[P][K]>;

  export function read<T>($: unknown, source: Atom<T>): Promise<T>;

  export function update<T>($: unknown, target: Atom<T>, change: (value: T) => T): Promise<T>;
}
