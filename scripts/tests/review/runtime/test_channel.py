"""Exercise the real private child-process acknowledgement boundary."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.review.runtime.channel import exchange
from scripts.deploy.review.state import DeploymentLock, private_json


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
