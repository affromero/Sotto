"""Exercise host command delivery while retaining the actual shared lock."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shlex
import sys
import tempfile
import unittest
from collections.abc import Mapping, Sequence
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.egress import TABLE, semantic_policy
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    atomic_json,
    checksum,
    private_json,
)
from scripts.deploy.review.topology import NETWORK
from scripts.tests.review.runtime.migration_fixture import (
    PREFIX,
    MigrationFixture,
    ToolExecutor,
    interleaved_inventories,
    sql_names,
)


class HostCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o700)
        self.path = self.root / 'fixture.lock'
        self.path.touch(mode=0o600)
        self.lock = DeploymentLock(self.path)
        self.addCleanup(self.lock.close)
        repository = Path(__file__).resolve().parents[4]
        tools = {
            str(path.relative_to(repository)):
            hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (repository / 'scripts/deploy').rglob('*')
            if path.is_file() and path.suffix in {'.py', '.ts', '.cjs'}
        }
        attempt = Attempt.create(self.root, 'fixture', {'tools': tools},
                                 'a' * 64)
        self.operations = HostOperations(attempt, self.lock)

    def test_standard_input_handoff_runs_exact_command_with_same_lock(
        self,
    ) -> None:
        # The system boundary emulates sudo's descriptor closure. The actual
        # bootstrap handoff and final process execute without substitution.
        sudo = self.root / 'sudo'
        handoff = '''
import os,sys
from pathlib import Path
from scripts.deploy.review.runtime.privileged import handoff
args=sys.argv[1:]
assert args[:4]==['-n','/usr/bin/python3','-m',
                 'scripts.deploy.review.runtime.privileged']
split=args.index('--')
options=dict(zip(args[4:split:2],args[5:split:2]))
os.close(9)
handoff(Path(options['--lock']),Path(options['--payload'])
        if '--payload' in options else None,
        int(options['--owner-uid']),options.get('--payload-sha256'),
        args[split+1:])
'''
        sudo.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable)
                        + ' -c ' + shlex.quote(handoff) + ' "$@"\n')
        sudo.chmod(0o700)
        target = '''import hashlib,json,os,sys
metadata=os.fstat(9)
print(json.dumps({'device':metadata.st_dev,'inode':metadata.st_ino,
 'sha256':hashlib.sha256(sys.stdin.buffer.read()).hexdigest(),
 'stdinInheritable':os.get_inheritable(0)}))
'''
        for content in (None, b'private fixture input'):
            with self.subTest(contentPresent=content is not None), patch.dict(
                os.environ,
                {'PATH': str(self.root) + ':' + os.environ['PATH'],
                 'PYTHONPATH': ''},
            ):
                result = json.loads(self.operations.command(
                    ['sudo', '-n', sys.executable, '-c', target],
                    content=content,
                ))
                metadata = os.fstat(9)
                self.assertEqual(result, {
                    'device': metadata.st_dev, 'inode': metadata.st_ino,
                    'sha256': hashlib.sha256(content or b'').hexdigest(),
                    'stdinInheritable': True,
                })
                self.lock.validate()

    def test_multiple_command_failures_preserve_every_diagnostic(
        self,
    ) -> None:
        for message in ('first fixture failure', 'second fixture failure'):
            with self.assertRaisesRegex(RuntimeError, 'review-command-failed'):
                self.operations.command([
                    sys.executable, '-c',
                    'import sys;sys.stderr.write(' + repr(message)
                    + ');sys.exit(17)',
                ])
        failures = [json.loads(path.read_text()) for path in
                    self.operations.attempt.directory.glob(
                        'command-failure-*.json',
                    )]
        self.assertEqual(len(failures), 2)
        self.assertEqual({item['stderr'] for item in failures}, {
            'first fixture failure', 'second fixture failure',
        })
        self.assertTrue(all(item['exitCode'] == 17 for item in failures))

    def test_changed_bound_runtime_source_refuses_before_root_command(
        self,
    ) -> None:
        tools = self.operations.manifest['tools']
        assert isinstance(tools, dict)
        tools['scripts/deploy/review/runtime/channel.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'runtime-tool-changed'):
            self.operations.command([
                'sudo', '-n', sys.executable, '-c',
                'raise RuntimeError("must not execute")',
            ])
        self.assertEqual(list(self.operations.attempt.directory.glob(
            'root-input-*',
        )), [])

    def test_missing_auth_and_activation_source_binding_refuses_root_work(
        self,
    ) -> None:
        tools = self.operations.manifest['tools']
        assert isinstance(tools, dict)
        for name in ('services.py', 'release/__init__.py',
                     'policy/__init__.py', 'policy/queues.ts'):
            retained = tools.pop('scripts/deploy/review/runtime/' + name)
            with self.subTest(source=name), self.assertRaisesRegex(
                ValueError, 'complete-runtime-source',
            ):
                self.operations.command([
                    'sudo', '-n', sys.executable, '-c',
                    'raise RuntimeError("must not execute")',
                ])
            tools['scripts/deploy/review/runtime/' + name] = retained

    def test_guard_rejects_changed_bridge_identity_or_missing_policy_family(
        self,
    ) -> None:
        self.operations.manifest['topology'] = {
            'network': {'id': 'a' * 64},
        }
        networks: list[dict[str, object]] = [
            {'Name': NETWORK, 'Id': 'a' * 64, 'Options': {}},
            {'Name': 'sotto-review_egress', 'Id': 'b' * 64, 'Options': {}},
        ]
        families = {family: {'nftables': [
            {'table': {'family': family, 'name': TABLE}},
            {'rule': {'family': family, 'table': TABLE,
                      'chain': 'forward', 'expr': [{'drop': None}]}},
        ]} for family in ('inet', 'bridge')}
        combined = {'nftables': [entry for policy in families.values()
                                for entry in policy['nftables']]}
        rules = self.root / 'guard.nft'
        rules.write_bytes(b'exact-admitted-rules')
        atomic_json(self.operations.attempt.directory / 'egress.json', {
            'networkId': 'b' * 64,
            'bridges': ['br-' + 'a' * 12, 'br-' + 'b' * 12],
            'policyHash': checksum(semantic_policy(combined)),
            'rulesHash': hashlib.sha256(rules.read_bytes()).hexdigest(),
        })

        def nft(arguments: list[str]) -> bytes:
            return json.dumps(families[arguments[-2]]).encode()

        with (patch('scripts.deploy.review.runtime.operations.RULES_PATH',
                    str(rules)),
              patch.object(HostOperations, 'command', side_effect=nft),
              patch.object(HostOperations, 'docker', side_effect=lambda *args:
                           json.dumps(networks).encode())):
            self.operations.verify_egress()
            original = copy.deepcopy(families['bridge'])
            families['bridge'] = {'nftables': []}
            with self.assertRaisesRegex(ValueError, 'Exactly inet and bridge'):
                self.operations.verify_egress()
            families['bridge'] = original
            networks[1]['Id'] = 'c' * 64
            with self.assertRaisesRegex(ValueError, 'network-identity'):
                self.operations.verify_egress()


class MigrationStageTests(unittest.TestCase):
    def host(
        self, inventories: Sequence[Mapping[str, str]] | None = None, *,
        tool_executor: ToolExecutor | None = None,
    ) -> MigrationFixture:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        return MigrationFixture(
            Path(temporary.name), inventories or interleaved_inventories(),
            tool_executor=tool_executor,
        )

    def receipts(self, host: MigrationFixture) -> dict[str, bytes]:
        return {path.name: path.read_bytes() for path in
                host.attempt.directory.glob('stage-*.json')}

    def assert_receipt(self, host: MigrationFixture, index: int) -> None:
        self.assertEqual(private_json(host.stage_path(index)), {
            'verified': True, 'migrations': sql_names(host.inventories[index]),
        })

    def advance(self, host: MigrationFixture, through: int) -> HostOperations:
        operations = host.reconstruct()
        for index in range(1, through + 1):
            operations.migrate_stage(host.stages[index],
                                     host.stages[index - 1])
            self.assertEqual(operations.applied_migrations(),
                             sql_names(host.inventories[index]))
            self.assert_receipt(host, index)
        return operations

    def test_interleaved_stages_establish_exact_sql_and_durable_receipts(
        self,
    ) -> None:
        with self.host() as host:
            self.advance(host, 3)
            self.assertEqual([len(item) for item in host.inventories],
                             [11, 13, 28, 31])
            journals = [private_json(path) for path in
                        host.attempt.directory.glob('helper-*.json')]
            self.assertTrue(journals)
            self.assertTrue(all(
                item['status'] == 'settled' and item['exitCode'] == 0
                for item in journals
            ))

    def test_reconstructed_attempt_replays_completed_and_partial_later_stages(
        self,
    ) -> None:
        with self.host() as host:
            self.advance(host, 2)
            retained = self.receipts(host)
            operations = host.reconstruct()
            host.replay_only = True
            operations.migrate_stage(host.stages[1], host.stages[0])
            self.assertEqual(operations.applied_migrations(),
                             sql_names(host.inventories[2]))
            self.assertEqual(self.receipts(host), retained)
            final = sql_names(host.inventories[3])
            middle = sql_names(host.inventories[2])
            first = sorted(final.keys() - middle.keys())[0]
            partial = {**middle, first: final[first]}
            host.set_inventory(partial)
            operations = host.reconstruct()
            for index in (1, 2):
                operations.migrate_stage(host.stages[index],
                                         host.stages[index - 1])
                self.assertEqual(operations.applied_migrations(), partial)
                self.assertEqual(self.receipts(host), retained)
            self.assertFalse(host.stage_path(3).exists())
            host.replay_only = False
            operations.migrate_stage(host.stages[3], host.stages[2])
            self.assertEqual(operations.applied_migrations(), final)
            self.assert_receipt(host, 3)
            host.replay_only = True
            host.reconstruct().migrate_stage(host.stages[3], host.stages[2])
            self.assertEqual(operations.applied_migrations(), final)

    def test_active_stage_orders_only_its_new_names_before_and_between_old_sql(
        self,
    ) -> None:
        previous = {PREFIX + name + '/migration.sql': name * 21 + 'a'
                    for name in ('020', '040')}
        candidate = {**previous, **{
            PREFIX + name + '/migration.sql': name * 21 + 'a'
            for name in ('010', '030')
        }}
        for additions in ((), ('010',)):
            with self.subTest(additions=additions), self.host(
                [previous, candidate],
            ) as host:
                actual = sql_names(previous)
                actual.update({name: name * 21 + 'a' for name in additions})
                host.set_inventory(actual)
                operations = host.reconstruct()
                operations.migrate_stage(host.stages[1], host.stages[0])
                self.assertEqual(operations.applied_migrations(),
                                 sql_names(candidate))
                self.assert_receipt(host, 1)

    def test_invalid_active_history_preserves_sql_and_existing_receipts(
        self,
    ) -> None:
        inventories = interleaved_inventories()
        previous = sql_names(inventories[2])
        candidate = sql_names(inventories[3])
        additions = sorted(candidate.keys() - previous.keys())
        oldest = sorted(previous)[0]
        missing = {key: value for key, value in previous.items()
                   if key != oldest}
        cases = {
            'missing-previous': missing,
            'same-count-replacement': {**missing, additions[0]:
                                       candidate[additions[0]]},
            'changed-previous': {**previous, oldest: 'f' * 64},
            'changed-new': {**previous, additions[0]: 'f' * 64},
            'unknown-name': {**previous, '000_unknown': 'f' * 64},
            'hole-in-additions': {**previous, additions[1]:
                                  candidate[additions[1]]},
        }
        for name, actual in cases.items():
            with self.subTest(history=name), self.host() as host:
                operations = self.advance(host, 2)
                host.set_inventory(actual)
                ledger = copy.deepcopy(host.ledger)
                receipts = self.receipts(host)
                host.replay_only = True
                with self.assertRaises(ValueError):
                    operations.migrate_stage(host.stages[3], host.stages[2])
                self.assertEqual(host.ledger, ledger)
                self.assertEqual(self.receipts(host), receipts)

    def test_retained_stage_rejects_corruption_and_incomplete_intervening_sql(
        self,
    ) -> None:
        inventories = interleaved_inventories()
        completed = sql_names(inventories[1])
        middle = sql_names(inventories[2])
        final = sql_names(inventories[3])
        middle_new = sorted(middle.keys() - completed.keys())
        final_new = sorted(final.keys() - middle.keys())
        oldest = sorted(completed)[0]
        cases = {
            'missing-completed': {key: value for key, value in middle.items()
                                   if key != oldest},
            'changed-completed': {**middle, oldest: 'f' * 64},
            'changed-later': {**middle, middle_new[0]: 'f' * 64},
            'unknown': {**middle, '000_unknown': 'f' * 64},
            'middle-hole': {**completed, middle_new[1]: middle[middle_new[1]]},
            'final-hole': {**middle, final_new[1]: final[final_new[1]]},
            'skipped-middle': {**completed, final_new[0]: final[final_new[0]]},
            'partial-middle-plus-final': {
                **completed, middle_new[0]: middle[middle_new[0]],
                final_new[0]: final[final_new[0]],
            },
        }
        for name, actual in cases.items():
            with self.subTest(history=name), self.host() as host:
                self.advance(host, 1)
                host.set_inventory(actual)
                ledger = copy.deepcopy(host.ledger)
                receipts = self.receipts(host)
                host.replay_only = True
                with self.assertRaisesRegex(ValueError, 'post-stage-sql'):
                    host.reconstruct().migrate_stage(host.stages[1],
                                                     host.stages[0])
                self.assertEqual(host.ledger, ledger)
                self.assertEqual(self.receipts(host), receipts)

    def test_retained_receipt_must_match_the_exact_completed_inventory(
        self,
    ) -> None:
        changes: list[dict[str, object]] = [
            {'verified': False}, {'verified': 1}, {'migrations': {}},
            {'extra': True},
        ]
        for changed in changes:
            with self.subTest(receipt=changed), self.host() as host:
                self.advance(host, 2)
                path = host.stage_path(1)
                atomic_json(path, {**private_json(path), **changed})
                ledger = copy.deepcopy(host.ledger)
                receipts = self.receipts(host)
                host.replay_only = True
                with self.assertRaisesRegex(ValueError, 'retained-stage'):
                    host.reconstruct().migrate_stage(host.stages[1],
                                                     host.stages[0])
                self.assertEqual(host.ledger, ledger)
                self.assertEqual(self.receipts(host), receipts)

    def test_retained_inventory_must_exist_in_the_admitted_chain(
        self,
    ) -> None:
        with self.host() as host:
            self.advance(host, 1)
            alternate = copy.deepcopy(host.inventories[1])
            alternate[PREFIX + '135_unadmitted/migration.sql'] = 'f' * 64
            stage = {**host.stages[1], 'migrations': alternate}
            host.set_inventory(sql_names(alternate))
            atomic_json(host.stage_path(1), {
                'verified': True, 'migrations': sql_names(alternate),
            })
            ledger, receipts = copy.deepcopy(host.ledger), self.receipts(host)
            host.replay_only = True
            with self.assertRaisesRegex(ValueError, 'post-stage-sql'):
                host.reconstruct().migrate_stage(stage, host.stages[0])
            self.assertEqual(host.ledger, ledger)
            self.assertEqual(self.receipts(host), receipts)

    def test_unfinished_rolled_back_duplicate_or_malformed_ledger_rows_refuse(
        self,
    ) -> None:
        for change in ('unfinished', 'rolled-back', 'duplicate', 'checksum'):
            with self.subTest(row=change), self.host() as host:
                operations = self.advance(host, 1)
                if change == 'unfinished':
                    host.ledger[0]['finished'] = False
                elif change == 'rolled-back':
                    host.ledger[0]['rolledBack'] = True
                elif change == 'duplicate':
                    host.ledger.append(dict(host.ledger[0]))
                else:
                    host.ledger[0]['checksum'] = 'invalid'
                ledger = copy.deepcopy(host.ledger)
                receipts = self.receipts(host)
                host.replay_only = True
                with self.assertRaises(ValueError):
                    operations.migrate_stage(host.stages[2], host.stages[1])
                self.assertEqual(host.ledger, ledger)
                self.assertEqual(self.receipts(host), receipts)

    def test_stage_bounds_and_published_checksums_remain_enforced(
        self,
    ) -> None:
        for change in ('empty', 'too-many', 'changed', 'removed'):
            with self.subTest(stage=change), self.host() as host:
                before = host.inventories[0]
                after = dict(host.inventories[1])
                if change == 'empty':
                    after = dict(before)
                elif change == 'too-many':
                    added = {PREFIX + str(index) + '/migration.sql': 'f' * 64
                             for index in range(17)}
                    after = {**before, **added}
                elif change == 'changed':
                    after[sorted(before)[0]] = 'f' * 64
                else:
                    del after[sorted(before)[0]]
                ledger = copy.deepcopy(host.ledger)
                receipts = self.receipts(host)
                host.replay_only = True
                with self.assertRaises(ValueError):
                    host.reconstruct().migrate_stage(
                        {**host.stages[1], 'migrations': after},
                        host.stages[0],
                    )
                self.assertEqual(host.ledger, ledger)
                self.assertEqual(self.receipts(host), receipts)

    def test_failed_post_inventory_helper_or_drift_never_receipts_a_stage(
        self,
    ) -> None:
        for failure in ('post-inventory', 'helper-bytes', 'establishment',
                        'drift'):
            with self.subTest(failure=failure), self.host() as host:
                if failure == 'post-inventory':
                    host.deploy_result = sql_names(host.inventories[0])
                elif failure == 'helper-bytes':
                    helper = (host.root / 'review-stage-assets'
                              / str(host.receipts[1]['sha'])
                              / 'queue-lifecycle.cjs')
                    helper.write_bytes(b'changed helper bytes')
                elif failure == 'establishment':
                    host.establishment = {'established': True,
                                          'appliedMigrations': 1}
                else:
                    host.drift = True
                with self.assertRaises((ValueError, RuntimeError)):
                    host.reconstruct().migrate_stage(host.stages[1],
                                                     host.stages[0])
                expected = host.inventories[0 if failure == 'post-inventory'
                                            else 1]
                self.assertEqual(host.reconstruct().applied_migrations(),
                                 sql_names(expected))
                self.assertEqual(self.receipts(host), {})

    def test_supplied_process_executor_observes_canonical_rendered_tools(
        self,
    ) -> None:
        def executor(
            command: Sequence[str], content: bytes | None,
            timeout: float | None,
        ) -> bytes:
            self.assertEqual(command[:2], ['docker', 'create'])
            self.assertIn('--read-only', command)
            self.assertIn('--env-file', command)
            self.assertEqual(timeout, 900)
            self.assertIsNone(content)
            return json.dumps([{
                'name': 'external_sql', 'checksum': 'e' * 64,
                'finished': True, 'rolledBack': False,
            }]).encode()

        with self.host(tool_executor=executor) as host:
            self.assertEqual(host.reconstruct().applied_migrations(),
                             {'external_sql': 'e' * 64})
            journals = [private_json(path) for path in
                        host.attempt.directory.glob('helper-*.json')]
            self.assertTrue(all(
                item['status'] == 'settled' and item['exitCode'] == 0
                for item in journals
            ))
