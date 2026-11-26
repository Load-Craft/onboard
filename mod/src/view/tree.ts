/**
 * The drawings of the mod as plain data: a tree of `Box` and `Text` that `toElements` turns into
 * the elements `$.ui.resolve(e)` hands a `ui.render` hook. Keeping the tree apart from the
 * elements keeps every drawing a pure function (no `$`, no clock) that a test can read as text.
 *
 * Colors are theme keys only (they follow the user's theme, light or dark).
 */

import { inline } from '../../../mcp/src/render/primitives.js';

export type ThemeColor = 'success' | 'error' | 'warning' | 'suggestion' | 'inactive' | 'claude';

export interface TextProps {
  readonly color?: ThemeColor;
  readonly bold?: true;
  readonly dimColor?: true;
  readonly wrap?: 'wrap' | 'truncate-end';
}

export interface BoxProps {
  readonly flexDirection?: 'row' | 'column';
  readonly columnGap?: number;
  readonly paddingLeft?: number;
}

export interface TreeText {
  readonly type: 'Text';
  readonly props: TextProps;
  readonly children: readonly string[];
}

export interface TreeBox {
  readonly type: 'Box';
  readonly props: BoxProps;
  readonly children: readonly TreeNode[];
}

export type TreeNode = TreeText | TreeBox;

/** What a drawing needs to know about the place it is drawn in. */
export interface DrawContext {
  readonly locale: 'en' | 'pl';
  /** Columns the drawing may use. */
  readonly width: number;
  /** `terminal`, `desktop` or `vscode`; any other surface gets no drawing. */
  readonly surface: string;
}

/**
 * The longest piece of text one element of a drawing holds, in grapheme clusters. The texts come
 * from data the mod does not control (a name a customer chose, a message of the tested system), and
 * a drawing is a summary: what is longer ends in `…`, the full text stays in the result (ctrl+o).
 */
export const MAX_TEXT = 1_000;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `content`, cut to `MAX_TEXT` grapheme clusters (the last one `…`) when it is longer. */
export function bounded(content: string): string {
  if (content.length <= MAX_TEXT) return content;
  // A cluster is at least one code unit, so the cut never needs more than this much of the text.
  const head = content.slice(0, MAX_TEXT * 8);
  const parts = Array.from(segmenter.segment(head), (part) => part.segment);
  if (parts.length <= MAX_TEXT && head.length === content.length) return content;
  return `${parts.slice(0, MAX_TEXT - 1).join('')}…`;
}

/**
 * `inline(value, limit)` (one clean line, cut with `…`) that reads no more of a long value than the
 * cut needs: a value of megabytes costs what one of `limit` clusters does.
 */
export function short(value: string, limit: number): string {
  return inline(value.length > limit * 8 ? value.slice(0, limit * 8) : value, limit);
}

export const text = (content: string, props: TextProps = {}): TreeText => ({
  type: 'Text',
  props,
  children: [bounded(content)],
});

export const box = (props: BoxProps, children: readonly TreeNode[]): TreeBox => ({
  type: 'Box',
  props,
  children,
});

export const column = (children: readonly TreeNode[]): TreeBox =>
  box({ flexDirection: 'column' }, children);

export const row = (children: readonly TreeNode[], columnGap = 2): TreeBox =>
  box({ flexDirection: 'row', columnGap }, children);

/** The text of a tree, one line per `Text` in a column and cells side by side in a row. */
export function textOf(node: TreeNode): string {
  if (node.type === 'Text') return node.children.join('');
  const parts = node.children.map(textOf);
  return node.props.flexDirection === 'row' ? parts.join('  ') : parts.join('\n');
}

export interface TreeSize {
  /** Elements and text children, as Claude Code counts them (limit 20 000). */
  readonly elements: number;
  /** Characters of text (limit 100 000). */
  readonly characters: number;
  /** Levels below the root element (limit 32). */
  readonly depth: number;
}

export function sizeOf(node: TreeNode): TreeSize {
  if (node.type === 'Text') {
    const characters = node.children.reduce((sum, child) => sum + child.length, 0);
    return { elements: 1 + node.children.length, characters, depth: 1 };
  }
  const sizes = node.children.map(sizeOf);
  return {
    elements: 1 + sizes.reduce((sum, size) => sum + size.elements, 0),
    characters: sizes.reduce((sum, size) => sum + size.characters, 0),
    depth: 1 + Math.max(0, ...sizes.map((size) => size.depth)),
  };
}

/** The element functions `$.ui.resolve(e)` returns, as far as the drawings use them. */
export interface Elements {
  Box(props: Record<string, unknown>): unknown;
  Text(props: Record<string, unknown>): unknown;
}

/** Builds the elements of a tree. `$` is not needed: the caller passes the resolved functions. */
export function toElements(elements: Elements, node: TreeNode): unknown {
  if (node.type === 'Text') {
    return elements.Text({ ...node.props, children: [...node.children] });
  }
  return elements.Box({
    ...node.props,
    children: node.children.map((child) => toElements(elements, child)),
  });
}

// ---- reading data of a shape the mod does not control ------------------------------------

export type Dict = Readonly<Record<string, unknown>>;

export function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
