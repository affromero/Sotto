"""Exercise the real private child-process acknowledgement boundary."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.review.runtime.channel import exchange
from scripts.deploy.review.state import (
    DeploymentLock,
    atomic_json,
    private_json,
)


class ReviewChannelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        path = self.root / 'deploy.lock'
        path.touch(mode=0o600)
        self.lock = DeploymentLock(path)
        self.addCleanup(self.lock.close)
        self.fences = 0
        self.fence_failure = False
        self.manifests: list[dict[str, object]] = []

    def fence(self) -> None:
        self.lock.validate()
        if self.fence_failure:
            raise ValueError('actual-fence-missing')
        self.fences += 1

    def run_child(
        self, body: str, *, mode: str = 'providers', timeout: float = 2,
    ) -> object:
        preamble = '''import json,os,sys,time
initial=json.loads(sys.stdin.readline())
def emit(value):
 print('SOTTO_REVIEW_IPC='+json.dumps(value),flush=True)
def ack(identity):
 assert json.loads(sys.stdin.readline())=={'type':'ack','id':identity}
'''
        return exchange(
            [sys.executable, '-u', '-c', preamble + body],
            {'mode': mode, 'input': {'secret': 'private-fixture-value'}},
            directory=self.root, assert_fence=self.fence,
            queue_manifest=lambda value: self.manifests.append(dict(value)),
            queue_policy=lambda value: atomic_json(
                self.root / 'queue-policy-intent.json', value,
            ),
            timeout=timeout,
        )

    def test_acknowledges_only_after_durable_checkpoint_and_actual_fence(
        self,
    ) -> None:
        script = '''emit({'type':'fence','id':1});ack(1)
emit({'type':'checkpoint','id':2,'value':{
 'credentials':[],'modelChangePrepared':True}});ack(2)
with open(CHECKPOINT) as source:
 assert json.load(source)['modelChangePrepared'] is True
emit({'type':'result','value':{'ready':True}})
assert sys.stdin.read()==''
'''.replace('CHECKPOINT', repr(str(
            self.root / 'provider-checkpoint.json',
        )))
        self.assertEqual(self.run_child(script), {'ready': True})
        self.assertEqual(self.fences, 2)
        retained = self.root / 'provider-checkpoint.json'
        self.assertEqual(retained.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('private-fixture-value', retained.read_text())

    def test_lost_response_retains_original_operation_for_reconciliation(
        self,
    ) -> None:
        script = '''emit({'type':'checkpoint','id':1,'value':{
 'credentials':[{'operationId':'retained-operation'}],
 'modelChangePrepared':False}});ack(1)
sys.exit(9)
'''
        with self.assertRaisesRegex(ValueError, 'result-unresolved'):
            self.run_child(script)
        self.assertEqual(private_json(
            self.root / 'provider-checkpoint.json',
        )['credentials'], [{'operationId': 'retained-operation'}])

    def test_workload_intent_is_durable_before_ack_and_survives_lost_result(
        self,
    ) -> None:
        script = '''emit({'type':'workloadCheckpoint','id':1,'value':{
 'version':1,'inputHash':'a'*64,'startedAt':123,
 'profiles':[{'courseIntent':True},{'courseIntent':False}]}});ack(1)
with open(CHECKPOINT) as source:
 assert json.load(source)['profiles'][0]['courseIntent'] is True
sys.exit(9)
'''.replace('CHECKPOINT', repr(str(
            self.root / 'workload-checkpoint.json',
        )))
        with self.assertRaisesRegex(ValueError, 'result-unresolved'):
            self.run_child(script, mode='workloads')
        retained = self.root / 'workload-checkpoint.json'
        self.assertEqual(private_json(retained)['startedAt'], 123)
        self.assertEqual(retained.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('private-fixture-value', retained.read_text())
        self.assertEqual(self.fences, 1)

    def test_other_modes_cannot_acknowledge_workload_mutation_intents(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, 'unexpected-workload'):
            self.run_child('''emit({'type':'workloadCheckpoint','id':1,
 'value':{}});ack(1)
''', mode='paused-admission')
        self.assertFalse((self.root / 'workload-checkpoint.json').exists())

    def test_foreign_event_and_sequence_gap_never_receive_ack(self) -> None:
        for event in [
            {'type': 'checkpoint', 'id': 2, 'value': {}},
            {'type': 'erase', 'id': 1},
            {'type': 'fence', 'id': True},
        ]:
            with self.subTest(event=event), self.assertRaises(ValueError):
                self.run_child('emit(' + repr(event) + ')\nack(1)\n')
        self.assertEqual(self.fences, 0)
        self.assertFalse((self.root / 'provider-checkpoint.json').exists())

    def test_queue_manifest_is_saved_before_child_may_pause(self) -> None:
        result = self.run_child('''emit({'type':'queueManifest','id':1,
 'value':{'queues':[{'name':'worksheet-pdf','paused':False}]}});ack(1)
emit({'type':'result','value':{'paused':True}})
''', mode='prepare')
        self.assertEqual(result, {'paused': True})
        self.assertEqual(self.manifests, [{
            'queues': [{'name': 'worksheet-pdf', 'paused': False}],
        }])
        self.assertEqual(self.fences, 1)

    def test_failed_fence_does_not_acknowledge_or_change_checkpoint(
        self,
    ) -> None:
        self.fence_failure = True
        with self.assertRaisesRegex(ValueError, 'actual-fence-missing'):
            self.run_child('''emit({'type':'checkpoint','id':1,'value':{
 'credentials':[],'modelChangePrepared':False}});ack(1)
''')
        self.assertFalse((self.root / 'provider-checkpoint.json').exists())

    def test_getter_only_guard_acknowledges_without_a_mutation_checkpoint(
        self,
    ) -> None:
        result = self.run_child('''emit({'type':'policyCheck','id':1});ack(1)
emit({'type':'result','value':{'concurrency':1}})
''', mode='queue-policy')
        self.assertEqual(result, {'concurrency': 1})
        self.assertEqual(self.fences, 1)
        self.assertFalse((self.root / 'provider-checkpoint.json').exists())
        self.assertFalse((self.root / 'queue-policy-intent.json').exists())

    def test_getter_only_mode_cannot_acknowledge_fence_or_mutation_events(
        self,
    ) -> None:
        for kind in ('fence', 'checkpoint', 'workloadCheckpoint',
                     'queueManifest', 'queuePolicyIntent'):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.run_child("emit({'type':" + repr(kind)
                               + ",'id':1,'value':{}});ack(1)",
                               mode='queue-policy')
        self.assertEqual(self.fences, 0)
        self.assertFalse((self.root / 'provider-checkpoint.json').exists())
        self.assertFalse((self.root / 'queue-policy-intent.json').exists())

    def test_original_concurrency_intent_is_durable_before_setter_ack(
        self,
    ) -> None:
        path = self.root / 'queue-policy-intent.json'
        result = self.run_child('''emit({'type':'queuePolicyIntent','id':1,
'value':{'originalConcurrency':None,'concurrency':1}});ack(1)
with open(INTENT) as source:
 assert json.load(source)['originalConcurrency'] is None
emit({'type':'result','value':{'prepared':True}})
'''.replace('INTENT', repr(str(path))), mode='prepare')
        self.assertEqual(result, {'prepared': True})
        self.assertEqual(private_json(path)['concurrency'], 1)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_partial_line_deadline_and_duplicate_result_fail_closed(
        self,
    ) -> None:
        for script, message in [
            ("sys.stdout.write('SOTTO_REVIEW_IPC={');sys.stdout.flush()",
             'result-unresolved'),
            ("emit({'type':'result','value':{}});"
             "emit({'type':'result','value':{}})", 'message-after-result'),
        ]:
            with self.subTest(script=script), self.assertRaisesRegex(
                ValueError, message,
            ):
                self.run_child(script)
        with self.assertRaises(TimeoutError):
            self.run_child('time.sleep(2)', timeout=0.05)

    def test_child_diagnostics_remain_private_and_preserve_original_failure(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, 'result-unresolved'):
            self.run_child("print('private diagnostic',file=sys.stderr)")
        paths = list(self.root.glob('runtime-diagnostics-*.bin'))
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0].read_bytes(), b'private diagnostic\n')
        self.assertEqual(paths[0].stat().st_mode & 0o777, 0o600)
        self.assertEqual(os.fstat(9).st_ino,
                         (self.root / 'deploy.lock').stat().st_ino)
