// `flows_import_har`: sends a browser recording (HAR) to LoadCraft and reports what it found in it. The
// upload and the analysis are two long synchronous calls, so the tool reports elapsed time while
// it waits. A recording is remembered by its content for as long as the backend keeps the session,
// so the same file sent again costs no request. Recordings carry the session of the person who
// made them: only counts and names reach the result and the state file.

import * as z from 'zod';

import {
  analyzeHar,
  fingerprintHar,
  getDefaultEnvironment,
  uploadHar,
  type HarAnalysis,
  type HarUpload,
} from '../api/har.js';
import { getCompat } from '../api/status.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { defineTool } from '../registry.js';
import { renderImportHar, type HarWarning, type ImportHarData } from '../render/views/importHar.js';
import { createResolver } from '../resolve/handles.js';
import { MIN_SECRET_LENGTH } from '../security/mask.js';
import { isSecretField, secretFieldValues } from '../security/secretFields.js';
import { openAllowed, readBytesAllowed, type AllowedFile } from '../workspace/uploads.js';
import { content } from './moduleCall.js';

/** The backend keeps a HAR session for 2 h; the plugin trusts 110 min. */
const SESSION_TTL_MS = 110 * 60_000;
/** A gateway failure after at least this long comes from a proxy with the default 60 s limit. */
const PROXY_LIMIT_MS = 55_000;
const PROXY_STATUS_CODES: ReadonlySet<string> = new Set(['gateway_timeout', 'bad_gateway']);
const TICK_MS = 1000;
/** Names and variables shown in full; the rest is counted. */
const LISTED = 10;
/**
 * A correlation is accepted automatically above this confidence
 * (`confidence_level`, as the frontend's correlation preview reads it).
 */
const ACCEPTED_ABOVE = 0.8;

const input = z.object({
  file: z
    .string()
    .min(1)
    .describe('Path of the .har recording, relative to the project directory.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

type StoredData = Omit<ImportHarData, 'reused'>;

const storedSchema = z.object({
  sessionId: z.string(),
  data: z.object({
    sizeBytes: z.number(),
    entries: z.number(),
    filtered: z.number(),
    auth: z.object({
      detected: z.string().nullable(),
      endpoint: z.object({ method: z.string(), path: z.string() }).optional(),
    }),
    baseUrl: z.object({ host: z.string(), environment: z.string().nullable() }),
    paths: z.array(z.string()),
    morePaths: z.number(),
    correlations: z.object({
      accepted: z.number(),
      uncertain: z.array(z.object({ variable: z.string(), confidence: z.number() })),
      moreUncertain: z.number(),
      ambiguous: z.array(z.object({ variable: z.string() })),
      moreAmbiguous: z.number(),
    }),
    warnings: z.array(
      z.object({
        kind: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    ),
  }),
});

/**
 * Runs `work` and reports `<label> <seconds> s` once a second until it settles; the seconds are
 * counted by the call's clock, so a test moves them.
 */
async function withElapsed<T>(
  ctx: ToolContext,
  key: 'importHar.progress.upload' | 'importHar.progress.analyze',
  work: () => Promise<T>,
): Promise<T> {
  const started = ctx.clock.now();
  const stop = new AbortController();
  const ticking = (async (): Promise<void> => {
    for (;;) {
      const seconds = Math.floor((ctx.clock.now() - started) / 1000);
      ctx.progress.report(ctx.t(key, { seconds }));
      try {
        await ctx.clock.sleep(TICK_MS, stop.signal);
      } catch {
        return;
      }
    }
  })();
  try {
    return await work();
  } finally {
    stop.abort();
    await ticking;
  }
}

/** A gateway failure after about a minute is the proxy's time limit, not LoadCraft's. */
async function timed<T>(ctx: ToolContext, work: () => Promise<T>): Promise<T> {
  const started = ctx.clock.now();
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof LoadcraftApiError &&
      PROXY_STATUS_CODES.has(error.code) &&
      ctx.clock.now() - started >= PROXY_LIMIT_MS
    ) {
      throw new ToolError('har_proxy_timeout', { params: { status: error.status }, cause: error });
    }
    throw error;
  }
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Largest confidence per variable, in order of first appearance. */
function strongest(analysis: HarAnalysis): Map<string, number> {
  const confidence = new Map<string, number>();
  for (const correlation of analysis.correlations) {
    confidence.set(
      correlation.variable,
      Math.max(confidence.get(correlation.variable) ?? 0, correlation.confidence),
    );
  }
  return confidence;
}

/** The request that produced the token the recording sends in `Authorization`, when it shows it. */
function loginEndpoint(analysis: HarAnalysis): { method: string; path: string } | undefined {
  const source = analysis.correlations.find((correlation) => correlation.sentAsAuth)?.sourceEntry;
  if (source === undefined) return undefined;
  for (const group of analysis.groups) {
    const request = group.requests[group.entryIndices.indexOf(source)];
    if (request !== undefined && request.method !== '' && request.path !== '') {
      return { method: request.method, path: request.path };
    }
  }
  return undefined;
}

function hostOf(address: string): string {
  try {
    return new URL(address).host.toLowerCase();
  } catch {
    return address;
  }
}

/** `sanitized_har_export` and the refusal condition of the backend are one fact for the user. */
const SANITIZED = 'sanitized_export';

function warningsOf(
  upload: HarUpload,
  analysis: HarAnalysis,
  host: string,
  mismatch: string | null,
): HarWarning[] {
  const codes = [...upload.warningCodes, ...analysis.warningCodes].map((code) =>
    code === 'sanitized_har_export' ? SANITIZED : code,
  );
  // Generation is refused when bodies were declared but absent and no response carries one
  // (`sanitized_export_refusal`).
  if (analysis.strippedResponseBodyRatio > 0 && analysis.responseBodyRatio === 0) {
    codes.push(SANITIZED);
  }
  const all = distinct(codes);
  const ordered = [
    ...all.filter((code) => code === SANITIZED),
    ...all.filter((code) => code !== SANITIZED),
  ];
  const warnings: HarWarning[] = ordered.map((kind) => ({ kind }));
  if (mismatch !== null) {
    warnings.push({ kind: 'different_host', params: { host, environment: mismatch } });
  }
  return warnings;
}

function describe(
  upload: HarUpload,
  analysis: HarAnalysis,
  sizeBytes: number,
  environment: { name: string; hosts: readonly string[] } | null,
): StoredData {
  const host = hostOf(upload.baseUrl);
  const matches = environment?.hosts.includes(host) === true;
  const paths = distinct(analysis.groups.map((group) => group.name).filter((name) => name !== ''));
  const confidence = strongest(analysis);
  const accepted = [...confidence.values()].filter((value) => value > ACCEPTED_ABOVE).length;
  const uncertain = [...confidence]
    .filter(([, value]) => value <= ACCEPTED_ABOVE)
    .map(([variable, value]) => ({ variable, confidence: value }));
  const ambiguous = distinct(analysis.ambiguousLocations).map((variable) => ({ variable }));
  const endpoint = upload.authPattern === null ? undefined : loginEndpoint(analysis);
  const mismatch = environment !== null && host !== '' && !matches ? environment.name : null;
  return {
    sizeBytes,
    entries: upload.totalEntries,
    filtered: Math.max(0, upload.totalEntries - (upload.keptEntries - upload.noiseEntries)),
    auth: { detected: upload.authPattern, ...(endpoint === undefined ? {} : { endpoint }) },
    baseUrl: { host, environment: matches && environment !== null ? environment.name : null },
    paths: paths.slice(0, LISTED),
    morePaths: Math.max(0, paths.length - LISTED),
    correlations: {
      accepted,
      uncertain: uncertain.slice(0, LISTED),
      moreUncertain: Math.max(0, uncertain.length - LISTED),
      ambiguous: ambiguous.slice(0, LISTED),
      moreAmbiguous: Math.max(0, ambiguous.length - LISTED),
    },
    warnings: warningsOf(upload, analysis, host, mismatch),
  };
}

// ---- secrets of the recording ------------------------------------------------------------------

/** Values of one recording registered as secrets at most; the rest is counted in the log. */
export const MAX_RECORDING_SECRETS = 2000;
/** Headers whose value is a credential whatever it looks like. */
const SECRET_HEADERS =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-session-id|x-amz-security-token)$/iu;

interface NameValue {
  readonly name?: unknown;
  readonly value?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pairs = (value: unknown): NameValue[] =>
  Array.isArray(value) ? value.filter((item): item is NameValue => isRecord(item)) : [];

/** The parts of a credential header a backend may quote on their own. */
function headerParts(name: string, value: string): string[] {
  const lower = name.toLowerCase();
  if (lower === 'cookie') {
    return [value, ...value.split(';').map((part) => part.slice(part.indexOf('=') + 1).trim())];
  }
  if (lower === 'set-cookie') {
    const [first = ''] = value.split(';');
    return [value, first.slice(first.indexOf('=') + 1).trim()];
  }
  const space = value.indexOf(' ');
  return space > 0 ? [value, value.slice(space + 1).trim()] : [value];
}

function bodySecrets(text: unknown, found: string[]): void {
  if (typeof text !== 'string' || text === '') return;
  try {
    found.push(...secretFieldValues(JSON.parse(text)));
    return;
  } catch {
    // Not JSON: a form body is tried below.
  }
  for (const [key, value] of new URLSearchParams(text)) {
    if (isSecretField(key)) found.push(value);
  }
}

/**
 * Credentials of the recording: values of credential headers (and the cookie values and tokens
 * inside them), cookies, and fields with secret names in query strings, form and JSON bodies.
 * LoadCraft may quote any of them back; registered, they are masked in every output of the call.
 */
export function recordingSecrets(content: Uint8Array): { values: string[]; skipped: number } {
  let har: unknown;
  try {
    har = JSON.parse(Buffer.from(content).toString('utf8'));
  } catch {
    return { values: [], skipped: 0 };
  }
  const entries = isRecord(har) && isRecord(har['log']) ? har['log']['entries'] : undefined;
  const found: string[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry)) continue;
    for (const side of [entry['request'], entry['response']]) {
      if (!isRecord(side)) continue;
      for (const header of pairs(side['headers'])) {
        if (typeof header.name !== 'string' || typeof header.value !== 'string') continue;
        if (SECRET_HEADERS.test(header.name) || isSecretField(header.name)) {
          found.push(...headerParts(header.name, header.value));
        }
      }
      for (const cookie of pairs(side['cookies'])) {
        if (typeof cookie.value === 'string') found.push(cookie.value);
      }
      for (const field of [
        ...pairs(side['queryString']),
        ...pairs(isRecord(side['postData']) ? side['postData']['params'] : undefined),
      ]) {
        if (
          typeof field.name === 'string' &&
          typeof field.value === 'string' &&
          isSecretField(field.name)
        ) {
          found.push(field.value);
        }
      }
      bodySecrets(isRecord(side['postData']) ? side['postData']['text'] : undefined, found);
      bodySecrets(isRecord(side['content']) ? side['content']['text'] : undefined, found);
    }
  }
  const values = [...new Set(found.filter((value) => value.length >= MIN_SECRET_LENGTH))];
  return {
    values: values.slice(0, MAX_RECORDING_SECRETS),
    skipped: Math.max(0, values.length - MAX_RECORDING_SECRETS),
  };
}

/** Registers the credentials of the file in the call's scope; returns them for later calls. */
async function registerRecordingSecrets(ctx: ToolContext, file: AllowedFile): Promise<string[]> {
  const { values, skipped } = recordingSecrets(await readBytesAllowed(file));
  for (const value of values) ctx.secrets.add(value);
  if (skipped > 0) {
    ctx.log.info('recording holds more credentials than are masked', {
      masked: values.length,
      skipped,
    });
  }
  return values;
}

/** A recording LoadCraft holds as a HAR session: what `flows_import_har` found in it, and where it is. */
export interface ImportedRecording {
  readonly projectId: string;
  readonly sessionId: string;
  /** File name without the `.har` extension: the default name of what is built from it. */
  readonly name: string;
  readonly reused: boolean;
  readonly data: StoredData;
  /** Key of the remembered session: dropping it makes the next call send the file again. */
  readonly key: string;
  /** Credentials of the file, registered in this call; kept in memory for later calls only. */
  readonly secrets: readonly string[];
}

/**
 * The steps of `flows_import_har`, shared with the tools that build from a recording: the file is sent
 * and analysed unless the same content was sent to the same project within the session lifetime.
 */
export async function importRecording(
  ctx: ToolContext,
  args: { readonly file: string; readonly project?: string | undefined },
): Promise<ImportedRecording> {
  const file = await openAllowed(ctx.config.workspaceRoot, args.file, 'har');
  const { id: projectId } = await createResolver(ctx).project(args.project?.trim() ?? '');
  const { sha256, size } = await fingerprintHar(file);
  const key = `${projectId}:${sha256}:${String(size)}`;
  const name = file.name.replace(/\.har$/iu, '');
  // Before anything is sent or read back: whatever LoadCraft answers is masked from here on.
  const secrets = await registerRecordingSecrets(ctx, file);

  const known = ctx.state.get('harSessions', key);
  if (known !== undefined && ctx.clock.now() - known.savedAt < SESSION_TTL_MS) {
    const stored = storedSchema.safeParse(known.value);
    if (stored.success) {
      const { sessionId, data } = stored.data;
      return { projectId, sessionId, name, reused: true, data, key, secrets };
    }
  }

  const upload = await timed(ctx, () =>
    withElapsed(ctx, 'importHar.progress.upload', () => uploadHar(ctx, projectId, file)),
  );
  const analysis = await timed(ctx, () =>
    withElapsed(ctx, 'importHar.progress.analyze', () =>
      analyzeHar(ctx, projectId, upload.sessionId),
    ),
  );
  const environment = await getDefaultEnvironment(ctx, projectId);
  // A name the backend made from the recording can hold one of its credentials: masked, not refused.
  const described = describe(upload, analysis, size, environment);
  // the generator's names of the paths are shown masked, their secrets registered (FIX-76)
  const data = ctx.secrets.scrubDeep({
    ...described,
    paths: described.paths.map((name) => content(ctx, name, 120)),
  });
  await ctx.state.set('harSessions', key, { sessionId: upload.sessionId, data });
  return { projectId, sessionId: upload.sessionId, name, reused: false, data, key, secrets };
}

export const flowsImportHar = defineTool({
  name: 'flows_import_har',
  title: 'Import a HAR recording',
  description:
    'Step 03: send a browser recording (.har, up to 100 MB) to LoadCraft and show what it found: ' +
    'requests kept and filtered as noise, the login, the action groups in the recording and the values ' +
    'passed between requests. The same file sent again is not uploaded twice. The recording may ' +
    "hold the user's session data: the result shows counts and names only. Takes up to a few minutes.",
  input,
  annotations: { idempotentHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const { reused, data } = await importRecording(ctx, args);
    return { status: 'done', data: { reused, ...data } };
  },
  render: renderImportHar,
});
