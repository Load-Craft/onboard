// `process_set_choices` (module process): Set user decisions (flow method, journeys, traffic split,
// environment, load profile, run target) that module tools use as defaults.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the view.
// The tool sends no request: it writes the `choices` of the process state through the `update` of its
// outcome (the reducer merges, validates and invalidates). The groups, the fields and their
// validation are the state schema's (`ProcessUpdate`), read here, never listed by hand; a field set
// to null is cleared. The previous values of the changed fields are the undo (`update.log.undo_args`).
// Log: args "{keys}" (`update.log.values`: every path given), result "{changed}": the data carries
// `changed`.
// Arguments: choices (the groups of the state schema).

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { renderSetChoices, type SetChoicesData } from '../../render/process/setChoices.js';
import { ProcessUpdate } from '../../workspace/processState.js';
import { maskText } from '../../security/traceMask.js';
import { content } from '../moduleCall.js';
import { moduleTool } from '../moduleTool.js';
import { PROCESS_SET_CHOICES } from './meta.generated.js';

type Shape = Readonly<Record<string, z.ZodType>>;

/** The fields of one group of `choices`, each also accepting null (clear it), from the state schema. */
function groupInput(group: z.ZodType): z.ZodType {
  // a group of the state schema is `optional(default(strict object))`
  const fields = (group as z.ZodOptional<z.ZodDefault<z.ZodObject<Shape>>>).unwrap().unwrap().shape;
  return z
    .strictObject(
      Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.nullable()])),
    )
    .optional();
}

const groups: Shape = ProcessUpdate.shape.choices.unwrap().shape;
const choicesInput = z.strictObject(
  Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, groupInput(group)])),
);

type Given = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
type Stored = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const processSetChoices = moduleTool(PROCESS_SET_CHOICES, {
  title: 'Set user decisions',
  input: {
    choices: choicesInput.describe(
      'The decisions to set, by group (flows, scenario, run, data, functional) and field, for ' +
        'example {"flows":{"method":"har"}}; a field set to null is cleared.',
    ),
  },
  run(ctx, args) {
    const given: Given = args.choices as Given;
    const stored: Stored = ctx.state.process()?.choices ?? {};
    // choices stay in the workspace state in the clear: a value the secret mask would change is not saved
    for (const [group, fields] of Object.entries(given)) {
      for (const [field, value] of Object.entries(fields ?? {})) {
        const text = JSON.stringify(value);
        if (maskText(ctx.secrets.scrub(text)).text !== text) {
          // learns the secret, so the log of this refused call masks it too
          content(ctx, text, 10);
          throw new ToolError('invalid_arguments', {
            message: `${group}.${field} looks like a secret; choices are saved in the workspace state, name a file instead`,
            params: { rule: 'choices_secret', path: `${group}.${field}` },
          });
        }
      }
    }
    const paths: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];
    const next: Record<string, Record<string, unknown>> = {};
    const previous: Record<string, Record<string, unknown>> = {};
    const set: Record<string, string> = {};
    const cleared: string[] = [];
    for (const [group, fields] of Object.entries(given)) {
      for (const [field, value] of Object.entries(fields ?? {})) {
        const path = `${group}.${field}`;
        paths.push(path);
        const before = stored[group]?.[field];
        const wanted = value === null ? undefined : value;
        if (same(before, wanted)) {
          unchanged.push(path);
          continue;
        }
        changed.push(path);
        (next[group] ??= {})[field] = wanted;
        (previous[group] ??= {})[field] = before === undefined ? null : before;
        if (wanted === undefined) cleared.push(path);
        else set[path] = content(ctx, JSON.stringify(wanted), 300);
      }
    }
    if (paths.length === 0) {
      throw new ToolError('invalid_arguments', {
        message: 'send at least one field of choices, for example flows.method',
        params: { rule: 'choices_empty' },
      });
    }
    // masking the values registers what the mask finds in them, before the check below
    for (const group of Object.values(previous)) content(ctx, JSON.stringify(group), 2000);
    const undoable =
      changed.length > 0 &&
      Object.values(previous).every((group) => {
        const text = JSON.stringify(group);
        return ctx.secrets.scrub(text) === text;
      });
    const data: SetChoicesData = { changed, unchanged, set, cleared, undoable };
    const logValues = { keys: paths.join(', ') };
    if (changed.length === 0) {
      return Promise.resolve({
        status: 'done' as const,
        data,
        inert: true as const,
        update: { log: { values: logValues } },
      });
    }
    return Promise.resolve({
      status: 'done' as const,
      data,
      update: {
        choices: next,
        log: { values: logValues, ...(undoable ? { undo_args: { choices: previous } } : {}) },
      },
    });
  },
  render: renderSetChoices,
});
