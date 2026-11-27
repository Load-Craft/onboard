// Layout constants of the `flows_suggest_journeys` view, in a file of their own with no imports: the
// view draws with them and the live gate (`scripts/live-gate.ts`, which node runs without a
// build) reads the drawn text back with the same numbers.

/** Indent of a continuation line under a name that does not fit the name column. */
export const INDENT = '  ';
/** Spaces between the name column and the steps. */
export const GAP = 3;
/** A longer name does not fit a column; its steps go on the next line. */
export const NAME_COLUMN_MAX = 30;
/** Between two steps of a proposal. */
export const ARROW = ' → ';
/** Between the steps of a proposal whose order the generator sets when it builds. */
export const SET_SEPARATOR = ' · ';
/** Most entries (proposals, the ladder counting as one) the view lists. */
export const SHOWN_ENTRIES = 25;
