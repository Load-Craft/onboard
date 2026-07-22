from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

PACK_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_VALIDATOR = (
    PACK_ROOT / "skills" / "loadcraft-openapi" / "scripts" / "validate_openapi.py"
)
JOURNEY_VALIDATOR = (
    PACK_ROOT
    / "skills"
    / "loadcraft-journeys"
    / "scripts"
    / "validate_journeys.py"
)


def _valid_openapi() -> dict[str, Any]:
    return {
        "openapi": "3.0.3",
        "info": {"title": "Orders API", "version": "1.0.0"},
        "servers": [{"url": "https://app.example.com"}],
        "paths": {
            "/api/orders": {
                "post": {
                    "operationId": "createOrder",
                    "summary": "Create an order",
                    "description": "Creates an order and returns its persisted representation.",
                    "security": [{"bearerAuth": []}],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CreateOrder"},
                                "example": {"item_id": "item-example", "quantity": 1},
                            }
                        },
                    },
                    "responses": {
                        "201": {
                            "description": "Order created",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/Order"},
                                    "example": {
                                        "id": "order-example",
                                        "item_id": "item-example",
                                        "quantity": 1,
                                    },
                                }
                            },
                        },
                        "400": {
                            "description": "Invalid order",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/Error"}
                                }
                            },
                        },
                    },
                }
            }
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
            },
            "schemas": {
                "CreateOrder": {
                    "type": "object",
                    "required": ["item_id", "quantity"],
                    "properties": {
                        "item_id": {"type": "string"},
                        "quantity": {"type": "integer", "minimum": 1},
                    },
                },
                "Order": {
                    "type": "object",
                    "required": ["id", "item_id", "quantity"],
                    "properties": {
                        "id": {"type": "string"},
                        "item_id": {"type": "string"},
                        "quantity": {"type": "integer"},
                    },
                },
                "Error": {
                    "type": "object",
                    "required": ["message"],
                    "properties": {"message": {"type": "string"}},
                },
            },
        },
    }


class ValidatorCliTestCase(unittest.TestCase):
    def _run(self, script: Path, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script), str(target)],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_openapi_accepts_a_self_contained_loadcraft_document(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(_valid_openapi()), encoding="utf-8")

            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 operation", result.stdout)
        self.assertIn("structural preflight", result.stdout)
        self.assertNotIn("LoadCraft-ready", result.stdout)

    def test_openapi_rejects_external_refs(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders"]["post"]["requestBody"]["content"][
            "application/json"
        ]["schema"] = {"$ref": "./schemas.json#/CreateOrder"}

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("external $ref", result.stderr)

    def test_openapi_requires_operation_level_security(self) -> None:
        document = _valid_openapi()
        document["security"] = [{"bearerAuth": []}]
        del document["paths"]["/api/orders"]["post"]["security"]

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("operation-level security", result.stderr)

    def test_openapi_rejects_unresolved_todos(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders"]["post"]["x-todo"] = "guess response"

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    def test_openapi_rejects_duplicate_operation_ids(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders/{order_id}"] = {
            "get": {
                "operationId": "createOrder",
                "summary": "Read an order",
                "security": [{"bearerAuth": []}],
                "parameters": [
                    {
                        "name": "order_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {"200": {"description": "Order returned"}},
            }
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate operationId", result.stderr)

    def test_openapi_rejects_31_union_parameter_types(self) -> None:
        document = _valid_openapi()
        document["openapi"] = "3.1.0"
        operation = document["paths"]["/api/orders"]["post"]
        operation["parameters"] = [
            {
                "name": "state",
                "in": "query",
                "schema": {"type": ["string", "null"]},
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("OpenAPI 3.0.3 compatibility profile", result.stderr)
        self.assertIn("single string", result.stderr)

    def test_openapi_rejects_numeric_parameter_enums(self) -> None:
        document = _valid_openapi()
        operation = document["paths"]["/api/orders"]["post"]
        operation["parameters"] = [
            {
                "name": "priority",
                "in": "query",
                "schema": {"type": "integer", "enum": [1, 2]},
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parameter enum values must all be strings", result.stderr)

    def test_openapi_rejects_lossy_unions_and_get_bodies(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders"]["get"] = {
            "operationId": "listOrders",
            "summary": "List orders",
            "security": [{"bearerAuth": []}],
            "requestBody": {
                "content": {
                    "application/json": {
                        "schema": {
                            "oneOf": [
                                {"type": "object", "properties": {"page": {"type": "integer"}}},
                                {"type": "object", "properties": {"cursor": {"type": "string"}}},
                            ]
                        }
                    }
                }
            },
            "responses": {
                "200": {
                    "description": "Orders returned",
                    "content": {
                        "application/json": {
                            "schema": {"type": "array", "items": {"$ref": "#/components/schemas/Order"}}
                        }
                    },
                }
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GET/DELETE request bodies", result.stderr)
        self.assertIn("oneOf/anyOf", result.stderr)

    def test_openapi_rejects_missing_required_properties(self) -> None:
        document = _valid_openapi()
        document["components"]["schemas"]["CreateOrder"]["required"].append("missing")

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required property 'missing' is not declared", result.stderr)

    def test_openapi_does_not_treat_example_fields_as_schema_keywords(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders"]["post"]["responses"]["201"]["content"][
            "application/json"
        ]["example"] = {
            "id": "order-example",
            "type": "wholesale",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_openapi_rejects_undefined_security_scheme_shape(self) -> None:
        document = _valid_openapi()
        document["components"]["securitySchemes"]["bearerAuth"] = {}

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("security scheme type", result.stderr)

    def test_openapi_requires_explicit_body_required_and_supported_media(self) -> None:
        document = _valid_openapi()
        request_body = document["paths"]["/api/orders"]["post"]["requestBody"]
        del request_body["required"]
        media = request_body["content"].pop("application/json")
        request_body["content"]["application/vnd.orders+json"] = media

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requestBody.required", result.stderr)
        self.assertIn("unsupported request media type", result.stderr)

    def test_openapi_rejects_examples_on_secret_bearing_properties(self) -> None:
        document = _valid_openapi()
        document["components"]["schemas"]["CreateOrder"]["properties"]["password"] = {
            "type": "string",
            "example": "sample-password",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_openapi_rejects_secret_literals_in_example_objects(self) -> None:
        document = _valid_openapi()
        document["paths"]["/api/orders"]["post"]["requestBody"]["content"][
            "application/json"
        ]["example"] = {"password": "sample-password"}

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing field", result.stderr)

    def test_openapi_accepts_valid_provenance_stamp(self) -> None:
        document = _valid_openapi()
        document["info"]["x-loadcraft-source"] = {
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "dirty": False,
            "method": "static-trace",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_openapi_rejects_malformed_provenance_stamp(self) -> None:
        document = _valid_openapi()
        document["info"]["x-loadcraft-source"] = {
            "commit": "",
            "dirty": "no",
            "method": "guesswork",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            result = self._run(OPENAPI_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("commit must be a git object hash", result.stderr)
        self.assertIn("dirty must be a boolean", result.stderr)
        self.assertIn("method must be", result.stderr)

    def test_journey_accepts_plain_grounded_description(self) -> None:
        description = """Use the provided administrator test account and start at https://app.example.com.

Open \"Orders\". Click \"Create order\". Type a unique order name into \"Name\". Click \"Save\".

Finish when \"Order created\" is visible and the new order appears in the list.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 journey", result.stdout)

    def test_journey_rejects_markdown_and_runner_dialect(self) -> None:
        description = """# Create an order

1. Open Orders.
2. Run getByRole('button', { name: 'Create order' }).click().

| Step | Selector |
| 2 | [data-testid=\"create-order\"] |
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Markdown", result.stderr)
        self.assertIn("runner-specific", result.stderr)

    def test_journey_rejects_cross_file_dependencies_and_todos(self) -> None:
        description = """Run JRN-001 first, then open \"Orders\".

[TODO: find the save button]

Finish when the order is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cross-file dependency", result.stderr)
        self.assertIn("unresolved marker", result.stderr)

    def test_journey_rejects_secret_like_values(self) -> None:
        description = """Use Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature.

Open \"Orders\" and click \"Create order\".

Finish when \"Order created\" is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_journey_rejects_literal_account_email(self) -> None:
        description = """Use the account customer@acme.test to work with orders.

Open "Orders". Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "list-orders.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("credential-like value", result.stderr)

    def test_journey_rejects_literal_password_assignment(self) -> None:
        description = """Sign in with password: sample-password before continuing.

Open "Orders". Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "list-orders.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("credential-like value", result.stderr)

    def test_journey_requires_an_observable_finish_condition(self) -> None:
        description = """Use the provided administrator test account.

Open \"Orders\" and click \"Create order\".
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("observable finish condition", result.stderr)

    def test_journey_requires_finish_condition_as_the_final_instruction(self) -> None:
        description = """Open "Orders".
Check that the orders list is visible.
Click "Create order".
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, target)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("final instruction", result.stderr)

    def test_journey_directory_accepts_valid_provenance_stamp(self) -> None:
        description = """Open the "Orders" page.

Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "list-orders.txt").write_text(description, encoding="utf-8")
            (directory / ".provenance.json").write_text(
                json.dumps(
                    {
                        "commit": "0123456789abcdef0123456789abcdef01234567",
                        "dirty": False,
                    }
                ),
                encoding="utf-8",
            )
            result = self._run(JOURNEY_VALIDATOR, directory)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 journey", result.stdout)

    def test_journey_directory_rejects_malformed_provenance_stamp(self) -> None:
        description = """Open the "Orders" page.

Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "list-orders.txt").write_text(description, encoding="utf-8")
            (directory / ".provenance.json").write_text(
                json.dumps({"commit": "", "dirty": "no", "note": "x"}),
                encoding="utf-8",
            )
            result = self._run(JOURNEY_VALIDATOR, directory)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("provenance commit must be a git object hash", result.stderr)
        self.assertIn("provenance dirty must be a boolean", result.stderr)
        self.assertIn("unsupported keys", result.stderr)

    def test_journey_directory_rejects_invalid_provenance_json(self) -> None:
        description = """Open the "Orders" page.

Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "list-orders.txt").write_text(description, encoding="utf-8")
            (directory / ".provenance.json").write_text("{not json", encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, directory)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("provenance stamp must be valid JSON", result.stderr)

    def test_journey_directory_rejects_non_text_artifacts(self) -> None:
        description = "Open \"Orders\". Check that the orders list is visible."
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "list-orders.txt").write_text(description, encoding="utf-8")
            (directory / "README.md").write_text("journey notes", encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, directory)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only .txt journey files", result.stderr)

    def test_journey_rejects_duplicate_descriptions_and_source_references(self) -> None:
        description = """Open "Orders" as implemented in src/orders/OrdersPage.tsx:42.

Check that the orders list is visible.
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "list-orders.txt").write_text(description, encoding="utf-8")
            (directory / "view-orders.txt").write_text(description, encoding="utf-8")
            result = self._run(JOURNEY_VALIDATOR, directory)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source file reference", result.stderr)
        self.assertIn("duplicates", result.stderr)


if __name__ == "__main__":
    unittest.main()
