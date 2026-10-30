"""Exercise provider continuity admission through the deployment controller."""

import unittest

from scripts.tests import test_deploy_script as deployment


class EstablishedProviderReviewTests(unittest.TestCase):
    def setUp(self):
        self.controller = deployment.DeploymentFailureTests(methodName='runTest')

    def test_implicit_provider_with_matching_contracts_rejects_incomplete_or_stale_review(self):
        for options in (
            {'reviewed_runtime': False, 'provider_continuity': False},
            {'partial_review': True},
            {'missing_evidence': True},
            {'stale_review': True},
        ):
            with self.subTest(options=options):
                state, output = self.controller.run_deployment(
                    'compat-provider-success', matching_contracts=True,
                    implicit_gate=True, **options)
                self.assertFalse(state['stopped'], output)
                self.assertFalse(any('up' in call and 'web' in call
                                     for call in state['calls']), output)
                self.assertEqual(state['active_route'], 'old', output)
                if not options.get('stale_review'):
                    self.assertFalse(state['pulled'], output)
                    self.assertEqual(state['retention_records'], [], output)
                    self.assertIsNone(state['compose_env'], output)

    def test_reviewed_implicit_provider_stays_enabled_during_overlap(self):
        state, output = self.controller.run_deployment(
            'compat-provider-success', implicit_gate=True, matching_contracts=True,
            success=True, expect_rollback=False, prepaused=True, controller_timeout=60)
        self.assertTrue(state['provider_enabled_at_web_start'], output)
        self.assertFalse(state['gate_disabled_before_cutover'], output)
        self.assertTrue(state['gate_enabled_after_controller'], output)
        self.assertEqual(state['queue_flags'], {
            'audio-generation': True, 'speaking-grading': False}, output)
        self.assertIsNone(state['unresolved_marker'], output)


if __name__ == '__main__':
    unittest.main()
