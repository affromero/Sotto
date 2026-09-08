"""Record current, rollback and failed-attempt images under the deployment lock."""

import json
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time


def atomic_json(target, value):
    descriptor, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def docker(*arguments):
    return subprocess.check_output(["docker", *arguments], text=True).strip()


def update_record(phase, environment):
    stack = environment["SOTTO_STACK"]
    attempt_key = environment["RETENTION_ATTEMPT_KEY"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", stack) or not re.fullmatch(r"[a-zA-Z0-9_-]+", attempt_key):
        raise ValueError("Invalid retention record identity")
    if phase == "backups-success":
        retain_backups(environment)
        return
    root = pathlib.Path(environment["PRODUCTION_IMAGE_RETENTION_DIR"])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    stable = root / (stack + ".json")
    attempt = root / (stack + "-attempt-" + attempt_key + ".json")
    if phase == "success":
        successful = json.loads(attempt.read_text())["successful_images"]
        validate_images(successful)
        atomic_json(stable, {"protected_images": sorted(set(successful))})
        attempt.unlink()
        return
    if phase != "begin":
        raise ValueError("Expected begin or success")
    protected = set(json.loads(stable.read_text())["protected_images"]) if stable.exists() else set()
    successful = set()
    for key in ("SOTTO_WEB_IMAGE_REF", "SOTTO_WORKERS_IMAGE_REF"):
        successful.add(docker("image", "inspect", "--format", "{{.Id}}", environment[key]))
    for project in (stack, stack + "-blue", stack + "-green"):
        containers = docker("ps", "-aq", "--filter", "label=com.docker.compose.project=" + project).split()
        for container in containers:
            successful.add(docker("inspect", "--format", "{{.Image}}", container))
    protected.update(successful)
    validate_images(protected)
    if attempt.exists():
        raise ValueError("Deployment attempt record already exists")
    atomic_json(attempt, {"protected_images": sorted(protected), "successful_images": sorted(successful)})


def validate_images(images):
    if not images or any(not isinstance(image, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image) for image in images):
        raise ValueError("Invalid image identity in rollback protection record")


def retain_backups(environment, now=None):
    """Only completed deployments qualify; failed and unknown backups remain."""
    now = time.time() if now is None else now
    root = pathlib.Path(environment["SOTTO_BACKUP_DIR"])
    sha = environment["SOTTO_RELEASE_SHA"]
    key = environment["RETENTION_ATTEMPT_KEY"]
    if not re.fullmatch(r"[a-f0-9]{40}", sha) or not re.fullmatch(r"[a-zA-Z0-9_-]+", key):
        raise ValueError("Invalid backup identity")
    current = root / (sha + "-" + key + ".dump")
    checksum = pathlib.Path(str(current) + ".sha256")
    if current.is_symlink() or checksum.is_symlink() or not current.is_file() or not checksum.is_file() or current.stat().st_size == 0:
        raise ValueError("Verified backup files are unavailable")
    digest = checksum.read_text().split()[0]
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Backup checksum is invalid")
    atomic_json(pathlib.Path(str(current) + ".success.json"),
                {"status": "success", "completed_at": now, "backup": current.name, "sha256": digest})
    completed = []
    for marker in root.glob("*.dump.success.json"):
        if marker.is_symlink() or not marker.is_file():
            continue
        try:
            metadata = json.loads(marker.read_text())
            if not isinstance(metadata, dict):
                continue
            name = metadata["backup"]
            timestamp = metadata["completed_at"]
            if metadata.get("status") != "success" or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
                continue
            if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{40}-[a-zA-Z0-9_-]+\.dump", name) or marker.name != name + ".success.json":
                continue
            backup = root / name
            checksum = pathlib.Path(str(backup) + ".sha256")
            if backup.is_symlink() or checksum.is_symlink() or not backup.is_file() or not checksum.is_file():
                continue
            digest = metadata["sha256"]
            if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or checksum.read_text().split()[0] != digest:
                continue
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            continue
        completed.append((timestamp, backup, checksum, marker))
    completed.sort(key=lambda item: item[0], reverse=True)
    for timestamp, backup, checksum, marker in completed[10:]:
        if backup == current or now - timestamp < 30 * 86400:
            continue
        backup.unlink()
        checksum.unlink()
        marker.unlink()


if __name__ == "__main__":
    update_record(sys.argv[1], os.environ)
