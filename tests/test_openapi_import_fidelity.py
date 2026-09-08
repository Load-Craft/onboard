"""Cover the rules that protect what survives a LoadCraft import.

Two families live here. Referenced leaf enums are an ERROR, because the
canonical property model does not follow a `$ref` for a leaf and the enum
silently disappears. Missing examples, unusable parameters and dropped
`examples` maps are WARNINGS, because the importer accepts them while
generating measurably worse flows and feeder data; `--strict` promotes them.

Every fixture starts from the shared valid document and is mutated in exactly
one spot, so an asserted message can only come from the rule under test.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from tests.test_validators import OPENAPI_VALIDATOR, _valid_openapi

ENUM_INLINE_MESSAGE = "enum-bearing schema must be inlined here"
ARRAY_WRAPPER_MESSAGE = "referenced array schema hides an enum in its items"
RESPONSE_EXAMPLE_MESSAGE = "body-bearing response has no example"
PARAMETER_VALUE_MESSAGE = "parameter has no example, enum or default"
RESPONSE_EXAMPLES_MAP_MESSAGE = "a named examples map on a response is dropped on import"
PARAMETER_EXAMPLES_MAP_MESSAGE = "a named examples map on a parameter is dropped on import"


class OpenapiImportFidelityTestCase(unittest.TestCase):
    def _run(self, document: dict[str, Any], *flags: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(OPENAPI_VALIDATOR), str(target), *flags],
                check=False,
                capture_output=True,
                text=True,
            )

    def _operation(self, document: dict[str, Any]) -> dict[str, Any]:
        return document["paths"]["/api/orders"]["post"]

    def _clean_document(self) -> dict[str, Any]:
        """The shared fixture plus the one example it is missing."""
        document = copy.deepcopy(_valid_openapi())
        responses = self._operation(document)["responses"]
        responses["400"]["content"]["application/json"]["example"] = {
            "message": "quantity must be at least 1"
        }
        return document

    def _with_status_enum_component(self, document: dict[str, Any]) -> dict[str, Any]:
        document["components"]["schemas"]["OrderStatus"] = {
            "type": "string",
            "enum": ["open", "shipped"],
        }
        return document

    # ---- referenced leaf enums are rejected -------------------------------

    def test_rejects_enum_referenced_from_a_property(self) -> None:
        document = self._with_status_enum_component(self._clean_document())
        document["components"]["schemas"]["Order"]["properties"]["status"] = {
            "$ref": "#/components/schemas/OrderStatus"
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ENUM_INLINE_MESSAGE, result.stderr)
        self.assertIn("Order/properties/status/$ref", result.stderr)

    def test_rejects_enum_reached_through_a_reference_chain(self) -> None:
        document = self._with_status_enum_component(self._clean_document())
        document["components"]["schemas"]["StatusAlias"] = {
            "$ref": "#/components/schemas/OrderStatus"
        }
        document["components"]["schemas"]["Order"]["properties"]["status"] = {
            "$ref": "#/components/schemas/StatusAlias"
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ENUM_INLINE_MESSAGE, result.stderr)

    def test_rejects_enum_wrapped_in_all_of(self) -> None:
        document = self._with_status_enum_component(self._clean_document())
        document["components"]["schemas"]["DescribedStatus"] = {
            "allOf": [{"$ref": "#/components/schemas/OrderStatus"}],
            "description": "Fulfilment state.",
        }
        document["components"]["schemas"]["Order"]["properties"]["status"] = {
            "$ref": "#/components/schemas/DescribedStatus"
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ENUM_INLINE_MESSAGE, result.stderr)

    def test_rejects_enum_referenced_from_additional_properties(self) -> None:
        document = self._with_status_enum_component(self._clean_document())
        document["components"]["schemas"]["StatusMap"] = {
            "type": "object",
            "additionalProperties": {"$ref": "#/components/schemas/OrderStatus"},
        }
        document["components"]["schemas"]["Order"]["properties"]["statuses"] = {
            "$ref": "#/components/schemas/StatusMap"
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ENUM_INLINE_MESSAGE, result.stderr)

    def test_rejects_referenced_array_that_hides_an_enum(self) -> None:
        document = self._clean_document()
        document["components"]["schemas"]["StatusList"] = {
            "type": "array",
            "items": {"type": "string", "enum": ["open", "shipped"]},
        }
        document["components"]["schemas"]["Order"]["properties"]["statuses"] = {
            "$ref": "#/components/schemas/StatusList"
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ARRAY_WRAPPER_MESSAGE, result.stderr)

    def test_rejects_enum_referenced_from_a_parameter_schema(self) -> None:
        document = self._with_status_enum_component(self._clean_document())
        self._operation(document)["parameters"] = [
            {
                "name": "status",
                "in": "query",
                "required": False,
                "schema": {"$ref": "#/components/schemas/OrderStatus"},
            }
        ]
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn(ENUM_INLINE_MESSAGE, result.stderr)
        self.assertIn("parameters/query-status/schema/$ref", result.stderr)

    def test_accepts_a_referenced_object_schema_that_also_declares_an_enum(self) -> None:
        """An object schema is projected as an object, so its reference is followed."""
        document = self._clean_document()
        document["components"]["schemas"]["Shape"] = {
            "type": "object",
            "enum": [{"kind": "box"}],
        }
        document["components"]["schemas"]["Order"]["properties"]["shape"] = {
            "$ref": "#/components/schemas/Shape"
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_an_enum_as_a_whole_response_body(self) -> None:
        """A body schema reference is followed, unlike a leaf property reference."""
        document = self._with_status_enum_component(self._clean_document())
        self._operation(document)["responses"]["200"] = {
            "description": "Current status",
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/OrderStatus"},
                    "example": "open",
                }
            },
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    # ---- unresolved markers ------------------------------------------------

    def test_rejects_a_tbd_marker(self) -> None:
        document = self._clean_document()
        document["components"]["schemas"]["Order"]["properties"]["id"]["description"] = "TBD"
        result = self._run(document)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unresolved marker", result.stderr)

    # ---- the secret heuristic must not fire on an OAuth2 scope -------------

    def test_accepts_a_sensitively_named_oauth_scope(self) -> None:
        """A scope name comes from the identity provider and cannot be renamed."""
        document = self._clean_document()
        document["components"]["securitySchemes"]["oauth"] = {
            "type": "oauth2",
            "flows": {
                "clientCredentials": {
                    "tokenUrl": "https://app.example.com/oauth/token",
                    "scopes": {"read:secret": "Read protected records"},
                }
            },
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    # ---- warnings: accepted on import, worse in practice -------------------

    def test_clean_document_emits_no_warning(self) -> None:
        result = self._run(self._clean_document(), "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("WARN", result.stderr)

    def test_warns_about_a_response_without_an_example(self) -> None:
        document = self._clean_document()
        del self._operation(document)["responses"]["400"]["content"]["application/json"]["example"]
        result = self._run(document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(RESPONSE_EXAMPLE_MESSAGE, result.stderr)
        self.assertIn("PASS", result.stdout)
        self.assertIn("1 warning", result.stdout)

    def test_strict_promotes_a_missing_response_example_to_an_error(self) -> None:
        document = self._clean_document()
        del self._operation(document)["responses"]["400"]["content"]["application/json"]["example"]
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ERROR /paths/~1api~1orders/post/responses/400", result.stderr)
        self.assertNotIn("WARN", result.stderr)

    def test_does_not_ask_for_an_example_on_a_binary_body(self) -> None:
        document = self._clean_document()
        self._operation(document)["responses"]["200"] = {
            "description": "The rendered invoice",
            "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_does_not_ask_for_an_example_on_an_event_stream(self) -> None:
        document = self._clean_document()
        self._operation(document)["responses"]["200"] = {
            "description": "Progress events",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_warns_about_a_named_examples_map_on_a_response(self) -> None:
        document = self._clean_document()
        media = self._operation(document)["responses"]["400"]["content"]["application/json"]
        media["examples"] = {
            "belowMinimum": {"value": {"message": "quantity must be at least 1"}},
            "unknownItem": {"value": {"message": "item_id not found"}},
        }
        result = self._run(document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(RESPONSE_EXAMPLES_MAP_MESSAGE, result.stderr)

    def test_warns_about_a_parameter_a_caller_cannot_fill(self) -> None:
        document = self._clean_document()
        self._operation(document)["parameters"] = [
            {"name": "region", "in": "query", "required": False, "schema": {"type": "string"}}
        ]
        result = self._run(document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(PARAMETER_VALUE_MESSAGE, result.stderr)
        self.assertIn("parameters/query-region", result.stderr)

    def test_accepts_a_parameter_level_example(self) -> None:
        document = self._clean_document()
        self._operation(document)["parameters"] = [
            {
                "name": "region",
                "in": "query",
                "required": False,
                "example": "eu-west",
                "schema": {"type": "string"},
            }
        ]
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_a_schema_level_default_instead_of_an_example(self) -> None:
        document = self._clean_document()
        self._operation(document)["parameters"] = [
            {
                "name": "region",
                "in": "query",
                "required": False,
                "schema": {"type": "string", "default": "eu-west"},
            }
        ]
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_does_not_ask_for_a_value_on_a_secret_named_parameter(self) -> None:
        """The profile forbids a literal there, so the warning would be unresolvable."""
        document = self._clean_document()
        self._operation(document)["parameters"] = [
            {"name": "nextToken", "in": "query", "required": False, "schema": {"type": "string"}}
        ]
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_does_not_ask_for_a_value_on_a_security_scheme_header(self) -> None:
        document = self._clean_document()
        document["components"]["securitySchemes"]["tenantHeader"] = {
            "type": "apiKey",
            "in": "header",
            "name": "x-tenant-id",
        }
        self._operation(document)["parameters"] = [
            {"name": "x-tenant-id", "in": "header", "required": True, "schema": {"type": "string"}}
        ]
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_does_not_ask_for_a_value_on_a_preflight_parameter(self) -> None:
        document = self._clean_document()
        document["paths"]["/api/orders/{order_id}"] = {
            "options": {
                "operationId": "preflightOrder",
                "summary": "Cross-origin preflight",
                "security": [],
                "parameters": [
                    {
                        "name": "order_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Preflight accepted",
                        "content": {
                            "application/json": {"schema": {"type": "object"}, "example": {}}
                        },
                    }
                },
            }
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_warns_about_a_named_examples_map_on_a_parameter(self) -> None:
        document = self._clean_document()
        self._operation(document)["parameters"] = [
            {
                "name": "region",
                "in": "query",
                "required": False,
                "schema": {"type": "string", "example": "eu-west"},
                "examples": {"eu": {"value": "eu-west"}, "us": {"value": "us-east"}},
            }
        ]
        result = self._run(document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(PARAMETER_EXAMPLES_MAP_MESSAGE, result.stderr)

    # ---- provenance --------------------------------------------------------

    def test_accepts_platform_export_as_a_provenance_method(self) -> None:
        document = self._clean_document()
        document["info"]["x-loadcraft-source"] = {
            "commit": "0123abc",
            "dirty": False,
            "method": "platform-export",
        }
        result = self._run(document, "--strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    # ---- input robustness --------------------------------------------------

    def test_reports_a_directory_without_a_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.mkdir()
            result = subprocess.run(
                [sys.executable, str(OPENAPI_VALIDATOR), str(target)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("is a directory", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
