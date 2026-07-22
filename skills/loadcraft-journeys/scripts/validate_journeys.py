#!/usr/bin/env python3
"""Validate plain-text journey descriptions before they enter LoadCraft."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SLUG_FILE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.txt$")
MARKDOWN_PATTERNS = (
    re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE),
    re.compile(r"```"),
    re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE),
    re.compile(r"^\s*[-*+]\s+", re.MULTILINE),
    re.compile(r"^\s*\d+[.)]\s+", re.MULTILINE),
)
RUNNER_PATTERNS = (
    re.compile(r"\bgetBy(?:Role|Text|Label|TestId|Placeholder)\s*\(", re.IGNORECASE),
    re.compile(r"\b(?:page|cy)\.(?:locator|get|find|click|visit)\s*\(", re.IGNORECASE),
    re.compile(r"\bdata-(?:testid|test|cy)\b", re.IGNORECASE),
    re.compile(r"\blocator\s*\(", re.IGNORECASE),
)
CROSS_FILE_PATTERNS = (
    re.compile(r"\bJRN-\d+\b", re.IGNORECASE),
    re.compile(r"\brun\s+[^.\n]{0,50}\s+first\b", re.IGNORECASE),
    re.compile(r"\b(?:previous|prior|another)\s+journey\b", re.IGNORECASE),
    re.compile(r"\b[a-z0-9-]+\.txt\b", re.IGNORECASE),
)
UNRESOLVED_PATTERNS = (
    re.compile(r"\[\s*TODO\b", re.IGNORECASE),
    re.compile(r"\bx-todo\b", re.IGNORECASE),
    re.compile(r"\bTBD\b", re.IGNORECASE),
)
SOURCE_REFERENCE_PATTERNS = (
    re.compile(
        r"\b[\w./-]+\.(?:c|cc|cpp|cs|go|java|js|jsx|php|py|rb|rs|svelte|ts|tsx|vue):\d+\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b[\w./-]+\.(?:c|cc|cpp|cs|go|java|js|jsx|php|py|rb|rs|svelte|ts|tsx|vue)\s+line\s+\d+\b",
        re.IGNORECASE,
    ),
)
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~-]{20,}\b", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b"),
)
CREDENTIAL_PATTERNS = (
    re.compile(
        r"\b(?:password|passwd|pwd|api[ _-]?key|token)\s*(?::|=|\bis\b)\s*[^\s,.;]+",
        re.IGNORECASE,
    ),
)
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b", re.IGNORECASE)
FINISH_PATTERN = re.compile(
    r"\b(?:finish when|stop when|confirm that|verify that|check that)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, order=True)
class Issue:
    path: Path
    message: str


def _collect_files(targets: list[Path]) -> tuple[list[Path], list[Issue]]:
    files: set[Path] = set()
    issues: list[Issue] = []
    for target in targets:
        if not target.exists():
            issues.append(Issue(target, "path does not exist"))
        elif target.is_dir():
            for path in target.rglob("*"):
                if not path.is_file():
                    continue
                if path.suffix.lower() != ".txt":
                    issues.append(
                        Issue(path, "output directory may contain only .txt journey files")
                    )
                    continue
                files.add(path)
        elif target.suffix.lower() != ".txt":
            issues.append(Issue(target, "journey artifact must use the .txt extension"))
        else:
            files.add(target)
    if not files and not issues:
        issues.append(Issue(targets[0], "no .txt journey files found"))
    return sorted(files), issues


def validate_text(path: Path, text: str) -> list[Issue]:
    issues: list[Issue] = []
    stripped = text.strip()
    if not SLUG_FILE.fullmatch(path.name):
        issues.append(Issue(path, "filename must be a lowercase hyphenated slug ending in .txt"))
    if len(stripped) < 10:
        issues.append(Issue(path, "description must contain at least 10 characters"))
    if len(stripped) > 6000:
        issues.append(Issue(path, "description exceeds the 6000-character skill contract"))
    if "\x00" in text:
        issues.append(Issue(path, "description contains a NUL byte"))
    if any(pattern.search(text) for pattern in MARKDOWN_PATTERNS):
        issues.append(Issue(path, "Markdown formatting is not allowed in the LoadCraft description"))
    if any(pattern.search(text) for pattern in RUNNER_PATTERNS):
        issues.append(Issue(path, "runner-specific locator or command is not allowed"))
    if any(pattern.search(text) for pattern in CROSS_FILE_PATTERNS):
        issues.append(Issue(path, "cross-file dependency is not allowed; each file must stand alone"))
    if any(pattern.search(text) for pattern in UNRESOLVED_PATTERNS):
        issues.append(Issue(path, "unresolved marker is not allowed in a deliverable"))
    if any(pattern.search(text) for pattern in SOURCE_REFERENCE_PATTERNS):
        issues.append(Issue(path, "source file reference is not allowed in direct LoadCraft input"))
    if any(pattern.search(text) for pattern in SECRET_PATTERNS):
        issues.append(Issue(path, "secret-like value must not appear in a journey description"))
    email_domains = {match.group(1).casefold() for match in EMAIL_PATTERN.finditer(text)}
    has_non_synthetic_email = any(domain != "example.com" for domain in email_domains)
    if has_non_synthetic_email or any(
        pattern.search(text) for pattern in CREDENTIAL_PATTERNS
    ):
        issues.append(
            Issue(path, "credential-like value must not appear in a journey description")
        )
    if not FINISH_PATTERN.search(text):
        issues.append(
            Issue(
                path,
                "observable finish condition is required; end with Finish when, Stop when, Confirm that, Verify that, or Check that",
            )
        )
    else:
        final_line = next(
            (line.strip() for line in reversed(text.splitlines()) if line.strip()),
            "",
        )
        fragments = re.split(r"(?<=[.!?])\s+", final_line)
        final_sentence = next(
            (
                fragment
                for fragment in reversed(fragments)
                if not re.fullmatch(r"\(.*\)", fragment.strip())
            ),
            "",
        )
        if not FINISH_PATTERN.search(final_sentence):
            issues.append(
                Issue(path, "observable finish condition must be the final instruction")
            )
    return sorted(set(issues))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate plain-text LoadCraft journey descriptions."
    )
    parser.add_argument(
        "targets",
        type=Path,
        nargs="+",
        help="One or more .txt files or directories containing journey files",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    files, issues = _collect_files(args.targets)
    seen_descriptions: dict[str, Path] = {}
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            issues.append(Issue(path, f"file must be UTF-8: {exc}"))
            continue
        issues.extend(validate_text(path, text))
        normalized = " ".join(text.split()).casefold()
        previous = seen_descriptions.get(normalized)
        if previous is not None:
            issues.append(Issue(path, f"description duplicates {previous}"))
        else:
            seen_descriptions[normalized] = path

    unique_issues = sorted(set(issues))
    if unique_issues:
        for issue in unique_issues:
            print(f"ERROR {issue.path}: {issue.message}", file=sys.stderr)
        return 1
    noun = "journey" if len(files) == 1 else "journeys"
    verb = "passes" if len(files) == 1 else "pass"
    print(f"PASS: {len(files)} {noun} {verb} the LoadCraft structural preflight.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
