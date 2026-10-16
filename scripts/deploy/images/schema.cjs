'use strict';

// Keep the canonical deploy.sh schema and migration hash byte-compatible.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = '/app/apps/web/prisma';
const hash = createHash('sha256');
function add(file) {
  const full = path.join(root, file);
  if (fs.statSync(full).isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) add(path.join(file, name));
  } else {
    hash.update(file);
    hash.update(fs.readFileSync(full));
  }
}
add('schema.prisma');
if (fs.existsSync(path.join(root, 'migrations'))) add('migrations');
console.log(hash.digest('hex'));
