/**
 * Addresses of LoadCraft app screens. The backend does not build frontend
 * URLs, so this is the single place in the MCP server that does.
 *
 * Routes mirror the frontend router (project-scoped, non-redirecting only).
 */

import type { Link, LinkKey } from './outcome.js';

export const RESULTS_TABS = [
  'Overview',
  'Response Times',
  'Errors',
  'Requests',
  'Traces',
  'Diagnostics',
  'Gatling report',
  'AI analysis',
] as const;

export type ResultsTab = (typeof RESULTS_TABS)[number];

export interface Links {
  projectProfile(pid: string): Link;
  flow(pid: string, flowId: string): Link;
  describeRun(pid: string, runId: string): Link;
  harImport(pid: string): Link;
  composition(pid: string, cid: string): Link;
  scenario(pid: string, sid: string): Link;
  feeders(pid: string): Link;
  executionLive(pid: string, eid: string): Link;
  executionResults(pid: string, eid: string, tab?: ResultsTab): Link;
  compare(pid: string, a: string, b: string): Link;
  /** The list of projects, where a project is deleted. */
  projects(): Link;
  /** The flows of a project, where flows are deleted. */
  flows(pid: string): Link;
}

const enc = encodeURIComponent;

export function createLinks(appUrl: string): Links {
  const base = appUrl.replace(/\/+$/, '');
  const project = (pid: string, path: string): string => `${base}/projects/${enc(pid)}${path}`;
  const link = (labelKey: LinkKey, url: string, showLabel = false): Link =>
    showLabel ? { labelKey, url, showLabel } : { labelKey, url };

  return {
    projectProfile: (pid) =>
      link('link.projectProfile', project(pid, '/settings#application-profile')),
    flow: (pid, flowId) => link('link.flow', project(pid, `/flows/${enc(flowId)}`)),
    describeRun: (pid, runId) =>
      link('link.describeRun', project(pid, `/scenario-from-description/runs/${enc(runId)}`), true),
    harImport: (pid) => link('link.harImport', project(pid, '/har-import')),
    composition: (pid, cid) =>
      link('link.composition', project(pid, `/gatling/compositions/${enc(cid)}`)),
    scenario: (pid, sid) => link('link.scenario', project(pid, `/gatling/scenarios/${enc(sid)}`)),
    feeders: (pid) => link('link.feeders', project(pid, '/gatling/feeders')),
    executionLive: (pid, eid) =>
      link('link.executionLive', project(pid, `/gatling/executions/${enc(eid)}/live`)),
    executionResults: (pid, eid, tab) =>
      link(
        'link.executionResults',
        project(
          pid,
          `/gatling/executions/${enc(eid)}${tab === undefined ? '' : `?tab=${enc(tab)}`}`,
        ),
      ),
    compare: (pid, a, b) =>
      link('link.compare', project(pid, `/gatling/executions/compare?compare=${enc(a)},${enc(b)}`)),
    projects: () => link('link.projects', `${base}/projects`, true),
    flows: (pid) => link('link.flows', project(pid, '/flows'), true),
  };
}
