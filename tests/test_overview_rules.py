from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[1]
OVERVIEW_VALIDATOR = (
    PACK_ROOT
    / "skills"
    / "loadcraft-overview"
    / "scripts"
    / "validate_overview.py"
)


def _valid_overview() -> str:
    """A realistic, fully valid ~1000-character LoadCraft overview.

    Every rejected-input fixture below is this text mutated in one spot, so an
    asserted error can only come from the rule under test.
    """
    return (
        "# Orders Example Shop\n\n"
        "Orders Example Shop is a web storefront where small retailers manage "
        "their product catalog and fulfil customer orders. It serves shop "
        "operators who process daily sales and administrators who configure the "
        "store at app.example.com.\n\n"
        "The domain centers on a handful of entities. A Product has a name, a "
        "stock-keeping identifier such as order-example, a price amount, and an "
        "availability state. An Order groups line items, carries a status that "
        "moves from pending to paid to shipped, and belongs to a Customer. "
        "Customers hold a display name and a contact address like "
        "user@example.com.\n\n"
        "Two roles use the system. Operators browse the catalog, create orders, "
        "adjust quantities, and mark orders as fulfilled. Administrators "
        "additionally manage the catalog, invite teammates, and review sales "
        "summaries.\n\n"
        "The main business flows are catalog browsing, order creation, order "
        "fulfilment, and reporting. An operator opens the catalog, assembles an "
        "order, confirms it, and later transitions it through shipping. "
        "Administrators reconcile daily totals.\n\n"
        "Data is primarily English. Identifiers follow short hyphenated slugs, "
        "prices are decimal amounts in a single currency, and names are free "
        "text. A typical product code looks like order-example.\n\n"
        "The application integrates with a hosted identity provider for sign-in, "
        "a payment gateway for checkout, and an analytics collector. Traffic to "
        "the analytics and CDN hosts is noise from a load-testing perspective "
        "and can be excluded from scenarios.\n"
    )


class OverviewRuleTestCase(unittest.TestCase):
    def _run(self, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(OVERVIEW_VALIDATOR), str(target)],
            check=False,
            capture_output=True,
            text=True,
        )

    def _run_content(
        self, filename: str, content: str
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / filename
            target.write_text(content, encoding="utf-8")
            return self._run(target)

    def _run_bytes(
        self, filename: str, content: bytes
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / filename
            target.write_bytes(content)
            return self._run(target)

    # -- accepts --------------------------------------------------------------

    def test_accepts_valid_overview(self) -> None:
        result = self._run_content("overview.md", _valid_overview())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("passes the LoadCraft structural preflight", result.stdout)

    def test_accepts_valid_overview_with_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "overview.md").write_text(
                _valid_overview(), encoding="utf-8"
            )
            (directory / "overview.provenance.json").write_text(
                json.dumps({"commit": "a1b2c3d4e5f6", "dirty": False}),
                encoding="utf-8",
            )
            result = self._run(directory / "overview.md")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("passes the LoadCraft structural preflight", result.stdout)

    def test_accepts_headings_and_lists(self) -> None:
        content = (
            "# Orders Example Shop\n\n"
            "## What it does\n\n"
            "Orders Example Shop is a web storefront where small retailers "
            "manage their product catalog and fulfil customer orders for shop "
            "operators and administrators at app.example.com.\n\n"
            "## Roles\n\n"
            "- Operators create and fulfil orders across the catalog.\n"
            "- Administrators manage the catalog and review sales summaries.\n\n"
            "## Data\n\n"
            "Identifiers follow short hyphenated slugs such as order-example, "
            "prices are decimal amounts in a single currency, and contact "
            "addresses look like user@example.com. The data is primarily "
            "English and integrates with an identity provider and a payment "
            "gateway whose analytics traffic is load-testing noise.\n"
        )
        result = self._run_content("overview.md", content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("passes the LoadCraft structural preflight", result.stdout)

    # -- I/O guards -----------------------------------------------------------

    def test_rejects_non_md_extension(self) -> None:
        result = self._run_content("overview.txt", _valid_overview())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".md extension", result.stderr)

    def test_rejects_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "overview.md"
            result = self._run(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file not found", result.stderr)

    def test_rejects_invalid_utf8_bytes(self) -> None:
        result = self._run_bytes(
            "overview.md", b"# Orders \xff\xfe Example Shop\n"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file must be UTF-8", result.stderr)

    def test_rejects_nul_byte(self) -> None:
        content = _valid_overview().replace("A Product", "A\x00Product")
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("NUL byte", result.stderr)

    # -- structural rules -----------------------------------------------------

    def test_rejects_missing_h1_heading(self) -> None:
        content = _valid_overview().replace(
            "# Orders Example Shop", "Orders Example Shop"
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("H1 heading", result.stderr)

    def test_rejects_content_under_minimum_length(self) -> None:
        result = self._run_content(
            "overview.md", "# Orders Example Shop\n\nA tiny shop.\n"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("at least 200 characters", result.stderr)

    def test_rejects_content_over_maximum_length(self) -> None:
        padding = "The operator reviews each pending order carefully. " * 200
        content = f"# Orders Example Shop\n\n{padding}\n"
        self.assertGreater(len(content.strip()), 8000)
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exceeds the 8000-character", result.stderr)

    def test_rejects_code_fence(self) -> None:
        content = _valid_overview() + "\n```\nGET /orders\n```\n"
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("code fence", result.stderr)

    def test_rejects_markdown_table(self) -> None:
        content = (
            _valid_overview()
            + "\n| Role | Action |\n| --- | --- |\n| Operator | Create |\n"
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("table", result.stderr)

    def test_rejects_unresolved_marker(self) -> None:
        content = _valid_overview().replace(
            "Administrators reconcile daily totals.",
            "Administrators reconcile daily totals. TBD.",
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unresolved marker", result.stderr)

    def test_rejects_source_file_reference(self) -> None:
        content = _valid_overview().replace(
            "carries a status",
            "carries a status defined in models/order.py:42",
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source file reference", result.stderr)

    def test_rejects_secret_like_value(self) -> None:
        content = _valid_overview().replace(
            "A typical product code looks like order-example.",
            "A typical product code looks like order-example. "
            "AKIAIOSFODNN7EXAMPLE identifies the account.",
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like value", result.stderr)

    def test_rejects_credential_like_value(self) -> None:
        content = _valid_overview().replace(
            "A typical product code looks like order-example.",
            "A typical product code looks like order-example. "
            "apiKey: sample-value seeds the client.",
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("credential-like value", result.stderr)

    def test_rejects_non_synthetic_email(self) -> None:
        content = _valid_overview().replace(
            "user@example.com", "operator@acme-corp.com"
        )
        result = self._run_content("overview.md", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("credential-like value", result.stderr)

    # -- provenance sidecar ---------------------------------------------------

    def test_rejects_malformed_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "overview.md").write_text(
                _valid_overview(), encoding="utf-8"
            )
            (directory / "overview.provenance.json").write_text(
                json.dumps(
                    {"commit": "not-a-hash", "dirty": "yes", "extra": 1}
                ),
                encoding="utf-8",
            )
            result = self._run(directory / "overview.md")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("provenance commit must be a git object hash", result.stderr)
        self.assertIn("provenance dirty must be a boolean", result.stderr)
        self.assertIn("provenance stamp has unsupported keys", result.stderr)


if __name__ == "__main__":
    unittest.main()
