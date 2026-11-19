"""Protect main CodeQL scans from Dependabot squash-commit token restrictions."""

from pathlib import Path
import unittest

import yaml


class MainCodeQLTests(unittest.TestCase):
    """The trusted worker scans only successful same-repository main pushes."""

    def test_main_scan_uses_validated_revision(self) -> None:
        """PR analysis stays native; main analysis runs outside the push token."""
        path = Path(__file__).resolve().parents[1] / "workflows/codeql.yml"
        workflow = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        self.assertNotIn("push", workflow["on"])
        self.assertIn("pull_request", workflow["on"])
        self.assertEqual(workflow["on"]["workflow_run"]["workflows"], ["CI"])
        job = workflow["jobs"]["analyze"]
        for condition in [
            "conclusion == 'success'",
            "event == 'push'",
            "head_branch == 'main'",
            "head_repository.full_name == github.repository",
        ]:
            self.assertIn(condition, job["if"])
        checkout = job["steps"][0]["with"]
        self.assertEqual(
            checkout["ref"], "${{ github.event.workflow_run.head_sha || github.sha }}"
        )
        self.assertEqual(checkout["persist-credentials"], "false")
        scan = job["steps"][-1]["with"]
        self.assertEqual(scan["sha"], checkout["ref"])
        self.assertIn("refs/heads/main", scan["ref"])


if __name__ == "__main__":
    unittest.main()
