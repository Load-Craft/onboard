// View of `flows_describe_journeys`: the plan handle, the number of paths and who shares the one sign-in on
// the first line, the paths that register their own account (and so start signed out) on the next
// one when there are any, then one line per path (its name, then its steps joined by arrows). When the walk
// has already begun (one path, which LoadCraft does not ask about, or a split approved in the app)
// a sentence says so and names the next step.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';

export interface DescribedPath {
  readonly name: string;
  /** What the browser will do on this path, as the planner wrote it; empty when not known. */
  readonly steps: readonly string[];
  /** The path needs what an earlier path created. */
  readonly dependsOnPrior: boolean;
  /** The path registers its own account, so the shared sign-in skips it. */
  readonly ownIdentity: boolean;
}

export interface DescribeFlowsData {
  /** Handle of the plan, `r-` and the first 8 characters of the run id. */
  readonly plan: string;
  readonly paths: readonly DescribedPath[];
  /** Names of the paths the one shared sign-in runs before; empty when there is none. */
  readonly sharedSignIn: readonly string[];
  /** One path: LoadCraft does not ask about a split, the walk starts at once. */
  readonly single: boolean;
  /** The walk has begun, so there is nothing left to approve. */
  readonly started: boolean;
  /** The env file and the key of the login the browser signs in with; never the values. */
  readonly accountUsed: { readonly file: string; readonly emailKey: string } | null;
  /** The run in LoadCraft (live preview, approval, taking over). */
  readonly link: string;
}

const SEPARATOR = ' · ';
const ARROW = ' → ';
const GAP = 2;
const INDENT = '  ';
/** A longer name does not fit a column; its steps go on the next line. */
const NAME_COLUMN_MAX = 30;

/**
 * `render(names)` with as many of `names` as fit the width, the rest counted as `+N`; never wider
 * than the view, whatever the names.
 */
function fitNames(
  names: readonly string[],
  render: (names: string) => string,
  t: Translator,
): string {
  const shown = names.map((name) => inline(name, NAME_COLUMN_MAX));
  for (let count = shown.length; count >= 0; count -= 1) {
    const rest = shown.length - count;
    const listed = [
      ...shown.slice(0, count),
      ...(rest === 0 ? [] : [t('describe.more', { count: rest })]),
    ].join(', ');
    const line = render(listed);
    if (visibleWidth(line) <= VIEW_WIDTH) return line;
  }
  return render(t('describe.more', { count: shown.length }));
}

function headLines(data: DescribeFlowsData, t: Translator): string[] {
  const head = [
    t('describe.plan', { plan: inline(data.plan) }),
    t.plural('describe.paths', data.paths.length),
  ].join(SEPARATOR);
  const lines = [head];
  const shared = data.sharedSignIn;
  if (shared.length === data.paths.length && shared.length > 0) {
    lines[0] = `${head}${SEPARATOR}${t('describe.sharedSignIn.all')}`;
  } else if (shared.length > 0) {
    lines[0] = fitNames(
      shared,
      (names) => `${head}${SEPARATOR}${t('describe.sharedSignIn.some', { names })}`,
      t,
    );
  }
  // A path that registers its own account starts signed out: the model must not expect a sign-in.
  const own = data.paths.filter((path) => path.ownIdentity).map((path) => path.name);
  if (own.length > 0) lines.push(fitNames(own, (names) => t('describe.ownIdentity', { names }), t));
  return lines;
}

function stepsText(path: DescribedPath, t: Translator): string {
  const parts = [path.steps.map((step) => inline(step)).join(ARROW)];
  if (path.dependsOnPrior) parts.push(t('describe.dependsOnPrior'));
  return parts.filter((part) => part !== '').join(SEPARATOR);
}

function pathLines(data: DescribeFlowsData, t: Translator): string[] {
  const paths = data.paths.map((path) => ({ ...path, name: inline(path.name, VIEW_WIDTH) }));
  const inColumn = paths.filter((path) => visibleWidth(path.name) <= NAME_COLUMN_MAX);
  const nameWidth = Math.max(0, ...inColumn.map((path) => visibleWidth(path.name)));
  return paths.flatMap((path) => {
    const text = stepsText(path, t);
    if (text === '') return [path.name];
    if (visibleWidth(path.name) > NAME_COLUMN_MAX) {
      return [path.name, ...wrap(text, VIEW_WIDTH - INDENT.length).map((line) => INDENT + line)];
    }
    const [first = '', ...rest] = wrap(text, VIEW_WIDTH - nameWidth - GAP);
    const gap = ' '.repeat(nameWidth - visibleWidth(path.name) + GAP);
    const hang = ' '.repeat(nameWidth + GAP);
    return [`${path.name}${gap}${first}`, ...rest.map((line) => hang + line)];
  });
}

export function renderDescribeFlows(data: DescribeFlowsData, t: Translator): string {
  const lines = [...headLines(data, t), ...pathLines(data, t)];
  if (data.started) {
    lines.push(...wrap(t(data.single ? 'describe.started.single' : 'describe.started.approved')));
    lines.push(`→ ${t('describe.next', { plan: inline(data.plan) })}`);
  }
  return lines.join('\n');
}
