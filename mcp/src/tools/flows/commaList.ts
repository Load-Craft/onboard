// A list a tool takes as one comma-separated text (the catalog has no list argument without a fixed
// set of values): split, trimmed, empty items dropped, repeats kept once, in the order given.

/** The items of `text`; none when it is absent or holds only separators. */
export function commaList(text: string | undefined): string[] {
  if (text === undefined) return [];
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}
