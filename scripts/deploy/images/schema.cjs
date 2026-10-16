'use strict';

// Keep the canonical deploy.sh schema and migration hash byte-compatible.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const hash = createHash('sha256');
function openRoot() {
  let descriptor = fs.openSync('/app', flags);
  try {
    for (const name of ['apps', 'web', 'prisma']) {
      if (!fs.fstatSync(descriptor).isDirectory()) throw new Error('Unexpected schema ancestor');
      const child = fs.openSync(`/proc/self/fd/${descriptor}/${name}`, flags);
      fs.closeSync(descriptor);
      descriptor = child;
    }
    if (!fs.fstatSync(descriptor).isDirectory()) throw new Error('Unexpected schema root');
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}
function add(file, parent, name, optional = false) {
  let descriptor;
  try {
    descriptor = fs.openSync(`/proc/self/fd/${parent}/${name}`, flags);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return;
    throw error;
  }
  try {
    const metadata = fs.fstatSync(descriptor);
    if (metadata.isDirectory()) {
      for (const child of fs.readdirSync(`/proc/self/fd/${descriptor}`).sort())
        add(path.posix.join(file, child), descriptor, child);
      return;
    }
    if (!metadata.isFile()) throw new Error('Unexpected schema entry');
    hash.update(file);
    hash.update(fs.readFileSync(descriptor));
  } finally {
    fs.closeSync(descriptor);
  }
}
const root = openRoot();
try {
  add('schema.prisma', root, 'schema.prisma');
  add('migrations', root, 'migrations', true);
  console.log(hash.digest('hex'));
} finally {
  fs.closeSync(root);
}
