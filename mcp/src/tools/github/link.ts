// The link of a project to a GitHub repository, as the tools that act on the repository need it.

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { CallContext } from '../moduleCall.js';
import { getGithubStatus } from './getStatus.js';

/**
 * The project must be linked to a repository before a push is planned: without a link the backend
 * answers a plan with a plain "not found", which says nothing of the link, and a missing composition
 * would be asked for first. A status the backend cannot give does not stop the plan (the preview then
 * answers for itself); only a link it says is missing does.
 */
export function isLinked(status: Awaited<ReturnType<typeof getGithubStatus>>): boolean {
  return (
    status.connected &&
    status.sync_status !== 'not_configured' &&
    typeof status.repo_url === 'string' &&
    status.repo_url.trim() !== ''
  );
}

export async function requireGithubLink(
  ctx: CallContext,
  projectId: string,
  /** What the tool needs the repository for: the refusal says it (`push`: somewhere to push to, `read`: somewhere to read from). */
  purpose: 'push' | 'read',
): Promise<void> {
  let status: Awaited<ReturnType<typeof getGithubStatus>>;
  try {
    status = await getGithubStatus(ctx, { project_id: projectId });
  } catch (error) {
    if (error instanceof LoadcraftApiError) return;
    throw error;
  }
  if (!isLinked(status)) throw new ToolError('github_not_linked', { params: { rule: purpose } });
}
