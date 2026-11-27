"""Verify lineage of provider readiness during established App Review upgrades."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.release import successor
from scripts.deploy.review.state import Attempt, DeploymentLock, atomic_json


class RetainedProviderCheckpointTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o700)
        path = self.root / 'deploy.lock'
        path.touch(mode=0o600)
        self.lock = DeploymentLock(path)
        self.addCleanup(self.lock.close)
        self.attempt = Attempt.create(self.root, 'successor', {}, 'a' * 64)
        self.inputs: dict[str, object] = {}
        inputs_patch = patch.object(services, 'private_inputs', return_value=self.inputs)
        inputs_patch.start()
        self.addCleanup(inputs_patch.stop)

    def provider_checkpoint_fixture(
        self,
    ) -> tuple[HostOperations, HostOperations, dict[str, object], dict[str, object]]:
        previous_attempt = Attempt.create(self.root, 'previous', {}, 'b' * 64)
        previous = HostOperations(previous_attempt, self.lock)
        current = HostOperations(self.attempt, self.lock)
        current.manifest['predecessor'] = {'directory': str(previous_attempt.directory)}
        readiness = {'profiles': [{'id': 'owner'}, {'id': 'member'}], 'speechProvider': 'openai'}
        self.inputs['readiness'] = readiness
        checkpoint = {
            'credentials': [
                {'profileId': profile, 'endpoint': endpoint, 'command': {
                    'operationId': profile + '-' + endpoint,
                    'provider': 'openai', 'expectedRevision': None,
                }}
                for profile in ('owner', 'member')
                for endpoint in ('ai-keys', 'byok')
            ],
            'modelChangePrepared': True,
        }
        return current, previous, readiness, checkpoint

    def test_established_provider_settings_adopt_a_verified_checkpoint_without_a_write_journal(
        self,
    ) -> None:
        current, previous, readiness, checkpoint = self.provider_checkpoint_fixture()
        source = previous.attempt.directory / successor.PROVIDER_CHECKPOINT
        atomic_json(source, checkpoint)
        with patch.object(successor, 'bind_predecessor', return_value=previous):
            inherited = successor.inherited_provider_checkpoint(current, readiness)
            self.assertEqual(inherited['checkpoint'], checkpoint)
            self.assertEqual(inherited['sourceSha256'], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertFalse((current.attempt.directory / successor.PROVIDER_CHECKPOINT).exists())
            receipt = current.attempt.directory / successor.INHERITED_PROVIDER_CHECKPOINT
            atomic_json(receipt, inherited)
            self.assertEqual(successor.inherited_provider_checkpoint(current, readiness), inherited)
            atomic_json(receipt, {**inherited, 'sourceSha256': '0' * 64})
            with self.assertRaisesRegex(ValueError, 'inherited-provider-checkpoint-changed'):
                successor.inherited_provider_checkpoint(current, readiness)

    def test_retained_provider_receipt_supplies_the_next_successor(self) -> None:
        current, previous, readiness, checkpoint = self.provider_checkpoint_fixture()
        source = previous.attempt.directory / successor.INHERITED_PROVIDER_CHECKPOINT
        previous.manifest['predecessor'] = {'directory': str(self.root / 'earlier')}
        atomic_json(source, {
            'manifestSha256': previous.attempt.manifest_hash,
            'predecessor': previous.manifest['predecessor'],
            'source': successor.PROVIDER_CHECKPOINT, 'sourceSha256': 'c' * 64,
            'checkpoint': checkpoint,
        })
        with patch.object(successor, 'bind_predecessor', return_value=previous):
            inherited = successor.inherited_provider_checkpoint(current, readiness)
        self.assertEqual(inherited['source'], successor.INHERITED_PROVIDER_CHECKPOINT)
        self.assertEqual(inherited['checkpoint'], checkpoint)

    def test_established_provider_settings_fail_closed_on_drift_or_incomplete_receipts(self) -> None:
        current, previous, readiness, checkpoint = self.provider_checkpoint_fixture()
        source = previous.attempt.directory / successor.PROVIDER_CHECKPOINT
        with patch.object(successor, 'bind_predecessor', return_value=previous):
            with self.assertRaisesRegex(ValueError, 'one-completed-predecessor-provider-checkpoint'):
                successor.inherited_provider_checkpoint(current, readiness)
            atomic_json(source, {**checkpoint, 'credentials': []})
            with self.assertRaisesRegex(ValueError, 'complete-retained-provider-checkpoint'):
                successor.inherited_provider_checkpoint(current, readiness)
            atomic_json(source, checkpoint)
            with self.assertRaisesRegex(ValueError, 'retained-provider-readiness-inputs-changed'):
                successor.inherited_provider_checkpoint(current, {**readiness, 'speechProvider': 'other'})
            atomic_json(previous.attempt.directory / successor.INHERITED_PROVIDER_CHECKPOINT, {})
            with self.assertRaisesRegex(ValueError, 'one-completed-predecessor-provider-checkpoint'):
                successor.inherited_provider_checkpoint(current, readiness)
