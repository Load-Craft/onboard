// The stored artifact of a scenario or of one of its versions, as a view may show it: a recorded
// body, so it passes `body` (masked, or hidden whole when the mask cannot read its format) and is
// cut at a fixed length. Shared by `scenario_get` and `scenario_get_versions`.

import type { ArtifactView } from '../../render/scenario/get.js';
import { body, type CallContext } from '../moduleCall.js';

const ARTIFACT_LIMIT = 6000;

export function artifactOf(
  ctx: CallContext,
  artifact: Readonly<Record<string, unknown>> | null,
): ArtifactView {
  if (artifact === null) return { kind: 'none' };
  // The artifact is what LoadCraft generated (its plan, its code), read as its own documentation.
  const shown = body(ctx, JSON.stringify(artifact), 'application/json', 'response', {
    documentation: true,
  });
  if (shown.kind === 'hidden') return shown;
  const cut = shown.text.length > ARTIFACT_LIMIT;
  return {
    kind: 'shown',
    text: cut ? shown.text.slice(0, ARTIFACT_LIMIT) : shown.text,
    truncated: cut,
  };
}
