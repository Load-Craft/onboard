from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = PACK_ROOT / "skills"


class PackageLayoutTestCase(unittest.TestCase):
    def test_vendor_manifests_stay_in_version_lockstep(self) -> None:
        codex = json.loads(
            (PACK_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        claude = json.loads(
            (PACK_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )

        for key in ("name", "version", "description", "author", "keywords"):
            self.assertEqual(codex[key], claude[key], key)
        self.assertEqual(codex["skills"], "./skills/")
        self.assertRegex(codex["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(codex.get("repository"), claude.get("repository"))
        self.assertEqual(codex.get("homepage"), claude.get("homepage"))

    def test_skills_are_self_contained_and_references_resolve(self) -> None:
        expected_names = {"loadcraft-openapi", "loadcraft-journeys", "loadcraft-asyncapi", "loadcraft-overview"}
        actual_names: set[str] = set()

        for skill_dir in sorted(path for path in SKILLS_ROOT.iterdir() if path.is_dir()):
            skill_file = skill_dir / "SKILL.md"
            text = skill_file.read_text(encoding="utf-8")
            frontmatter_match = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
            self.assertIsNotNone(frontmatter_match, skill_file)
            assert frontmatter_match is not None
            name_match = re.search(r"^name:\s*(\S+)\s*$", frontmatter_match.group(1), re.MULTILINE)
            self.assertIsNotNone(name_match, skill_file)
            assert name_match is not None
            name = name_match.group(1)
            actual_names.add(name)
            self.assertEqual(name, skill_dir.name)
            self.assertIsNone(re.search(r"\[TODO(?::|\])", text, re.IGNORECASE))

            reference_links = re.findall(r"\]\((references/[^)]+)\)", text)
            self.assertTrue(reference_links, f"{skill_file} has no progressive references")
            for relative_link in reference_links:
                reference = skill_dir / relative_link
                self.assertTrue(reference.is_file(), reference)
                self.assertEqual(reference.parent, skill_dir / "references")

        self.assertEqual(actual_names, expected_names)


if __name__ == "__main__":
    unittest.main()
