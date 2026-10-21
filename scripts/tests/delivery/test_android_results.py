"""Android CI requires successful, actually executed instrumentation tests."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).resolve().parents[2] / 'ci/android-results.py'


class AndroidResultsTests(unittest.TestCase):
    def run_reports(
        self, reports: dict[str, str],
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, xml in reports.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(xml)
            return subprocess.run(
                [sys.executable, str(CHECKER), str(root)],
                capture_output=True, text=True, check=False,
            )

    def test_successful_nested_reports_can_include_skipped_cases(self) -> None:
        result = self.run_reports({
            'device/TEST-game.xml': '<testsuite tests="2" failures="0">'
            '<testcase name="plays"/><testcase name="optional">'
            '<skipped/></testcase></testsuite>',
            'device/TEST-recovery.xml': '<testsuites><testsuite>'
            '<testcase name="recovers"/></testsuite></testsuites>',
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('2 executed', result.stdout)

    def test_missing_empty_and_all_skipped_runs_fail(self) -> None:
        for xml in (None, '<testsuite tests="0"/>',
                    '<testsuite><testcase><skipped/></testcase></testsuite>'):
            with self.subTest(xml=xml):
                reports = {} if xml is None else {'test.xml': xml}
                result = self.run_reports(reports)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('verification failed', result.stderr)

    def test_installation_failures_and_summary_failures_fail(self) -> None:
        for failure in ('<failure>APK installation failed</failure>',
                        '<error>Device disconnected</error>',
                        '<testsuite failures="1"/>',
                        '<testsuite errors="1"/>'):
            with self.subTest(failure=failure):
                result = self.run_reports({
                    'test.xml': '<testsuites><testsuite><testcase/>'
                    '</testsuite>' + failure + '</testsuites>',
                })
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('test.xml', result.stderr)

    def test_failed_cases_and_malformed_reports_fail(self) -> None:
        for xml in ('<testsuite><testcase><failure>Wrong result</failure>'
                    '</testcase></testsuite>', '<testsuite',
                    '<testsuite failures="unknown"><testcase/></testsuite>'):
            with self.subTest(xml=xml):
                result = self.run_reports({'test.xml': xml})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('verification failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
