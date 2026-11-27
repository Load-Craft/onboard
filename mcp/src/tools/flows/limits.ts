// Limits of `flows_generate_from_suggestions` that another reader needs as well: the panel of the mod lets the user mark at
// most as many proposals as one call takes. A module with no imports, so the mod can take it alone.

/** LoadCraft takes at most this many proposals in one run of `flows_generate_from_suggestions`. */
export const MAX_SUGGESTIONS = 50;
