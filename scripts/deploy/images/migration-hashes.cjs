const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const relative = 'apps/web/prisma/migrations';
const root = path.join('/app', relative);
const entries = fs.readdirSync(root, { withFileTypes: true });
assert(entries.length > 1 && entries.length <= 129, 'Bounded Prisma migration inventory required');
const inventory = {};
let bytes = 0;
for (const entry of entries) {
  if (entry.name === 'migration_lock.toml' && entry.isFile()) continue;
  assert(entry.isDirectory() && /^[A-Za-z0-9_]+$/.test(entry.name), 'Invalid migration directory');
  const sql = path.join(root, entry.name, 'migration.sql');
  const metadata = fs.lstatSync(sql);
  assert(metadata.isFile() && metadata.size > 0, 'Regular migration SQL required');
  bytes += metadata.size;
  assert(bytes <= 16 * 1024 * 1024, 'Prisma migration inventory exceeds bound');
  inventory[`${relative}/${entry.name}/migration.sql`] = crypto
    .createHash('sha256')
    .update(fs.readFileSync(sql))
    .digest('hex');
}
process.stdout.write(JSON.stringify(inventory) + '\n');
