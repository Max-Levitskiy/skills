"""Check fixture construction and oracles, not model quality or skill execution."""

import argparse
import ast
import io
import json
from pathlib import Path
import runpy
import tokenize
import unittest


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--plugin-root", type=Path, default=Path(__file__).resolve().parents[3])
parser.add_argument("--existing-only", action="store_true", help="Check only the fixture present before this repair.")
args = parser.parse_args()
fixtures = args.plugin_root / "skills/code/workspace/fixtures"
skill = (args.plugin_root / "skills/code/SKILL.md").read_text(encoding="utf-8")
names = ["dense_but_wrong"] if args.existing_only else [
    "dense_but_wrong", "stale_docstring", "useful_docstring"
]


def expectation(name):
    return json.loads((fixtures / f"{name}.expected.json").read_text(encoding="utf-8"))


class BoundaryFixtures(unittest.TestCase):
    def test_negative_has_no_comment_or_docstring_signal(self):
        source = (fixtures / "dense_but_wrong.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)):
                self.assertIsNone(ast.get_docstring(node), "Keep the hidden contract outside analyzed source")
        self.assertFalse(any(t.type == tokenize.COMMENT for t in tokenize.generate_tokens(io.StringIO(source).readline)))

    def test_scope_expectations_match_report_template(self):
        template = skill.split("## Step 4: Report", 1)[1]
        for name in names:
            with self.subTest(fixture=name):
                report = expectation(name)["report_expectation"]
                self.assertIn(report["required_scope_statement"], template)
                self.assertEqual(report["match"], "literal_substring")

    def test_no_precalibration_score_oracle(self):
        for name in names:
            with self.subTest(fixture=name):
                density = expectation(name)["density_expectation"]
                self.assertNotIn("minimum_score", density)
                self.assertNotIn("expected_label", density)

    def test_functional_oracles(self):
        for name in names:
            with self.subTest(fixture=name):
                spec = expectation(name)
                self.assertEqual(spec["fixture"], f"{name}.py")
                oracle = spec["functional_oracle"]
                if "cases" not in oracle:
                    # PR #69 used a shell assertion instead of structured cases.
                    function = runpy.run_path(str(fixtures / spec["fixture"]))["inclusive_sum"]
                    self.assertEqual(function(1, 3), 3)
                    self.assertEqual(oracle["expected_exit_code"], 1)
                    continue
                self.assertTrue(oracle["contract"])
                function = runpy.run_path(str(fixtures / spec["fixture"]))[oracle["entrypoint"]]
                outcomes = []
                for case in oracle["cases"]:
                    actual = function(*case["args"])
                    self.assertEqual(actual, case["observed"])
                    outcomes.append(actual == case["expected"])
                self.assertEqual(all(outcomes), oracle["passes"])

    @unittest.skipIf(args.existing_only, "New paired controls are not present at the baseline")
    def test_paired_comment_controls(self):
        stale = ast.parse((fixtures / "stale_docstring.py").read_text(encoding="utf-8")).body[0]
        useful = ast.parse((fixtures / "useful_docstring.py").read_text(encoding="utf-8")).body[0]
        self.assertEqual(ast.get_docstring(stale), ast.get_docstring(useful))
        positive = expectation("stale_docstring")["density_expectation"]["expected_findings"]
        self.assertEqual([(f["method"], f["pattern"], f["severity"]) for f in positive],
                         [("comment-redundancy", "stale-or-wrong", "high")])
        self.assertEqual(positive[0]["anchor"], ast.get_docstring(stale))
        negative = expectation("useful_docstring")["density_expectation"]
        self.assertEqual(negative["expected_findings"], [])
        self.assertIn(ast.get_docstring(useful), negative["preserve_spans"])


if __name__ == "__main__":
    unittest.main(argv=[__file__], verbosity=2)
