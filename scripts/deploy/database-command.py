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
    parser.add_argument('operation', choices=('size', 'dump', 'empty'))
    parser.add_argument('--container', default='sotto-prod-postgres')
    args = parser.parse_args()
    payload = connection_input(sys.stdin.read().rstrip('\n'))
    if args.operation == 'size':
        command = 'psql --no-psqlrc --dbname="$connection" -Atc "SELECT pg_database_size(current_database())"'
    elif args.operation == 'empty':
        command = '''psql --no-psqlrc --dbname="$connection" -v ON_ERROR_STOP=1 -Atc "SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f')) + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_catalog.pg_namespace n WHERE left(n.nspname,3) <> 'pg_' AND n.nspname NOT IN ('information_schema','public')) + (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql')"'''
    else:
        command = 'pg_dump --dbname="$connection" --format=custom'
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
