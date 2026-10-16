'use strict';

const { createRequire } = require('node:module');
const load = createRequire('/app/apps/web/package.json');
const { ALL_QUEUE_NAMES } = load('/app/apps/web/src/lib/queue.ts');
process.stdout.write(JSON.stringify([...ALL_QUEUE_NAMES].sort()) + '\n');
// Imports construct lazy clients. No queue/database operation is required.
process.exit(0);
