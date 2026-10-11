'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Mixed web/worker revisions must share executable payloads and authority.
const hash = createHash('sha256');
const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const root = fs.openSync('/app', flags);
function add(relative, parent, components) {
  const [name, ...remaining] = components;
  const descriptor = fs.openSync(`/proc/self/fd/${parent}/${name}`, flags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (remaining.length) {
      if (!stat.isDirectory()) throw new Error('Unexpected contract ancestor');
      add(relative, descriptor, remaining);
      return;
    }
    if (stat.isDirectory()) {
      const names = fs.readdirSync(`/proc/self/fd/${descriptor}`).sort();
      if (!names.length) throw new Error('Missing executable contract payload');
      for (const child of names) add(path.posix.join(relative, child), descriptor, [child]);
      return;
    }
    if (!stat.isFile()) throw new Error('Unexpected contract entry');
    const bytes = fs.readFileSync(descriptor);
    hash.update(JSON.stringify([relative, bytes.length]));
    hash.update(bytes);
  } finally {
    fs.closeSync(descriptor);
  }
}
function include(relative) {
  add(relative, root, relative.split('/'));
}
try {
  if (!fs.fstatSync(root).isDirectory()) throw new Error('Unexpected contract root');
  for (const relative of [
    'apps/web/src/lib/sidedoor',
    'apps/web/src/lib/queue.ts',
    'apps/web/src/lib/redis.ts',
    'apps/web/src/workers',
    'node_modules/.package-lock.json',
    'packages/shared/src',
    'packages/learning-model/src',
  ])
    include(relative);
  for (const name of ['thesidedoor', 'thesidedoor-core']) {
    include('node_modules/' + name + '/package.json');
    include('node_modules/' + name + '/dist');
  }
  for (const name of ['package.json', 'index.cjs', 'binding.gyp', 'fs-ext.cc']) {
    include('node_modules/thesidedoor-flock/' + name);
  }
  process.stdout.write(hash.digest('hex') + '\n');
} finally {
  fs.closeSync(root);
}
