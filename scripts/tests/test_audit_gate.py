import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


class AuditGateTests(unittest.TestCase):
    def run_gate(self, packages, nodes, *, advisory='GHSA-vfj7-8cjw-p6xm',
                 at='2026-10-04T12:00:00Z', report_error=False):
        with tempfile.TemporaryDirectory(prefix='sotto-audit-test-') as directory:
            root = Path(directory)
            gate = root / 'scripts' / 'ci' / 'audit-gate.mjs'
            gate.parent.mkdir(parents=True)
            shutil.copyfile(Path(__file__).resolve().parents[1] / 'ci' / 'audit-gate.mjs', gate)
            (root / 'package-lock.json').write_text(json.dumps({'packages': packages}))
            report = root / 'audit.json'
            vulnerability = {
                'severity': 'high', 'nodes': nodes,
                'via': [{'url': 'https://github.com/advisories/' + advisory}],
            }
            report.write_text(json.dumps(
                {'error': {'summary': 'Unavailable audit'}} if report_error else
                {'vulnerabilities': {'braces': vulnerability}}
            ))
            binaries = root / 'bin'
            binaries.mkdir()
            npm = binaries / 'npm'
            npm.write_text('#!/bin/sh\ncat ' + shlex.quote(str(report)) + '\nexit 1\n')
            npm.chmod(0o700)
            clock = root / 'clock.cjs'
            clock.write_text(
                'const NativeDate=Date;global.Date=class extends NativeDate{'
                'constructor(...args){super(...(args.length?args:'
                '[process.env.SOTTO_AUDIT_TEST_TIME]));}};'
            )
            environment = os.environ.copy()
            environment['PATH'] = str(binaries) + os.pathsep + environment['PATH']
            environment['SOTTO_AUDIT_TEST_TIME'] = at
            return subprocess.run(
                [shutil.which('node'), '--require', str(clock), str(gate)],
                cwd=root, env=environment, capture_output=True, text=True, timeout=15,
            )

    def test_unpatched_development_tooling_is_allowed_before_expiry(self):
        result = self.run_gate({'node_modules/braces': {'dev': True}}, ['node_modules/braces'])
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_runtime_and_mixed_dependencies_still_fail(self):
        for packages, nodes in [
            ({'node_modules/braces': {'dev': False}}, ['node_modules/braces']),
            ({'node_modules/braces': {'dev': True}, 'node_modules/runtime/braces': {'dev': False}},
             ['node_modules/braces', 'node_modules/runtime/braces']),
        ]:
            with self.subTest(nodes=nodes):
                result = self.run_gate(packages, nodes)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('GHSA-vfj7-8cjw-p6xm', result.stderr)

    def test_unknown_or_empty_dependency_scope_still_fails(self):
        for packages, nodes in [({}, ['node_modules/braces']), ({}, [])]:
            with self.subTest(nodes=nodes):
                self.assertNotEqual(self.run_gate(packages, nodes).returncode, 0)

    def test_exception_ends_at_the_exact_utc_boundary(self):
        result = self.run_gate({'node_modules/braces': {'dev': True}}, ['node_modules/braces'],
                               at='2026-10-11T00:00:00Z')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('GHSA-vfj7-8cjw-p6xm', result.stderr)

    def test_unrelated_advisories_still_fail(self):
        result = self.run_gate({'node_modules/braces': {'dev': True}}, ['node_modules/braces'],
                               advisory='different-advisory')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('different-advisory', result.stderr)

    def test_unavailable_audits_fail_closed(self):
        result = self.run_gate({}, [], report_error=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('did not produce a report', result.stderr)
