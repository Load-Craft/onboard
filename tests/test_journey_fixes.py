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


class JourneyFinishConditionTestCase(unittest.TestCase):
    def _run(self, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(JOURNEY_VALIDATOR), str(target)],
            check=False,
            capture_output=True,
            text=True,
        )

    def _validate(self, description: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "create-order.txt"
            target.write_text(description, encoding="utf-8")
            return self._run(target)

    def test_finish_followed_by_parenthetical_clarification_passes(self) -> None:
        description = """Open the "Orders" page.
Click "Create order".
Finish when the success toast appears. (It may take a few seconds.)
"""
        result = self._validate(description)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 journey", result.stdout)

    def test_finish_followed_by_multiple_parentheticals_passes(self) -> None:
        description = """Open the "Orders" page.
Click "Create order".
Finish when the success toast appears. (It may take a few seconds.) (Ignore the banner.)
"""
        result = self._validate(description)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 journey", result.stdout)

    def test_finish_followed_by_real_instruction_still_fails(self) -> None:
        description = """Open the "Orders" page.
Click "Create order".
Finish when the toast appears. Then click "Close".
"""
        result = self._validate(description)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("final instruction", result.stderr)

    def test_finish_only_in_the_middle_still_fails(self) -> None:
        description = """Open the "Orders" page.
Finish when the success toast appears.
Click "Create order".
"""
        result = self._validate(description)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("final instruction", result.stderr)

    def test_missing_finish_condition_still_fails(self) -> None:
        description = """Open the "Orders" page.
Click "Create order".
"""
        result = self._validate(description)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("observable finish condition", result.stderr)


if __name__ == "__main__":
    unittest.main()
