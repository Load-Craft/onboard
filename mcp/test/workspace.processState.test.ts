import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_KEY, State } from '../src/workspace/processState.js';

const schemaPath = new URL('../src/workspace/processState.ts', import.meta.url);
const catalogPath = new URL('../catalog/stan-procesu.ts', import.meta.url);
const digestPath = new URL('../catalog/stan-procesu.sha256', import.meta.url);

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

const PROJECT = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-01-01T00:00:00.000Z';

function steps(): Record<string, { status: string; checks: Record<string, never> }> {
  const out: Record<string, { status: string; checks: Record<string, never> }> = {};
  for (const m of [
    'project',
    'flows',
    'scenario',
    'data',
    'run',
    'results',
    'functional',
    'traffic',
    'github',
  ]) {
    out[m] = { status: 'todo', checks: {} };
  }
  return out;
}

function proc(ids: Record<string, unknown>): Record<string, unknown> {
  return { rev: 0, updated_at: NOW, step: 'project', ids, steps: steps() };
}

function state(processMap: Record<string, unknown>): unknown {
  return { schema: 3, process: processMap };
}

describe('schemat stanu procesu', () => {
  it('jest bajt w bajt kopią pliku z katalogu', () => {
    expect(readFileSync(schemaPath).equals(readFileSync(catalogPath))).toBe(true);
  });

  it('odcisk SHA-256 pliku zgadza się z zapisanym w katalogu', () => {
    const recorded = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] ?? '';
    expect(sha(readFileSync(schemaPath))).toBe(recorded);
  });

  it('zmiana jednego bajta zmienia odcisk (mutacja)', () => {
    const bytes = Buffer.from(readFileSync(schemaPath));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const recorded = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] ?? '';
    expect(sha(bytes)).not.toBe(recorded);
  });

  it('nie importuje niczego poza zod', () => {
    const src = readFileSync(schemaPath, 'utf8');
    const specs = [
      ...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gms),
    ].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['zod']));
    expect(src).not.toMatch(/\brequire\(|import\(/);
  });

  it('przyjmuje przykładowy stan z procesem projektu', () => {
    const parsed = State.parse(state({ [PROJECT]: proc({ project_id: PROJECT }) }));
    expect(parsed.process[PROJECT]?.ids.flow_ids).toEqual([]);
  });

  it('klucz _new bez ids.project_id przechodzi', () => {
    expect(State.safeParse(state({ [NEW_KEY]: proc({}) })).success).toBe(true);
  });

  it('klucz projektu bez ids.project_id nie przechodzi', () => {
    expect(State.safeParse(state({ [PROJECT]: proc({}) })).success).toBe(false);
  });

  it('ids.project_id złego typu nie przechodzi', () => {
    // pod kluczem _new nie działa kontrola zgodności klucza, więc odrzuca wyłącznie walidacja ids.project_id
    expect(State.safeParse(state({ [NEW_KEY]: proc({ project_id: 42 }) })).success).toBe(false);
    expect(State.safeParse(state({ [NEW_KEY]: proc({ project_id: 'nie-uuid' }) })).success).toBe(
      false,
    );
  });

  it('nieznany klucz w procesie albo w ids nie przechodzi (strictObject)', () => {
    expect(
      State.safeParse(state({ [PROJECT]: { ...proc({ project_id: PROJECT }), extra: 1 } })).success,
    ).toBe(false);
    expect(
      State.safeParse(state({ [PROJECT]: proc({ project_id: PROJECT, extra: 1 }) })).success,
    ).toBe(false);
  });
});
