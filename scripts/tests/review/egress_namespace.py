"""Privileged packet proof, executed only inside an admitted namespace."""

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
prepared = None
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
            elif operation == 'ndp-once':
                packet = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
                try:
                    packet.settimeout(0.35)
                    packet.bind((request['source'], 0))
                    size = packet.sendto(b'\x00', (request['address'], 9))
                    result = {'sent': size == 1,
                              'local': packet.getsockname(),
                              'remote': [request['address'], 9]}
                finally:
                    packet.close()
                print(json.dumps(result), flush=True)
            elif operation == 'prepare-probe':
                family = (socket.AF_INET6 if ':' in request['address']
                          else socket.AF_INET)
                route = socket.socket(family, socket.SOCK_DGRAM)
                try:
                    route.connect((request['address'], request['port']))
                    source = route.getsockname()[0]
                    kind = (socket.SOCK_DGRAM
                            if request['protocol'] == 'udp'
                            else socket.SOCK_STREAM)
                    prepared = socket.socket(family, kind)
                    prepared.settimeout(0.35)
                    prepared.bind((source, 0))
                    result = {'prepared': True,
                              'local': prepared.getsockname(),
                              'remote': [request['address'], request['port']]}
                except OSError as error:
                    result = {'prepared': False, 'errno': error.errno,
                              'error': str(error)}
                    if prepared is not None:
                        prepared.close()
                        prepared = None
                finally:
                    route.close()
                print(json.dumps(result), flush=True)
            elif operation == 'probe':
                family = (socket.AF_INET6 if ':' in request['address']
                          else socket.AF_INET)
                protocol = request['protocol']
                kind = (socket.SOCK_DGRAM if protocol == 'udp'
                        else socket.SOCK_STREAM)
                if request.get('usePrepared'):
                    assert prepared is not None
                    probe, prepared = prepared, None
                else:
                    probe = socket.socket(family, kind)
                probe.settimeout(0.35)
                port = request['port']
                result = {'phase': 'connect', 'errno': None, 'error': None,
                          'remote': [request['address'], port]}
                query = (b'\x53\x54\x01\x00\x00\x01\x00\x00'
                         b'\x00\x00\x00\x00\x05sotto\x04test'
                         b'\x00\x00\x01\x00\x01')
                try:
                    probe.connect((request['address'], port))
                    result['phase'] = 'send'
                    payload = query if port == 53 else b'probe\n'
                    if port == 53 and protocol == 'tcp':
                        payload = struct.pack('!H', len(payload)) + payload
                    probe.sendall(payload)
                    result['phase'] = 'read'
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
                    result['phase'] = 'complete'
                except (OSError, TimeoutError) as error:
                    allowed = False
                    result.update(errno=error.errno, error=str(error),
                                  errorClass=type(error).__name__)
                finally:
                    result['local'] = probe.getsockname()
                    probe.close()
                print(json.dumps({'allowed': allowed, **result}), flush=True)
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

def receive(process, timeout=4):
    assert time.monotonic() < deadline
    ready, _, _ = select.select([process.stdout], [], [], timeout)
    assert ready, 'Namespace test agent did not settle'
    line = process.stdout.readline()
    assert line, ('Namespace test agent exited', process.stderr.read(65536))
    return json.loads(line)

def command(process, timeout=4, **values):
    process.stdin.write(json.dumps(values) + '\n')
    process.stdin.flush()
    return receive(process, timeout)

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

def ipv6_addresses_ready(entries, expected):
    addresses = [address for interface in entries
                 for address in interface.get('addr_info', [])
                 if address.get('family') == 'inet6']
    for address in addresses:
        flags = address.get('flags', [])
        assert not (address.get('dadfailed') or 'dadfailed' in flags), (
            'IPv6 address failed duplicate detection', address)
    present = any(address.get('local') == expected for address in addresses)
    link_local = any(address.get('scope') == 'link'
                     and address.get('local', '').startswith('fe80:')
                     for address in addresses)
    return present and link_local and not any(
        address.get('tentative') or 'tentative' in address.get('flags', [])
        for address in addresses)

def ipv6_neighbor_ready(entries, expected, mac):
    for entry in entries:
        if entry.get('dst') != expected or entry.get('lladdr') != mac:
            continue
        state = entry.get('state', [])
        states = [state] if isinstance(state, str) else state
        return bool(set(states) & {'REACHABLE', 'STALE', 'DELAY', 'PROBE'})
    return False

def wait_ipv6_path(paths):
    # This is apparatus readiness before any baseline, never a case retry.
    until = min(deadline, time.monotonic() + 3)
    evidence = {'addresses': {}, 'neighbors': {}, 'stimuli': []}

    def remaining():
        value = until - time.monotonic()
        assert value > 0, ('IPv6 apparatus readiness expired', evidence)
        return value

    def inspect(process, *arguments):
        outcome = subprocess.run(
            [*namespace_prefix(process), 'ip', '-j', *arguments],
            check=False, text=True, capture_output=True,
            timeout=remaining())
        assert outcome.returncode == 0, (arguments, outcome.stderr)
        return json.loads(outcome.stdout)

    try:
        while True:
            ready = True
            for process, link, source, _, _, _ in paths:
                key = str(process.pid) + ':' + link
                entries = inspect(process, '-6', 'address', 'show',
                                  'dev', link)
                evidence['addresses'][key] = entries
                ready = ipv6_addresses_ready(entries, source) and ready
            if ready:
                break
            select.select([], [], [], min(0.02, remaining()))
        macs = []
        for process, link, source, peer, peer_link, address in paths:
            links = inspect(peer, 'link', 'show', 'dev', peer_link)
            assert len(links) == 1 and links[0].get('address'), links
            macs.append(links[0]['address'])
            stimulus = command(process, timeout=remaining(),
                               operation='ndp-once', source=source,
                               address=address)
            assert stimulus.get('sent'), stimulus
            evidence['stimuli'].append(stimulus)
        while True:
            ready = True
            for path, mac in zip(paths, macs):
                process, link, _, _, _, address = path
                entries = inspect(process, '-6', 'neighbor', 'show',
                                  'to', address, 'dev', link)
                evidence['neighbors'][str(process.pid) + ':' + address] = (
                    entries)
                ready = ipv6_neighbor_ready(entries, address, mac) and ready
            if ready:
                return evidence
            select.select([], [], [], min(0.02, remaining()))
    except Exception:
        print(json.dumps({'ipv6ReadinessFailure': evidence}), flush=True)
        raise

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
    network_links[process.pid] = peer
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
network_agents = {}
network_links = {}

def diagnostic_command(arguments, until):
    remaining = until - time.monotonic()
    if remaining <= 0:
        return {'error': 'Diagnostic budget exhausted'}
    try:
        result = subprocess.run(arguments, capture_output=True, text=True,
                                timeout=min(1, remaining))
        return {'returncode': result.returncode,
                'stdout': result.stdout[:8192],
                'stderr': result.stderr[:2048]}
    except subprocess.TimeoutExpired:
        return {'error': 'Diagnostic command timed out'}

def namespace_prefix(process):
    identity = os.readlink('/proc/' + str(process.pid) + '/ns/net')
    assert identity != request['outerNamespace']
    return ['nsenter', '--target', str(process.pid), '--net']

def bridge_metadata():
    assert os.readlink('/proc/self/ns/net') == router_namespace
    until = min(deadline, time.monotonic() + 2)
    return {
        'sysctls': diagnostic_command([
            'sysctl', 'net.bridge.bridge-nf-call-iptables',
            'net.bridge.bridge-nf-call-ip6tables',
            'net.bridge.bridge-nf-call-arptables'], until),
        'bridges': diagnostic_command(
            ['ip', '-d', '-j', 'link', 'show', 'type', 'bridge'], until),
    }

def trace_monitor_ready(process, until):
    assert os.readlink('/proc/' + str(process.pid) + '/ns/net') == (
        router_namespace)
    directory = '/proc/' + str(process.pid)
    while process.poll() is None and time.monotonic() < until:
        try:
            sockets = {
                os.readlink(directory + '/fd/' + name)
                for name in os.listdir(directory + '/fd')}
            with open(directory + '/net/netlink') as stream:
                rows = [line.split() for line in stream.readlines()[1:]]
            if any(len(row) >= 10 and row[1] == '12'
                   and int(row[3], 16) != 0
                   and 'socket:[' + row[-1] + ']' in sockets
                   for row in rows):
                return True
        except FileNotFoundError:
            pass
        select.select([], [], [], max(0, min(0.01,
                                            until - time.monotonic())))
    return False

def trace_failed_flow(process, address, port, protocol, until):
    remaining = until - time.monotonic()
    if remaining <= 0:
        return {'error': 'Diagnostic budget exhausted before trace'}
    ready = command(process, timeout=min(1, remaining),
                    operation='prepare-probe', address=address,
                    port=port, protocol=protocol)
    if not ready.get('prepared'):
        return {'preparation': ready}
    source, source_port = ready['local'][:2]
    family = 'ip6' if ':' in address else 'ip'
    directions = [
        (source, address, source_port, port),
        (address, source, port, source_port),
    ]
    expressions = '\n'.join(
        f'{family} saddr {src} {family} daddr {dst} '
        f'{protocol} sport {sport} {protocol} dport {dport} '
        'meta nftrace set 1'
        for src, dst, sport, dport in directions)
    rules = '\n'.join(
        f'table {kind} review_harness_trace {{\n' + '\n'.join(
            f'chain {hook} {{ type filter hook {hook} priority -301; '
            f'policy accept;\n{expressions}\n}}'
            for hook in hooks) + '\n}'
        for kind, hooks in [('inet', ['prerouting', 'output']),
                            ('bridge', ['prerouting'])])
    monitor = subprocess.Popen(['nft', 'monitor', 'trace'],
                               stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE)
    result = {'preparedFlow': ready, 'trace': '', 'traceErrors': ''}
    try:
        result['monitorReady'] = trace_monitor_ready(
            monitor, min(until, time.monotonic() + 0.5))
        if not result['monitorReady']:
            result['error'] = 'Trace subscription was not observed'
            return result
        installed = subprocess.run(['nft', '-f', '-'], input=rules,
                                   text=True, capture_output=True,
                                   timeout=min(1, max(0.01, until
                                                     - time.monotonic())))
        result['installation'] = {
            'returncode': installed.returncode,
            'stderr': installed.stderr[:2048]}
        if installed.returncode != 0:
            return result
        remaining = until - time.monotonic()
        if remaining <= 0:
            result['error'] = 'Diagnostic budget exhausted before probe'
            return result
        result['probe'] = command(
            process, timeout=min(1, remaining),
            operation='probe', address=address,
            port=port, protocol=protocol, usePrepared=True)
        streams = {monitor.stdout: 'trace', monitor.stderr: 'traceErrors'}
        remaining = 32768
        capture_until = min(until, time.monotonic() + 0.5)
        while streams and remaining and time.monotonic() < capture_until:
            readable, _, _ = select.select(
                list(streams), [], [], max(0, capture_until
                                         - time.monotonic()))
            for stream in readable:
                chunk = os.read(stream.fileno(), min(4096, remaining))
                if not chunk:
                    streams.pop(stream)
                    continue
                result[streams[stream]] += chunk.decode(errors='replace')
                remaining -= len(chunk)
        result['truncated'] = remaining == 0
        return result
    finally:
        monitor.terminate()
        try:
            monitor.wait(timeout=1)
        except subprocess.TimeoutExpired:
            monitor.kill()
            monitor.wait(timeout=1)
        monitor.stdout.close()
        monitor.stderr.close()
        result['cleanup'] = {}
        for kind in ['inet', 'bridge']:
            result['cleanup'][kind] = diagnostic_command([
                'nft', 'delete', 'table', kind,
                'review_harness_trace'], until)

def failure_diagnostics(process, receiver, address, port, protocol):
    assert os.readlink('/proc/self/ns/net') == router_namespace
    assert router_namespace != request['outerNamespace']
    until = time.monotonic() + 8
    result = {'bridgeMetadata': bridge_metadata(), 'namespaces': {}}
    for name, item in network_agents.items():
        if item not in (process, receiver, host):
            continue
        prefix = namespace_prefix(item)
        link = network_links.get(item.pid)
        commands = {
            'addresses': ['ip', '-j', 'address'],
            'routes': ['ip', '-j', 'route', 'show', 'table', 'all'],
            'neighbours': ['ip', '-j', 'neigh'],
            'routeToDestination': ['ip', '-j',
                                   '-6' if ':' in address else '-4',
                                   'route', 'get', address],
            'rpFilter': ['sysctl', 'net.ipv4.conf.all.rp_filter',
                         'net.ipv4.conf.default.rp_filter'],
        }
        if link:
            commands['rpFilter'].append(
                'net.ipv4.conf.' + link + '.rp_filter')
        result['namespaces'][name] = {
            key: diagnostic_command([*prefix, *args], until)
            for key, args in commands.items()}
        if item.poll() is not None:
            result['namespaces'][name]['agentStderr'] = (
                item.stderr.read(8192))
    result['bridgePorts'] = diagnostic_command(['bridge', '-j', 'link'],
                                              until)
    result['routerRpFilter'] = diagnostic_command([
        'sysctl', *['net.ipv4.conf.' + name + '.rp_filter' for name in
                    ['all', 'default', 'br-review', 'br-egress',
                     'br-other', 'outside']]], until)
    result['policy'] = diagnostic_command(['nft', '-a', 'list', 'ruleset'],
                                         until)
    try:
        result['exactDiagnosticFlow'] = trace_failed_flow(
            process, address, port, protocol, until)
    except (AssertionError, OSError, subprocess.TimeoutExpired) as error:
        result['traceFailure'] = str(error)[:2048]
    return result

def receiver_counts(process):
    if process.poll() is not None:
        return {'unavailable': 'Receiver exited',
                'returncode': process.returncode}
    try:
        return command(process, operation='counts')
    except (AssertionError, OSError) as error:
        return {'unavailable': str(error)[:2048]}

def probe(process, address, port, protocol, expected, receiver,
          stage='guarded'):
    global cases
    before = receiver_counts(receiver)
    outcome = command(process, operation='probe', address=address,
                      port=port, protocol=protocol)
    after = receiver_counts(receiver)
    if (outcome['allowed'] != expected
            or 'unavailable' in before or 'unavailable' in after
            or (not expected and after != before)):
        try:
            diagnostics = failure_diagnostics(
                process, receiver, address, port, protocol)
        except Exception as error:
            diagnostics = {'collectionError': type(error).__name__,
                           'message': str(error)[:2048]}
        evidence = {'stage': stage, 'address': address, 'port': port,
                    'protocol': protocol, 'expected': expected,
                    'probe': outcome, 'receiverBefore': before,
                    'receiverAfter': after,
                    'diagnostics': diagnostics}
        print(json.dumps({'probeFailure': evidence}), flush=True)
        raise AssertionError((address, port, protocol, outcome))
    if stage == 'guarded':
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
    l2peer = agent()
    l2_link = attach(l2peer, 'br-review', 'l2',
                     '172.30.99.20/24', '172.30.99.1')
    inside(l2peer, 'ip', 'address', 'add', '8.8.4.4/32', 'dev', l2_link)
    inside(internal, 'ip', 'route', 'add', '8.8.4.4/32',
           'dev', internal_link)
    inside(l2peer, 'ip', '-6', 'address', 'add', 'fd00:99::20/64',
           'dev', l2_link, 'nodad')
    network_agents.update(internal=internal, egress=egress,
                          unrelated=unrelated, peers=peers,
                          public=public, host=host, l2peer=l2peer)
    peer_link = attach(peers, 'br-review', 'peers',
                       '172.30.99.2/24', '172.30.99.1')
    for address in ['172.30.99.3', '172.30.99.10']:
        inside(peers, 'ip', 'address', 'add', address + '/32',
               'dev', peer_link)
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
    ipv6_readiness = wait_ipv6_path([
        (internal, internal_link, 'fd00:99::11',
         host, 'br-review', 'fd00:99::1'),
        (host, 'br-review', 'fd00:99::1',
         internal, internal_link, 'fd00:99::11'),
        (host, 'outside', 'fd00:101::1',
         public, 'poutside', 'fd00:101::2'),
        (public, 'poutside', 'fd00:101::2',
         host, 'outside', 'fd00:101::1'),
        (internal, internal_link, 'fd00:99::11',
         l2peer, l2_link, 'fd00:99::20'),
        (l2peer, l2_link, 'fd00:99::20',
         internal, internal_link, 'fd00:99::11'),
    ])
    for server, addresses in [
        (peers, ['172.30.99.2', '172.30.99.3', '172.30.99.10']),
        (public, [*destinations, '2001:4860:4860::8888']),
        (host, ['203.0.114.1', '172.30.99.1']),
        (l2peer, ['172.30.99.20', '8.8.4.4', 'fd00:99::20']),
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
    actual_bridge_metadata = bridge_metadata()
    same_l2_route = json.loads(inside(
        internal, 'ip', '-j', 'route', 'get', '172.30.99.20'))
    assert len(same_l2_route) == 1, same_l2_route
    assert same_l2_route[0]['dev'] == internal_link, same_l2_route
    assert 'gateway' not in same_l2_route[0], same_l2_route
    own_service_routes = {}
    for address in ['172.30.99.2', '172.30.99.3', '172.30.99.10',
                    '8.8.4.4']:
        route = json.loads(inside(internal, 'ip', '-j', 'route',
                                  'get', address))
        assert len(route) == 1 and route[0]['dev'] == internal_link, route
        assert 'gateway' not in route[0], route
        own_service_routes[address] = route
    checks = []
    for client in [internal, egress]:
        for address, port in [('172.30.99.3', 5432),
                              ('172.30.99.2', 6379),
                              ('172.30.99.10', 3000)]:
            checks.append((client, address, port, 'tcp', True, peers))
        for port in [80, 443, 53]:
            checks.append((client, '8.8.8.8', port, 'tcp', True, public))
        checks.append((client, '8.8.8.8', 53, 'udp', True, public))
        for address in ['10.42.0.2', '172.18.0.2',
                        '169.254.169.254', '203.0.113.2']:
            checks.append((client, address, 443, 'tcp', False, public))
        for protocol in ['udp', 'tcp']:
            for address in ['10.42.0.2', '169.254.169.254']:
                checks.append((client, address, 53, protocol, False,
                               public))
        for port in [80, 443, 9090]:
            checks.append((client, '203.0.114.1', port, 'tcp', False,
                           host))
        for protocol in ['udp', 'tcp']:
            checks.append((client, '203.0.114.1', 53, protocol, False,
                           host))
        for address, port, protocol, receiver in [
            ('172.30.99.1', 443, 'tcp', host),
            ('8.8.8.8', 9090, 'tcp', public),
            ('172.30.99.3', 443, 'tcp', peers),
            ('172.30.99.2', 5432, 'tcp', peers),
            ('172.30.99.3', 53, 'udp', peers),
            ('172.30.99.2', 53, 'tcp', peers),
        ]:
            checks.append((client, address, port, protocol, False, receiver))
    checks.extend([
        (internal, '2001:4860:4860::8888', 443, 'tcp', False, public),
        (host, '172.30.99.10', 3000, 'tcp', True, peers),
        (unrelated, '10.42.0.2', 9090, 'tcp', True, public),
        (unrelated, '203.0.114.1', 9090, 'tcp', True, host),
        (internal, '172.30.99.20', 9090, 'tcp', False, l2peer),
        (internal, '172.30.99.20', 5432, 'tcp', False, l2peer),
        (internal, '8.8.4.4', 80, 'tcp', True, l2peer),
        (internal, '8.8.4.4', 443, 'tcp', True, l2peer),
        (internal, '8.8.4.4', 9090, 'tcp', False, l2peer),
        (internal, 'fd00:99::20', 443, 'tcp', False, l2peer),
    ])
    for client, address, port, protocol, _, receiver in checks:
        probe(client, address, port, protocol, True, receiver,
              stage='unguarded')
    outcome = subprocess.run(['nft', '--check', '-f', '-'],
                             input=request['rules'],
                             text=True, capture_output=True, timeout=5)
    assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
    for _ in range(2):
        outcome = subprocess.run(['nft', '-f', '-'], input=request['rules'],
                                 text=True, capture_output=True, timeout=5)
        assert outcome.returncode == 0, (outcome.stdout, outcome.stderr)
        assert stable_unrelated() == unrelated_before
    empty_arp = {}
    for process, link in [(internal, internal_link), (peers, peer_link)]:
        inside(process, 'ip', '-4', 'neighbor', 'flush', 'dev', link)
        neighbors = json.loads(inside(process, 'ip', '-j', '-4',
                                      'neighbor', 'show', 'dev', link))
        assert not neighbors, neighbors
        empty_arp[str(process.pid) + ':' + link] = neighbors
    for check in checks:
        probe(*check)
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
                                 ('public', public), ('host', host),
                                 ('l2peer', l2peer)]},
    }
    assert namespace_ids['host'] == router_namespace
    assert request['outerNamespace'] not in [
        value for key, value in namespace_ids.items() if key != 'caller']
    actual_script = sys.orig_argv[sys.orig_argv.index('-c') + 1]
    print(json.dumps({'namespaceOnly': True, 'cases': cases,
                      'unguardedCases': len(checks),
                      'sameL2Route': same_l2_route,
                      'sameL2OwnServiceRoutes': own_service_routes,
                      'sameL2EmptyArpBeforeGuardedProbes': empty_arp,
                      'ipv6Readiness': ipv6_readiness,
                      'bridgeMetadata': actual_bridge_metadata,
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
