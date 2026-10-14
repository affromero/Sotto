import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    all: { type: 'boolean', default: false },
    base: { type: 'string', default: '' },
    head: { type: 'string', default: 'HEAD' },
    event: { type: 'string', default: 'push' },
  },
});

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

try {
  let desktop = false;
  let ios = false;
  if (values.all || !values.base || /^0+$/.test(values.base)) {
    desktop = true;
    ios = true;
  } else {
    const base =
      values.event === 'pull_request'
        ? git('merge-base', values.base, values.head).trim()
        : values.base;
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, values.head, '--')
      .split('\0')
      .filter(Boolean);
    for (const path of paths) {
      if (
        path === '.github/workflows/release-surfaces-ci.yml' ||
        path === 'scripts/ci/native-scope.mjs'
      ) {
        desktop = true;
        ios = true;
      }
      desktop ||=
        path.startsWith('apps/desktop/') ||
        path === '.github/workflows/desktop-release.yml' ||
        path === 'scripts/ci/test-desktop-appimage.sh' ||
        path === 'apps/web/public/brand/sotto-mark.svg';
      ios ||= path.startsWith('apps/ios/');
    }
  }
  console.log(`desktop=${desktop}\nios=${ios}`);
} catch (error) {
  console.error(`Native change selection failed: ${error.message}`);
  process.exitCode = 1;
}
