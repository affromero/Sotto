'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const hash = createHash('sha256');
const files = {};
const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const rootPath = '/app';
const root = fs.openSync(rootPath, flags);

function hasDirectory(relative) {
  let descriptor = root;
  try {
    for (const name of relative.split('/')) {
      const child = fs.openSync(`/proc/self/fd/${descriptor}/${name}`, flags);
      if (descriptor !== root) fs.closeSync(descriptor);
      descriptor = child;
      if (!fs.fstatSync(descriptor).isDirectory()) throw new Error('Malformed package ancestor');
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally {
    if (descriptor !== root) fs.closeSync(descriptor);
  }
}

function packageDirectory(name, from) {
  const load = createRequire(path.join(rootPath, from, 'probe.cjs'));
  for (const directory of load.resolve.paths(name)) {
    const absolute = path.join(directory, name);
    if (!absolute.startsWith(rootPath + path.sep)) continue;
    const relative = path.relative(rootPath, absolute);
    if (hasDirectory(relative)) return relative;
  }
  throw new Error(`Missing executable package: ${name}`);
}

function add(relative, parent, components) {
  const [name, ...remaining] = components;
  const descriptor = fs.openSync(`/proc/self/fd/${parent}/${name}`, flags);
  try {
    const metadata = fs.fstatSync(descriptor);
    if (remaining.length) {
      if (!metadata.isDirectory()) throw new Error('Unexpected contract ancestor');
      add(relative, descriptor, remaining);
      return;
    }
    if (metadata.isDirectory()) {
      const names = fs.readdirSync(`/proc/self/fd/${descriptor}`).sort();
      if (!names.length) throw new Error('Missing executable contract payload');
      for (const child of names) add(path.posix.join(relative, child), descriptor, [child]);
      return;
    }
    if (!metadata.isFile()) throw new Error('Unexpected contract entry');
    const bytes = fs.readFileSync(descriptor);
    if (Object.hasOwn(files, relative)) throw new Error('Duplicate runtime asset');
    files[relative] = createHash('sha256').update(bytes).digest('hex');
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
    'apps/web/src/lib/providers',
    'apps/web/prisma',
    'apps/web/src/lib/sidedoor',
    'apps/web/src/lib/queue.ts',
    'apps/web/src/lib/redis.ts',
    'apps/web/src/workers',
    'node_modules/.package-lock.json',
    'packages/shared/src',
    'packages/learning-model/src',
  ])
    include(relative);
  if (hasDirectory('apps/web/src/lib/providers/documents'))
    include('apps/web/scripts/pdf-render');
  if (hasDirectory('apps/web/src/lib/play')) include('apps/web/src/lib/play');
  const core = packageDirectory('thesidedoor-core', 'apps/web');
  for (const directory of [packageDirectory('thesidedoor', 'apps/web'), core]) {
    include(directory + '/package.json');
    include(directory + '/dist');
  }
  const flock = packageDirectory('thesidedoor-flock', core + '/dist/storage');
  for (const name of ['package.json', 'index.cjs', 'binding.gyp', 'fs-ext.cc']) {
    include(flock + '/' + name);
  }
  process.stdout.write(JSON.stringify({ protectedHash: hash.digest('hex'), files }) + '\n');
} finally {
  fs.closeSync(root);
}
