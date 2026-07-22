#!/usr/bin/env python3
"""Validate the single-file AsyncAPI 3.0 contract consumed reliably by LoadCraft."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ASYNCAPI_VERSION = "3.0.0"
OPERATION_ACTIONS = {"send", "receive"}
UNRESOLVED_KEYS = {"x-todo", "x-loadcraft-blocker"}
SCHEMA_TYPES = {"string", "number", "integer", "boolean", "array", "object"}
MESSAGE_REF_PREFIX = "#/components/messages/"
CHANNEL_REF_PREFIX = "#/channels/"
MAX_REF_CHAIN_DEPTH = 20
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~-]{20,}\b", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b"),
)
SENSITIVE_PROPERTY_NAMES = {
    "api_key",
    "authorization",
    "password",
    "passwd",
    "secret",
    "token",
}


@dataclass(frozen=True, order=True)
class Issue:
    pointer: str
    message: str


def _pointer(parent: str, child: str) -> str:
    escaped = child.replace("~", "~0").replace("/", "~1")
    return f"{parent}/{escaped}" if parent else f"/{escaped}"


def _is_sensitive_property(name: str) -> bool:
    split = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    normalized = re.sub(r"[^a-z0-9]+", "_", split.casefold()).strip("_")
    return normalized in SENSITIVE_PROPERTY_NAMES or any(
        normalized.endswith(f"_{suffix}") for suffix in SENSITIVE_PROPERTY_NAMES
    )


def _walk(value: object, pointer: str = "") -> Iterator[tuple[str, object]]:
    yield pointer or "/", value
    if isinstance(value, Mapping):
        for key, child in value.items():
            yield from _walk(child, _pointer(pointer, str(key)))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            yield from _walk(child, _pointer(pointer, str(index)))


def _resolve_ref(document: Mapping[str, object], ref: str) -> object | None:
    if not ref.startswith("#/"):
        return None
    current: object = document
    for raw_part in ref[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, Mapping) and part in current:
            current = current[part]
            continue
        if (
            isinstance(current, Sequence)
            and not isinstance(current, (str, bytes, bytearray))
            and part.isdigit()
            and int(part) < len(current)
        ):
            current = current[int(part)]
            continue
        return None
    return current


def _require_text(
    mapping: Mapping[str, object], key: str, pointer: str, issues: list[Issue]
) -> str | None:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        issues.append(Issue(_pointer(pointer, key), "must be a non-empty string"))
        return None
    return value.strip()


PROVENANCE_KEY = "x-loadcraft-source"
PROVENANCE_METHODS = {"native-export", "static-trace"}
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{7,64}$")


def _validate_provenance(info: Mapping[str, object], issues: list[Issue]) -> None:
    stamp = info.get(PROVENANCE_KEY)
    if stamp is None:
        return
    pointer = _pointer("/info", PROVENANCE_KEY)
    if not isinstance(stamp, Mapping):
        issues.append(Issue(pointer, "x-loadcraft-source must be an object"))
        return
    commit = stamp.get("commit")
    if not isinstance(commit, str) or not COMMIT_PATTERN.match(commit):
        issues.append(
            Issue(_pointer(pointer, "commit"), "x-loadcraft-source commit must be a git object hash")
        )
    if not isinstance(stamp.get("dirty"), bool):
        issues.append(
            Issue(_pointer(pointer, "dirty"), "x-loadcraft-source dirty must be a boolean")
        )
    if stamp.get("method") not in PROVENANCE_METHODS:
        issues.append(
            Issue(
                _pointer(pointer, "method"),
                "x-loadcraft-source method must be 'native-export' or 'static-trace'",
            )
        )
    unknown = set(stamp) - {"commit", "dirty", "method"}
    if unknown:
        issues.append(
            Issue(pointer, f"x-loadcraft-source has unsupported keys: {', '.join(sorted(unknown))}")
        )


def _validate_global_markers(document: Mapping[str, object], issues: list[Issue]) -> None:
    for pointer, value in _walk(document):
        if isinstance(value, Mapping):
            for key, child in value.items():
                base = "" if pointer == "/" else pointer
                if str(key).lower() in UNRESOLVED_KEYS:
                    issues.append(
                        Issue(_pointer(base, str(key)), "unresolved marker is not allowed in a deliverable")
                    )
                if _is_sensitive_property(str(key)) and not isinstance(child, Mapping):
                    issues.append(
                        Issue(
                            _pointer(base, str(key)),
                            "secret-bearing field must not embed a literal value",
                        )
                    )
        if not isinstance(value, str):
            continue
        if re.search(r"\[\s*TODO\b", value, re.IGNORECASE):
            issues.append(Issue(pointer, "unresolved marker is not allowed in a deliverable"))
        if any(pattern.search(value) for pattern in SECRET_PATTERNS):
            issues.append(Issue(pointer, "secret-like value must not be embedded in the specification"))


def _validate_refs(document: Mapping[str, object], issues: list[Issue]) -> None:
    for pointer, value in _walk(document):
        if not isinstance(value, Mapping) or "$ref" not in value:
            continue
        ref = value.get("$ref")
        ref_pointer = _pointer("" if pointer == "/" else pointer, "$ref")
        if not isinstance(ref, str) or not ref:
            issues.append(Issue(ref_pointer, "$ref must be a non-empty string"))
            continue
        if not ref.startswith("#/"):
            issues.append(Issue(ref_pointer, f"external $ref is not allowed: {ref}"))
            continue
        _validate_ref_chain(document, ref, ref_pointer, issues)


def _validate_ref_chain(
    document: Mapping[str, object],
    ref: str,
    ref_pointer: str,
    issues: list[Issue],
) -> None:
    """Follow a chain of internal $refs, rejecting cycles and over-deep chains."""
    seen: set[str] = set()
    current = ref
    depth = 0
    while True:
        if current in seen:
            issues.append(Issue(ref_pointer, f"cyclic $ref chain detected at: {current}"))
            return
        seen.add(current)
        depth += 1
        if depth > MAX_REF_CHAIN_DEPTH:
            issues.append(
                Issue(ref_pointer, f"reference chain exceeds the supported depth of {MAX_REF_CHAIN_DEPTH}")
            )
            return
        resolved = _resolve_ref(document, current)
        if resolved is None:
            issues.append(Issue(ref_pointer, f"unresolved $ref: {current}"))
            return
        if isinstance(resolved, Mapping):
            nested = resolved.get("$ref")
            if isinstance(nested, str):
                if not nested.startswith("#/"):
                    issues.append(Issue(ref_pointer, f"external $ref is not allowed: {nested}"))
                    return
                current = nested
                continue
        return


def _validate_schema_object(value: object, pointer: str, issues: list[Issue]) -> None:
    """Validate one Schema Object and its schema-bearing children."""
    if isinstance(value, bool):
        issues.append(
            Issue(pointer, "boolean schemas are not supported in the LoadCraft compatibility profile")
        )
        return
    if not isinstance(value, Mapping):
        issues.append(Issue(pointer, "schema must be an object"))
        return

    schema_type = value.get("type")
    if schema_type is not None:
        if not isinstance(schema_type, str):
            issues.append(
                Issue(
                    _pointer(pointer, "type"),
                    "schema type must be a single string in the LoadCraft compatibility profile",
                )
            )
        elif schema_type not in SCHEMA_TYPES:
            issues.append(
                Issue(_pointer(pointer, "type"), f"unsupported schema type: {schema_type}")
            )

    for keyword in ("oneOf", "anyOf"):
        if keyword in value:
            issues.append(
                Issue(
                    _pointer(pointer, keyword),
                    "oneOf/anyOf is lossy in LoadCraft; model one unambiguous schema instead",
                )
            )

    properties = value.get("properties")
    if properties is not None and not isinstance(properties, Mapping):
        issues.append(Issue(_pointer(pointer, "properties"), "properties must be an object"))
    required = value.get("required")
    if required is not None and not isinstance(required, list):
        issues.append(Issue(_pointer(pointer, "required"), "required must be an array"))
    elif isinstance(required, list):
        if not isinstance(properties, Mapping):
            issues.append(
                Issue(
                    _pointer(pointer, "required"),
                    "schema with required fields must declare properties",
                )
            )
        else:
            for required_name in required:
                if not isinstance(required_name, str):
                    issues.append(
                        Issue(_pointer(pointer, "required"), "required entries must be strings")
                    )
                elif required_name not in properties:
                    issues.append(
                        Issue(
                            _pointer(pointer, "required"),
                            f"required property {required_name!r} is not declared in properties",
                        )
                    )

    if isinstance(properties, Mapping):
        for property_name, property_schema in properties.items():
            if _is_sensitive_property(str(property_name)) and isinstance(
                property_schema, Mapping
            ):
                for keyword in ("default", "enum", "example"):
                    if keyword in property_schema:
                        issues.append(
                            Issue(
                                _pointer(
                                    _pointer(
                                        _pointer(pointer, "properties"),
                                        str(property_name),
                                    ),
                                    keyword,
                                ),
                                "secret-bearing property must not embed a literal value",
                            )
                        )
            _validate_schema_object(
                property_schema,
                _pointer(_pointer(pointer, "properties"), str(property_name)),
                issues,
            )

    if "items" in value:
        _validate_schema_object(value["items"], _pointer(pointer, "items"), issues)

    additional_properties = value.get("additionalProperties")
    if isinstance(additional_properties, Mapping):
        _validate_schema_object(
            additional_properties,
            _pointer(pointer, "additionalProperties"),
            issues,
        )

    all_of = value.get("allOf")
    if isinstance(all_of, list):
        for index, member in enumerate(all_of):
            _validate_schema_object(
                member,
                _pointer(_pointer(pointer, "allOf"), str(index)),
                issues,
            )


def _validate_schema_subset(document: Mapping[str, object], issues: list[Issue]) -> None:
    """Reject schema constructs that LoadCraft currently parses lossily."""
    roots: dict[str, object] = {}
    components = document.get("components")
    if isinstance(components, Mapping):
        schemas = components.get("schemas")
        if isinstance(schemas, Mapping):
            for name, schema in schemas.items():
                roots[_pointer("/components/schemas", str(name))] = schema
        messages = components.get("messages")
        if isinstance(messages, Mapping):
            for name, message in messages.items():
                if not isinstance(message, Mapping):
                    continue
                base = _pointer("/components/messages", str(name))
                if "payload" in message and isinstance(message["payload"], Mapping):
                    roots[_pointer(base, "payload")] = message["payload"]
                if "headers" in message and isinstance(message["headers"], Mapping):
                    roots[_pointer(base, "headers")] = message["headers"]

    for pointer, schema in sorted(roots.items()):
        _validate_schema_object(schema, pointer, issues)


def _is_message_ref(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("$ref"), str)
        and str(value["$ref"]).startswith(MESSAGE_REF_PREFIX)
    )


def _has_content_type(message: object) -> bool:
    return (
        isinstance(message, Mapping)
        and isinstance(message.get("contentType"), str)
        and bool(str(message["contentType"]).strip())
    )


def _validate_content_type(document: Mapping[str, object], issues: list[Issue]) -> None:
    default_content_type = document.get("defaultContentType")
    if isinstance(default_content_type, str) and default_content_type.strip():
        return
    components = document.get("components")
    messages = components.get("messages") if isinstance(components, Mapping) else None
    if not isinstance(messages, Mapping):
        return
    for name, message in messages.items():
        if not _has_content_type(message):
            issues.append(
                Issue(
                    _pointer(_pointer("/components/messages", str(name)), "contentType"),
                    "defaultContentType is unset, so every message must declare a non-empty contentType",
                )
            )


def _validate_servers(document: Mapping[str, object], issues: list[Issue]) -> None:
    servers = document.get("servers")
    if not isinstance(servers, Mapping) or not servers:
        issues.append(Issue("/servers", "must be a non-empty object"))
        return
    for name, server in servers.items():
        pointer = _pointer("/servers", str(name))
        if not isinstance(server, Mapping):
            issues.append(Issue(pointer, "must be an object"))
            continue
        url = server.get("url")
        if not isinstance(url, str) or not url.strip():
            issues.append(
                Issue(
                    _pointer(pointer, "url"),
                    "server url is required; the importer reads the 2.x-style url field and drops servers without it",
                )
            )
        protocol = server.get("protocol")
        if not isinstance(protocol, str) or not protocol.strip():
            issues.append(
                Issue(
                    _pointer(pointer, "protocol"),
                    "server protocol is required; the importer never relies on address heuristics for a declared server",
                )
            )


def _validate_channels(document: Mapping[str, object], issues: list[Issue]) -> None:
    channels = document.get("channels")
    if not isinstance(channels, Mapping) or not channels:
        issues.append(Issue("/channels", "must be a non-empty object"))
        return
    for name, channel in channels.items():
        pointer = _pointer("/channels", str(name))
        if not isinstance(channel, Mapping):
            issues.append(Issue(pointer, "must be an object"))
            continue
        address = channel.get("address")
        if not isinstance(address, str) or not address.strip():
            issues.append(
                Issue(
                    _pointer(pointer, "address"),
                    "channel address is required; address-less channels are silently dropped by the importer",
                )
            )
        channel_messages = channel.get("messages")
        if channel_messages is None:
            continue
        if not isinstance(channel_messages, Mapping):
            issues.append(Issue(_pointer(pointer, "messages"), "channel messages must be an object"))
            continue
        for message_key, message_ref in channel_messages.items():
            message_pointer = _pointer(_pointer(pointer, "messages"), str(message_key))
            if not _is_message_ref(message_ref):
                issues.append(
                    Issue(
                        message_pointer,
                        f"channel message must reference {MESSAGE_REF_PREFIX}<name>",
                    )
                )


def _channel_message_set(
    document: Mapping[str, object], channel_id: str
) -> Mapping[str, object] | None:
    channels = document.get("channels")
    if not isinstance(channels, Mapping):
        return None
    channel = channels.get(channel_id)
    if not isinstance(channel, Mapping):
        return None
    messages = channel.get("messages")
    return messages if isinstance(messages, Mapping) else None


def _validate_operations(document: Mapping[str, object], issues: list[Issue]) -> int:
    operations = document.get("operations")
    if not isinstance(operations, Mapping) or not operations:
        issues.append(Issue("/operations", "must be a non-empty object"))
        return 0

    valid_operations = 0
    for name, operation in operations.items():
        pointer = _pointer("/operations", str(name))
        before = len(issues)
        if not isinstance(operation, Mapping):
            issues.append(Issue(pointer, "must be an object"))
            continue

        action = operation.get("action")
        if action not in OPERATION_ACTIONS:
            issues.append(
                Issue(
                    _pointer(pointer, "action"),
                    "operation action must be exactly 'send' or 'receive'",
                )
            )

        channel = operation.get("channel")
        channel_id: str | None = None
        channel_ref = channel.get("$ref") if isinstance(channel, Mapping) else None
        if (
            isinstance(channel, Mapping)
            and isinstance(channel_ref, str)
            and channel_ref.startswith(CHANNEL_REF_PREFIX)
        ):
            candidate = channel_ref[len(CHANNEL_REF_PREFIX):]
            if _channel_message_set(document, candidate) is not None or (
                isinstance(document.get("channels"), Mapping)
                and candidate in document["channels"]
            ):
                channel_id = candidate
        else:
            issues.append(
                Issue(
                    _pointer(pointer, "channel"),
                    f"operation channel must be a $ref to {CHANNEL_REF_PREFIX}<id>",
                )
            )

        explicit_messages = operation.get("messages")
        if isinstance(explicit_messages, list) and not explicit_messages:
            # The importer treats an empty list exactly like an absent field:
            # it falls back to the channel's messages and keeps the operation.
            explicit_messages = None
        effective_message_count = 0
        if explicit_messages is not None:
            if not isinstance(explicit_messages, list):
                issues.append(
                    Issue(_pointer(pointer, "messages"), "operation messages must be an array")
                )
            else:
                for index, message_ref in enumerate(explicit_messages):
                    message_pointer = _pointer(_pointer(pointer, "messages"), str(index))
                    if not _is_message_ref(message_ref):
                        issues.append(
                            Issue(
                                message_pointer,
                                f"operation message must reference {MESSAGE_REF_PREFIX}<name>",
                            )
                        )
                    elif _resolve_ref(document, str(message_ref["$ref"])) is not None:
                        effective_message_count += 1
        elif channel_id is not None:
            channel_messages = _channel_message_set(document, channel_id)
            if isinstance(channel_messages, Mapping):
                effective_message_count = len(channel_messages)

        if effective_message_count == 0:
            issues.append(
                Issue(
                    pointer,
                    "operation has no resolvable message; explicit refs or its channel's messages must supply at least one",
                )
            )

        if len(issues) == before:
            valid_operations += 1

    return valid_operations


def _validate_messages(document: Mapping[str, object], issues: list[Issue]) -> None:
    components = document.get("components")
    messages = components.get("messages") if isinstance(components, Mapping) else None
    if not isinstance(messages, Mapping):
        return
    for name, message in messages.items():
        pointer = _pointer("/components/messages", str(name))
        if not isinstance(message, Mapping):
            issues.append(Issue(pointer, "must be an object"))
            continue
        payload = message.get("payload")
        if not isinstance(payload, Mapping):
            issues.append(
                Issue(_pointer(pointer, "payload"), "message payload must be an object schema")
            )
        examples = message.get("examples")
        first_example = examples[0] if isinstance(examples, list) and examples else None
        first_payload = (
            first_example.get("payload") if isinstance(first_example, Mapping) else None
        )
        if first_payload is None:
            issues.append(
                Issue(
                    _pointer(pointer, "examples"),
                    "message's first example must carry a non-null payload; "
                    "the importer uses the first example verbatim",
                )
            )


def validate_document(document: object) -> tuple[list[Issue], int]:
    issues: list[Issue] = []
    if not isinstance(document, Mapping):
        return [Issue("/", "document must be a JSON object")], 0

    _validate_global_markers(document, issues)
    _validate_refs(document, issues)
    _validate_schema_subset(document, issues)

    version = document.get("asyncapi")
    if version != ASYNCAPI_VERSION:
        issues.append(
            Issue(
                "/asyncapi",
                "must be AsyncAPI 3.0.0; a 2.x document imports as zero channels and zero operations in LoadCraft",
            )
        )

    info = document.get("info")
    if not isinstance(info, Mapping):
        issues.append(Issue("/info", "must be an object"))
    else:
        _require_text(info, "title", "/info", issues)
        _require_text(info, "version", "/info", issues)
        _validate_provenance(info, issues)

    _validate_content_type(document, issues)
    _validate_servers(document, issues)
    _validate_channels(document, issues)
    _validate_messages(document, issues)
    operation_count = _validate_operations(document, issues)

    return sorted(set(issues)), operation_count


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a self-contained AsyncAPI 3.0 JSON file for LoadCraft."
    )
    parser.add_argument("spec", type=Path, help="Path to the canonical asyncapi.json")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    path: Path = args.spec
    if path.suffix.lower() != ".json":
        print("ERROR /: canonical LoadCraft artifact must be a .json file", file=sys.stderr)
        return 1
    try:
        document: Any = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR /: file not found: {path}", file=sys.stderr)
        return 1
    except UnicodeDecodeError as exc:
        print(f"ERROR /: file must be UTF-8: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(
            f"ERROR /: invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
            file=sys.stderr,
        )
        return 1
    except RecursionError:
        print("ERROR /: document nesting exceeds the supported depth", file=sys.stderr)
        return 1

    try:
        issues, operation_count = validate_document(document)
    except RecursionError:
        print("ERROR /: document nesting exceeds the supported depth", file=sys.stderr)
        return 1
    if issues:
        for issue in issues:
            print(f"ERROR {issue.pointer}: {issue.message}", file=sys.stderr)
        return 1
    noun = "operation" if operation_count == 1 else "operations"
    print(
        f"PASS: {path} passes LoadCraft structural preflight "
        f"({operation_count} {noun})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
