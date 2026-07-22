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


class OpenapiRuleTestCase(unittest.TestCase):
    """Cover individual enforced rules in validate_openapi.py.

    Every rejected-input fixture starts from the shared valid document and is
    mutated in exactly one spot, so an asserted error message can only come
    from the rule under test.
    """

    def _run(self, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(OPENAPI_VALIDATOR), str(target)],
            check=False,
            capture_output=True,
            text=True,
        )

    def _run_document(self, document: dict[str, Any]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(json.dumps(document), encoding="utf-8")
            return self._run(target)

    def _run_raw(self, filename: str, content: bytes) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / filename
            target.write_bytes(content)
            return self._run(target)

    def _operation(self, document: dict[str, Any]) -> dict[str, Any]:
        return document["paths"]["/api/orders"]["post"]

    def _valid_get_operation(self) -> dict[str, Any]:
        return {
            "operationId": "getOrder",
            "summary": "Read an order",
            "description": "Returns a single order by its identifier.",
            "security": [{"bearerAuth": []}],
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
                    "description": "Order returned",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/Order"}
                        }
                    },
                }
            },
        }

    # -- SECRET_PATTERNS in string values -------------------------------------

    def _document_with_secret(self, secret: str) -> dict[str, Any]:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["description"] = f"Creates an order. Debug note: {secret}"
        return document

    def test_rejects_jwt_shaped_secret_literal(self) -> None:
        result = self._run_document(
            self._document_with_secret(
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
                ".eyJzdWIiOiJvcmRlci1leGFtcGxlIn0"
                ".synthetic0signature0value"
            )
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value must not be embedded", result.stderr)

    def test_rejects_aws_access_key_literal(self) -> None:
        result = self._run_document(self._document_with_secret("AKIAIOSFODNN7EXAMPLE"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value must not be embedded", result.stderr)

    def test_rejects_stripe_live_key_literal(self) -> None:
        result = self._run_document(
            self._document_with_secret("sk_live_0123456789abcdefEXAMPLE")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value must not be embedded", result.stderr)

    def test_rejects_pem_private_key_header_literal(self) -> None:
        result = self._run_document(
            self._document_with_secret("-----BEGIN RSA PRIVATE KEY-----")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value must not be embedded", result.stderr)

    # -- main() I/O guards ----------------------------------------------------

    def test_rejects_non_json_suffix(self) -> None:
        result = self._run_raw(
            "openapi.txt", json.dumps(_valid_openapi()).encode("utf-8")
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
        result = self._run_raw("openapi.json", b"{ not valid json ")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid JSON at line", result.stderr)

    def test_rejects_non_utf8_bytes(self) -> None:
        result = self._run_raw("openapi.json", b"\xff\xfe\xfa not utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file must be UTF-8", result.stderr)

    # -- info -----------------------------------------------------------------

    def test_rejects_missing_info_title(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del document["info"]["title"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info/title", result.stderr)

    def test_rejects_missing_info_version(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del document["info"]["version"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info/version", result.stderr)

    def test_rejects_info_not_an_object(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["info"] = "Orders API"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/info: must be an object", result.stderr)

    # -- servers --------------------------------------------------------------

    def test_rejects_missing_servers(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del document["servers"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must contain at least one server URL", result.stderr)

    def test_rejects_first_server_without_url(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["servers"] = [{}]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/servers/0/url", result.stderr)

    # -- security schemes -----------------------------------------------------

    def test_rejects_http_scheme_without_scheme(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["securitySchemes"]["bearerAuth"] = {"type": "http"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("securitySchemes/bearerAuth/scheme", result.stderr)

    def test_rejects_apikey_without_name(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["securitySchemes"]["bearerAuth"] = {
            "type": "apiKey",
            "in": "header",
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("securitySchemes/bearerAuth/name", result.stderr)

    def test_rejects_apikey_not_in_header(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["securitySchemes"]["bearerAuth"] = {
            "type": "apiKey",
            "name": "X-Api-Key",
            "in": "query",
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("apiKey security must use a header", result.stderr)

    def test_rejects_oauth2_without_flows(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["securitySchemes"]["bearerAuth"] = {"type": "oauth2"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("oauth2 flows are required", result.stderr)

    def test_rejects_openidconnect_without_url(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["securitySchemes"]["bearerAuth"] = {
            "type": "openIdConnect"
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("openIdConnectUrl", result.stderr)

    # -- parameters -----------------------------------------------------------

    def test_rejects_parameters_not_an_array(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["parameters"] = {"order_id": "path"}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parameters must be an array", result.stderr)

    def test_rejects_parameter_with_empty_name(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["parameters"] = [
            {"name": "", "in": "query", "schema": {"type": "string"}}
        ]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parameters/operation-0/name", result.stderr)

    def test_rejects_parameter_with_invalid_in(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["parameters"] = [
            {"name": "state", "in": "body", "schema": {"type": "string"}}
        ]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be path, query, header, or cookie", result.stderr)

    def test_rejects_parameter_without_schema(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["parameters"] = [{"name": "state", "in": "query"}]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parameter schema is required", result.stderr)

    # -- path variables -------------------------------------------------------

    def test_rejects_path_variable_without_parameter(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        get_operation = self._valid_get_operation()
        del get_operation["parameters"]
        document["paths"]["/api/orders/{order_id}"] = {"get": get_operation}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no path parameter", result.stderr)

    def test_rejects_path_parameter_not_required(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        get_operation = self._valid_get_operation()
        get_operation["parameters"][0]["required"] = False
        document["paths"]["/api/orders/{order_id}"] = {"get": get_operation}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must set required=true", result.stderr)

    # -- responses ------------------------------------------------------------

    def test_rejects_non_three_digit_status(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        responses = self._operation(document)["responses"]
        responses["2XX"] = responses.pop("201")
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit three-digit code", result.stderr)

    def test_rejects_response_without_description(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del self._operation(document)["responses"]["201"]["description"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("responses/201/description", result.stderr)

    def test_rejects_success_response_without_content(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["responses"]["200"] = {"description": "Order read"}
        del self._operation(document)["responses"]["201"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("successful response content is required", result.stderr)

    def test_rejects_no_success_response(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        responses = self._operation(document)["responses"]
        del responses["201"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("at least one explicit 2xx response is required", result.stderr)

    def test_rejects_response_media_without_schema(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del self._operation(document)["responses"]["201"]["content"][
            "application/json"
        ]["schema"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("response schema is required", result.stderr)

    # -- requestBody ----------------------------------------------------------

    def test_rejects_multiple_request_media_types(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        content = self._operation(document)["requestBody"]["content"]
        content["text/plain"] = {"schema": {"type": "string"}}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly one request media type", result.stderr)

    def test_rejects_request_media_without_schema(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del self._operation(document)["requestBody"]["content"]["application/json"][
            "schema"
        ]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("request schema is required", result.stderr)

    # -- schema object --------------------------------------------------------

    def test_rejects_boolean_schema(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["schemas"]["CreateOrder"]["properties"]["item_id"] = True
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("boolean schemas are not supported", result.stderr)

    def test_rejects_unsupported_schema_type(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["schemas"]["Order"]["properties"]["quantity"][
            "type"
        ] = "decimal"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported schema type: decimal", result.stderr)

    def test_rejects_required_not_an_array(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["schemas"]["CreateOrder"]["required"] = "item_id"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required must be an array", result.stderr)

    def test_rejects_required_entry_not_in_properties(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["schemas"]["CreateOrder"]["required"].append("nonexistent")
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "required property 'nonexistent' is not declared", result.stderr
        )

    def test_rejects_unsupported_request_media_type(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        content = self._operation(document)["requestBody"]["content"]
        content["application/vnd.orders+json"] = content.pop("application/json")
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported request media type", result.stderr)

    # -- operations -----------------------------------------------------------

    def test_rejects_missing_operation_id(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        del self._operation(document)["operationId"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("post/operationId", result.stderr)

    def test_rejects_missing_summary_and_description(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        operation = self._operation(document)
        del operation["summary"]
        del operation["description"]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("summary or description is required", result.stderr)

    def test_rejects_trace_method(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["paths"]["/api/orders"]["trace"] = {
            "operationId": "traceOrder",
            "summary": "Trace",
            "security": [{"bearerAuth": []}],
            "responses": {"200": {"description": "ok"}},
        }
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HTTP method is not consumed by LoadCraft", result.stderr)

    def test_rejects_path_not_starting_with_slash(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["paths"]["api/orders-bad"] = {}
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("path key must start with /", result.stderr)

    def test_rejects_security_referencing_undefined_scheme(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        self._operation(document)["security"] = [{"undefinedScheme": []}]
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("references an undefined security scheme", result.stderr)

    # -- plural output --------------------------------------------------------

    def test_reports_plural_operation_count(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["paths"]["/api/orders/{order_id}"] = {
            "get": self._valid_get_operation()
        }
        result = self._run_document(document)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 operations", result.stdout)


if __name__ == "__main__":
    unittest.main()
