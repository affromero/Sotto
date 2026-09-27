import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/access.ts'],
  outfile: 'dist/access.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['thesidedoor-flock', 'pg-native', 'readline/promises'],
  logLevel: 'info',
});
