"""Inspect the retained review network after both writers stop."""

from __future__ import annotations

import json
from ipaddress import ip_interface, ip_network
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime.inventory.predecessor import inspect_predecessor
from scripts.deploy.review.state import checksum, private_json
from scripts.deploy.review.topology import (
    NETWORK,
    PROJECT,
    environment,
    exact_mounts,
    rows,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def verify_retained_network(
    previous: HostOperations, successor: HostOperations,
) -> None:
    """Check exact service and network identities around stopped writers.

    This observes network membership only. Host, client, provider and queue
    quiescence require separate controls and repeated checks by the caller.
    """
    stopped = {'web': 'stopped', 'workers': 'stopped'}
    if inspect_predecessor(previous, successor) != stopped:
        raise ValueError('both-predecessor-writers-must-be-stopped')
    previous.verify_egress()
    topology = record(previous.manifest['topology'], 'review topology')
    services = record(topology['services'], 'review services')
    review_id = record(topology['network'], 'review network')['id']
    egress_id = private_json(previous.attempt.directory / 'egress.json')['networkId']
    subnet = ip_network(cast(str, record(topology['network'], 'review network')['subnet']))
    expected_ids: set[str] = set()
    expected_endpoints: dict[str, tuple[str, str]] = {}
    for role in ('postgres', 'redis'):
        expected = record(services[role], 'retained review service')
        identity = expected.get('id')
        if not isinstance(identity, str) or identity in expected_ids:
            raise ValueError('distinct-retained-services-required')
        expected_ids.add(identity)
        actual = previous.inspect(identity)
        if len(actual) != 1:
            raise ValueError('unique-retained-service-required')
        container = actual[0]
        state = record(container.get('State'), 'service state')
        health = state.get('Health')
        host = record(container.get('HostConfig'), 'service host')
        settings = record(container.get('NetworkSettings'), 'service network')
        attachments = record(settings.get('Networks'), 'service attachments')
        endpoint = record(attachments.get(NETWORK), 'review endpoint')
        admitted_network = record(expected.get('network'), 'admitted endpoint')
        ports = record(settings.get('Ports'), 'service ports')
        config = record(container.get('Config'), 'service configuration')
        if (container.get('Id') != identity
                or container.get('Image') != expected.get('imageId')
                or container.get('Name') != expected.get('name')
                or config.get('User') != expected.get('user')
                or checksum(environment(container)) != expected.get('environmentHash')
                or exact_mounts(role, container.get('Mounts')) != expected.get('mounts')
                or host.get('RestartPolicy') != expected.get('restartPolicy')
                or host.get('Memory') != expected.get('memory')
                or host.get('LogConfig') != expected.get('logging')
                or state.get('Status') != 'running'
                or state.get('Running') is not True
                or state.get('Paused') is not False
                or state.get('Restarting') is not False
                or state.get('OOMKilled') is not False
                or state.get('Dead') is not False
                or state.get('Error') != ''
                or (health is not None
                    and record(health, 'health').get('Status') != 'healthy')
                or set(attachments) != {NETWORK}
                or endpoint.get('NetworkID') != review_id
                or endpoint.get('IPAddress') != admitted_network.get('address')
                or endpoint.get('GlobalIPv6Address') not in ('', None)
                or admitted_network.get('id') != review_id
                or any(value not in (None, []) for value in ports.values())):
            raise ValueError('retained-review-service-changed')
        expected_endpoints[identity] = (
            cast(str, expected['name']).lstrip('/'),
            cast(str, admitted_network['address']),
        )

    def check_membership() -> None:
        networks = rows(json.loads(previous.docker(
            'network', 'inspect', cast(str, review_id), cast(str, egress_id),
        )), 'review networks')
        by_id = {network.get('Id'): network for network in networks}
        if len(networks) != 2 or set(by_id) != {review_id, egress_id}:
            raise ValueError('review-network-identities-changed')
        review = record(by_id[review_id], 'review network')
        egress = record(by_id[egress_id], 'egress network')
        if review.get('Name') != NETWORK or egress.get('Name') != PROJECT + '_egress':
            raise ValueError('review-network-names-changed')
        members = record(review.get('Containers'), 'review members')
        if (set(members) != expected_ids
                or record(egress.get('Containers'), 'egress members')):
            raise ValueError('unexpected-review-network-member')
        for identity, (name, address) in expected_endpoints.items():
            endpoint = record(members[identity], 'network endpoint')
            interface = ip_interface(cast(str, endpoint.get('IPv4Address')))
            if (endpoint.get('Name') != name
                    or str(interface.ip) != address or interface.network != subnet
                    or endpoint.get('IPv6Address') not in ('', None)):
                raise ValueError('review-network-endpoint-changed')

    check_membership()
    if inspect_predecessor(previous, successor) != stopped:
        raise ValueError('predecessor-stop-evidence-changed')
    previous.verify_egress()
    successor.verify_fence()
    check_membership()
    successor.verify_fence()
