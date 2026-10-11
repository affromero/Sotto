'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Mixed web/worker revisions must share executable payloads and authority.
const hash = createHash('sha256');
function add(relative) {
  const absolute = path.join('/app', relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('Unexpected contract symlink');
  if (stat.isDirectory()) {
    const names = fs.readdirSync(absolute).sort();
    if (!names.length) throw new Error('Missing executable contract payload');
    for (const name of names) add(path.join(relative, name));
    return;
  }
  if (!stat.isFile()) throw new Error('Unexpected contract entry');
  const bytes = fs.readFileSync(absolute);
  hash.update(JSON.stringify([relative, bytes.length]));
  hash.update(bytes);
}
for (const relative of [
  'apps/web/src/lib/sidedoor',
  'apps/web/src/lib/queue.ts',
  'apps/web/src/lib/redis.ts',
  'apps/web/src/workers',
  'node_modules/.package-lock.json',
  'packages/shared/src',
  'packages/learning-model/src',
]) add(relative);
for (const name of ['thesidedoor', 'thesidedoor-core']) {
  add('node_modules/' + name + '/package.json');
  add('node_modules/' + name + '/dist');
}
for (const name of ['package.json', 'index.cjs', 'binding.gyp', 'fs-ext.cc']) {
  add('node_modules/thesidedoor-flock/' + name);
}
process.stdout.write(hash.digest('hex') + '\n');
