"""Verify backup-gated recovery and its exact successor data receipt."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.release import assessment_recovery
from scripts.deploy.review.state import atomic_json


class AssessmentRecoveryTests(unittest.TestCase):
    def test_records_original_data_before_cleanup_and_resumes_after_settlement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            previous = MagicMock(spec=HostOperations)
            successor = MagicMock(spec=HostOperations)
            successor.attempt = MagicMock()
            successor.attempt.directory = Path(directory)
            atomic_json(Path(directory) / 'backups.json', {'archive': 'verified'})
            successor.attempt.manifest_hash = 'a' * 64
            successor.attempt.manifest.return_value = {'finalWorker': {'sha': 'b' * 40}}
            before = {'schemaVersion': 1, 'tables': [
                {'table': 'User', 'sha256': 'c' * 64},
                {'table': 'SidedoorState', 'sha256': 'd' * 64},
            ]}
            settled = {**before, 'tables': [
                before['tables'][0], {'table': 'SidedoorState', 'sha256': 'e' * 64},
            ]}
            proof = {'binding': {'id': 'synthetic-execution'}}
            projected = {'settled': False, 'receipt': False, 'outside': {'sha256': 'f' * 64},
                         'indexesSha256': 'a' * 64}
            first = {'observation': before, 'assessmentRecovery': projected}
            last = {'observation': settled, 'assessmentRecovery': {
                **projected, 'settled': True, 'receipt': True, 'indexesSha256': None,
            }}
            successor.image_command.side_effect = [
                json.dumps(value).encode() for value in (first, last, last)
            ]

            def cleanup(*_arguments: object, **_options: object) -> dict[str, str]:
                self.assertTrue((Path(directory) / 'assessment-recovery-data-before.json').exists())
                return {'executionId': 'synthetic-execution'}

            successor.runtime_exchange.side_effect = cleanup
            with (patch.object(assessment_recovery, 'approved_assessment_cleanup',
                               return_value={'proof': proof, 'originalQueues': {}}),
                  patch.object(assessment_recovery, 'preservation_request', return_value=(b'{}', before)),
                  patch.object(assessment_recovery, 'retained_inventory_network', return_value='none')):
                assessment_recovery.recover_assessment_data(previous, successor)
                self.assertEqual(
                    assessment_recovery.retained_assessment_recovery_data(successor, before),
                    settled,
                )
                successor.runtime_exchange.side_effect = AssertionError('completed recovery replayed')
                assessment_recovery.recover_assessment_data(previous, successor)
