import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/access.ts'],
  outfile: 'dist/access.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['thesidedoor-flock', 'pg-native'],
  logLevel: 'info',
});
