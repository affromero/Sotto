#!/usr/bin/env node
// Populate packages/maps with a no-op stub when the private maps submodule is
// not initialized (the open-source build / public CI image). Idempotent: if the
// real package is already present, it does nothing and leaves it untouched.
//
// The real @sotto/maps powers historical place resolution + map visuals in the
// video pipeline and lives in a private submodule. The OSS build replaces it
// with a stub so the workspace installs and the app builds without private code;
// the video map-visual feature is simply inactive.
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'maps');
const stub = join(root, 'scripts', 'oss-maps-stub');

if (existsSync(join(target, 'package.json'))) {
  console.log('[oss-maps-stub] @sotto/maps is present — keeping the real package.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
cpSync(stub, target, { recursive: true });
console.log('[oss-maps-stub] wrote the @sotto/maps OSS stub (video map visuals disabled).');
