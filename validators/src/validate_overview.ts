// Validate the Markdown overview whose whole content fills LoadCraft's project description.
// Run it as `node validate_overview.mjs <overview.md>`; the .mjs is built from this file.

import {
  JSONDecodeError,
  PyOSError,
  PyPath,
  UnicodeDecodeError,
  casefold,
  compareStr,
  compile,
  compileGlobal,
  exists,
  loads,
  parseArgs,
  pyLen,
  readText,
  runMain,
  sortedUnique,
  splitLines,
  strip,
  type ParserSpec,
  type PathIssue,
  type PyValue,
} from './py/index.ts';

const PROVENANCE_FILE = 'overview.provenance.json';
const COMMIT_PATTERN = compile('^[0-9a-f]{7,64}$', {}, 'match');
const MIN_CHARS = 200;
const MAX_CHARS = 8000;
const H1_PATTERN = compile(String.raw`#(?!#)\s+\S`, {}, 'match');
const CODE_FENCE_PATTERN = compile('```');
const TABLE_PATTERN = compile(String.raw`^\s*\|.*\|\s*$`, { multiline: true });
const I = { ignoreCase: true };
const UNRESOLVED_PATTERNS = [
  compile(String.raw`\[\s*TODO\b`, I),
  compile(String.raw`\bx-todo\b`, I),
  compile(String.raw`\bTBD\b`, I),
];
const SOURCE_EXTENSIONS = 'c|cc|cpp|cs|go|java|js|jsx|php|py|rb|rs|svelte|ts|tsx|vue';
const SOURCE_REFERENCE_PATTERNS = [
  compile(String.raw`\b[\w./-]+\.(?:${SOURCE_EXTENSIONS}):\d+\b`, I),
  compile(String.raw`\b[\w./-]+\.(?:${SOURCE_EXTENSIONS})\s+line\s+\d+\b`, I),
];
const SECRET_PATTERNS = [
  compile('-----BEGIN [A-Z ]*PRIVATE KEY-----'),
  compile(String.raw`\bBearer\s+[A-Za-z0-9._~-]{20,}\b`, I),
  compile(String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b`),
  compile(String.raw`\bAKIA[0-9A-Z]{16}\b`),
  compile(String.raw`\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b`),
];
const CREDENTIAL_PATTERNS = [
  compile(String.raw`\b(?:password|passwd|pwd|api[ _-]?key|token)\s*(?::|=|\bis\b)\s*[^\s,.;]+`, I),
];
const EMAIL_PATTERN_SOURCE = String.raw`\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b`;

function validateProvenanceFile(path: PyPath): PathIssue[] {
  let stamp: PyValue;
  try {
    stamp = loads(readText(path.text));
  } catch (error) {
    if (error instanceof UnicodeDecodeError || error instanceof JSONDecodeError) {
      return [{ path, message: 'provenance stamp must be valid JSON' }];
    }
    throw error;
  }
  if (!(stamp instanceof Map)) return [{ path, message: 'provenance stamp must be valid JSON' }];
  const issues: PathIssue[] = [];
  const commit = stamp.get('commit');
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    issues.push({ path, message: 'provenance commit must be a git object hash' });
  }
  if (typeof stamp.get('dirty') !== 'boolean') {
    issues.push({ path, message: 'provenance dirty must be a boolean' });
  }
  const unknown = [...stamp.keys()].filter((key) => key !== 'commit' && key !== 'dirty');
  if (unknown.length > 0) {
    issues.push({
      path,
      message: `provenance stamp has unsupported keys: ${unknown.sort(compareStr).join(', ')}`,
    });
  }
  return issues;
}

export function validateText(path: PyPath, text: string): PathIssue[] {
  const issues: PathIssue[] = [];
  const add = (message: string): void => {
    issues.push({ path, message });
  };
  if (text.includes('\x00')) add('overview contains a NUL byte');
  const stripped = strip(text);
  const firstLine = splitLines(text).find((line) => strip(line) !== '') ?? '';
  if (!H1_PATTERN.test(strip(firstLine))) add('first non-empty line must be a single-# H1 heading');
  if (pyLen(stripped) < MIN_CHARS) add('overview must contain at least 200 characters');
  if (pyLen(stripped) > MAX_CHARS) add('overview exceeds the 8000-character skill contract');
  if (CODE_FENCE_PATTERN.test(text))
    add('code fences are not allowed in the LoadCraft description');
  if (TABLE_PATTERN.test(text)) add('Markdown tables are not allowed in the LoadCraft description');
  if (UNRESOLVED_PATTERNS.some((pattern) => pattern.test(text))) {
    add('unresolved marker is not allowed in a deliverable');
  }
  if (SOURCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    add('source file reference is not allowed in direct LoadCraft input');
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    add('secret-like value must not appear in a project overview');
  }
  const emailDomains = new Set(
    [...text.matchAll(compileGlobal(EMAIL_PATTERN_SOURCE, I))].map((match) =>
      casefold(match[1] as string),
    ),
  );
  const hasNonSyntheticEmail = [...emailDomains].some((domain) => domain !== 'example.com');
  if (hasNonSyntheticEmail || CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    add('credential-like value must not appear in a project overview');
  }
  return sortedUnique(issues);
}

const SPEC: ParserSpec = {
  usage: 'usage: validate_overview.mjs [-h] overview\n',
  help: `Validate a Markdown LoadCraft project overview.

positional arguments:
  overview    Path to the overview.md file

options:
  -h, --help  show this help message and exit
`,
  positionals: [{ dest: 'overview', many: false }],
  options: [],
};

export function main(
  out: { print(text: string): void; eprint(text: string): void },
  argv: string[],
  prog: string,
): number {
  const args = parseArgs(SPEC, prog, argv);
  const path = new PyPath(args.overview as string);
  if (path.suffix.toLowerCase() !== '.md') {
    out.eprint(`ERROR ${path.display}: overview artifact must use the .md extension`);
    return 1;
  }
  let text: string;
  try {
    text = readText(path.text);
  } catch (error) {
    if (error instanceof PyOSError && error.kind === 'FileNotFoundError') {
      out.eprint(`ERROR ${path.display}: file not found`);
      return 1;
    }
    if (error instanceof UnicodeDecodeError) {
      out.eprint(`ERROR ${path.display}: file must be UTF-8: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const issues = validateText(path, text);
  const sidecar = path.parent.join(PROVENANCE_FILE);
  if (exists(sidecar.text)) issues.push(...validateProvenanceFile(sidecar));

  const unique = sortedUnique(issues);
  if (unique.length > 0) {
    for (const issue of unique) out.eprint(`ERROR ${issue.path.display}: ${issue.message}`);
    return 1;
  }
  out.print(`PASS: ${path.display} passes the LoadCraft structural preflight.`);
  return 0;
}

runMain(main);
