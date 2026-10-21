"""Review-only nftables policy, independent of Docker-owned tables."""

from __future__ import annotations

import ipaddress
import json
import re
from collections.abc import Mapping, Sequence

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.state import checksum
from scripts.deploy.review.topology import rows

TABLE = 'sotto_review_guard'
RULES_PATH = '/etc/sotto-review/egress.nft'
UNIT_NAME = 'sotto-review-egress.service'
BLOCKED = (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
    '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15',
    '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
)


def bridge_name(network: Mapping[str, object]) -> str:
    identity = digest(network.get('Id'), 'review bridge network')
    options = record(network.get('Options') or {}, 'bridge options')
    name = options.get('com.docker.network.bridge.name', 'br-' + identity[:12])
    if (not isinstance(name, str)
            or not re.fullmatch(r'[a-zA-Z0-9_-]{1,15}', name)):
        raise ValueError('An exact Linux review bridge name is required')
    return name


def host_addresses(interfaces: object) -> list[str]:
    result: set[str] = set()
    for interface in rows(interfaces, 'host interface'):
        for address in rows(interface.get('addr_info'), 'host address'):
            if address.get('family') == 'inet':
                value = address.get('local')
                if not isinstance(value, str):
                    raise ValueError('Host address is missing')
                parsed = ipaddress.IPv4Address(value)
                if not parsed.is_unspecified:
                    result.add(str(parsed))
    if not result:
        raise ValueError('Actual host address inventory is required')
    return sorted(result)


def render_rules(
    bridges: Sequence[str], addresses: Sequence[str],
) -> str:
    if (
        len(bridges) != 2 or len(set(bridges)) != 2
        or any(not re.fullmatch(r'[a-zA-Z0-9_-]{1,15}', name)
               for name in bridges)
        or not addresses or len(addresses) > 1000
    ):
        raise ValueError('Two review bridges and host addresses required')
    hosts = sorted({str(ipaddress.IPv4Address(value)) for value in addresses})
    blocked = list(ipaddress.collapse_addresses([
        *(ipaddress.IPv4Network(value) for value in BLOCKED),
        *(ipaddress.IPv4Network(value + '/32') for value in hosts),
    ]))
    interface_set = ', '.join(json.dumps(name) for name in sorted(bridges))
    destinations = ', '.join(str(value) for value in blocked)
    apps = '{ 172.30.99.10, 172.30.99.11 }'
    responders = '{ 172.30.99.2, 172.30.99.3, 172.30.99.10, 172.30.99.11 }'
    # add permits an existing table. Delete/recreate is one nft transaction.
    return f'''add table inet {TABLE}
delete table inet {TABLE}
table inet {TABLE} {{
    set bridges {{ type ifname; elements = {{ {interface_set} }}; }}
    set blocked {{
        type ipv4_addr; flags interval;
        elements = {{ {destinations} }};
    }}
    chain review_input {{
        ct direction reply ct state established,related return
        drop
    }}
    chain review_forward {{
        ct state invalid drop
        oifname @bridges ip daddr 172.30.99.3 tcp dport 5432 return
        oifname @bridges ip daddr 172.30.99.2 tcp dport 6379 return
        oifname @bridges ip daddr {apps} tcp dport 3000 return
        oifname @bridges ip saddr {responders} \\
            ct direction reply ct state established,related return
        ip daddr @blocked drop
        meta nfproto ipv6 drop
        udp dport 53 return
        tcp dport {{ 53, 80, 443 }} return
        drop
    }}
    chain input {{
        type filter hook input priority -10; policy accept;
        iifname @bridges jump review_input
    }}
    chain forward {{
        type filter hook forward priority -10; policy accept;
        iifname @bridges jump review_forward
    }}
}}
'''


def guard_unit() -> str:
    """No stop action removes the guard from live-restore containers."""
    return f'''[Unit]
Description=Isolated Sotto review egress policy
After=local-fs.target
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f {RULES_PATH}
ExecReload=/usr/sbin/nft -f {RULES_PATH}

[Install]
RequiredBy=docker.service
'''


def semantic_policy(value: object) -> dict[str, object]:
    envelope = record(value, 'nftables result')
    objects = rows(envelope.get('nftables'), 'nftables object')
    result: list[dict[str, object]] = []
    tables = 0
    for entry in objects:
        if set(entry) == {'metainfo'}:
            continue
        if len(entry) != 1:
            raise ValueError('Unexpected nftables object')
        kind, raw = next(iter(entry.items()))
        details = record(raw, 'nftables details')
        if (
            kind not in {'table', 'chain', 'set', 'rule'}
            or details.get('family') != 'inet'
            or details.get('name' if kind == 'table' else 'table') != TABLE
        ):
            raise ValueError('Unexpected table in review policy result')
        if kind == 'table':
            tables += 1
        result.append({kind: {key: item for key, item in details.items()
                             if key != 'handle'}})
    if tables != 1:
        raise ValueError('Exactly one review guard table is required')
    return {'nftables': result}


def verify_policy(value: object, admitted_hash: str) -> None:
    digest(admitted_hash, 'admitted kernel policy')
    if checksum(semantic_policy(value)) != admitted_hash:
        raise ValueError('Installed review guard differs from admitted policy')
