#!/usr/bin/env python3
"""Validate the single-file OpenAPI contract consumed reliably by LoadCraft."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
UNSUPPORTED_METHODS = {"trace"}
UNRESOLVED_KEYS = {"x-todo", "x-loadcraft-blocker"}
SCHEMA_TYPES = {"string", "number", "integer", "boolean", "array", "object"}
SECURITY_SCHEME_TYPES = {"apiKey", "http", "oauth2", "openIdConnect"}
SUPPORTED_CONTENT_TYPES = {
    "application/json",
    "application/pdf",
    "application/xml",
    "application/octet-stream",
    "application/x-www-form-urlencoded",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "multipart/form-data",
    "text/event-stream",
    "text/html",
    "text/plain",
}
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
    normalized = re.sub(r"[^a-z0-9]+", "_", name.casefold()).strip("_")
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


def _resolved_mapping(
    value: object,
    document: Mapping[str, object],
    pointer: str,
    issues: list[Issue],
) -> Mapping[str, object] | None:
    if not isinstance(value, Mapping):
        issues.append(Issue(pointer, "must be an object"))
        return None
    ref = value.get("$ref")
    if not isinstance(ref, str):
        return value
    resolved = _resolve_ref(document, ref)
    if resolved is None:
        kind = "external $ref is not allowed" if not ref.startswith("#/") else "unresolved $ref"
        issues.append(Issue(_pointer(pointer, "$ref"), f"{kind}: {ref}"))
        return None
    if not isinstance(resolved, Mapping):
        issues.append(Issue(_pointer(pointer, "$ref"), "$ref must resolve to an object"))
        return None
    return resolved


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
                if str(key).lower() in UNRESOLVED_KEYS:
                    issues.append(
                        Issue(_pointer("" if pointer == "/" else pointer, str(key)), "unresolved marker is not allowed in a deliverable")
                    )
                if _is_sensitive_property(str(key)) and not isinstance(child, Mapping):
                    issues.append(
                        Issue(
                            _pointer("" if pointer == "/" else pointer, str(key)),
                            "secret-bearing field must not embed a literal value",
                        )
                    )
        if not isinstance(value, str):
            continue
        if "[TODO" in value.upper():
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
        elif not ref.startswith("#/"):
            issues.append(Issue(ref_pointer, f"external $ref is not allowed: {ref}"))
        elif _resolve_ref(document, ref) is None:
            issues.append(Issue(ref_pointer, f"unresolved $ref: {ref}"))


def _validate_schema_object(
    value: object,
    pointer: str,
    issues: list[Issue],
) -> None:
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
                        Issue(
                            _pointer(pointer, "required"),
                            "required entries must be strings",
                        )
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

    for raw_pointer, value in _walk(document):
        if not isinstance(value, Mapping) or "schema" not in value:
            continue
        pointer = "" if raw_pointer == "/" else raw_pointer
        if any(segment in {"example", "examples"} for segment in pointer.split("/")):
            continue
        schema_pointer = _pointer(pointer, "schema")
        roots.setdefault(schema_pointer, value["schema"])

    for pointer, schema in sorted(roots.items()):
        _validate_schema_object(schema, pointer, issues)


def _collect_parameters(
    path_parameters: object,
    operation_parameters: object,
    document: Mapping[str, object],
    pointer: str,
    issues: list[Issue],
) -> dict[tuple[str, str], Mapping[str, object]]:
    collected: dict[tuple[str, str], Mapping[str, object]] = {}
    for label, raw_parameters in (
        ("path", path_parameters),
        ("operation", operation_parameters),
    ):
        if raw_parameters is None:
            continue
        if not isinstance(raw_parameters, list):
            issues.append(Issue(_pointer(pointer, "parameters"), "parameters must be an array"))
            continue
        for index, raw_parameter in enumerate(raw_parameters):
            parameter_pointer = _pointer(_pointer(pointer, "parameters"), f"{label}-{index}")
            parameter = _resolved_mapping(raw_parameter, document, parameter_pointer, issues)
            if parameter is None:
                continue
            name = parameter.get("name")
            location = parameter.get("in")
            if not isinstance(name, str) or not name:
                issues.append(Issue(_pointer(parameter_pointer, "name"), "must be a non-empty string"))
                continue
            if location not in {"path", "query", "header", "cookie"}:
                issues.append(Issue(_pointer(parameter_pointer, "in"), "must be path, query, header, or cookie"))
                continue
            if not isinstance(parameter.get("schema"), Mapping):
                issues.append(Issue(_pointer(parameter_pointer, "schema"), "parameter schema is required"))
            else:
                raw_schema = parameter["schema"]
                schema = _resolved_mapping(
                    raw_schema,
                    document,
                    _pointer(parameter_pointer, "schema"),
                    issues,
                )
                if schema is not None:
                    schema_type = schema.get("type")
                    if not isinstance(schema_type, str):
                        issues.append(
                            Issue(
                                _pointer(_pointer(parameter_pointer, "schema"), "type"),
                                "parameter schema type must be a single string",
                            )
                        )
                    enum = schema.get("enum")
                    if isinstance(enum, list) and any(
                        not isinstance(item, str) for item in enum
                    ):
                        issues.append(
                            Issue(
                                _pointer(_pointer(parameter_pointer, "schema"), "enum"),
                                "parameter enum values must all be strings for LoadCraft",
                            )
                        )
            collected[(str(location), name)] = parameter
    return collected


def _validate_security(
    operation: Mapping[str, object],
    security_schemes: Mapping[str, object],
    pointer: str,
    issues: list[Issue],
) -> None:
    if "security" not in operation:
        issues.append(
            Issue(
                _pointer(pointer, "security"),
                "operation-level security is required; use [] explicitly for a public operation",
            )
        )
        return
    security = operation.get("security")
    if not isinstance(security, list):
        issues.append(Issue(_pointer(pointer, "security"), "must be an array"))
        return
    for index, requirement in enumerate(security):
        requirement_pointer = _pointer(_pointer(pointer, "security"), str(index))
        if not isinstance(requirement, Mapping):
            issues.append(Issue(requirement_pointer, "security requirement must be an object"))
            continue
        for scheme_name in requirement:
            if scheme_name not in security_schemes:
                issues.append(
                    Issue(_pointer(requirement_pointer, str(scheme_name)), "references an undefined security scheme")
                )


def _validate_security_schemes(
    security_schemes: Mapping[str, object],
    document: Mapping[str, object],
    issues: list[Issue],
) -> None:
    for name, raw_scheme in security_schemes.items():
        pointer = _pointer("/components/securitySchemes", str(name))
        scheme = _resolved_mapping(raw_scheme, document, pointer, issues)
        if scheme is None:
            continue
        scheme_type = scheme.get("type")
        if scheme_type not in SECURITY_SCHEME_TYPES:
            issues.append(
                Issue(
                    _pointer(pointer, "type"),
                    "security scheme type must be apiKey, http, oauth2, or openIdConnect",
                )
            )
            continue
        if scheme_type == "http":
            _require_text(scheme, "scheme", pointer, issues)
        elif scheme_type == "apiKey":
            _require_text(scheme, "name", pointer, issues)
            if scheme.get("in") != "header":
                issues.append(
                    Issue(
                        _pointer(pointer, "in"),
                        "LoadCraft-compatible apiKey security must use a header",
                    )
                )
        elif scheme_type == "oauth2" and not isinstance(scheme.get("flows"), Mapping):
            issues.append(Issue(_pointer(pointer, "flows"), "oauth2 flows are required"))
        elif scheme_type == "openIdConnect":
            _require_text(scheme, "openIdConnectUrl", pointer, issues)


def _validate_request_body(
    raw_body: object,
    document: Mapping[str, object],
    pointer: str,
    issues: list[Issue],
) -> None:
    body = _resolved_mapping(raw_body, document, pointer, issues)
    if body is None:
        return
    if not isinstance(body.get("required"), bool):
        issues.append(
            Issue(
                _pointer(pointer, "required"),
                "requestBody.required must be an explicit boolean",
            )
        )
    content = body.get("content")
    if not isinstance(content, Mapping) or not content:
        issues.append(Issue(_pointer(pointer, "content"), "requestBody content must be a non-empty object"))
        return
    if len(content) != 1:
        issues.append(
            Issue(
                _pointer(pointer, "content"),
                "must declare exactly one request media type because LoadCraft consumes the first one",
            )
        )
    for media_type, raw_media in content.items():
        media_pointer = _pointer(_pointer(pointer, "content"), str(media_type))
        if media_type not in SUPPORTED_CONTENT_TYPES:
            issues.append(
                Issue(
                    media_pointer,
                    f"unsupported request media type for LoadCraft: {media_type}",
                )
            )
        media = _resolved_mapping(raw_media, document, media_pointer, issues)
        if media is not None and not isinstance(media.get("schema"), Mapping):
            issues.append(Issue(_pointer(media_pointer, "schema"), "request schema is required"))


def _validate_responses(
    raw_responses: object,
    document: Mapping[str, object],
    pointer: str,
    issues: list[Issue],
) -> None:
    if not isinstance(raw_responses, Mapping) or not raw_responses:
        issues.append(Issue(pointer, "responses must be a non-empty object"))
        return
    success_codes: list[int] = []
    for raw_status, raw_response in raw_responses.items():
        status = str(raw_status)
        response_pointer = _pointer(pointer, status)
        if not re.fullmatch(r"[1-5][0-9]{2}", status):
            issues.append(
                Issue(
                    response_pointer,
                    "response status must be an explicit three-digit code; default/ranges are lossy in LoadCraft",
                )
            )
            continue
        status_code = int(status)
        if 200 <= status_code < 300:
            success_codes.append(status_code)
        response = _resolved_mapping(raw_response, document, response_pointer, issues)
        if response is None:
            continue
        _require_text(response, "description", response_pointer, issues)
        content = response.get("content")
        if content is None:
            if 200 <= status_code < 300 and status_code not in {204, 205}:
                issues.append(
                    Issue(_pointer(response_pointer, "content"), "successful response content is required except for 204/205")
                )
            continue
        if not isinstance(content, Mapping) or not content:
            issues.append(Issue(_pointer(response_pointer, "content"), "must be a non-empty object"))
            continue
        for media_type, raw_media in content.items():
            media_pointer = _pointer(_pointer(response_pointer, "content"), str(media_type))
            media = _resolved_mapping(raw_media, document, media_pointer, issues)
            if media is not None and not isinstance(media.get("schema"), Mapping):
                issues.append(Issue(_pointer(media_pointer, "schema"), "response schema is required"))
    if not success_codes:
        issues.append(Issue(pointer, "at least one explicit 2xx response is required"))


def validate_document(document: object) -> tuple[list[Issue], int]:
    issues: list[Issue] = []
    if not isinstance(document, Mapping):
        return [Issue("/", "document must be a JSON object")], 0

    _validate_global_markers(document, issues)
    _validate_refs(document, issues)
    _validate_schema_subset(document, issues)

    version = document.get("openapi")
    if version != "3.0.3":
        issues.append(
            Issue(
                "/openapi",
                "must use the OpenAPI 3.0.3 compatibility profile for current LoadCraft",
            )
        )

    info = document.get("info")
    if not isinstance(info, Mapping):
        issues.append(Issue("/info", "must be an object"))
    else:
        _require_text(info, "title", "/info", issues)
        _require_text(info, "version", "/info", issues)
        _validate_provenance(info, issues)

    servers = document.get("servers")
    if not isinstance(servers, list) or not servers:
        issues.append(Issue("/servers", "must contain at least one server URL"))
    else:
        first_server = servers[0]
        if not isinstance(first_server, Mapping):
            issues.append(Issue("/servers/0", "must be an object"))
        else:
            _require_text(first_server, "url", "/servers/0", issues)

    components = document.get("components")
    components_mapping = components if isinstance(components, Mapping) else {}
    security_schemes = components_mapping.get("securitySchemes", {})
    if not isinstance(security_schemes, Mapping):
        issues.append(Issue("/components/securitySchemes", "must be an object"))
        security_schemes = {}
    _validate_security_schemes(security_schemes, document, issues)

    paths = document.get("paths")
    if not isinstance(paths, Mapping) or not paths:
        issues.append(Issue("/paths", "must be a non-empty object"))
        return sorted(set(issues)), 0

    seen_operation_ids: dict[str, str] = {}
    operation_count = 0
    for path, raw_path_item in paths.items():
        path_pointer = _pointer("/paths", str(path))
        if not isinstance(path, str) or not path.startswith("/"):
            issues.append(Issue(path_pointer, "path key must start with /"))
        path_item = _resolved_mapping(raw_path_item, document, path_pointer, issues)
        if path_item is None:
            continue
        for method in UNSUPPORTED_METHODS:
            if method in path_item:
                issues.append(Issue(_pointer(path_pointer, method), "HTTP method is not consumed by LoadCraft"))
        for method in HTTP_METHODS:
            if method not in path_item:
                continue
            operation_count += 1
            operation_pointer = _pointer(path_pointer, method)
            operation = _resolved_mapping(path_item[method], document, operation_pointer, issues)
            if operation is None:
                continue
            operation_id = _require_text(operation, "operationId", operation_pointer, issues)
            if operation_id:
                previous = seen_operation_ids.get(operation_id)
                if previous:
                    issues.append(
                        Issue(
                            _pointer(operation_pointer, "operationId"),
                            f"duplicate operationId {operation_id!r}; first used at {previous}",
                        )
                    )
                else:
                    seen_operation_ids[operation_id] = operation_pointer
            if not any(
                isinstance(operation.get(key), str) and str(operation.get(key)).strip()
                for key in ("summary", "description")
            ):
                issues.append(Issue(operation_pointer, "summary or description is required"))
            _validate_security(operation, security_schemes, operation_pointer, issues)

            parameters = _collect_parameters(
                path_item.get("parameters"),
                operation.get("parameters"),
                document,
                operation_pointer,
                issues,
            )
            for variable in re.findall(r"\{([^{}]+)\}", str(path)):
                parameter = parameters.get(("path", variable))
                if parameter is None:
                    issues.append(
                        Issue(
                            _pointer(operation_pointer, "parameters"),
                            f"path variable {variable!r} has no path parameter",
                        )
                    )
                elif parameter.get("required") is not True:
                    issues.append(
                        Issue(
                            _pointer(operation_pointer, "parameters"),
                            f"path parameter {variable!r} must set required=true",
                        )
                    )

            if "requestBody" in operation:
                if method in {"get", "delete", "head"}:
                    issues.append(
                        Issue(
                            _pointer(operation_pointer, "requestBody"),
                            "GET/DELETE request bodies are rejected by LoadCraft flow validation",
                        )
                    )
                _validate_request_body(
                    operation["requestBody"],
                    document,
                    _pointer(operation_pointer, "requestBody"),
                    issues,
                )
            _validate_responses(
                operation.get("responses"),
                document,
                _pointer(operation_pointer, "responses"),
                issues,
            )

    if operation_count == 0:
        issues.append(Issue("/paths", "contains no supported HTTP operations"))
    return sorted(set(issues)), operation_count


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a self-contained OpenAPI JSON file for LoadCraft."
    )
    parser.add_argument("spec", type=Path, help="Path to the canonical openapi.json")
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

    issues, operation_count = validate_document(document)
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
