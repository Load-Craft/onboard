#!/usr/bin/env python3
"""Validate the Markdown overview whose whole content fills LoadCraft's project description."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

PROVENANCE_FILE = "overview.provenance.json"
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{7,64}$")
MIN_CHARS = 200
MAX_CHARS = 8000
H1_PATTERN = re.compile(r"#(?!#)\s+\S")
CODE_FENCE_PATTERN = re.compile(r"```")
TABLE_PATTERN = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)
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


@dataclass(frozen=True, order=True)
class Issue:
    path: Path
    message: str


def _validate_provenance_file(path: Path) -> list[Issue]:
    issues: list[Issue] = []
    try:
        stamp = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return [Issue(path, "provenance stamp must be valid JSON")]
    if not isinstance(stamp, dict):
        return [Issue(path, "provenance stamp must be valid JSON")]
    commit = stamp.get("commit")
    if not isinstance(commit, str) or not COMMIT_PATTERN.match(commit):
        issues.append(Issue(path, "provenance commit must be a git object hash"))
    if not isinstance(stamp.get("dirty"), bool):
        issues.append(Issue(path, "provenance dirty must be a boolean"))
    unknown = set(stamp) - {"commit", "dirty"}
    if unknown:
        issues.append(
            Issue(path, f"provenance stamp has unsupported keys: {', '.join(sorted(unknown))}")
        )
    return issues


def validate_text(path: Path, text: str) -> list[Issue]:
    issues: list[Issue] = []
    if "\x00" in text:
        issues.append(Issue(path, "overview contains a NUL byte"))
    stripped = text.strip()
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    if not H1_PATTERN.match(first_line.strip()):
        issues.append(
            Issue(path, "first non-empty line must be a single-# H1 heading")
        )
    if len(stripped) < MIN_CHARS:
        issues.append(Issue(path, "overview must contain at least 200 characters"))
    if len(stripped) > MAX_CHARS:
        issues.append(Issue(path, "overview exceeds the 8000-character skill contract"))
    if CODE_FENCE_PATTERN.search(text):
        issues.append(Issue(path, "code fences are not allowed in the LoadCraft description"))
    if TABLE_PATTERN.search(text):
        issues.append(Issue(path, "Markdown tables are not allowed in the LoadCraft description"))
    if any(pattern.search(text) for pattern in UNRESOLVED_PATTERNS):
        issues.append(Issue(path, "unresolved marker is not allowed in a deliverable"))
    if any(pattern.search(text) for pattern in SOURCE_REFERENCE_PATTERNS):
        issues.append(Issue(path, "source file reference is not allowed in direct LoadCraft input"))
    if any(pattern.search(text) for pattern in SECRET_PATTERNS):
        issues.append(Issue(path, "secret-like value must not appear in a project overview"))
    email_domains = {match.group(1).casefold() for match in EMAIL_PATTERN.finditer(text)}
    has_non_synthetic_email = any(domain != "example.com" for domain in email_domains)
    if has_non_synthetic_email or any(
        pattern.search(text) for pattern in CREDENTIAL_PATTERNS
    ):
        issues.append(
            Issue(path, "credential-like value must not appear in a project overview")
        )
    return sorted(set(issues))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a Markdown LoadCraft project overview."
    )
    parser.add_argument("overview", type=Path, help="Path to the overview.md file")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    path: Path = args.overview
    if path.suffix.lower() != ".md":
        print(f"ERROR {path}: overview artifact must use the .md extension", file=sys.stderr)
        return 1
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"ERROR {path}: file not found", file=sys.stderr)
        return 1
    except UnicodeDecodeError as exc:
        print(f"ERROR {path}: file must be UTF-8: {exc}", file=sys.stderr)
        return 1

    issues = validate_text(path, text)
    sidecar = path.parent / PROVENANCE_FILE
    if sidecar.exists():
        issues.extend(_validate_provenance_file(sidecar))

    unique_issues = sorted(set(issues))
    if unique_issues:
        for issue in unique_issues:
            print(f"ERROR {issue.path}: {issue.message}", file=sys.stderr)
        return 1
    print(f"PASS: {path} passes the LoadCraft structural preflight.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
