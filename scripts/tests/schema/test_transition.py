"""Verify exact schema admission and fenced deployment failure outcomes."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
import subprocess
import unittest
from unittest.mock import patch

import test_deploy_processes as process_tests
import test_deploy_script as controller_tests


REVIEW = process_tests.REVIEW
MIGRATION = (
    'apps/web/prisma/migrations/'
    '20261020120000_learner_review_events/migration.sql'
)


class SchemaReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.case = process_tests.CompatibilityReviewTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)
        continuity = self.case.continuity_review()
        self.provider = continuity['providerActivation']
        self.provider['reviewedRuntimeFiles'][MIGRATION] = {
            'previousSha256': None, 'candidateSha256': '9' * 64,
        }
        self.bound = {
            'review': json.dumps(continuity),
            'evidence': self.case.evidence.decode(),
        }
        self.evidence = b'Independent schema and migration SQL review.'
        self.previous = (self.case.image + ' ' + 'd' * 64 + '\n').encode()
        self.review = {
            'schemaVersion': 1, 'procedure': 'fenced-schema-migration',
            'stack': self.case.environment['SOTTO_STACK'],
            'releaseSha': self.case.environment['SOTTO_RELEASE_SHA'],
            'candidateWebImage': self.case.environment['SOTTO_WEB_IMAGE_REF'],
            'candidateWorkersImage': self.case.environment['SOTTO_WORKERS_IMAGE_REF'],
            'candidateSchemaHash': 'e' * 64,
            'previousSchemaHashes': {self.case.image: 'd' * 64},
            'compatibilityReviewSha256': hashlib.sha256(
                self.bound['review'].encode()).hexdigest(),
            'reviewer': 'Independent schema reviewer',
            'evidenceSha256': hashlib.sha256(self.evidence).hexdigest(),
        }

    def validate(self, review: dict | None = None) -> None:
        REVIEW.schema_transition(
            self.review if review is None else review, self.evidence,
            self.bound, self.provider, 'e' * 64, self.previous,
            self.case.environment,
        )

    def test_only_exact_release_images_schema_and_independent_evidence_admit(self) -> None:
        self.validate()
        changes = {
            'schemaVersion': True, 'procedure': 'compatible-runtime-overlap',
            'stack': 'foreign', 'releaseSha': 'f' * 40,
            'candidateWebImage': 'fixture/web:main',
            'candidateWorkersImage': 'fixture/workers:main',
            'candidateSchemaHash': 'f' * 64,
            'previousSchemaHashes': {self.case.image: 'f' * 64},
            'compatibilityReviewSha256': 'f' * 64,
            'reviewer': ' ', 'evidenceSha256': 'f' * 64,
        }
        for field, value in changes.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate({**self.review, field: value})
        with self.assertRaises(ValueError):
            self.validate({**self.review, 'skipChecks': True})

    def test_previously_published_migrations_cannot_change_or_disappear(self) -> None:
        pair = self.provider['reviewedRuntimeFiles'][MIGRATION]
        for old, new in [('a' * 64, 'b' * 64), ('a' * 64, None)]:
            pair.update(previousSha256=old, candidateSha256=new)
            with self.subTest(old=old, new=new), self.assertRaises(ValueError):
                self.validate()
        pair.update(previousSha256=None, candidateSha256='9' * 64)
        self.provider['reviewedRuntimeFiles'][
            'apps/web/prisma/migrations/migration_lock.toml'
        ] = {'previousSha256': 'a' * 64, 'candidateSha256': 'b' * 64}
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_sql_or_first_provider_activation_cannot_use_this_procedure(self) -> None:
        del self.provider['reviewedRuntimeFiles'][MIGRATION]
        with self.assertRaises(ValueError):
            self.validate()
        self.provider['reviewedRuntimeFiles'][MIGRATION] = {
            'previousSha256': None, 'candidateSha256': '9' * 64,
        }
        self.provider['mode'] = 'first-activation'
        with self.assertRaises(ValueError):
            self.validate()

    def test_queue_names_must_be_unchanged_for_retained_jobs(self) -> None:
        def docker(arguments: list[str], **options: object) -> subprocess.CompletedProcess:
            names = ['audio-generation', 'speaking-grading']
            if self.changed and self.case.image in arguments:
                names.append('unreviewed-queue')
            return subprocess.CompletedProcess(
                arguments, 0, json.dumps(names).encode())

        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=docker
        ):
            self.changed = False
            REVIEW.unchanged_queue_contract(self.bound)
            self.changed = True
            with self.assertRaises(ValueError):
                REVIEW.unchanged_queue_contract(self.bound)

    def test_failed_queue_probe_exposes_the_runtime_error_before_admission(
        self,
    ) -> None:
        def failed_probe(
            arguments: list[str], **options: object,
        ) -> subprocess.CompletedProcess[bytes]:
            raise subprocess.CalledProcessError(
                1, arguments, stderr=b'fixture queue module failed to load',
            )

        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=failed_probe
        ):
            with self.assertRaisesRegex(ValueError, 'queue module failed to load'):
                REVIEW.unchanged_queue_contract(self.bound)

    def test_additive_review_binds_exact_previous_candidate_and_added_queue_inventories(self) -> None:
        transition = {'previousQueues': ['audio-generation'],
                      'candidateQueues': ['audio-generation', 'material-analysis'],
                      'addedQueues': ['material-analysis']}
        reviewed = {**self.review, 'schemaVersion': 2, 'queueTransition': transition}
        self.validate(reviewed)

        def probe(arguments: list[str], **options: object) -> subprocess.CompletedProcess:
            names = transition['previousQueues' if self.case.image in arguments else 'candidateQueues']
            return subprocess.CompletedProcess(arguments, 0, json.dumps(names).encode())

        with patch.dict(os.environ, self.case.environment), patch.object(REVIEW.subprocess, 'run', side_effect=probe):
            REVIEW.unchanged_queue_contract(self.bound, transition)
            with self.assertRaises(ValueError):
                REVIEW.unchanged_queue_contract(self.bound)
            for field, value in [('previousQueues', ['audio-generation', 'foreign']),
                                 ('candidateQueues', ['audio-generation', 'foreign']),
                                 ('addedQueues', ['foreign'])]:
                with self.subTest(field=field), self.assertRaises(ValueError):
                    REVIEW.unchanged_queue_contract(self.bound, {**transition, field: value})
        for changed in [
            {**transition, 'candidateQueues': ['material-analysis']},
            {**transition, 'addedQueues': []},
            {**transition, 'previousQueues': ['audio-generation', 'audio-generation']},
            {**transition, 'skipQueueChecks': True},
        ]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                self.validate({**reviewed, 'queueTransition': changed})

    def test_queue_lifecycle_preserves_every_observed_added_queue_flag(self) -> None:
        path = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'queue-transition.cjs')
        result = subprocess.run(['node', '--test', path], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_stopped_proof_rejects_running_replaced_or_abnormal_captured_services(self) -> None:
        fixture = self.case.legacy_continuity_fixture()
        previous = fixture['review']['providerActivation']['previousRuntimes']
        for runtime in previous.values():
            fixture['rows'][runtime['containerId']]['State'].update(
                Running=False, OOMKilled=False, ExitCode=0)

        def docker(arguments: list[str], **options: object) -> subprocess.CompletedProcess:
            if arguments[:2] == ['docker', 'ps']:
                return subprocess.CompletedProcess(
                    arguments, 0, b'f' * 64 if self.replacement else b'')
            return fixture['docker'](arguments, **options)

        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=docker
        ):
            self.replacement = False
            REVIEW.stopped_continuity(fixture['bound'], 'blue')
            self.replacement = True
            with self.assertRaises(ValueError):
                REVIEW.stopped_continuity(fixture['bound'], 'blue')
            self.replacement = False
            for runtime in previous.values():
                state = fixture['rows'][runtime['containerId']]['State']
                original = deepcopy(state)
                for field, value in [('Running', True), ('OOMKilled', True), ('ExitCode', 137)]:
                    state.update(original)
                    state[field] = value
                    with self.subTest(field=field), self.assertRaises(ValueError):
                        REVIEW.stopped_continuity(fixture['bound'], 'blue')
                state.update(original)


class SchemaControllerTests(unittest.TestCase):
    def test_additive_transition_restores_old_and_new_flags_after_fenced_cutover(self) -> None:
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment('migration-success', schema_transition=True,
            additive_queues=True, success=True, expect_rollback=False, prepaused=True)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertTrue(state['migration_admitted_safely'], output)
        self.assertEqual(state['queue_flags'], {'audio-generation': True,
            'speaking-grading': False, 'material-analysis': True, 'vocabulary-audio': False}, output)
        self.assertIsNone(state['unresolved_marker'], output)

    def test_additive_partial_migration_keeps_every_queue_fenced(self) -> None:
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment('migration-partial', schema_transition=True,
            additive_queues=True, expect_rollback=False, prepaused=True, retained_candidate=True)
        self.assertEqual(state['active_route'], 'maintenance', output)
        self.assertEqual(set(state['queue_flags']), {'audio-generation', 'speaking-grading',
            'material-analysis', 'vocabulary-audio'}, output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertEqual(state['unresolved_marker']['phase'], 'compatibility-cutover', output)

    def run_transition(self, failure: str, *, success: bool) -> dict:
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment(
            failure, schema_transition=True, success=success,
            expect_rollback=False, prepaused=True,
            retained_candidate=not success,
        )
        self.assertFalse(state.get('old_web_recreated', False), output)
        self.assertFalse(state.get('backup_while_old_writers_running', False), output)
        state['controller_output'] = output
        return state

    def test_success_migrates_only_after_fencing_draining_retirement_and_verified_backup(self) -> None:
        state = self.run_transition('migration-success', success=True)
        self.assertTrue(state['migration_admitted_safely'])
        self.assertTrue(state['migration_complete'])
        self.assertEqual(state['active_route'], 'candidate')
        self.assertEqual(state['active_slot'], 'green')
        self.assertEqual(state['queue_flags'], {
            'audio-generation': True, 'speaking-grading': False,
        })
        self.assertIsNone(state['unresolved_marker'])
        self.assertTrue(any(status == 503 for status, version in state['observations']))

    def test_schema_only_change_still_validates_its_explicit_continuity_review(self) -> None:
        state = self.run_transition('migration-schema-only', success=True)
        self.assertTrue(state['migration_complete'])
        self.assertEqual(state['active_route'], 'candidate')

    def test_exact_sdk_index_limitation_is_visibly_verified_and_recorded(self) -> None:
        state = self.run_transition('migration-sdk-index', success=True)
        self.assertTrue(state['drift_proof']['sdkLimitationVerified'])
        self.assertIn('Exact BTree introspection limitation recorded', state['controller_output'])

    def test_wrong_direct_database_is_rejected_before_fencing_or_migration(self) -> None:
        case = controller_tests.DeploymentFailureTests()
        state, output = case.run_deployment(
            'migration-direct-target', schema_transition=True,
            prepaused=True,
        )
        self.assertIn('database/schema identities differ', output)
        self.assertFalse(state.get('migration_started', False))
        self.assertEqual(state['active_route'], 'old')
        self.assertEqual(state['queue_flags'], {
            'audio-generation': True, 'speaking-grading': False,
        })
        self.assertIsNone(state['unresolved_marker'])

    def test_old_target_configuration_or_actual_schema_mismatch_rejects_before_fencing(self) -> None:
        case = controller_tests.DeploymentFailureTests()
        for failure in ['migration-old-target', 'migration-old-web-config', 'migration-old-pg-options']:
            with self.subTest(failure=failure):
                state, output = case.run_deployment(
                    failure, schema_transition=True, prepaused=True,
                )
                self.assertFalse(state.get('migration_started', False), output)
                self.assertEqual(state['active_route'], 'old', output)
                self.assertIsNone(state['unresolved_marker'], output)
                self.assertEqual(state['queue_flags'], {
                    'audio-generation': True, 'speaking-grading': False,
                }, output)

    def test_partial_unknown_migration_and_drift_never_restart_old_or_reopen_admissions(self) -> None:
        for failure in ['migration-partial', 'migration-drift', 'migration-restore']:
            with self.subTest(failure=failure):
                state = self.run_transition(failure, success=False)
                self.assertTrue(state.get('migration_admitted_safely'), state['controller_output'])
                self.assertEqual(state['active_route'], 'maintenance')
                self.assertTrue(all(state['queue_flags'].values()))
                self.assertEqual(state['active_slot'], 'blue')
                self.assertEqual(state['unresolved_marker']['phase'], 'compatibility-cutover')

    def test_lost_fence_response_preserves_preparation_and_does_not_start_migration(self) -> None:
        state = self.run_transition('migration-fence-lost', success=False)
        self.assertFalse(state.get('migration_started', False))
        self.assertEqual(state['active_route'], 'maintenance')
        self.assertTrue(all(state['queue_flags'].values()))
        self.assertEqual(state['unresolved_marker']['phase'], 'compatibility-preparation')
