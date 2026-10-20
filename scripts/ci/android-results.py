"""Reject failed or empty Android connected-test runs."""

from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def executed_cases(directory: Path) -> int:
    reports = sorted(directory.rglob('*.xml'))
    if not reports:
        raise ValueError(f'No Android test reports found in {directory}')
    executed = 0
    for report in reports:
        root = ET.parse(report).getroot()
        for element in root.iter():
            tag = element.tag.rsplit('}', 1)[-1]
            if tag in ('failure', 'error'):
                detail = ''.join(element.itertext()).strip()
                raise ValueError(f'{report}: {tag}: {detail}')
            if tag in ('testsuite', 'testsuites'):
                for attribute in ('failures', 'errors'):
                    count = int(element.get(attribute, '0'))
                    if count != 0:
                        raise ValueError(
                            f'{report}: {attribute}={count}'
                        )
            if tag == 'testcase':
                skipped = any(
                    child.tag.rsplit('}', 1)[-1] == 'skipped'
                    for child in element
                )
                if not skipped:
                    executed += 1
    if executed == 0:
        raise ValueError('Android reports contain no executed test cases')
    return executed


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: android-results.py CONNECTED_RESULTS', file=sys.stderr)
        return 2
    try:
        count = executed_cases(Path(sys.argv[1]))
    except (OSError, ValueError, ET.ParseError) as error:
        print(f'Android test verification failed: {error}', file=sys.stderr)
        return 1
    print(f'Android test verification passed: {count} executed cases')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
