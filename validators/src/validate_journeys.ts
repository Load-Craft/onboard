// Validate plain-text journey descriptions before they enter LoadCraft.
// Run it as `node validate_journeys.mjs <file.txt|directory>...`; the .mjs is built from this file.

import {
  JSONDecodeError,
  PyOSError,
  PyPath,
  UnicodeDecodeError,
  casefold,
  compile,
  compileGlobal,
  exists,
  isDir,
  isFile,
  loads,
  parseArgs,
  pyLen,
  readText,
  rglob,
  runMain,
  sortedUnique,
  splitLines,
  splitWords,
  compareStr,
  strip,
  type ParserSpec,
  type PathIssue,
  type PyValue,
} from './py/index.ts';

const SLUG_FILE = compile('^[a-z0-9]+(?:-[a-z0-9]+)*\\.txt$', {}, 'fullmatch');
const PROVENANCE_FILE = '.provenance.json';
const COMMIT_PATTERN = compile('^[0-9a-f]{7,64}$', {}, 'match');
const I = { ignoreCase: true };
const M = { multiline: true };
const MARKDOWN_PATTERNS = [
  compile(String.raw`^\s{0,3}#{1,6}\s+`, M),
  compile('```'),
  compile(String.raw`^\s*\|.*\|\s*$`, M),
  compile(String.raw`^\s*[-*+]\s+`, M),
  compile(String.raw`^\s*\d+[.)]\s+`, M),
];
const RUNNER_PATTERNS = [
  compile(String.raw`\bgetBy(?:Role|Text|Label|TestId|Placeholder)\s*\(`, I),
  compile(String.raw`\b(?:page|cy)\.(?:locator|get|find|click|visit)\s*\(`, I),
  compile(String.raw`\bdata-(?:testid|test|cy)\b`, I),
  compile(String.raw`\blocator\s*\(`, I),
];
const CROSS_FILE_PATTERNS = [
  compile(String.raw`\bJRN-\d+\b`, I),
  compile(String.raw`\brun\s+[^.\n]{0,50}\s+first\b`, I),
  compile(String.raw`\b(?:previous|prior|another)\s+journey\b`, I),
  compile(String.raw`\b[a-z0-9-]+\.txt\b`, I),
];
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
const FINISH_PATTERN = compile(
  String.raw`\b(?:finish when|stop when|confirm that|verify that|check that)\b`,
  I,
);
const SENTENCE_BREAK = compile(String.raw`(?<=[.!?])\s+`);
const PARENTHESISED = compile(String.raw`\(.*\)`, {}, 'fullmatch');

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
  if (!(stamp instanceof Map)) return [{ path, message: 'provenance stamp must be a JSON object' }];
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

function collectFiles(targets: PyPath[]): { files: PyPath[]; issues: PathIssue[] } {
  const files = new Map<string, PyPath>();
  const issues: PathIssue[] = [];
  for (const target of targets) {
    if (!exists(target.text)) {
      issues.push({ path: target, message: 'path does not exist' });
    } else if (isDir(target.text)) {
      for (const entry of rglob(target.text)) {
        if (!isFile(entry)) continue;
        const path = new PyPath(entry);
        if (path.name === PROVENANCE_FILE) {
          issues.push(...validateProvenanceFile(path));
          continue;
        }
        if (path.suffix.toLowerCase() !== '.txt') {
          issues.push({ path, message: 'output directory may contain only .txt journey files' });
          continue;
        }
        files.set(path.text, path);
      }
    } else if (target.suffix.toLowerCase() !== '.txt') {
      issues.push({ path: target, message: 'journey artifact must use the .txt extension' });
    } else {
      files.set(target.text, target);
    }
  }
  if (files.size === 0 && issues.length === 0) {
    issues.push({ path: targets[0] as PyPath, message: 'no .txt journey files found' });
  }
  return { files: [...files.values()].sort((a, b) => PyPath.compare(a, b)), issues };
}

export function validateText(path: PyPath, text: string): PathIssue[] {
  const issues: PathIssue[] = [];
  const add = (message: string): void => {
    issues.push({ path, message });
  };
  const stripped = strip(text);
  if (!SLUG_FILE.test(path.name))
    add('filename must be a lowercase hyphenated slug ending in .txt');
  if (pyLen(stripped) < 10) add('description must contain at least 10 characters');
  if (pyLen(stripped) > 6000) add('description exceeds the 6000-character skill contract');
  if (text.includes('\x00')) add('description contains a NUL byte');
  if (MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))) {
    add('Markdown formatting is not allowed in the LoadCraft description');
  }
  if (RUNNER_PATTERNS.some((pattern) => pattern.test(text))) {
    add('runner-specific locator or command is not allowed');
  }
  if (CROSS_FILE_PATTERNS.some((pattern) => pattern.test(text))) {
    add('cross-file dependency is not allowed; each file must stand alone');
  }
  if (UNRESOLVED_PATTERNS.some((pattern) => pattern.test(text))) {
    add('unresolved marker is not allowed in a deliverable');
  }
  if (SOURCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    add('source file reference is not allowed in direct LoadCraft input');
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    add('secret-like value must not appear in a journey description');
  }
  const emailDomains = new Set(
    [...text.matchAll(compileGlobal(EMAIL_PATTERN_SOURCE, I))].map((match) =>
      casefold(match[1] as string),
    ),
  );
  const hasNonSyntheticEmail = [...emailDomains].some((domain) => domain !== 'example.com');
  if (hasNonSyntheticEmail || CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    add('credential-like value must not appear in a journey description');
  }
  if (!FINISH_PATTERN.test(text)) {
    add(
      'observable finish condition is required; end with Finish when, Stop when, Confirm that, Verify that, or Check that',
    );
  } else {
    const finalLine =
      splitLines(text)
        .map((line) => strip(line))
        .reverse()
        .find((line) => line !== '') ?? '';
    const fragments = finalLine.split(SENTENCE_BREAK);
    const finalSentence =
      [...fragments].reverse().find((fragment) => !PARENTHESISED.test(strip(fragment))) ?? '';
    if (!FINISH_PATTERN.test(finalSentence)) {
      add('observable finish condition must be the final instruction');
    }
  }
  return sortedUnique(issues);
}

const SPEC: ParserSpec = {
  usage: 'usage: validate_journeys.mjs [-h] targets [targets ...]\n',
  help: `Validate plain-text LoadCraft journey descriptions.

positional arguments:
  targets     One or more .txt files or directories containing journey files

options:
  -h, --help  show this help message and exit
`,
  positionals: [{ dest: 'targets', many: true }],
  options: [],
};

export function main(
  out: { print(text: string): void; eprint(text: string): void },
  argv: string[],
  prog: string,
): number {
  const args = parseArgs(SPEC, prog, argv);
  const targets = (args.targets as string[]).map((target) => new PyPath(target));
  const collected = collectFiles(targets);
  const issues = collected.issues;
  const seenDescriptions = new Map<string, PyPath>();
  for (const path of collected.files) {
    let text: string;
    try {
      text = readText(path.text);
    } catch (error) {
      if (error instanceof UnicodeDecodeError) {
        issues.push({ path, message: `file must be UTF-8: ${error.message}` });
        continue;
      }
      if (error instanceof PyOSError) throw error;
      throw error;
    }
    issues.push(...validateText(path, text));
    const normalized = casefold(splitWords(text).join(' '));
    const previous = seenDescriptions.get(normalized);
    if (previous !== undefined) {
      issues.push({ path, message: `description duplicates ${previous.display}` });
    } else {
      seenDescriptions.set(normalized, path);
    }
  }

  const unique = sortedUnique(issues);
  if (unique.length > 0) {
    for (const issue of unique) out.eprint(`ERROR ${issue.path.display}: ${issue.message}`);
    return 1;
  }
  const count = collected.files.length;
  const noun = count === 1 ? 'journey' : 'journeys';
  const verb = count === 1 ? 'passes' : 'pass';
  out.print(`PASS: ${count} ${noun} ${verb} the LoadCraft structural preflight.`);
  return 0;
}

runMain(main);
