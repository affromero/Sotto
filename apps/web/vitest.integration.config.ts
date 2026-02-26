import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest config for integration tests.
 * - Uses 'node' environment (no jsdom — these are server-side tests)
 * - Does NOT stub 'openai' — integration tests use real SDKs and APIs
 * - No setup files (no mocks/spies)
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
