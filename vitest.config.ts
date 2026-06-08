import { defineConfig } from 'vitest/config';

// Root delegator: running vitest from the repo root (e.g. the test-sync
// pre-commit hook, which passes `apps/web/tests/...` paths) resolves the
// @sotto/web project's full config — aliases (`@/`), environment, and setup.
// Day-to-day test runs still happen inside apps/web against its own config.
export default defineConfig({
  test: {
    projects: ['apps/web'],
  },
});
