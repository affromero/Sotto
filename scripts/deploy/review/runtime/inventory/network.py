"""Inspect the retained review networks around the predecessor handover."""

from __future__ import annotations

import json
from ipaddress import ip_interface, ip_network
from typing import TYPE_CHECKING, Literal, cast

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime.inventory.predecessor import (
    RetainedPhase,
    inspect_predecessor,
)
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

Endpoints = dict[str, tuple[str, str]]


def verify_retained_network(
    previous: HostOperations, successor: HostOperations,
    *, phase: RetainedPhase = 'FENCED',
) -> None:
    """Check exact service and network identities around stopped writers.

    This observes network membership only. Host, client, provider and queue
    quiescence require separate controls and repeated checks by the caller.
    """
    _verify_network(previous, successor, web='stopped', workers='stopped', phase=phase)


def verify_running_predecessor_network(
    previous: HostOperations, successor: HostOperations,
    *, web_stopped: bool = False,
) -> None:
    """Verify the fenced worker topology, including after a confirmed web stop."""
    _verify_network(
        previous, successor, web='stopped' if web_stopped else 'running',
        workers='running',
    )


def _verify_network(
    previous: HostOperations, successor: HostOperations, *,
    web: Literal['running', 'stopped'],
    workers: Literal['running', 'stopped'],
    phase: RetainedPhase = 'FENCED',
) -> None:
    expected_state = {'web': web, 'workers': workers}
    if inspect_predecessor(previous, successor, phase=phase) != expected_state:
        raise ValueError(f'expected-predecessor-web-{web}-workers-{workers}')
    previous.verify_egress()
    topology = record(previous.manifest['topology'], 'review topology')
    services = record(topology['services'], 'review services')
    review_id = record(topology['network'], 'review network')['id']
    egress_id = private_json(previous.attempt.directory / 'egress.json')['networkId']
    subnet = ip_network(cast(str, record(topology['network'], 'review network')['subnet']))
    expected_endpoints: Endpoints = {}
    for role in ('postgres', 'redis'):
        expected = record(services[role], 'retained review service')
        identity = expected.get('id')
        if not isinstance(identity, str) or identity in expected_endpoints:
            raise ValueError('distinct-retained-services-required')
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
            f"{admitted_network['address']}/{subnet.prefixlen}",
        )

    def running_endpoints() -> tuple[Endpoints, Endpoints]:
        review_members: Endpoints = {}
        egress_members: Endpoints = {}
        for role, state in expected_state.items():
            if state == 'stopped':
                continue
            binding = private_json(previous.attempt.directory
                                   / ('candidate-' + role + '.json'))
            identity = binding.get('id')
            if (not isinstance(identity, str) or identity in expected_endpoints
                    or identity in review_members):
                raise ValueError('distinct-predecessor-writers-required')
            actual = previous.inspect(identity)
            if (len(actual) != 1
                    or not previous.candidate_binding_matches(actual[0], binding)):
                raise ValueError('predecessor-candidate-identity-changed')
            container = actual[0]
            name = cast(str, container['Name']).lstrip('/')
            settings = record(container['NetworkSettings'], 'writer settings')
            networks = record(settings['Networks'], 'writer networks')
            if set(networks) != {NETWORK, PROJECT + '_egress'}:
                raise ValueError('predecessor-network-endpoint-changed')
            for network, expected_id, members in (
                (NETWORK, review_id, review_members),
                (PROJECT + '_egress', egress_id, egress_members),
            ):
                endpoint = record(networks.get(network), 'writer endpoint')
                address = endpoint.get('IPAddress')
                prefix = endpoint.get('IPPrefixLen')
                if (endpoint.get('NetworkID') != expected_id
                        or endpoint.get('GlobalIPv6Address') not in ('', None)
                        or not isinstance(address, str) or not address
                        or type(prefix) is not int or not 0 < prefix <= 32):
                    raise ValueError('predecessor-network-endpoint-changed')
                interface = ip_interface(f'{address}/{prefix}')
                if interface.version != 4 or (network == NETWORK
                                               and interface.network != subnet):
                    raise ValueError('predecessor-network-endpoint-changed')
                members[identity] = (name, str(interface))
        return review_members, egress_members

    writer_endpoints = running_endpoints()

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
        for network, expected in (
            (review, {**expected_endpoints, **writer_endpoints[0]}),
            (egress, writer_endpoints[1]),
        ):
            members = record(network.get('Containers'), 'network members')
            if set(members) != set(expected):
                raise ValueError('unexpected-review-network-member')
            for identity, (name, address) in expected.items():
                endpoint = record(members[identity], 'network endpoint')
                interface = ip_interface(cast(str, endpoint.get('IPv4Address')))
                if (endpoint.get('Name') != name or str(interface) != address
                        or endpoint.get('IPv6Address') not in ('', None)):
                    raise ValueError('review-network-endpoint-changed')

    check_membership()
    if inspect_predecessor(previous, successor, phase=phase) != expected_state:
        raise ValueError('predecessor-writer-state-evidence-changed')
    if running_endpoints() != writer_endpoints:
        raise ValueError('predecessor-network-evidence-changed')
    previous.verify_egress()
    successor.verify_fence()
    check_membership()
    successor.verify_fence()
