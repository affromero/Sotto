import '@testing-library/jest-dom';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Set default environment variables for tests
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://selfhost.example.com';
process.env.SIDEDOOR_EXECUTION_DIR =
  process.env.SIDEDOOR_EXECUTION_DIR ||
  join(tmpdir(), `sotto-test-executions-${process.pid}-${process.env.VITEST_POOL_ID || 'main'}`);

// Mock DOM methods not available in jsdom (guard for node environment)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
