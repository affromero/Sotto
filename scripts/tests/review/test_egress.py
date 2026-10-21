"""Scope the review guard without changing another Docker firewall table."""

from __future__ import annotations

import ast
import copy
import hashlib
import io
import itertools
import json
import os
import runpy
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from pathlib import Path
from typing import cast
from unittest.mock import Mock, patch

from scripts.deploy.review.egress import (
    TABLE,
    bridge_name,
    collect_policy,
    guard_unit,
    host_addresses,
    render_rules,
    semantic_policy,
    verify_policy,
)
from scripts.deploy.review.state import checksum
from scripts.tests.review.egress_namespace import LINUX_NAMESPACE_HARNESS


class ReviewEgressTests(unittest.TestCase):
    def test_actual_host_addresses_and_exact_review_bridges_are_required(
        self,
    ) -> None:
        addresses = host_addresses([{
            'ifname': 'eth0', 'addr_info': [
                {'family': 'inet', 'local': '203.0.114.1'},
                {'family': 'inet6', 'local': '2001:db8::1'},
            ],
        }])
        self.assertEqual(addresses, ['203.0.114.1'])
        self.assertEqual(bridge_name({'Id': 'a' * 64, 'Options': {}}),
                         'br-' + 'a' * 12)
        for value in ({'Id': 'short'}, {'Id': 'a' * 64, 'Options': {
                'com.docker.network.bridge.name': 'br-x; flush ruleset'}}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bridge_name(value)
        with self.assertRaisesRegex(ValueError, 'address inventory'):
            host_addresses([])

    def test_only_review_interfaces_get_private_and_host_destination_blocks(
        self,
    ) -> None:
        rules = render_rules(['br-review', 'br-egress'], ['203.0.114.1'])
        self.assertIn('iifname @bridges jump review_forward', rules)
        self.assertIn('iifname @bridges jump review_input', rules)
        self.assertIn('elements = { "br-egress", "br-review" }', rules)
        self.assertIn('203.0.114.1/32', rules)
        self.assertIn('172.16.0.0/12', rules)
        self.assertIn('ip daddr @blocked drop', rules)
        self.assertIn('meta nfproto ipv6 drop', rules)
        self.assertIn('tcp dport { 53, 80, 443 } return\n        drop', rules)
        self.assertGreater(rules.index('udp dport 53 return'),
                           rules.index('ip daddr @blocked drop'))
        self.assertIn('ct direction reply ct state established,related', rules)
        self.assertIn('172.30.99.3 tcp dport 5432 return', rules)
        self.assertIn('172.30.99.2 tcp dport 6379 return', rules)
        self.assertNotIn('flush ruleset', rules)
        self.assertNotIn('DOCKER', rules)
        self.assertEqual(rules.count('delete table'), 2)
        self.assertIn('delete table inet ' + TABLE, rules)
        self.assertIn('delete table bridge ' + TABLE, rules)
        self.assertIn('meta ibrname @bridges jump review_forward', rules)
        self.assertIn('meta obrname @bridges ip daddr 172.30.99.3', rules)
        bridge = rules.split('table bridge ' + TABLE + ' {', 1)[1]
        self.assertLess(bridge.index('ether type arp return'),
                        bridge.index('ct state invalid drop'))
        reply = ('        ct direction reply '
                 'ct state established,related return')
        self.assertIn('        ct state invalid drop\n' + reply, bridge)
        self.assertLess(bridge.index(reply),
                        bridge.index('ip daddr @blocked drop'))
        inet = rules.split('table inet ' + TABLE + ' {', 1)[1].split(
            'table bridge ' + TABLE + ' {', 1)[0]
        inet_forward = inet.split('chain review_forward {', 1)[1].split(
            'chain forward {', 1)[0]
        self.assertNotIn(reply, inet_forward.splitlines())
        self.assertIn('ether type ip6 drop', bridge)
        self.assertNotIn('hook input', bridge)
        unit = guard_unit()
        self.assertIn('Before=docker.service', unit)
        self.assertIn('RequiredBy=docker.service', unit)
        self.assertNotIn('ExecStop', unit)
        self.assertNotIn('nftables.service', unit)

    def test_kernel_policy_identity_survives_handle_changes_but_not_rule_loss(
        self,
    ) -> None:
        value: dict[str, object] = {'nftables': [
            {'metainfo': {'version': '1.0.9'}},
            {'table': {'family': 'inet', 'name': TABLE, 'handle': 100}},
            {'chain': {'family': 'inet', 'table': TABLE, 'name': 'input',
                       'hook': 'input', 'prio': -10, 'policy': 'accept',
                       'handle': 101}},
            {'rule': {'family': 'inet', 'table': TABLE, 'chain': 'input',
                      'expr': [{'drop': None}], 'handle': 102}},
            {'table': {'family': 'bridge', 'name': TABLE, 'handle': 300}},
            {'rule': {'family': 'bridge', 'table': TABLE, 'chain': 'forward',
                      'expr': [{'drop': None}], 'handle': 301}},
        ]}
        admitted = checksum(semantic_policy(value))
        changed = copy.deepcopy(value)
        objects = cast(list[dict[str, dict[str, object]]], changed['nftables'])
        objects[0]['metainfo']['version'] = '1.1.0'
        for item in objects[1:]:
            next(iter(item.values()))['handle'] = 200
        verify_policy(changed, admitted)
        objects.pop()
        with self.assertRaisesRegex(ValueError, 'differs from admitted'):
            verify_policy(changed, admitted)
        with self.assertRaisesRegex(ValueError, 'Exactly inet and bridge'):
            semantic_policy({'nftables': []})
        with self.assertRaisesRegex(ValueError, 'Unexpected table'):
            semantic_policy({'nftables': [{'table': {
                'family': 'ip', 'name': 'filter',
            }}]})

    def test_each_guard_family_is_required_once_and_preserves_rule_order(
        self,
    ) -> None:
        inet = [{'table': {'family': 'inet', 'name': TABLE}}]
        bridge = [
            {'table': {'family': 'bridge', 'name': TABLE}},
            {'rule': {'family': 'bridge', 'table': TABLE, 'chain': 'forward',
                      'expr': [{'accept': None}]}},
            {'rule': {'family': 'bridge', 'table': TABLE, 'chain': 'forward',
                      'expr': [{'drop': None}]}},
        ]
        admitted = checksum(semantic_policy({'nftables': inet + bridge}))
        verify_policy({'nftables': bridge + inet}, admitted)
        for objects in [inet, bridge, inet + bridge + inet,
                        inet + [bridge[0], bridge[2], bridge[1]]]:
            with self.subTest(objects=objects), self.assertRaises(ValueError):
                verify_policy({'nftables': objects}, admitted)

    def test_collector_binds_both_actual_family_responses(self) -> None:
        def boundary(arguments: object) -> bytes:
            self.assertIsInstance(arguments, list)
            args = cast(list[str], arguments)
            self.assertEqual(args[:-2], [
                'sudo', '-n', '/usr/sbin/nft', '-j', 'list', 'table'])
            self.assertEqual(args[-1], TABLE)
            return json.dumps({'nftables': [
                {'metainfo': {'version': '1.0.9'}},
                {'table': {'family': args[-2], 'name': TABLE}},
            ]}).encode()

        policy = collect_policy(boundary)
        self.assertEqual(policy, {'nftables': [
            {'table': {'family': 'inet', 'name': TABLE}},
            {'table': {'family': 'bridge', 'name': TABLE}},
        ]})
        for response in [b'{"nftables": []}', json.dumps({
            'nftables': [{'table': {'family': 'inet', 'name': TABLE}}],
        }).encode()]:
            def fixed_response(
                arguments: Sequence[str], value: bytes = response,
            ) -> bytes:
                self.assertIn(arguments[-2], ('inet', 'bridge'))
                return value

            with self.subTest(response=response), self.assertRaises(
                ValueError,
            ):
                collect_policy(fixed_response)





class ReviewProbeDiagnosticsTests(unittest.TestCase):
    def run_agent(
        self, requests: list[dict[str, object]], sockets: list[Mock],
    ) -> list[dict[str, object]]:
        module = ast.parse(LINUX_NAMESPACE_HARNESS)
        agent = next(ast.literal_eval(node.value) for node in module.body
                     if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name)
                             and target.id == 'AGENT'
                             for target in node.targets))
        supplied = io.StringIO(''.join(json.dumps(value) + '\n'
                                      for value in requests))
        output = io.StringIO()
        with tempfile.TemporaryDirectory(prefix='sotto-review-probe-') as name:
            script = Path(name) / 'agent.py'
            script.write_text(agent)
            with (patch('sys.stdin', supplied),
                  patch('socket.socket', side_effect=sockets),
                  patch('select.select', return_value=([supplied], [], [])),
                  redirect_stdout(output), self.assertRaises(SystemExit)):
                runpy.run_path(str(script), run_name='__main__')
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_probe_keeps_the_actual_socket_failure_and_success_boundary(
        self,
    ) -> None:
        for phase in ['connect', 'send', 'read', 'complete']:
            with self.subTest(phase=phase):
                connection = Mock()
                connection.getsockname.return_value = (
                    '172.30.99.11', 41001)
                connection.recv.return_value = b'SOTTO_NAMESPACE_OK'
                if phase != 'complete':
                    operation = {'connect': connection.connect,
                                 'send': connection.sendall,
                                 'read': connection.recv}[phase]
                    operation.side_effect = OSError(111, 'fixture refusal')
                result = self.run_agent([{
                    'operation': 'probe', 'address': '172.30.99.3',
                    'port': 5432, 'protocol': 'tcp',
                }], [connection])[-1]
                self.assertEqual(result['phase'], phase)
                self.assertEqual(result['allowed'], phase == 'complete')
                self.assertEqual(result['local'], ['172.30.99.11', 41001])
                self.assertEqual(result['remote'], ['172.30.99.3', 5432])
                self.assertEqual(result['errno'],
                                 None if phase == 'complete' else 111)
                self.assertEqual(result['error'], None if phase == 'complete'
                                 else '[Errno 111] fixture refusal')

    def test_diagnostic_probe_uses_the_announced_exact_socket_tuple(
        self,
    ) -> None:
        route, connection = Mock(), Mock()
        route.getsockname.return_value = ('172.30.99.11', 41000)
        connection.getsockname.return_value = ('172.30.99.11', 41002)
        connection.recv.return_value = b'SOTTO_NAMESPACE_OK'
        target = {'address': '172.30.99.3', 'port': 5432, 'protocol': 'tcp'}
        results = self.run_agent([
            {'operation': 'prepare-probe', **target},
            {'operation': 'probe', 'usePrepared': True, **target},
        ], [route, connection])
        self.assertTrue(results[1]['prepared'])
        self.assertEqual(results[1]['local'], results[2]['local'])
        self.assertEqual(results[1]['remote'], results[2]['remote'])
        self.assertTrue(results[2]['allowed'])

    def test_ndp_stimulus_sends_one_small_datagram_without_a_tcp_probe(
        self,
    ) -> None:
        connection = Mock()
        connection.sendto.return_value = 1
        connection.getsockname.return_value = ('fd00:99::11', 41000, 0, 0)
        results = self.run_agent([{
            'operation': 'ndp-once', 'source': 'fd00:99::11',
            'address': 'fd00:99::1',
        }], [connection])
        self.assertEqual(results[-1], {
            'sent': True, 'local': ['fd00:99::11', 41000, 0, 0],
            'remote': ['fd00:99::1', 9],
        })
        self.assertEqual(connection.sendto.call_args.args,
                         (b'\x00', ('fd00:99::1', 9)))
        connection.recv.assert_not_called()
        connection.connect.assert_not_called()


class ReviewIpv6ReadinessTests(unittest.TestCase):
    def load_helpers(self) -> dict[str, object]:
        module = ast.parse(LINUX_NAMESPACE_HARNESS)
        names = {'ipv6_addresses_ready', 'ipv6_neighbor_ready',
                 'wait_ipv6_path', 'namespace_prefix', 'command', 'receive'}
        functions: list[ast.stmt] = [
            node for node in module.body if isinstance(node, ast.FunctionDef)
            and node.name in names]
        with tempfile.TemporaryDirectory(prefix='sotto-review-ipv6-') as name:
            script = Path(name) / 'helpers.py'
            script.write_text(ast.unparse(ast.Module(
                body=functions, type_ignores=[])))
            return runpy.run_path(str(script), init_globals={
                'json': json, 'time': time, 'select': select, 'os': os,
                'subprocess': subprocess, 'deadline': time.monotonic() + 65,
                'request': {'outerNamespace': 'different-owned-namespace'},
            })

    def test_tentative_or_missing_path_addresses_cannot_start_baseline(
        self,
    ) -> None:
        ready = self.load_helpers()['ipv6_addresses_ready']
        self.assertTrue(callable(ready))
        if not callable(ready):
            self.fail('Missing readiness helper')
        addresses = [
            {'family': 'inet6', 'local': 'fd00:99::11', 'scope': 'global'},
            {'family': 'inet6', 'local': 'fe80::11', 'scope': 'link'},
        ]
        self.assertTrue(ready([{'addr_info': addresses}], 'fd00:99::11'))
        self.assertFalse(ready([], 'fd00:99::11'))
        self.assertFalse(ready([{'addr_info': addresses[:1]}], 'fd00:99::11'))
        tentative_flags: list[dict[str, object]] = [
            {'tentative': True}, {'flags': ['tentative']}]
        for flag in tentative_flags:
            with self.subTest(flag=flag):
                self.assertFalse(ready([{'addr_info': [
                    addresses[0], {**addresses[1], **flag},
                ]}], 'fd00:99::11'))
        failed_flags: list[dict[str, object]] = [
            {'dadfailed': True}, {'flags': ['dadfailed']}]
        for flag in failed_flags:
            with self.subTest(flag=flag), self.assertRaisesRegex(
                AssertionError, 'failed duplicate detection',
            ):
                ready([{'addr_info': [
                    addresses[0], {**addresses[1], **flag},
                ]}], 'fd00:99::11')

    def test_only_usable_actual_peer_mac_finishes_neighbor_readiness(
        self,
    ) -> None:
        ready = self.load_helpers()['ipv6_neighbor_ready']
        self.assertTrue(callable(ready))
        if not callable(ready):
            self.fail('Missing neighbor helper')
        peer = '02:00:00:00:00:11'
        for state in ['REACHABLE', 'STALE', 'DELAY', 'PROBE',
                      'INCOMPLETE', 'FAILED', 'NONE']:
            for actual in [state, [state]]:
                with self.subTest(state=actual):
                    self.assertEqual(ready([{
                        'dst': 'fd00:99::1', 'lladdr': peer, 'state': actual,
                    }], 'fd00:99::1', peer), state in {
                        'REACHABLE', 'STALE', 'DELAY', 'PROBE'})
        for entries in [[], [{'dst': 'fd00:99::1', 'state': ['REACHABLE']}],
                        [{'dst': 'fd00:99::1', 'lladdr': 'wrong',
                          'state': ['REACHABLE']}]]:
            with self.subTest(entries=entries):
                self.assertFalse(ready(entries, 'fd00:99::1', peer))

    def test_readiness_waits_for_actual_dad_and_ndp_before_baseline(
        self,
    ) -> None:
        process = Mock(pid=os.getpid())
        process.stdin = io.StringIO()
        process.stdout = io.StringIO('{"sent": true}\n')
        process.stderr = io.StringIO()
        mac = '02:00:00:00:00:01'
        states = iter(['INCOMPLETE', 'REACHABLE'])
        addresses = iter([True, False])

        def boundary(arguments: list[str], **options: object) -> object:
            self.assertGreater(cast(float, options['timeout']), 0)
            self.assertLessEqual(cast(float, options['timeout']), 3)
            if 'address' in arguments:
                value: object = [{'addr_info': [
                    {'family': 'inet6', 'local': 'fd00:99::11'},
                    {'family': 'inet6', 'local': 'fe80::11', 'scope': 'link',
                     'tentative': next(addresses)},
                ]}]
            elif 'neighbor' in arguments:
                value = [{'dst': 'fd00:99::1', 'lladdr': mac,
                          'state': [next(states)]}]
            else:
                value = [{'address': mac}]
            return subprocess.CompletedProcess(arguments, 0,
                                               json.dumps(value), '')

        wait = self.load_helpers()['wait_ipv6_path']
        if not callable(wait):
            self.fail('Missing path readiness helper')
        with (patch('subprocess.run', side_effect=boundary),
              patch('os.readlink', return_value='owned-fixture-namespace'),
              patch('select.select', side_effect=lambda readers, *args:
                    (readers, [], []))):
            evidence = wait([(
                process, 'pclient', 'fd00:99::11',
                process, 'br-review', 'fd00:99::1',
            )])
        self.assertEqual(json.loads(process.stdin.getvalue()), {
            'operation': 'ndp-once', 'source': 'fd00:99::11',
            'address': 'fd00:99::1',
        })
        key = str(process.pid) + ':fd00:99::1'
        self.assertEqual(evidence['neighbors'][key][0]['state'],
                         ['REACHABLE'])
        self.assertEqual(evidence['stimuli'], [{'sent': True}])

    def test_missing_dad_readiness_fails_inside_three_seconds_without_probe(
        self,
    ) -> None:
        process = Mock(pid=os.getpid(), stdin=io.StringIO())
        wait = self.load_helpers()['wait_ipv6_path']
        if not callable(wait):
            self.fail('Missing path readiness helper')
        output = io.StringIO()
        with (patch('time.monotonic',
                    side_effect=itertools.count(start=0, step=0.2)),
              patch('os.readlink', return_value='owned-fixture-namespace'),
              patch('subprocess.run', return_value=subprocess.CompletedProcess(
                  [], 0, '[]', '')),
              patch('select.select', return_value=([], [], [])),
              redirect_stdout(output), self.assertRaisesRegex(
                  AssertionError, 'apparatus readiness expired')):
            wait([(process, 'pclient', 'fd00:99::11',
                   process, 'br-review', 'fd00:99::1')])
        self.assertEqual(process.stdin.getvalue(), '')
        self.assertIn('ipv6ReadinessFailure', json.loads(output.getvalue()))


@unittest.skipUnless(
    sys.platform == 'linux'
    and os.environ.get('SOTTO_REVIEW_NFT_NAMESPACE_TEST') == '1',
    'Requires explicit isolated Linux nft namespace proof',
)
class ReviewKernelEgressTests(unittest.TestCase):
    def test_generated_policy_filters_actual_namespace_packets(self) -> None:
        if not __debug__:
            self.fail('Optimized Python cannot run the namespace proof')
        if os.geteuid() != 0:
            self.fail('Run the explicitly selected namespace proof as root')
        outer_namespace = os.readlink('/proc/self/ns/net')
        admission = json.dumps({
            'outerNamespace': outer_namespace,
            'rules': render_rules(
                ['br-review', 'br-egress'],
                ['172.30.99.1', '172.30.100.1', '203.0.114.1'],
            ),
        })
        process = subprocess.Popen(
            ['unshare', '--net', '--', sys.executable, '-c',
             LINUX_NAMESPACE_HARNESS],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            try:
                output, errors = process.communicate(admission, timeout=85)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                output, errors = process.communicate(timeout=5)
                self.fail('Namespace proof timed out:\n' + output + errors)
            self.assertEqual(process.returncode, 0, output + errors)
            result = json.loads(output)
            self.assertTrue(result['namespaceOnly'])
            self.assertFalse(result['externalNetworkUsed'])
            self.assertTrue(result['unrelatedRulePreserved'])
            self.assertGreaterEqual(result['cases'], 50)
            self.assertEqual(result['scriptSha256'], hashlib.sha256(
                LINUX_NAMESPACE_HARNESS.encode()).hexdigest())
            self.assertEqual(result['renderSha256'], hashlib.sha256(
                json.loads(admission)['rules'].encode()).hexdigest())
            self.assertTrue(result['kernelVersion'])
            self.assertIn('nftables', result['nftVersion'])
            self.assertEqual(os.readlink('/proc/self/ns/net'), outer_namespace)
            print(json.dumps({'reviewEgressNamespaceProof': result},
                             sort_keys=True))
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            if process.stdin is not None:
                process.stdin.close()
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()


if __name__ == '__main__':
    unittest.main()
