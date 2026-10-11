"""Retire a captured idle worker without imposing a forced-kill deadline."""

import argparse
import json
import os
import re
import subprocess
import sys
import time


def require_idle_processes(output):
    rows = [line.split(None, 2) for line in output.splitlines()[1:] if line.strip()]
    if not rows or any(len(row) != 3 for row in rows):
        raise ValueError('Worker process ownership is unknown')
    mains = [row for row in rows if re.fullmatch(
        r'node --max-old-space-size=[0-9]+ --import tsx src/workers/index\.ts', row[2])]
    if len(mains) != 1:
        raise ValueError('Worker main process identity is unknown')
    main_pid = mains[0][0]
    for pid, parent, command in rows:
        if pid == main_pid:
            continue
        if parent != main_pid or not re.fullmatch(
            r'/app/node_modules/@esbuild/linux-(?:x64|arm64)/bin/esbuild --service=[0-9.]+ --ping', command):
            raise ValueError('Worker still owns a provider or an unrecognized child process')


def stop_container(container, docker, *, worker):
    if not re.fullmatch(r'[a-f0-9]{64}', container):
        raise ValueError('Expected an immutable captured container ID')
    before = json.loads(docker('inspect', container))[0]
    if before['Id'] != container:
        raise ValueError('Captured container identity changed')
    if not before['State']['Running'] or before['State']['OOMKilled']:
        raise ValueError('Captured worker is not running normally')
    if worker:
        require_idle_processes(docker('top', container, '-eo', 'pid,ppid,args'))
    # An interrupted client never authorizes another stop or a forced kill.
    # Keep the shared lock inherited if the supervising shell is interrupted.
    try:
        os.fstat(9)
        lock_fds = (9,)
    except OSError:
        lock_fds = ()
    result = subprocess.run(['docker', 'stop', '--time', '-1', container], check=False,
                            pass_fds=lock_fds)
    while True:
        try:
            current = json.loads(docker('inspect', container))[0]
            if current['Id'] != container:
                raise ValueError('Captured container identity changed')
            if not current['State']['Running']:
                expected_exits = (0,) if worker else (0, 143)
                if current['State']['OOMKilled'] or current['State']['ExitCode'] not in expected_exits:
                    raise ValueError('Worker exit did not prove graceful settlement')
                return
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            pass
        if result.returncode == 0:
            raise ValueError('Worker stop reported success while the captured process still runs')
        print('Worker stop outcome unresolved. Retaining deployment lock and observing the same ID.', flush=True)
        time.sleep(5)


def stop_worker(container, docker):
    stop_container(container, docker, worker=True)


def require_overlap_memory(meminfo, candidate_bytes):
    values = {}
    for line in meminfo.splitlines():
        fields = line.split()
        if fields[0] in ('MemAvailable:', 'MemTotal:'):
            if len(fields) != 3 or fields[2] != 'kB':
                raise ValueError('Unknown memory accounting')
            values[fields[0]] = int(fields[1]) * 1024
    if set(values) != {'MemAvailable:', 'MemTotal:'} or candidate_bytes <= 0:
        raise ValueError('Missing overlap memory accounting')
    reserve = min(values['MemTotal:'] // 10, 512 * 1024 * 1024)
    if values['MemAvailable:'] < candidate_bytes + reserve:
        raise ValueError('Insufficient RAM to overlap web slots; current web remains serving')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['stop', 'stop-web', 'overlap'])
    parser.add_argument('value')
    args = parser.parse_args()
    if args.operation == 'overlap':
        require_overlap_memory(sys.stdin.read(), int(args.value))
    else:
        stop_container(args.value,
                       lambda *arguments: subprocess.check_output(['docker', *arguments], text=True),
                       worker=args.operation == 'stop')
