from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

PACK_ROOT = Path(__file__).resolve().parents[1]
ASYNCAPI_VALIDATOR = (
    PACK_ROOT / "skills" / "loadcraft-asyncapi" / "scripts" / "validate_asyncapi.py"
)


def _valid_asyncapi() -> dict[str, Any]:
    """A minimal AsyncAPI 3.0 document that passes every LoadCraft rule."""
    return {
        "asyncapi": "3.0.0",
        "info": {"title": "Orders Events API", "version": "1.0.0"},
        "defaultContentType": "application/json",
        "servers": {
            "production": {"url": "ws://app.example.com/ws", "protocol": "ws"}
        },
        "channels": {
            "ordersEvents": {
                "address": "orders-events",
                "messages": {
                    "orderCreated": {"$ref": "#/components/messages/OrderCreated"}
                },
            }
        },
        "operations": {
            "receiveOrderCreated": {
                "action": "receive",
                "channel": {"$ref": "#/channels/ordersEvents"},
            },
            "sendOrderCreated": {
                "action": "send",
                "channel": {"$ref": "#/channels/ordersEvents"},
            },
        },
        "components": {
            "messages": {
                "OrderCreated": {
                    "contentType": "application/json",
                    "payload": {
                        "type": "object",
                        "required": ["messageType", "orderId"],
                        "properties": {
                            "messageType": {
                                "type": "string",
                                "const": "orderCreated",
                            },
                            "orderId": {"type": "string"},
                        },
                    },
                    "examples": [
                        {
                            "name": "order-example",
                            "payload": {
                                "messageType": "orderCreated",
                                "orderId": "order-example",
                            },
                        }
                    ],
                }
            }
        },
    }


class AsyncapiRuleTestCase(unittest.TestCase):
    """Cover individual enforced rules in validate_asyncapi.py.

    Every rejected-input fixture starts from the shared valid document and is
    mutated in exactly one spot, so an asserted error message can only come
    from the rule under test.
    """

    def _run(self, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(ASYNCAPI_VALIDATOR), str(target)],
            check=False,
            capture_output=True,
            text=True,
        )

    def _run_document(self, document: dict[str, Any]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "asyncapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            return self._run(target)

    def _run_raw(self, filename: str, content: bytes) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / filename
            target.write_bytes(content)
            return self._run(target)

    def _message(self, document: dict[str, Any]) -> dict[str, Any]:
        return document["components"]["messages"]["OrderCreated"]

    # -- accept ---------------------------------------------------------------

    def test_accepts_a_self_contained_loadcraft_document(self) -> None:
        result = self._run_document(_valid_asyncapi())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 operations", result.stdout)
        self.assertIn("structural preflight", result.stdout)

    def test_accepts_valid_provenance_stamp(self) -> None:
        document = _valid_asyncapi()
        document["info"]["x-loadcraft-source"] = {
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "dirty": False,
            "method": "static-trace",
        }
        result = self._run_document(document)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_per_message_content_type_without_default(self) -> None:
        document = _valid_asyncapi()
        del document["defaultContentType"]
        self._message(document)["contentType"] = "application/json"
        result = self._run_document(document)
        self.assertEqual(result.returncode, 0, result.stderr)

    # -- main() I/O guards ----------------------------------------------------

    def test_rejects_non_json_suffix(self) -> None:
        result = self._run_raw(
            "asyncapi.txt", json.dumps(_valid_asyncapi()).encode("utf-8")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be a .json file", result.stderr)

    def test_rejects_nonexistent_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "missing.json"
            result = self._run(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file not found", result.stderr)

    def test_rejects_invalid_json(self) -> None:
        result = self._run_raw("asyncapi.json", b"{ not valid json ")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid JSON at line", result.stderr)

    def test_rejects_non_utf8_bytes(self) -> None:
        result = self._run_raw("asyncapi.json", b"\xff\xfe\xfa not utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file must be UTF-8", result.stderr)

    def test_rejects_excessive_nesting_with_clean_message(self) -> None:
        depth = 2000
        blob = '{"a":' * depth + "1" + "}" * depth
        result = self._run_raw("asyncapi.json", blob.encode("utf-8"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nesting exceeds the supported depth", result.stderr)

    # -- document version -----------------------------------------------------

    def test_rejects_asyncapi_2x_version(self) -> None:
        document = _valid_asyncapi()
        document["asyncapi"] = "2.6.0"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("zero channels", result.stderr)

    def test_rejects_missing_asyncapi_version(self) -> None:
        document = _valid_asyncapi()
        del document["asyncapi"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("3.0.0", result.stderr)

    # -- info -----------------------------------------------------------------

    def test_rejects_non_object_info(self) -> None:
        document = _valid_asyncapi()
        document["info"] = "Orders Events API"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info", result.stderr)
        self.assertIn("must be an object", result.stderr)

    def test_rejects_empty_info_title(self) -> None:
        document = _valid_asyncapi()
        document["info"]["title"] = ""
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info/title", result.stderr)
        self.assertIn("non-empty string", result.stderr)

    def test_rejects_empty_info_version(self) -> None:
        document = _valid_asyncapi()
        document["info"]["version"] = ""
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info/version", result.stderr)
        self.assertIn("non-empty string", result.stderr)

    # -- content type ---------------------------------------------------------

    def test_rejects_missing_content_type_everywhere(self) -> None:
        document = _valid_asyncapi()
        del document["defaultContentType"]
        del self._message(document)["contentType"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("defaultContentType", result.stderr)
        self.assertIn("contentType", result.stderr)

    # -- servers --------------------------------------------------------------

    def test_rejects_empty_servers(self) -> None:
        document = _valid_asyncapi()
        document["servers"] = {}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/servers", result.stderr)
        self.assertIn("non-empty object", result.stderr)

    def test_rejects_server_without_url(self) -> None:
        document = _valid_asyncapi()
        del document["servers"]["production"]["url"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("url is required", result.stderr)

    def test_rejects_server_without_protocol(self) -> None:
        document = _valid_asyncapi()
        del document["servers"]["production"]["protocol"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("protocol is required", result.stderr)

    # -- channels -------------------------------------------------------------

    def test_rejects_empty_channels(self) -> None:
        document = _valid_asyncapi()
        document["channels"] = {}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/channels", result.stderr)
        self.assertIn("non-empty object", result.stderr)

    def test_rejects_channel_without_address(self) -> None:
        document = _valid_asyncapi()
        del document["channels"]["ordersEvents"]["address"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("address is required", result.stderr)
        self.assertIn("silently dropped", result.stderr)

    def test_rejects_channel_message_not_a_components_ref(self) -> None:
        document = _valid_asyncapi()
        document["channels"]["ordersEvents"]["messages"]["orderCreated"] = {
            "payload": {"type": "object"}
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("channel message must reference #/components/messages/", result.stderr)

    def test_rejects_channel_message_ref_that_does_not_resolve(self) -> None:
        document = _valid_asyncapi()
        document["channels"]["ordersEvents"]["messages"]["orderCreated"] = {
            "$ref": "#/components/messages/Missing"
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved $ref", result.stderr)

    # -- operations -----------------------------------------------------------

    def test_rejects_empty_operations(self) -> None:
        document = _valid_asyncapi()
        document["operations"] = {}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/operations", result.stderr)
        self.assertIn("non-empty object", result.stderr)

    def test_rejects_invalid_operation_action(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["action"] = "publish"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("action must be exactly 'send' or 'receive'", result.stderr)

    def test_rejects_operation_channel_not_a_channel_ref(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["channel"] = {"address": "x"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("operation channel must be a $ref to #/channels/", result.stderr)

    def test_rejects_operation_channel_ref_that_does_not_resolve(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["channel"] = {
            "$ref": "#/channels/missing"
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved $ref", result.stderr)
        self.assertIn("no resolvable message", result.stderr)

    def test_rejects_operation_message_not_a_components_ref(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["messages"] = [
            {"$ref": "#/channels/ordersEvents/messages/orderCreated"}
        ]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("operation message must reference #/components/messages/", result.stderr)

    def test_rejects_operation_with_no_resolvable_message(self) -> None:
        document = _valid_asyncapi()
        del document["channels"]["ordersEvents"]["messages"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no resolvable message", result.stderr)

    # -- messages -------------------------------------------------------------

    def test_rejects_non_object_message_payload(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"] = "OrderCreated"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("payload must be an object schema", result.stderr)

    def test_rejects_message_without_example_payload(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["examples"] = [{"name": "order-example"}]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first example verbatim", result.stderr)

    def test_rejects_message_without_any_examples(self) -> None:
        document = _valid_asyncapi()
        del self._message(document)["examples"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first example verbatim", result.stderr)

    # -- schema subset --------------------------------------------------------

    def test_rejects_one_of_schema(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"] = {
            "oneOf": [
                {"type": "object", "properties": {"a": {"type": "string"}}},
                {"type": "object", "properties": {"b": {"type": "string"}}},
            ]
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("oneOf/anyOf", result.stderr)

    def test_rejects_type_array_schema(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"]["properties"]["orderId"] = {
            "type": ["string", "null"]
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("single string", result.stderr)

    def test_rejects_boolean_schema(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"]["properties"]["flag"] = True
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("boolean schemas", result.stderr)

    def test_rejects_unsupported_schema_type(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"]["properties"]["orderId"] = {"type": "null"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported schema type", result.stderr)

    # -- refs -----------------------------------------------------------------

    def test_rejects_external_ref(self) -> None:
        document = _valid_asyncapi()
        document["channels"]["ordersEvents"]["messages"]["orderCreated"] = {
            "$ref": "./messages.json#/OrderCreated"
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("external $ref", result.stderr)

    def test_rejects_cyclic_ref_chain(self) -> None:
        document = _valid_asyncapi()
        document["components"]["schemas"] = {
            "Loop": {"$ref": "#/components/schemas/Loop"}
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cyclic $ref", result.stderr)

    def test_rejects_ref_chain_exceeding_depth(self) -> None:
        document = _valid_asyncapi()
        schemas: dict[str, Any] = {}
        for index in range(25):
            schemas[f"S{index}"] = {"$ref": f"#/components/schemas/S{index + 1}"}
        schemas["S25"] = {"type": "object"}
        document["components"]["schemas"] = schemas
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reference chain exceeds", result.stderr)

    # -- unresolved markers ---------------------------------------------------

    def test_rejects_x_todo_marker(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["x-todo"] = "confirm direction"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    def test_rejects_x_loadcraft_blocker_marker(self) -> None:
        document = _valid_asyncapi()
        document["info"]["x-loadcraft-blocker"] = "unknown schema"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    def test_rejects_todo_text_marker(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["summary"] = "[ TODO confirm payload shape ]"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    # -- secrets --------------------------------------------------------------

    def test_rejects_jwt_shaped_secret_literal(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["summary"] = (
            "Debug token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJzdWIiOiJvcmRlci1leGFtcGxlIn0"
            ".synthetic0signature0value"
        )
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_rejects_secret_bearing_property_literal(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["payload"]["properties"]["password"] = {
            "type": "string",
            "example": "sample-password",
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_rejects_secret_bearing_field_literal(self) -> None:
        document = _valid_asyncapi()
        self._message(document)["examples"][0]["payload"]["authorization"] = "Token abc"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing field", result.stderr)

    # -- provenance -----------------------------------------------------------

    def test_rejects_malformed_provenance_stamp(self) -> None:
        document = _valid_asyncapi()
        document["info"]["x-loadcraft-source"] = {
            "commit": "",
            "dirty": "no",
            "method": "guesswork",
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("commit must be a git object hash", result.stderr)
        self.assertIn("dirty must be a boolean", result.stderr)
        self.assertIn("method must be", result.stderr)

    def test_rejects_provenance_with_unsupported_keys(self) -> None:
        document = _valid_asyncapi()
        document["info"]["x-loadcraft-source"] = {
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "dirty": False,
            "method": "native-export",
            "note": "extra",
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported keys", result.stderr)


class AsyncapiReviewRegressionTestCase(unittest.TestCase):
    def _run_document(self, document: dict[str, Any]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "asyncapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(ASYNCAPI_VALIDATOR), str(target)],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_rejects_first_example_without_payload(self) -> None:
        document = _valid_asyncapi()
        message = document["components"]["messages"]["OrderCreated"]
        real_payload = message["examples"][0]["payload"]
        message["examples"] = [
            {"name": "placeholder"},
            {"name": "real", "payload": real_payload},
        ]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first example", result.stderr)

    def test_rejects_null_payload_in_first_example(self) -> None:
        document = _valid_asyncapi()
        document["components"]["messages"]["OrderCreated"]["examples"][0]["payload"] = None
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first example", result.stderr)

    def test_accepts_operation_with_empty_messages_list(self) -> None:
        document = _valid_asyncapi()
        document["operations"]["receiveOrderCreated"]["messages"] = []
        result = self._run_document(document)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_properties_that_are_not_an_object(self) -> None:
        document = _valid_asyncapi()
        document["components"]["messages"]["OrderCreated"]["payload"] = {
            "type": "object",
            "properties": [{"orderId": {"type": "string"}}],
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("properties must be an object", result.stderr)

    def test_rejects_pem_private_key_literal(self) -> None:
        document = _valid_asyncapi()
        document["info"]["description"] = "-----BEGIN RSA PRIVATE KEY-----"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_rejects_aws_key_literal(self) -> None:
        document = _valid_asyncapi()
        document["info"]["description"] = "uses key AKIAABCDEFGHIJKLMNOP"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_rejects_stripe_key_literal(self) -> None:
        document = _valid_asyncapi()
        document["info"]["description"] = "sk_live_abcdefghijklmnop"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_rejects_camel_case_secret_property_example(self) -> None:
        document = _valid_asyncapi()
        document["components"]["messages"]["OrderCreated"]["payload"]["properties"][
            "apiKey"
        ] = {"type": "string", "example": "sample-value"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)


if __name__ == "__main__":
    unittest.main()
