# Repository Guidelines

## Project Structure & Module Organization
This is an npm workspaces monorepo. Key areas:
- `apps/web/` Next.js web app (App Router), workers, Prisma, tests.
- `apps/mobile/` Expo React Native app.
- `apps/maps/` Next.js playground for `@sotto/maps`.
- `packages/` shared libraries (`shared`, `maps`, `video`, `mcp`, `verification-standard`).
- `services/` backend services (for example `remotion`).
- `e2e/` Playwright (web) and Maestro (mobile) tests.
- `scripts/` dev/ops automation; `docs/` product/architecture docs; `extension/` browser extension; `accounting/` beancount ledger.

## Build, Test, and Development Commands
Run from repo root unless noted.
- `npm run setup` bootstrap local tooling.
- `npm run dev` start web + workers using `.env.local`.
- `SKIP_DB_SYNC=1 npm run dev` faster start without DB sync.
- `npm run dev:web` or `npm run dev:workers` for scoped dev.
- `npm run build`, `npm run lint`, `npm run type-check`, `npm run test` proxy to `@sotto/web`.
- `npm run test:e2e:web` Playwright; `npm run test:e2e:mobile` Maestro.
- `npm run mobile:ios` / `npm run mobile:android` for Expo.

## Coding Style & Naming Conventions
- TypeScript first, no `any`. Prefer Server Components; add `'use client'` only when needed.
- CSS Modules only for web (`Name.tsx` + `Name.module.css`). React Native uses `StyleSheet.create()`.
- Formatting via Prettier; linting via ESLint. Run `npm run format` and `npm run lint`.
- API routes: `auth()` then Zod validation, Prisma, `NextResponse.json()`.

## Testing Guidelines
- Web uses Vitest; `apps/web/tests/` contains unit/integration/smoke tests.
- `packages/maps` and `packages/verification-standard` also use Vitest.
- E2E: Playwright (web) and Maestro (mobile).
- If you change a source file, update its corresponding tests in the same PR.

## Commit & Pull Request Guidelines
- Commit messages follow conventional style: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`.
- PRs should include a concise summary, test evidence (commands run), and screenshots for UI changes.
- Run `npm run ci` before merging when possible.

## Security & Configuration Tips
- Secrets are loaded from `.env.local` for local OSS development. Do not commit `.env` files or hardcode keys.
- If you add a new env var, update `.env.example` and relevant docs.

## Agent-Specific Instructions
- Before making changes, read all `CLAUDE.md` files in the repo (root and subdirectories) and follow the closest applicable guidance.
