import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup/index.ts'],
    globals: true,
    css: true,
    pool: (process.env.VITEST_POOL as 'threads' | 'forks' | undefined) || 'threads',
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      '**/.next/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub optional dependencies that may not be installed
      'openai': path.resolve(__dirname, './tests/setup/openai-stub.ts'),
    },
  },
});
