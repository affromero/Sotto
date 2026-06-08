# Contributing to Sotto

Sotto is open-source language-learning infrastructure released under the GNU Affero General Public License v3.0. Contributions are welcome.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- An API key for at least one LLM provider (e.g. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)
- An API key for at least one TTS provider (e.g. `ELEVENLABS_API_KEY`)

### First-time setup

```bash
git clone https://github.com/SottoFM/sotto.git
cd sotto
npm run setup
```

`npm run setup` runs `scripts/setup.sh`, which:

1. Copies `.env.oss.example` to `.env.local` if no local env file exists.
2. Starts PostgreSQL and Redis via Docker Compose.
3. Runs `npm install` across all workspaces.
4. Pushes the Prisma schema (`npx prisma db push`).
5. Generates the Prisma client (`npx prisma generate`).

Edit `.env.local` to add your API keys before starting the dev server.

### Running locally

```bash
npm run dev          # Next.js app + BullMQ workers (concurrent)
npm run dev:web      # Web app only
npm run dev:workers  # Workers only
```

### Running CI locally

```bash
npm run ci
```

This runs lint, TypeScript type-checking, Vitest tests, and a production build. **All checks must pass before opening a pull request.**

## Branch and Commit Conventions

- Branch names: `<type>/<short-description>` — e.g. `feat/cefr-placement`, `fix/vocab-graph-edge-case`, `chore/upgrade-prisma`.
- Commit messages: imperative mood, present tense — e.g. `add CEFR placement quiz`, `fix pronunciation scoring for tonal languages`.
- Keep each commit focused on one logical change. Squash fixup commits before merging.
- Run `npm run ci` and confirm it passes before pushing.

## Adding a Language Pair

1. Add the source and target language codes to the `SUPPORTED_LANGUAGES` constant in `packages/shared/src/provider-display.ts`.
2. Add display names to the `LANGUAGE_DISPLAY` map in the same file.
3. If the language requires a dedicated TTS voice profile, add an entry to `packages/shared/src/types/podcast.ts` (`VoiceProfile`).
4. Add a Prisma migration if any database enum needs updating, then run `npx prisma generate`.
5. Add at least one Vitest test covering the new language code in `apps/web/src/`.

## Pre-commit Hook: enforce-test-sync

A pre-commit hook (`scripts/hooks/enforce-test-sync.sh`) blocks commits when a staged source file has a corresponding test file that is currently failing. This applies to all languages (TypeScript, Python, Swift, Go, Rust).

If the hook blocks your commit:

1. Run `npm test -- --run <failing-test-file>` to see the failure.
2. Fix the test (or the source) before re-staging.
3. Never use `--no-verify` to bypass the hook.

## AGPLv3 Network-Use Disclosure

Sotto is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only). The AGPL's network-use clause (Section 13) means:

> If you run a **modified version** of Sotto and let users interact with it over a network, you must make the **complete corresponding source code** of your modified version available to those users under the same license.

Running the unmodified source from this repository is fully compliant. If you fork and deploy a customised instance, publish your changes.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be respectful and constructive. Harassment of any kind will not be tolerated.

## Pull Request Checklist

- [ ] `npm run ci` passes with zero errors and a successful build.
- [ ] No secrets or `.env` values are staged.
- [ ] Affected tests are updated and passing.
- [ ] Unused imports are removed.
- [ ] After Prisma schema changes, `npx prisma generate` has been run before type-checking.
- [ ] New environment variables are documented in both `.env.example` and `.env.oss.example`.
