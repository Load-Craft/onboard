// The user's word is `dataset`. The backend's word `feeder` lives only in the client code (routes,
// field names, i18n keys): no tool description, parameter description or dictionary text says it.

import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { en } from '../src/render/i18n/en.js';
import { paneEn, panePl } from '../src/render/i18n/pane.js';
import { pl } from '../src/render/i18n/pl.js';
import { ALL_TOOLS } from '../src/tools/index.js';

const FEEDER = /feeder/iu;

/** Argument names are client code the model must type (`feeder_bindings`); a text may name them. */
const ARGUMENT_NAMES = [
  ...new Set(
    ALL_TOOLS.flatMap((tool) =>
      Object.keys((z.toJSONSchema(tool.input) as { properties?: object }).properties ?? {}),
    ).filter((name) => FEEDER.test(name)),
  ),
];

function withoutArgumentNames(text: string): string {
  return ARGUMENT_NAMES.reduce((rest, name) => rest.split(name).join(''), text);
}

/** Every text of a value: strings, the forms of a plural, nested descriptions. */
function texts(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((item, i) => texts(item, `${path}[${String(i)}]`, out));
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) texts(item, `${path}.${key}`, out);
  }
  return out;
}

describe('the word feeder stays in the client code', () => {
  it('no tool says it in its title, description or the descriptions of its parameters', () => {
    const said = ALL_TOOLS.flatMap((tool) => [
      ...texts({ title: tool.title, description: tool.description }, tool.name),
      ...texts(z.toJSONSchema(tool.input), `${tool.name}.input`).filter(([path]) =>
        path.endsWith('.description'),
      ),
    ]).filter(([, text]) => FEEDER.test(text));
    expect(said).toEqual([]);
  });

  it('no dictionary text says it, in either language', () => {
    const said = [
      ...texts(en, 'en'),
      ...texts(pl, 'pl'),
      ...texts(paneEn, 'paneEn'),
      ...texts(panePl, 'panePl'),
    ].filter(([, text]) => FEEDER.test(withoutArgumentNames(text)));
    expect(said).toEqual([]);
  });

  it('lets a text name an argument, but not use the word beside it (guards the exemption)', () => {
    expect(ARGUMENT_NAMES).toContain('feeder_bindings');
    expect(FEEDER.test(withoutArgumentNames('pass feeder_bindings'))).toBe(false);
    expect(FEEDER.test(withoutArgumentNames('pass feeder_bindings to the feeder'))).toBe(true);
  });

  it('finds the word where it is (guards the guard)', () => {
    expect(
      texts({ a: { one: 'x', other: 'Feeders' } }, 'd').filter(([, t]) => FEEDER.test(t)),
    ).toEqual([['d.a.other', 'Feeders']]);
  });
});
