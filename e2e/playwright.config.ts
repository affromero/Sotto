import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '../apps/web/e2e',
  tsconfig: '../apps/web/tsconfig.json',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../test-results/browser',
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    actionTimeout: 15_000,
    baseURL: process.env.NEXT_PUBLIC_APP_URL,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${resolve(process.env.SOTTO_BROWSER_DIRECTORY!, 'microphone.wav')}`,
      ],
    },
  },
  webServer: {
    command: `npm run start --workspace=@sotto/web -- --hostname 127.0.0.1 --port ${process.env.SOTTO_BROWSER_PORT}`,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/access`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
