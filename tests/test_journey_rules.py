from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[1]
JOURNEY_VALIDATOR = (
    PACK_ROOT
    / "skills"
    / "loadcraft-journeys"
    / "scripts"
    / "validate_journeys.py"
)

# A minimal, fully valid journey. Every rejected-input fixture below is this
# text mutated in one spot, so an asserted error can only come from the rule
# under test.
VALID_JOURNEY = (
    'Use the provided administrator test account and start at '
    'https://app.example.com.\n\n'
    'Open "Orders". Click "Create order". Type a unique order name into '
    '"Name". Click "Save".\n\n'
    'Finish when "Order created" is visible and the new order appears in the '
    'list.\n'
)

SECOND_VALID_JOURNEY = (
    'Use the provided administrator test account and start at '
    'https://app.example.com.\n\n'
    'Open "Orders". Check that the orders list is visible and shows recent '
    'entries.\n'
)


class JourneyRuleTestCase(unittest.TestCase):
    def _run(self, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(JOURNEY_VALIDATOR), str(target)],
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

    # -- filename slug --------------------------------------------------------

    def test_rejects_invalid_slug_filename(self) -> None:
        result = self._run_content("Create_Order.txt", VALID_JOURNEY)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("lowercase hyphenated slug", result.stderr)

    # -- length bounds --------------------------------------------------------

    def test_rejects_content_under_minimum_length(self) -> None:
        result = self._run_content("create-order.txt", "Open it.")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("at least 10 characters", result.stderr)

    def test_rejects_content_over_maximum_length(self) -> None:
        padding = "The operator reviews each pending order carefully. " * 200
        content = (
            "Use the provided administrator test account and start at "
            "https://app.example.com.\n\n"
            f"{padding}\n\n"
            'Finish when "Order created" is visible.\n'
        )
        self.assertGreater(len(content.strip()), 6000)
        result = self._run_content("create-order.txt", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exceeds the 6000-character", result.stderr)

    # -- byte-level guards ----------------------------------------------------

    def test_rejects_nul_byte(self) -> None:
        content = VALID_JOURNEY.replace('Open "Orders".', 'Open\x00"Orders".')
        result = self._run_content("create-order.txt", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("NUL byte", result.stderr)

    def test_rejects_invalid_utf8_bytes(self) -> None:
        result = self._run_bytes(
            "create-order.txt", b'Open "Orders" and \xff\xfe finish.'
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file must be UTF-8", result.stderr)

    # -- target collection ----------------------------------------------------

    def test_rejects_nonexistent_target(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            result = self._run(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("path does not exist", result.stderr)

    def test_rejects_directory_without_txt_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = self._run(Path(temp_dir))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no .txt journey files found", result.stderr)

    def test_rejects_single_non_txt_file_target(self) -> None:
        result = self._run_content("notes.md", VALID_JOURNEY)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must use the .txt extension", result.stderr)

    # -- cross-file dependencies ----------------------------------------------

    def test_rejects_previous_journey_reference(self) -> None:
        content = (
            "Complete the previous journey before starting this one.\n\n"
            + VALID_JOURNEY
        )
        result = self._run_content("create-order.txt", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cross-file dependency", result.stderr)

    def test_rejects_run_first_reference(self) -> None:
        content = (
            "Run the sign-in journey first, then continue.\n\n" + VALID_JOURNEY
        )
        result = self._run_content("create-order.txt", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cross-file dependency", result.stderr)

    def test_rejects_other_txt_filename_reference(self) -> None:
        content = "See sign-in.txt for the setup steps.\n\n" + VALID_JOURNEY
        result = self._run_content("create-order.txt", content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cross-file dependency", result.stderr)

    # -- plural PASS output ---------------------------------------------------

    def test_reports_plural_journey_count(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "create-order.txt").write_text(
                VALID_JOURNEY, encoding="utf-8"
            )
            (directory / "view-orders.txt").write_text(
                SECOND_VALID_JOURNEY, encoding="utf-8"
            )
            result = self._run(directory)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 journeys", result.stdout)


if __name__ == "__main__":
    unittest.main()
