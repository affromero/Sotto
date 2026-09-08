"""Run PostgreSQL backup commands without exposing passwords in process arguments."""

import argparse
import os
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


def connection_input(url):
    if any(character in url for character in ('\n', '\r', '\t', '\x00')):
        raise ValueError('Connection contains unsupported control characters')
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname:
        raise ValueError('Expected a PostgreSQL connection URI')
    passwords = [unquote(parsed.password)] if parsed.password is not None else []
    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == 'password':
            passwords.append(value)
        elif key not in ('schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size'):
            query.append((key, value))
    if len(passwords) > 1:
        raise ValueError('Ambiguous connection password')
    authority = parsed.netloc
    if '@' in authority:
        user, host = authority.rsplit('@', 1)
        authority = user.split(':', 1)[0] + '@' + host
    sanitized = urlunsplit((parsed.scheme, authority, parsed.path, urlencode(query), parsed.fragment))
    password = passwords[0] if passwords else ''
    if any(character in password + sanitized for character in ('\n', '\r', '\x00')):
        raise ValueError('Connection contains unsupported control characters')
    return (password + '\n' + sanitized + '\n').encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('size', 'dump'))
    parser.add_argument('--container', default='sotto-prod-postgres')
    args = parser.parse_args()
    payload = connection_input(sys.stdin.read().rstrip('\n'))
    command = 'psql --no-psqlrc --dbname="$connection" -Atc "SELECT pg_database_size(current_database())"' if args.operation == 'size' else 'pg_dump --dbname="$connection" --format=custom'
    script = 'IFS= read -r PGPASSWORD; export PGPASSWORD; IFS= read -r connection; exec ' + command
    try:
        os.fstat(9)
        lock_fds = (9,)
    except OSError:
        lock_fds = ()
    return subprocess.run(['docker', 'exec', '-i', args.container, 'sh', '-ec', script], input=payload, pass_fds=lock_fds).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError):
        sys.exit('Invalid database connection or unavailable database command')
