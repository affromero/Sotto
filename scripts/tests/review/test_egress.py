"""Scope the review guard without changing another Docker firewall table."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import signal
import subprocess
import sys
import unittest
from typing import cast

from scripts.deploy.review.egress import (
    TABLE,
    bridge_name,
    guard_unit,
    host_addresses,
    render_rules,
    semantic_policy,
    verify_policy,
)
from scripts.deploy.review.state import checksum


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
        self.assertEqual(rules.count('delete table'), 1)
        self.assertIn('delete table inet ' + TABLE, rules)
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
        with self.assertRaisesRegex(ValueError, 'Exactly one'):
            semantic_policy({'nftables': []})
        with self.assertRaisesRegex(ValueError, 'Unexpected table'):
            semantic_policy({'nftables': [{'table': {
                'family': 'ip', 'name': 'filter',
            }}]})


LINUX_NAMESPACE_HARNESS = r'''
import hashlib
import json
import os
import platform
import select
import signal
import socket
import struct
import subprocess
import sys
import time

request = json.load(sys.stdin)
if not __debug__:
    raise RuntimeError('Optimized Python cannot run the namespace proof')
router_namespace = os.readlink('/proc/self/ns/net')
if router_namespace == request['outerNamespace']:
    raise RuntimeError('Refusing to change the caller network namespace')
if os.geteuid() != 0:
    raise RuntimeError('Isolated namespace proof requires root')
children = []
deadline = time.monotonic() + 65

def run(*arguments):
    assert time.monotonic() < deadline
    outcome = subprocess.run(arguments, check=False, text=True,
                             capture_output=True, timeout=5)
    assert outcome.returncode == 0, (arguments, outcome.stdout, outcome.stderr)
    return outcome.stdout

AGENT = r"""
import json, select, socket, struct, sys
listeners = []
counts = {}
def read_exact(connection, size):
    result = b''
    while len(result) < size:
        part = connection.recv(size - len(result))
        if not part:
            raise OSError('Incomplete namespace test response')
        result += part
    return result
print(json.dumps({'ready': True}), flush=True)
while True:
    readable, _, _ = select.select([sys.stdin, *listeners], [], [], 5)
    for item in readable:
        if item is sys.stdin:
            line = sys.stdin.readline()
            if not line:
                sys.exit(0)
            request = json.loads(line)
            operation = request['operation']
            if operation == 'serve':
                for protocol, ports in [('tcp', request['tcp']),
                                        ('udp', request['udp'])]:
                    for port in ports:
                        addresses = (request['udpAddresses']
                                     if protocol == 'udp'
                                     else ['0.0.0.0', '::'])
                        for address in addresses:
                            family = (socket.AF_INET6 if ':' in address
                                      else socket.AF_INET)
                            kind = (socket.SOCK_STREAM if protocol == 'tcp'
                                    else socket.SOCK_DGRAM)
                            listener = socket.socket(family, kind)
                            listener.setsockopt(socket.SOL_SOCKET,
                                                socket.SO_REUSEADDR, 1)
                            if family == socket.AF_INET6:
                                listener.setsockopt(socket.IPPROTO_IPV6,
                                                    socket.IPV6_V6ONLY, 1)
                            listener.bind((address, port))
                            if protocol == 'tcp':
                                listener.listen(16)
                            listeners.append(listener)
                print(json.dumps({'serving': True}), flush=True)
            elif operation == 'counts':
                print(json.dumps(counts), flush=True)
            elif operation == 'probe':
                family = (socket.AF_INET6 if ':' in request['address']
                          else socket.AF_INET)
                protocol = request['protocol']
                kind = (socket.SOCK_DGRAM if protocol == 'udp'
                        else socket.SOCK_STREAM)
                probe = socket.socket(family, kind)
                probe.settimeout(0.35)
                port = request['port']
                query = (b'\x53\x54\x01\x00\x00\x01\x00\x00'
                         b'\x00\x00\x00\x00\x05sotto\x04test'
                         b'\x00\x00\x01\x00\x01')
                try:
                    probe.connect((request['address'], port))
                    payload = query if port == 53 else b'probe\n'
                    if port == 53 and protocol == 'tcp':
                        payload = struct.pack('!H', len(payload)) + payload
                    probe.sendall(payload)
                    if port == 53:
                        if protocol == 'tcp':
                            header = read_exact(probe, 2)
                            length = struct.unpack('!H', header)[0]
                            response = read_exact(probe, length)
                        else:
                            response = probe.recv(4096)
                        allowed = (response[:4] == b'\x53\x54\x81\x80'
                                   and response[-4:] == b'\xcb\x00\x72\x2a')
                    else:
                        response = read_exact(
                            probe, len(b'SOTTO_NAMESPACE_OK'))
                        allowed = response == b'SOTTO_NAMESPACE_OK'
                except (OSError, TimeoutError):
                    allowed = False
                finally:
                    probe.close()
                print(json.dumps({'allowed': allowed}), flush=True)
            else:
                raise ValueError('Unknown namespace test operation')
        else:
            protocol = ('tcp' if item.type == socket.SOCK_STREAM else 'udp')
            if protocol == 'tcp':
                connection, _ = item.accept()
                connection.settimeout(0.35)
                local = connection.getsockname()
                try:
                    if local[1] == 53:
                        header = read_exact(connection, 2)
                        length = struct.unpack('!H', header)[0]
                        payload = read_exact(connection, length)
                    else:
                        payload = connection.recv(4096)
                    response = (payload[:2] + b'\x81\x80\x00\x01'
                                b'\x00\x01\x00\x00\x00\x00'
                                + payload[12:] + b'\xc0\x0c\x00\x01'
                                b'\x00\x01\x00\x00\x00\x01'
                                b'\x00\x04\xcb\x00\x72\x2a'
                                if local[1] == 53 else b'SOTTO_NAMESPACE_OK')
                    if local[1] == 53:
                        response = struct.pack('!H', len(response)) + response
                    connection.sendall(response)
                finally:
                    connection.close()
            else:
                payload, sender = item.recvfrom(4096)
                local = item.getsockname()
                response = (payload[:2] + b'\x81\x80\x00\x01'
                            b'\x00\x01\x00\x00\x00\x00'
                            + payload[12:] + b'\xc0\x0c\x00\x01'
                            b'\x00\x01\x00\x00\x00\x01'
                            b'\x00\x04\xcb\x00\x72\x2a')
                item.sendto(response, sender)
            key = protocol + ':' + str(local[1])
            counts[key] = counts.get(key, 0) + 1
"""

def receive(process):
    assert time.monotonic() < deadline
    ready, _, _ = select.select([process.stdout], [], [], 4)
    assert ready, 'Namespace test agent did not settle'
    line = process.stdout.readline()
    assert line, ('Namespace test agent exited', process.stderr.read(65536))
    return json.loads(line)

def command(process, **values):
    process.stdin.write(json.dumps(values) + '\n')
    process.stdin.flush()
    return receive(process)

def agent(isolated=True):
    arguments = ['unshare', '--net'] if isolated else []
    process = subprocess.Popen([*arguments, sys.executable, '-u', '-c', AGENT],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    children.append(process)
    assert receive(process) == {'ready': True}
    return process

def inside(process, *arguments):
    return run('nsenter', '--target', str(process.pid), '--net', *arguments)

def attach(process, bridge, suffix, address, gateway):
    local, peer = 'r' + suffix, 'p' + suffix
    run('ip', 'link', 'add', local, 'type', 'veth', 'peer', 'name', peer)
    run('ip', 'link', 'set', local, 'master', bridge)
    run('ip', 'link', 'set', local, 'up')
    run('ip', 'link', 'set', peer, 'netns', str(process.pid))
    inside(process, 'ip', 'link', 'set', 'lo', 'up')
    inside(process, 'ip', 'link', 'set', peer, 'up')
    inside(process, 'ip', 'address', 'add', address, 'dev', peer)
    inside(process, 'ip', 'route', 'add', 'default', 'via', gateway)
    return peer

def stable_unrelated():
    value = json.loads(run('nft', '-j', 'list', 'table', 'inet',
                          'review_harness_unrelated'))
    for entry in value['nftables']:
        for item in entry.values():
            if isinstance(item, dict):
                item.pop('handle', None)
                for expression in item.get('expr', []):
                    if 'counter' in expression:
                        expression['counter'] = {}
    return value

cases = 0
def probe(process, address, port, protocol, expected, receiver):
    global cases
    before = command(receiver, operation='counts')
    outcome = command(process, operation='probe', address=address,
                      port=port, protocol=protocol)
    assert outcome == {'allowed': expected}, (address, port, protocol, outcome)
    if not expected:
        assert command(receiver, operation='counts') == before, (
            'A blocked packet reached its destination',
            address, port, protocol)
    cases += 1

try:
    run('ip', 'link', 'set', 'lo', 'up')
    run('sysctl', '-q', '-w', 'net.ipv4.ip_forward=1')
    run('sysctl', '-q', '-w', 'net.ipv6.conf.all.forwarding=1')
    for name, address in [('br-review', '172.30.99.1/24'),
                          ('br-egress', '172.30.100.1/24'),
                          ('br-other', '172.31.99.1/24')]:
        run('ip', 'link', 'add', name, 'type', 'bridge')
        run('ip', 'address', 'add', address, 'dev', name)
        run('ip', 'link', 'set', name, 'up')
    run('ip', 'address', 'add', '203.0.114.1/32', 'dev', 'lo')
    run('ip', '-6', 'address', 'add', 'fd00:99::1/64', 'dev',
        'br-review', 'nodad')
    internal, egress, unrelated = agent(), agent(), agent()
    internal_link = attach(internal, 'br-review', 'client',
                           '172.30.99.11/24', '172.30.99.1')
    attach(egress, 'br-egress', 'egress',
           '172.30.100.11/24', '172.30.100.1')
    attach(unrelated, 'br-other', 'other',
           '172.31.99.11/24', '172.31.99.1')
    inside(internal, 'ip', '-6', 'address', 'add', 'fd00:99::11/64',
           'dev', internal_link, 'nodad')
    inside(internal, 'ip', '-6', 'route', 'add', 'default',
           'via', 'fd00:99::1')
    peers, public, host = agent(), agent(), agent(False)
    peer_link = attach(peers, 'br-egress', 'peers',
                       '172.30.100.2/24', '172.30.100.1')
    for address in ['172.30.99.2', '172.30.99.3', '172.30.99.10']:
        inside(peers, 'ip', 'address', 'add', address + '/32',
               'dev', peer_link)
        run('ip', 'route', 'add', address + '/32', 'via',
            '172.30.100.2', 'dev', 'br-egress')
        inside(internal, 'ip', 'route', 'add', address + '/32',
               'via', '172.30.99.1')
    run('ip', 'link', 'add', 'outside', 'type', 'veth', 'peer',
        'name', 'poutside')
    run('ip', 'address', 'add', '172.30.101.1/24', 'dev', 'outside')
    run('ip', 'link', 'set', 'outside', 'up')
    run('ip', 'link', 'set', 'poutside', 'netns', str(public.pid))
    inside(public, 'ip', 'link', 'set', 'lo', 'up')
    inside(public, 'ip', 'link', 'set', 'poutside', 'up')
    inside(public, 'ip', 'address', 'add', '172.30.101.2/24',
           'dev', 'poutside')
    inside(public, 'ip', 'route', 'add', 'default', 'via', '172.30.101.1')
    destinations = ['8.8.8.8', '10.42.0.2', '172.18.0.2',
                    '169.254.169.254', '203.0.113.2']
    for address in destinations:
        inside(public, 'ip', 'address', 'add', address + '/32',
               'dev', 'poutside')
        run('ip', 'route', 'add', address + '/32',
            'via', '172.30.101.2', 'dev', 'outside')
    run('ip', '-6', 'address', 'add', 'fd00:101::1/64',
        'dev', 'outside', 'nodad')
    inside(public, 'ip', '-6', 'address', 'add', 'fd00:101::2/64',
           'dev', 'poutside', 'nodad')
    inside(public, 'ip', '-6', 'address', 'add',
           '2001:4860:4860::8888/128', 'dev', 'poutside', 'nodad')
    inside(public, 'ip', '-6', 'route', 'add', 'default', 'via',
           'fd00:101::1')
    run('ip', '-6', 'route', 'add', '2001:4860:4860::8888/128',
        'via', 'fd00:101::2', 'dev', 'outside')
    for server, addresses in [
        (peers, ['172.30.99.2', '172.30.99.3', '172.30.99.10']),
        (public, [*destinations, '2001:4860:4860::8888']),
        (host, ['203.0.114.1', '172.30.99.1']),
    ]:
        assert command(server, operation='serve',
                       tcp=[53, 80, 443, 3000, 5432, 6379, 9090],
                       udp=[53], udpAddresses=addresses) == {'serving': True}
    unrelated_rules = r"""add table inet review_harness_unrelated
add chain inet review_harness_unrelated observe { \
    type filter hook forward priority -11; policy accept; }
add rule inet review_harness_unrelated observe \
    iifname "br-other" counter comment "preserved-unrelated-rule"
"""
    outcome = subprocess.run(['nft', '-f', '-'], input=unrelated_rules,
                             text=True, capture_output=True, timeout=5)
    assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
    unrelated_before = stable_unrelated()
    outcome = subprocess.run(['nft', '--check', '-f', '-'],
                             input=request['rules'],
                             text=True, capture_output=True, timeout=5)
    assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
    for _ in range(2):
        outcome = subprocess.run(['nft', '-f', '-'], input=request['rules'],
                                 text=True, capture_output=True, timeout=5)
        assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
        assert stable_unrelated() == unrelated_before
    for client in [internal, egress]:
        for address, port in [('172.30.99.3', 5432),
                              ('172.30.99.2', 6379),
                              ('172.30.99.10', 3000)]:
            probe(client, address, port, 'tcp', True, peers)
        for port in [80, 443, 53]:
            probe(client, '8.8.8.8', port, 'tcp', True, public)
        probe(client, '8.8.8.8', 53, 'udp', True, public)
        for address in ['10.42.0.2', '172.18.0.2',
                        '169.254.169.254', '203.0.113.2']:
            probe(client, address, 443, 'tcp', False, public)
        for protocol in ['udp', 'tcp']:
            probe(client, '10.42.0.2', 53, protocol, False, public)
            probe(client, '169.254.169.254', 53, protocol, False, public)
        for port in [80, 443, 9090]:
            probe(client, '203.0.114.1', port, 'tcp', False, host)
        for protocol in ['udp', 'tcp']:
            probe(client, '203.0.114.1', 53, protocol, False, host)
        probe(client, '172.30.99.1', 443, 'tcp', False, host)
        probe(client, '8.8.8.8', 9090, 'tcp', False, public)
        probe(client, '172.30.99.3', 443, 'tcp', False, peers)
        probe(client, '172.30.99.2', 5432, 'tcp', False, peers)
        probe(client, '172.30.99.3', 53, 'udp', False, peers)
        probe(client, '172.30.99.2', 53, 'tcp', False, peers)
    probe(internal, '2001:4860:4860::8888', 443, 'tcp', False, public)
    probe(host, '172.30.99.10', 3000, 'tcp', True, peers)
    probe(unrelated, '10.42.0.2', 9090, 'tcp', True, public)
    probe(unrelated, '203.0.114.1', 9090, 'tcp', True, host)
    assert stable_unrelated() == unrelated_before
    counters = json.loads(run('nft', '-j', 'list', 'table', 'inet',
                              'review_harness_unrelated'))
    assert any(expression.get('counter', {}).get('packets', 0) > 0
               for entry in counters['nftables']
               for expression in entry.get('rule', {}).get('expr', []))
    namespace_ids = {
        'caller': request['outerNamespace'], 'router': router_namespace,
        **{name: os.readlink('/proc/' + str(process.pid) + '/ns/net')
           for name, process in [('internal', internal), ('egress', egress),
                                 ('unrelated', unrelated), ('peers', peers),
                                 ('public', public), ('host', host)]},
    }
    assert namespace_ids['host'] == router_namespace
    assert request['outerNamespace'] not in [
        value for key, value in namespace_ids.items() if key != 'caller']
    actual_script = sys.orig_argv[sys.orig_argv.index('-c') + 1]
    print(json.dumps({'namespaceOnly': True, 'cases': cases,
                      'unrelatedRulePreserved': True,
                      'externalNetworkUsed': False,
                      'namespaceIds': namespace_ids,
                      'kernelVersion': platform.release(),
                      'nftVersion': run('nft', '--version').strip(),
                      'scriptSha256': hashlib.sha256(
                          actual_script.encode()).hexdigest(),
                      'renderSha256': hashlib.sha256(
                          request['rules'].encode()).hexdigest()}))
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)
        failures = child.stderr.read(65536)
        if failures:
            print(failures, file=sys.stderr)
        child.stdin.close()
        child.stdout.close()
        child.stderr.close()
'''


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
