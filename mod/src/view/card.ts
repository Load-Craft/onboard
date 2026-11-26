/**
 * The card above the prompt as plain data, and the block of the panel that lists every card. Pure:
 * no `$`, no clock, no exception. `register.ts` turns the tree into the elements `$.ui.resolve(e)`
 * hands out (`cardElements`); a press hands the digit of the action to `press`.
 *
 * Colours are theme keys only. The row never holds more than a frame, a title, two lines and one
 * row of actions, so it takes a few lines of the band and leaves room for the rows of other mods.
 */

import { cardTexts } from '../card/texts.js';
import type { Card } from '../card/queue.js';
import type { Locale } from '../i18n.js';
import { text, type Elements, type TextProps, type TreeNode, type TreeText } from './tree.js';

export interface CardBoxProps {
  readonly flexDirection: 'row' | 'column';
  readonly columnGap?: number;
  readonly borderStyle?: 'round';
  readonly borderColor?: 'inactive';
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
}

export interface CardButton {
  readonly type: 'Button';
  readonly key: string;
  readonly label: string;
  /** The digit of the action; also the hotkey, where the surface has hotkeys. */
  readonly digit: '0' | '1' | '2';
  readonly hotkey?: string;
  readonly plain: true;
}

export interface CardBox {
  readonly type: 'Box';
  readonly props: CardBoxProps;
  readonly children: readonly CardNode[];
}

export type CardNode = TreeText | CardBox | CardButton;

export interface CardContext {
  readonly locale: Locale;
  /** Columns the band's tree is laid out in (`bodyColumns`). */
  readonly width: number;
  /** `terminal`, `desktop`; VS Code buttons have no hotkeys. */
  readonly surface: string;
}

/** Frame (2 columns) and padding (2). */
const CHROME = 4;
const GAP = 2;

const titleProps = (card: Card): TextProps => ({
  bold: true,
  color: card.priority <= 1 ? 'error' : card.priority >= 4 ? 'success' : 'warning',
  wrap: 'truncate-end',
});

/** The width of `1: label` as the terminal draws a plain button. */
const widthOf = (digit: string, label: string): number => [...`${digit}: ${label}`].length;

/**
 * The actions that fit `inner` columns beside the counter: all of them; else the first and the one
 * that closes; else the first alone. The first is the main action, the last closes.
 */
function fitting(card: Card, inner: number, extra: number): Card['actions'] {
  const all = card.actions;
  const span = (list: Card['actions']): number =>
    list.reduce((sum, a, i) => sum + widthOf(a.digit, a.label) + (i > 0 ? GAP : 0), 0) + extra;
  if (span(all) <= inner) return all;
  const first = all[0];
  const last = all.at(-1);
  if (first !== undefined && last !== undefined && first !== last) {
    const pair = [first, last];
    if (span(pair) <= inner) return pair;
  }
  return first === undefined ? [] : [first];
}

/** The card as a framed box: title, up to two lines, then the actions under their digits. */
export function cardTree(card: Card, context: CardContext & { readonly waiting: number }): CardBox {
  const t = cardTexts(context.locale);
  const inner = Math.max(1, context.width - CHROME);
  const counter = context.waiting > 0 ? t('card.queue', { count: context.waiting }) : undefined;
  const extra = counter === undefined ? 0 : GAP + [...counter].length;
  const shown = fitting(card, inner, extra);
  const buttons: CardButton[] = shown.map((action) => ({
    type: 'Button',
    key: `card-${action.digit}`,
    label: action.label,
    digit: action.digit,
    ...(context.surface === 'vscode' ? {} : { hotkey: action.digit }),
    plain: true,
  }));
  return {
    type: 'Box',
    props: {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'inactive',
      paddingLeft: 1,
      paddingRight: 1,
    },
    children: [
      text(card.title, titleProps(card)),
      ...card.lines.slice(0, 2).map((line) => text(line, { dimColor: true, wrap: 'truncate-end' })),
      {
        type: 'Box',
        props: { flexDirection: 'row', columnGap: GAP },
        children: [
          ...buttons,
          ...(counter === undefined ? [] : [text(counter, { dimColor: true })]),
        ],
      },
    ],
  };
}

/** The buttons of the tree are the elements' `Button`; a press says which digit was pressed. */
export interface CardElements extends Elements {
  Button(props: Record<string, unknown>): unknown;
}

export function cardElements(
  elements: CardElements,
  node: CardNode,
  press: (digit: CardButton['digit']) => unknown,
): unknown {
  switch (node.type) {
    case 'Text':
      return elements.Text({ ...node.props, children: [...node.children] });
    case 'Box':
      return elements.Box({
        ...node.props,
        children: node.children.map((child) => cardElements(elements, child, press)),
      });
    case 'Button':
      return elements.Button({
        key: node.key,
        label: node.label,
        ...(node.hotkey === undefined ? {} : { hotkey: node.hotkey }),
        plain: node.plain,
        onPress: () => press(node.digit),
      });
  }
}

/** Cards the panel lists at most. */
const MAX_LISTED = 8;

/** A press in the notices block: close the card with this key (for good, like `0` on the card). */
export interface CardCloseAction {
  readonly kind: 'card.close';
  readonly key: string;
}

/** The close button of a listed card; it is a button of the panel (`PaneButton`) with this action. */
export interface NoticeButton {
  readonly type: 'Button';
  readonly key: string;
  readonly label: string;
  readonly action: CardCloseAction;
  readonly plain: true;
  readonly dimColor: true;
}

export interface NoticeRow {
  readonly type: 'Box';
  readonly props: { readonly flexDirection: 'row'; readonly columnGap: number };
  readonly children: readonly (TreeText | NoticeButton)[];
}

/**
 * The block of the panel with every card, one line each and a button that closes it: the place to
 * read a card, and to close it, when the band is collapsed or the surface has none. Empty when there
 * is no card.
 */
export function noticesBlock(cards: readonly Card[], locale: Locale): (TreeNode | NoticeRow)[] {
  if (cards.length === 0) return [];
  const t = cardTexts(locale);
  return [
    text(t('card.panel.title'), { bold: true }),
    ...cards.slice(0, MAX_LISTED).map((card, index): NoticeRow => ({
      type: 'Box',
      props: { flexDirection: 'row', columnGap: GAP },
      children: [
        text(`• ${[card.title, ...card.lines.slice(0, 1)].join(' — ')}`, {
          wrap: 'truncate-end',
        }),
        {
          type: 'Button',
          key: `notice-close-${index}`,
          label: t('card.action.close'),
          action: { kind: 'card.close', key: card.key },
          plain: true,
          dimColor: true,
        },
      ],
    })),
    text(' '),
  ];
}
