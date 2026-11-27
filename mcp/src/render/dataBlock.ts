// The data of a view as one JSON block, for a client that reads facts instead of a view (a mod
// calls the tool with `format: "data"` and parses the whole text). The registry scrubs the text
// like any other, so the token cannot travel in it.

import * as z from 'zod';

/** The `format` input of a tool that can answer with its data: the view, or one JSON block. */
export const formatInput = z
  .enum(['text', 'data'])
  .default('text')
  .describe(
    'Read-only choice of the answer: "text" (default) is the view; "data" is the same facts as ' +
      'one JSON block, for a client that parses them.',
  );

export type ResultFormat = z.infer<typeof formatInput>;

/** `{"a":1}` on one line: the whole text of a result in `data` format. */
export function renderDataBlock(data: unknown): string {
  return JSON.stringify(data);
}
