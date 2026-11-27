// The layout of the plugin package, the packaging of the stand-alone skills and the user documentation.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT, SKILLS_ROOT, withTempDir } from './helpers.ts';

// Command skills are named after the command (`status`), not the directory, and have
// no references; tests/playbook-skill.spec.ts covers them.
const COMMAND_SKILLS = new Set(['loadcraft-status', 'loadcraft-doctor']);
// The playbook lists references that later tasks write; tests/playbook-skill.spec.ts
// covers its layout, including the list of files not written yet.
const PLAYBOOK_SKILLS = new Set(['loadcraft-test']);
// Stand-alone skills work without the MCP server; only they are packed into a ZIP.
const STANDALONE_SKILLS = new Set([
  'loadcraft-openapi',
  'loadcraft-journeys',
  'loadcraft-asyncapi',
  'loadcraft-overview',
]);

type Json = Record<string, unknown>;
type ServerConfig = { command: string; args: string[]; env: Record<string, string> };
type UserConfigOption = Record<string, unknown>;

function readJson<T = Json>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(PACK_ROOT, ...parts), 'utf8')) as T;
}

function mcpServers(): Record<string, ServerConfig> {
  const data = readJson<Json>('.mcp.json');
  return (data['mcpServers'] ?? data) as Record<string, ServerConfig>;
}

function loadcraftServer(): ServerConfig {
  const server = mcpServers()['lc'];
  if (server === undefined) throw new Error('no lc server in .mcp.json');
  return server;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function dirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => statSync(join(dir, entry.name)).isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function setsEqual(actual: Set<string>, expected: Set<string>): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

describe('PackageLayoutTestCase', () => {
  it('test_vendor_manifests_stay_in_version_lockstep', () => {
    const codex = readJson('.codex-plugin', 'plugin.json');
    const claude = readJson('.claude-plugin', 'plugin.json');

    for (const key of ['name', 'version', 'description', 'author', 'keywords']) {
      expect(codex[key], key).toEqual(claude[key]);
    }
    expect(codex['skills']).toBe('./skills/');
    expect(String(codex['version'])).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(codex['repository']).toEqual(claude['repository']);
    expect(codex['homepage']).toEqual(claude['homepage']);
  });

  it('test_codex_manifest_does_not_declare_the_server_and_install_doc_covers_manual_setup', () => {
    // Codex plugins have no documented way to pass a secret to a bundled stdio server,
    // so the server is configured by hand and the manifest must not pretend otherwise.
    const codex = readJson('.codex-plugin', 'plugin.json');
    expect(codex).not.toHaveProperty('mcpServers');
    const text = readFileSync(join(PACK_ROOT, 'docs', 'plugin', 'INSTALL.md'), 'utf8');
    expect(text).toContain('\n## Codex\n');
    const section = text.split('\n## Codex\n')[1] ?? '';
    expect(section).toContain('[mcp_servers.loadcraft]');
    expect(section).toContain('command = "node"');
    expect(section).toContain('mcp/dist/server.mjs');
    expect(section).toMatch(/env_vars\s*=\s*\[[^\]]*"LOADCRAFT_API_TOKEN"/);
    // The token is forwarded by name; it is never written as a value in the config.
    const tomlBlock = /```toml\n(.*?)```/s.exec(section);
    expect(tomlBlock).not.toBeNull();
    expect(tomlBlock?.[1] ?? '').not.toMatch(/LOADCRAFT_API_TOKEN\s*=/);
    expect(section).not.toContain('lc_pat_');
    // The Polish page carries the same section and the same server block.
    const pl = readFileSync(join(PACK_ROOT, 'docs', 'plugin', 'INSTALL.pl.md'), 'utf8');
    expect(pl).toContain('\n## Codex\n');
    const plSection = pl.split('\n## Codex\n')[1] ?? '';
    expect(plSection).toContain('[mcp_servers.loadcraft]');
    expect(plSection).toContain('mcp/dist/server.mjs');
    expect(plSection).toMatch(/env_vars\s*=\s*\[[^\]]*"LOADCRAFT_API_TOKEN"/);
    const plToml = /```toml\n(.*?)```/s.exec(plSection);
    expect(plToml).not.toBeNull();
    expect(plToml?.[1] ?? '').not.toMatch(/LOADCRAFT_API_TOKEN\s*=/);
  });

  it('test_mcp_manifest_points_at_built_server', () => {
    const mcp = mcpServers();
    expect(mcp).toHaveProperty('lc');
    const server = loadcraftServer();
    expect(server.command).toBe('node');
    for (const arg of server.args) {
      const resolved = arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', PACK_ROOT);
      expect(isFile(resolved), resolved).toBe(true);
    }
  });

  it('test_mcp_user_config_references_resolve', () => {
    const claude = readJson('.claude-plugin', 'plugin.json');
    expect(claude['name']).toBe('loadcraft');
    expect(claude['mcpServers']).toBe('./.mcp.json');
    const userConfig = claude['userConfig'] as Record<string, UserConfigOption>;
    const raw = readFileSync(join(PACK_ROOT, '.mcp.json'), 'utf8');
    const referenced = new Set(
      [...raw.matchAll(/\$\{user_config\.(\w+)\}/g)].map((m) => m[1] ?? ''),
    );
    expect(referenced.size > 0).toBe(true);
    for (const key of referenced) {
      expect(Object.keys(userConfig), key).toContain(key);
    }
    setsEqual(
      new Set(Object.keys(loadcraftServer().env)),
      new Set([
        'LOADCRAFT_URL',
        'LOADCRAFT_API_URL',
        'LOADCRAFT_API_TOKEN',
        'LOADCRAFT_DEMO',
        'LOADCRAFT_LOCALE',
        'LOADCRAFT_WORKSPACE',
      ]),
    );
    expect(userConfig['api_token']?.['sensitive']).toBe(true);
    // The demo option is a boolean that is off by default and reaches the server as LOADCRAFT_DEMO.
    expect(userConfig['demo']?.['type']).toBe('boolean');
    expect(userConfig['demo']?.['default']).toBe(false);
    expect(loadcraftServer().env['LOADCRAFT_DEMO']).toBe('${user_config.demo}');
    expect(userConfig['locale']?.['options']).toEqual(['en', 'pl']);
    for (const [key, option] of Object.entries(userConfig)) {
      for (const field of ['type', 'title', 'description']) {
        expect(option, `${key}.${field}`).toHaveProperty(field);
      }
    }
  });

  it('test_user_config_only_token_is_required_and_addresses_are_unambiguous', () => {
    const claude = readJson('.claude-plugin', 'plugin.json');
    const userConfig = claude['userConfig'] as Record<string, UserConfigOption>;
    const required = Object.entries(userConfig)
      .filter(([, option]) => option['required'] === true)
      .map(([key]) => key);
    expect(required).toEqual(['api_token']);
    expect(userConfig['loadcraft_url']?.['default']).toBe('https://app.loadcraft.io');
    expect(userConfig['loadcraft_url']?.['title']).toBe('LoadCraft web app (browser address)');
    expect(userConfig['loadcraft_url']?.['description']).toMatch(
      /only for a local or self-hosted.*not the backend API address/i,
    );
    expect(userConfig['api_url']?.['title']).toBe(
      'Backend API address (leave empty if same as web app)',
    );
    expect(userConfig['api_url']?.['description']).toMatch(/including \/api\/v1/);
  });

  it('test_marketplace_lists_single_plugin_at_root', () => {
    const market = readJson<{ name: string; plugins: { name: string; source: string }[] }>(
      '.claude-plugin',
      'marketplace.json',
    );
    expect(market.name).toBe('loadcraft');
    expect(market.plugins.map((p) => [p.name, p.source])).toEqual([['loadcraft', './']]);
  });

  it('test_token_prefix_stays_out_of_shipped_files', () => {
    const needle = Buffer.from('lc_pat_');
    const allowedDirs = new Set(['.git', 'node_modules', 'tests', 'docs']);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          const top = relative(PACK_ROOT, path).split('/')[0] ?? '';
          // Dependencies (node_modules at any depth) are not shipped.
          return allowedDirs.has(top) || entry.name === 'node_modules' ? [] : walk(path);
        }
        return [path];
      });
    for (const path of walk(PACK_ROOT)) {
      const parts = relative(PACK_ROOT, path).split('/');
      if (allowedDirs.has(parts[0] ?? '') || !isFile(path)) continue;
      if (parts.includes('test') || path.endsWith('.md')) continue;
      expect(readFileSync(path).includes(needle), parts.join('/')).toBe(false);
    }
  });

  it('test_skills_are_self_contained_and_references_resolve', () => {
    const expectedNames = new Set([
      'loadcraft-openapi',
      'loadcraft-journeys',
      'loadcraft-asyncapi',
      'loadcraft-overview',
    ]);
    const actualNames = new Set<string>();

    for (const skillName of dirNames(SKILLS_ROOT)) {
      if (COMMAND_SKILLS.has(skillName) || PLAYBOOK_SKILLS.has(skillName)) continue;
      const skillDir = join(SKILLS_ROOT, skillName);
      const skillFile = join(skillDir, 'SKILL.md');
      const text = readFileSync(skillFile, 'utf8');
      const frontmatter = /^---\n(.*?)\n---\n/s.exec(text);
      expect(frontmatter, skillFile).not.toBeNull();
      const nameMatch = /^name:\s*(\S+)\s*$/m.exec(frontmatter?.[1] ?? '');
      expect(nameMatch, skillFile).not.toBeNull();
      const name = nameMatch?.[1] ?? '';
      actualNames.add(name);
      expect(name).toBe(skillName);
      expect(/\[TODO(?::|\])/i.test(text), skillFile).toBe(false);

      const referenceLinks = [...text.matchAll(/\]\((references\/[^)]+)\)/g)].map(
        (m) => m[1] ?? '',
      );
      expect(referenceLinks.length > 0, `${skillFile} has no progressive references`).toBe(true);
      for (const link of referenceLinks) {
        const reference = join(skillDir, link);
        expect(isFile(reference), reference).toBe(true);
        expect(resolve(reference, '..')).toBe(join(skillDir, 'references'));
      }
    }

    setsEqual(actualNames, expectedNames);
  });

  it('test_package_knows_every_skill_directory', () => {
    setsEqual(
      new Set(dirNames(SKILLS_ROOT)),
      new Set([...STANDALONE_SKILLS, ...COMMAND_SKILLS, ...PLAYBOOK_SKILLS]),
    );
  });

  it('test_skills_readmes_present_the_guiding_skill_and_the_plugin_install', () => {
    for (const name of ['README.md', 'README.pl.md']) {
      const text = readFileSync(join(SKILLS_ROOT, name), 'utf8');
      expect(text, name).toContain('loadcraft-test');
      expect(text, name).toContain('/plugin');
    }
  });

  it('test_zip_packaging_leaves_out_skills_that_need_the_server', () => {
    // Packaging stays a bash script (scripts/package.sh), exactly as it was.
    const zips = withTempDir((root) => {
      cpSync(join(PACK_ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
      cpSync(SKILLS_ROOT, join(root, 'skills'), {
        recursive: true,
        filter: (source) => !source.split('/').includes('__pycache__'),
      });
      const run = spawnSync('bash', [join(root, 'scripts', 'package.sh')], {
        cwd: root,
        encoding: 'utf8',
      });
      if (run.error !== undefined) throw run.error;
      expect(run.status, run.stderr).toBe(0);
      return readdirSync(join(root, 'dist'))
        .filter((name) => name.endsWith('.zip'))
        .map((name) => name.replace(/\.zip$/, ''));
    });
    setsEqual(new Set(zips), STANDALONE_SKILLS);
  });
});

// User documentation of the plugin. Each English file has a Polish twin with the same headings.
const DOC_PAIRS: [string, string][] = [
  ['README.md', 'README.pl.md'],
  ['skills/INSTALL.md', 'skills/INSTALL.pl.md'],
  ['docs/plugin/INSTALL.md', 'docs/plugin/INSTALL.pl.md'],
  ['docs/plugin/USAGE.md', 'docs/plugin/USAGE.pl.md'],
  ['docs/plugin/SECURITY.md', 'docs/plugin/SECURITY.pl.md'],
];
const PLUGIN_DOCS: string[] = [
  ...DOC_PAIRS.slice(2).map((pair) => pair[0]),
  ...DOC_PAIRS.slice(2).map((pair) => pair[1]),
];
const FIRST_PAIRS: string[] = DOC_PAIRS.slice(0, 2).flat();
// Tools the documentation already names but the server does not ship yet. Remove a name from
// here when its task lands; the test then requires it in `mcp/dist/tools.json`.
const TOOLS_NOT_SHIPPED_YET = new Set<string>();
// Passages written ahead of their dependencies, each marked `<!-- pending: <id> -->` in both
// languages. Finish a passage, delete its marker and its id here.
const PENDING_MARKERS = new Set<string>();
// Parameter and option names the documentation may put in backticks next to the tool names.
const KNOWN_IDENTIFIERS = new Set([
  'confirm_capped',
  'confirm_protected',
  'api_token',
  'loadcraft_url',
  'api_url',
  'env_vars',
  'demo',
]);
const MOD_COMMANDS = new Set(['loadcraft-panel']);

function doc(path: string): string {
  return readFileSync(join(PACK_ROOT, path), 'utf8');
}

function headings(text: string): number[] {
  const levels: number[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced;
    } else if (!fenced) {
      const match = /^(#{1,6}) \S/.exec(line);
      if (match !== null) levels.push((match[1] ?? '').length);
    }
  }
  return levels;
}

/** Documentation text without fenced code blocks (their lines are checked separately). */
function prose(text: string): string {
  return text.replace(/```.*?```/gs, '');
}

function shippedTools(): Set<string> {
  const data = readJson<{ tools: { name: string }[] }>('mcp', 'dist', 'tools.json');
  return new Set(data.tools.map((tool) => tool.name));
}

describe('PluginDocumentationTestCase', () => {
  it('test_english_and_polish_files_exist_in_pairs_with_the_same_headings', () => {
    for (const [english, polish] of DOC_PAIRS) {
      expect(isFile(join(PACK_ROOT, english)), english).toBe(true);
      expect(isFile(join(PACK_ROOT, polish)), polish).toBe(true);
      expect(headings(doc(english)), english).toEqual(headings(doc(polish)));
    }
  });

  it('test_every_tool_named_in_the_documentation_exists', () => {
    const shipped = shippedTools();
    const known = new Set([...shipped, ...TOOLS_NOT_SHIPPED_YET]);
    const overlap = [...TOOLS_NOT_SHIPPED_YET].filter((name) => shipped.has(name));
    expect(overlap, 'a tool shipped: drop it from TOOLS_NOT_SHIPPED_YET').toEqual([]);
    const mentioned = new Set<string>();
    for (const relativePath of PLUGIN_DOCS) {
      const text = doc(relativePath);
      for (const match of text.matchAll(/mcp__plugin_loadcraft_lc__([\p{L}\p{N}_]+)/gu)) {
        const rule = match[1] ?? '';
        expect(known.has(rule), `${relativePath}: permission rule for unknown tool ${rule}`).toBe(
          true,
        );
        mentioned.add(rule);
      }
      for (const match of prose(text).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        const word = match[1] ?? '';
        expect(
          known.has(word) || KNOWN_IDENTIFIERS.has(word),
          `${relativePath}: unknown name \`${word}\``,
        ).toBe(true);
        mentioned.add(word);
      }
    }
    for (const name of ['run_start', 'process_get_status', 'process_wait']) {
      expect(mentioned.has(name), name).toBe(true);
    }
  });

  it('test_every_command_named_in_the_documentation_exists', () => {
    const commands = new Set<string>();
    for (const name of COMMAND_SKILLS) {
      const text = readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const match = /^name:\s*(\S+)\s*$/m.exec(text);
      if (match === null) throw new Error(`no name in ${name}`);
      commands.add(`loadcraft:${match[1] ?? ''}`);
    }
    for (const command of MOD_COMMANDS) commands.add(command);
    const allowed = new Set([...commands, 'loadcraft-test']);
    const seen = new Set<string>();
    const commandPattern =
      /(?<![\p{L}\p{N}_/.-])\/(loadcraft(?::[a-z]+|-[a-z]+)?)(?![\p{L}\p{N}_/.-])/gu;
    for (const relativePath of [...PLUGIN_DOCS, ...FIRST_PAIRS.slice(0, 2)]) {
      for (const match of doc(relativePath).matchAll(commandPattern)) {
        const command = match[1] ?? '';
        if (command === 'loadcraft') continue;
        expect(allowed.has(command), `${relativePath}: /${command}`).toBe(true);
        seen.add(command);
      }
    }
    for (const command of ['loadcraft:status', 'loadcraft:doctor']) {
      expect(seen.has(command), command).toBe(true);
    }
  });

  it('test_install_guide_states_the_requirements_and_options_from_the_manifest', () => {
    const manifest = readJson<{
      engines: Record<string, string>;
      userConfig: Record<string, unknown>;
    }>('.claude-plugin', 'plugin.json');
    const minimum = (manifest.engines['claude-code'] ?? '').replace(/^>=/, '');
    const node =
      readJson<{ engines: Record<string, string> }>('mcp', 'package.json').engines['node'] ?? '';
    for (const relativePath of ['docs/plugin/INSTALL.md', 'docs/plugin/INSTALL.pl.md']) {
      const text = doc(relativePath);
      expect(text, relativePath).toContain(minimum);
      expect(text, relativePath).toContain(node.replace(/^>=/, ''));
      for (const key of Object.keys(manifest.userConfig)) {
        expect(text, `${relativePath}: option ${key}`).toContain(`\`${key}\``);
      }
    }
  });

  it('test_documentation_has_no_real_looking_token', () => {
    const mdIn = (dir: string, recursive: boolean): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return recursive ? mdIn(path, true) : [];
        return entry.name.endsWith('.md') ? [path] : [];
      });
    const paths = [
      ...mdIn(PACK_ROOT, false),
      ...mdIn(join(PACK_ROOT, 'docs'), true),
      ...mdIn(SKILLS_ROOT, false),
    ];
    for (const path of paths) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/lc_pat_[A-Za-z0-9]{6,}/);
    }
  });

  it('test_documentation_names_no_private_paths_or_planning_documents', () => {
    const forbidden =
      /\/home\/|docs\/plugin-mcp|zadania\/|\bREL-\d+|\bARCH-\d+|\bFIX-\d+|\bTOOL-\d+/;
    for (const relativePath of [...PLUGIN_DOCS, ...DOC_PAIRS.slice(0, 2).flat()]) {
      expect(doc(relativePath), relativePath).not.toMatch(forbidden);
    }
  });

  it('test_relative_links_resolve', () => {
    for (const relativePath of [...PLUGIN_DOCS, ...DOC_PAIRS.slice(0, 2).flat()]) {
      const base = resolve(PACK_ROOT, relativePath, '..');
      const links = prose(doc(relativePath)).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g);
      for (const match of links) {
        const target = match[1] ?? '';
        expect(existsSync(resolve(base, target)), `${relativePath}: ${target}`).toBe(true);
      }
    }
  });

  it('test_pending_passages_are_marked_in_both_languages', () => {
    const found = { en: new Set<string>(), pl: new Set<string>() };
    for (const relativePath of [...PLUGIN_DOCS, ...DOC_PAIRS.slice(0, 2).flat()]) {
      const language = relativePath.endsWith('.pl.md') ? 'pl' : 'en';
      for (const match of doc(relativePath).matchAll(/<!-- pending: ([a-z-]+) -->/g)) {
        found[language].add(match[1] ?? '');
      }
    }
    setsEqual(found.en, PENDING_MARKERS);
    setsEqual(found.pl, PENDING_MARKERS);
  });

  it('test_permission_variants_name_every_server_tool', () => {
    // Every tool of the built server is either allowed by variant B or named as left out on
    // purpose; variant A allows a subset of variant B. A new tool missing from both is a gap.
    const tools = (
      JSON.parse(readFileSync(join(PACK_ROOT, 'mcp', 'dist', 'tools.json'), 'utf8')) as {
        tools: { name: string }[];
      }
    ).tools.map((tool) => tool.name);
    const allowed = (block: string): string[] =>
      [...block.matchAll(/"mcp__plugin_loadcraft_lc__([a-z_]+)"/g)].map((match) => match[1] ?? '');
    for (const relativePath of ['docs/plugin/INSTALL.md', 'docs/plugin/INSTALL.pl.md']) {
      const text = doc(relativePath);
      const blocks = [...text.matchAll(/```json\n(.*?)```/gs)]
        .map((match) => match[1] ?? '')
        .filter((block) => block.includes('"allow"'));
      expect(blocks.length, relativePath).toBe(2);
      const [readsOnly, inside] = blocks.map(allowed);
      const after = text.slice(text.lastIndexOf('"allow"'));
      const leftOut = after.slice(0, after.indexOf('\n## '));
      for (const tool of readsOnly ?? []) expect(inside, `${relativePath}: ${tool}`).toContain(tool);
      for (const tool of tools) {
        expect(
          (inside ?? []).includes(tool) || leftOut.includes(`\`${tool}\``),
          `${relativePath}: ${tool} is neither allowed nor left out`,
        ).toBe(true);
      }
    }
  });

  it('test_install_guide_ends_with_a_codex_heading_for_the_next_edit', () => {
    for (const relativePath of ['docs/plugin/INSTALL.md', 'docs/plugin/INSTALL.pl.md']) {
      const lines = doc(relativePath)
        .split('\n')
        .filter((line) => line.startsWith('## '));
      expect(lines[lines.length - 1], relativePath).toBe('## Codex');
    }
  });

  it('test_mod_guide_is_linked_not_copied', () => {
    for (const [relativePath, modGuide] of [
      ['docs/plugin/INSTALL.md', 'USER.md'],
      ['docs/plugin/INSTALL.pl.md', 'USER.pl.md'],
    ] as const) {
      expect(doc(relativePath), relativePath).toContain(`../../mod/docs/${modGuide}`);
    }
  });
});
