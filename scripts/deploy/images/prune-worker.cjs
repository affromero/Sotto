'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceMap = /\.(?:[cm]?js|css|d\.ts)\.map$/;
const foreignPackages = [
  /^@img\/sharp-(?:libvips-)?linuxmusl-[a-z0-9]+$/,
  /^@napi-rs\/canvas-linux-[a-z0-9]+-musl$/,
  /^@shiftlabs\/markit-linux-[a-z0-9]+-musl$/,
];

function unusedPackage(directory) {
  const parent = path.dirname(directory);
  const name = path.basename(directory);
  if (path.basename(parent) === 'node_modules') return name === 'next';
  if (path.basename(path.dirname(parent)) !== 'node_modules') return false;
  const scoped = `${path.basename(parent)}/${name}`;
  return /^@next\/swc-/.test(scoped) || foreignPackages.some((pattern) => pattern.test(scoped));
}

function pruneWorker(root) {
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (unusedPackage(target)) fs.rmSync(target, { recursive: true });
        else visit(target);
      } else if (entry.isFile() && sourceMap.test(entry.name)) fs.unlinkSync(target);
    }
  }
  for (const relative of ['node_modules', 'apps/web/node_modules']) {
    const directory = path.join(root, relative);
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Expected a real dependency directory');
    visit(directory);
  }
}

module.exports = { pruneWorker };

if (require.main === module) {
  if (process.platform !== 'linux' || !process.report.getReport().header.glibcVersionRuntime)
    throw new Error('Worker dependency cleanup requires the Debian glibc runtime');
  pruneWorker(process.cwd());
}
