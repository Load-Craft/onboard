// Vitest file. Named *.spec.ts on purpose: `claude plugin test` collects every *.test.ts in the
// plugin and would try to run this file in the mods environment (see mod/docs/mods-facts.md).
import { describe, expect, it } from 'vitest';

import { minVersion, supports } from '../src/capabilities.js';

const SURFACES = ['terminal', 'desktop', 'vscode'] as const;

// Site × surface, as the mods reference draws them (Render sites and Elements tables).
const TABLE: Record<string, Record<(typeof SURFACES)[number], boolean>> = {
  AbovePrompt: { terminal: true, desktop: true, vscode: false },
  AbovePromptList: { terminal: true, desktop: true, vscode: false },
  Pane: { terminal: true, desktop: true, vscode: true },
  ToolUse: { terminal: true, desktop: true, vscode: true },
  ToolResult: { terminal: true, desktop: true, vscode: true },
  ToolProgress: { terminal: true, desktop: false, vscode: false },
  Placed: { terminal: true, desktop: false, vscode: false },
  Svg: { terminal: false, desktop: true, vscode: true },
  Raster: { terminal: true, desktop: false, vscode: false },
  status: { terminal: true, desktop: true, vscode: true },
  toast: { terminal: true, desktop: true, vscode: true },
  notify: { terminal: true, desktop: false, vscode: false },
};

describe('supports', () => {
  for (const [site, row] of Object.entries(TABLE)) {
    for (const surface of SURFACES) {
      it(`${site} on ${surface} → ${String(row[surface])}`, () => {
        expect(supports(surface, site)).toBe(row[surface]);
      });
    }
  }

  it('AbovePrompt is not drawn in VS Code', () => {
    expect(supports('vscode', 'AbovePrompt')).toBe(false);
  });

  it('ToolProgress is terminal only', () => {
    expect(supports('desktop', 'ToolProgress')).toBe(false);
  });

  it('an unknown site is false on every surface', () => {
    for (const surface of SURFACES) expect(supports(surface, 'Sidebar')).toBe(false);
  });

  it('an unknown or empty surface is false for every site', () => {
    for (const site of Object.keys(TABLE)) {
      expect(supports('mobile', site)).toBe(false);
      expect(supports('', site)).toBe(false);
    }
  });

  it('does not read inherited properties as sites or surfaces', () => {
    expect(supports('terminal', 'toString')).toBe(false);
    expect(supports('constructor', 'Pane')).toBe(false);
  });
});

describe('minVersion', () => {
  it.each([
    ['mods.terminal', '2.1.287'],
    ['mods.desktop', '2.1.286'],
    ['mods.vscode', '2.1.299'],
    ['mods.vscode.noFeatureFlags', '2.1.304'],
    ['ui.view', '2.1.300'],
    ['ui.place', '2.1.314'],
    ['AbovePromptList', '2.1.323'],
    ['band.perMod', '2.1.323'],
    ['ui.render.waitLimit', '2.1.326'],
  ])('%s → %s', (feature, version) => {
    expect(minVersion(feature)).toBe(version);
  });

  it('an unknown feature has no version', () => {
    expect(minVersion('ui.hologram')).toBeUndefined();
    expect(minVersion('toString')).toBeUndefined();
  });
});
