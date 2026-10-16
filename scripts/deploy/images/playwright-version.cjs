'use strict';

const lock = require('../../../package-lock.json');
const version = lock.packages?.['node_modules/playwright']?.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('The lockfile must contain an exact Playwright version');
}
process.stdout.write(version + '\n');
