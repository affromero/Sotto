"""Exercise the installed dependency through its public JavaScript APIs."""

from pathlib import Path
import shutil
import subprocess
import unittest


class BracesSecurityTests(unittest.TestCase):
    def test_shallow_patterns_remain_compatible_and_hostile_depth_is_rejected(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [shutil.which('node'), '--test', str(root / 'scripts/tests/braces.test.cjs')],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
