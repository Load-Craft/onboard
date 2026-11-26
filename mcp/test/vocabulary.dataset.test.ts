// The user's word is `dataset`. The backend's word `feeder` lives only in the client code (routes,
// field names, i18n keys): no tool description, parameter description or dictionary text says it.

import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { en } from '../src/render/i18n/en.js';
import { paneEn, panePl } from '../src/render/i18n/pane.js';
import { pl } from '../src/render/i18n/pl.js';
import { ALL_TOOLS } from '../src/tools/index.js';

const FEEDER = /feeder/iu;

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
    ].filter(([, text]) => FEEDER.test(text));
    expect(said).toEqual([]);
  });

  it('finds the word where it is (guards the guard)', () => {
    expect(
      texts({ a: { one: 'x', other: 'Feeders' } }, 'd').filter(([, t]) => FEEDER.test(t)),
    ).toEqual([['d.a.other', 'Feeders']]);
  });
});
