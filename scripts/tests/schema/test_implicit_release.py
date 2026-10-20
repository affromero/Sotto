"""Bind explicitly implicit previous runtimes to exact immutable image source."""

from copy import deepcopy
import json
import os
import subprocess
import unittest
from unittest.mock import patch

import test_deploy_processes as process_tests
import test_deploy_script as controller_tests

REVIEW = process_tests.REVIEW
SOURCE = 'https://github.com/affromero/Sotto'


class ImplicitReleaseProofTests(unittest.TestCase):
    def setUp(self):
        self.case = process_tests.CompatibilityReviewTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.fixture = self.case.legacy_continuity_fixture()
        self.previous = self.fixture['review']['providerActivation']['previousRuntimes']
        self.images = {}
        for runtime in self.previous.values():
            self.fixture['rows'][runtime['containerId']]['Config']['Env'] = []
            image = runtime['imageId']
            self.images[image] = {'Id': image, 'Config': {'Labels': {
                'org.opencontainers.image.revision': 'd' * 40,
                'org.opencontainers.image.source': SOURCE,
            }}}

    def docker(self, arguments, **options):
        if arguments[:3] == ['docker', 'image', 'inspect'] and '--format' not in arguments:
            return subprocess.CompletedProcess(arguments, 0,
                json.dumps([self.images[arguments[3]]]).encode())
        return self.fixture['docker'](arguments, **options)

    def validate(self):
        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=self.docker
        ):
            REVIEW.existing_continuity(self.fixture['bound'], 'blue')

    def test_absent_release_env_uses_reviewed_immutable_provenance_for_all_previous_services(self):
        self.validate()
        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=self.docker
        ):
            REVIEW.overlap_continuity(self.fixture['bound'], self.fixture['directory'], 'blue', 'green')
            REVIEW.candidate_continuity(self.fixture['directory'], 'green')

    def test_forged_container_revision_cannot_replace_missing_or_foreign_immutable_source_proof(self):
        for runtime in self.previous.values():
            image = runtime['imageId']
            saved = deepcopy(self.images[image])
            for field, value in [('revision', 'e' * 40), ('source', 'https://example.com/other')]:
                self.images[image]['Config']['Labels']['org.opencontainers.image.' + field] = value
                with self.subTest(service=runtime, field=field), self.assertRaises(ValueError):
                    self.validate()
                self.images[image] = deepcopy(saved)
            for bad in [{'Id': image, 'Config': {}}, {'Id': 'sha256:' + '0' * 64, 'Config': saved['Config']}]:
                self.images[image] = bad
                with self.subTest(service=runtime, bad=bad), self.assertRaises(ValueError):
                    self.validate()
            self.images[image] = saved

    def test_present_empty_bare_duplicate_or_mismatched_env_is_never_treated_as_absent(self):
        valid = 'SOTTO_RELEASE_SHA=' + 'd' * 40
        for runtime in self.previous.values():
            row = self.fixture['rows'][runtime['containerId']]
            for env in [['SOTTO_RELEASE_SHA'], ['SOTTO_RELEASE_SHA='],
                        ['SOTTO_RELEASE_SHA=' + 'e' * 40], [valid, valid], [valid, 'SOTTO_RELEASE_SHA']]:
                row['Config']['Env'] = env
                with self.subTest(service=runtime, env=env), self.assertRaises(ValueError):
                    self.validate()
            row['Config']['Env'] = []
        self.validate()

    def test_release_record_and_candidate_modes_still_require_exact_configured_release(self):
        for service, runtime in self.previous.items():
            runtime['activationMode'] = 'release-record'
            self.fixture['save_review']()
            with self.subTest(service=service), self.assertRaises(ValueError):
                self.validate()
            runtime['activationMode'] = 'implicit-enabled'
        self.fixture['save_review']()
        row = self.fixture['rows'][self.fixture['candidates']['web']]
        row['Config']['Env'] = [entry for entry in row['Config']['Env'] if not entry.startswith('SOTTO_RELEASE_SHA=')]
        with patch.dict(os.environ, self.case.environment), patch.object(REVIEW.subprocess, 'run', side_effect=self.docker):
            with self.assertRaises(ValueError):
                REVIEW.candidate_continuity(self.fixture['directory'], 'green')


class ImplicitReleaseControllerTests(unittest.TestCase):
    def test_exact_implicit_prior_source_can_complete_the_normal_fenced_schema_controller(self):
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment('migration-success', schema_transition=True,
            implicit_without_release=True, additive_queues=True, success=True,
            expect_rollback=False, prepaused=True)
        self.assertTrue(state['migration_admitted_safely'], output)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertEqual(state['queue_flags'], {'audio-generation': True,
            'speaking-grading': False, 'material-analysis': True, 'vocabulary-audio': False}, output)
        self.assertIsNone(state['unresolved_marker'], output)

    def test_forged_immutable_revision_rejects_before_fencing_or_migration(self):
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment('migration-implicit-forged-image', schema_transition=True,
            implicit_without_release=True, prepaused=True)
        self.assertIn('Immutable previous image release provenance differs', output)
        self.assertEqual(state['active_route'], 'old', output)
        self.assertFalse(state.get('migration_started', False), output)
        self.assertEqual(state['queue_flags'], {'audio-generation': True, 'speaking-grading': False}, output)
        self.assertIsNone(state['unresolved_marker'], output)
