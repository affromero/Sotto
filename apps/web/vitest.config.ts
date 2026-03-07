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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sotto/video': path.resolve(__dirname, '../../packages/video/src/index.ts'),
      // Stub optional dependencies that may not be installed
      'openai': path.resolve(__dirname, './tests/setup/openai-stub.ts'),
    },
  },
});
