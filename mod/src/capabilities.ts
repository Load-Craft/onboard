/**
 * Where the mod may draw, and from which Claude Code version a feature exists. Pure data and two
 * lookups: no `$`, no clock. Every drawing hook asks `supports(e.surface, site)` first and passes
 * the event on unchanged when the answer is false, so the plugin works the same without the mod.
 *
 * Sources: the mods reference (Render sites and Elements tables, the per-feature version notes)
 * at https://code.claude.com/docs/en/plugins/mods/reference, checked against Claude Code 2.1.325.
 * Details and open points: mod/docs/mods-facts.md.
 */

export type Surface = 'terminal' | 'desktop' | 'vscode';

const TERMINAL_DESKTOP: readonly Surface[] = ['terminal', 'desktop'];
const EVERYWHERE: readonly Surface[] = ['terminal', 'desktop', 'vscode'];
const TERMINAL: readonly Surface[] = ['terminal'];

/** Render sites, `$.ui` calls and elements the mod uses, with the surfaces that draw them. */
const SITES = {
  // Render sites (`ui.render` components).
  AbovePrompt: TERMINAL_DESKTOP,
  AbovePromptList: TERMINAL_DESKTOP,
  Pane: EVERYWHERE,
  ToolUse: EVERYWHERE,
  ToolResult: EVERYWHERE,
  ToolProgress: TERMINAL,
  Placed: TERMINAL,
  // Elements.
  Svg: ['desktop', 'vscode'],
  Raster: TERMINAL,
  // `$.ui` calls. `notify` resolves `no-surface` outside the terminal; use a toast there.
  status: EVERYWHERE,
  toast: EVERYWHERE,
  notify: TERMINAL,
} as const satisfies Record<string, readonly Surface[]>;

export type Site = keyof typeof SITES;

/** Lowest Claude Code version for each feature the mod depends on. */
const MIN_VERSIONS = {
  /** Mods load in the terminal CLI. */
  'mods.terminal': '2.1.287',
  /** Mods load in the Desktop app's own copy of Claude Code. */
  'mods.desktop': '2.1.286',
  /** The VS Code extension draws what a mod draws. */
  'mods.vscode': '2.1.299',
  /** VS Code in a session that does not fetch feature flags (for example on Amazon Bedrock). */
  'mods.vscode.noFeatureFlags': '2.1.304',
  /** `$.ui.view`. */
  'ui.view': '2.1.300',
  /** `$.ui.place` (the `Placed` site). */
  'ui.place': '2.1.314',
  /** The `AbovePromptList` site. */
  AbovePromptList: '2.1.323',
  /** Each mod draws its own band row (`{ plugin }` matcher); before it all mods share one drawing. */
  'band.perMod': '2.1.323',
  /** The 30 s limit on a `ui.render` hook waiting on mods API calls. */
  'ui.render.waitLimit': '2.1.326',
} as const satisfies Record<string, string>;

export type Feature = keyof typeof MIN_VERSIONS;

function own<T extends object>(table: T, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(table, key);
}

/** Whether `surface` draws `site`. An unknown surface or site is `false`. */
export function supports(surface: string, site: string): boolean {
  if (!own(SITES, site)) return false;
  const surfaces: readonly string[] = SITES[site];
  return surfaces.includes(surface);
}

/** The lowest Claude Code version that has `feature`, or `undefined` for an unknown feature. */
export function minVersion(feature: string): string | undefined {
  return own(MIN_VERSIONS, feature) ? MIN_VERSIONS[feature] : undefined;
}
