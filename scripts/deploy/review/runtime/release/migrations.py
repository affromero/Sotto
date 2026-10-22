"""Recognize progress through the exact admitted migration stages."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import pairwise
from pathlib import PurePosixPath

from scripts.deploy.images.metadata import digest, record


def migration_inventory(stage: Mapping[str, object]) -> dict[str, str]:
    result: dict[str, str] = {}
    for path, value in record(stage['migrations'], 'stage SQL').items():
        if not path.endswith('/migration.sql'):
            continue
        name = PurePosixPath(path).parent.name
        if name in result:
            raise ValueError('duplicate-admitted-migration-name')
        result[name] = digest(value, 'stage SQL')
    return result


def stage_progress(
    applied: Mapping[str, str], previous: Mapping[str, str],
    candidate: Mapping[str, str],
) -> bool:
    """Preserve old SQL and order only this transition's new migrations."""
    if not previous.items() <= applied.items() <= candidate.items():
        return False
    additions = sorted(candidate.keys() - previous.keys())
    actual = sorted(applied.keys() - previous.keys())
    return actual == additions[:len(applied) - len(previous)]


def later_stage_progress(
    applied: Mapping[str, str], completed: Mapping[str, str],
    inventories: Sequence[Mapping[str, str]],
) -> bool:
    """Recognize a completed stage or progress in a consecutive later pair."""
    if not completed.items() <= applied.items():
        return False
    for index, inventory in enumerate(inventories):
        if inventory == completed:
            return applied == completed or any(
                stage_progress(applied, previous, candidate)
                for previous, candidate in pairwise(inventories[index:])
            )
    return False
