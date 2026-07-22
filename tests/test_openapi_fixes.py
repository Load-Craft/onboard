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


class OpenapiSecretAndDepthFixTestCase(unittest.TestCase):
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

    def _with_property(self, name: str, schema: dict[str, Any]) -> dict[str, Any]:
        document = copy.deepcopy(_valid_openapi())
        document["components"]["schemas"]["CreateOrder"]["properties"][name] = schema
        return document

    def test_camelcase_api_key_example_is_rejected(self) -> None:
        document = self._with_property(
            "apiKey", {"type": "string", "example": "order-example"}
        )
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_camelcase_access_token_example_is_rejected(self) -> None:
        document = self._with_property(
            "accessToken", {"type": "string", "example": "order-example"}
        )
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_camelcase_client_secret_example_is_rejected(self) -> None:
        document = self._with_property(
            "clientSecret", {"type": "string", "example": "order-example"}
        )
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_snake_case_access_token_example_still_rejected(self) -> None:
        document = self._with_property(
            "access_token", {"type": "string", "example": "order-example"}
        )
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing property", result.stderr)

    def test_camelcase_embedded_secret_literal_is_rejected(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["info"]["bearerToken"] = "order-example-token"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-bearing field", result.stderr)

    def test_innocent_camelcase_field_with_example_is_accepted(self) -> None:
        document = self._with_property(
            "orderTotal", {"type": "integer", "example": 1}
        )
        result = self._run_document(document)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_todo_marker_with_inner_space_is_rejected(self) -> None:
        document = copy.deepcopy(_valid_openapi())
        document["info"]["title"] = "[ TODO ] fill in"
        result = self._run_document(document)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    def test_deeply_nested_document_fails_cleanly(self) -> None:
        raw = '{"x":' + "[" * 3000 + "]" * 3000 + "}"
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "openapi.json"
            target.write_text(raw, encoding="utf-8")
            result = self._run(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("document nesting exceeds the supported depth", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
