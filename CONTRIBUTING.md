# Contributing to Sotto

Sotto is source-available language-learning infrastructure released under PolyForm Noncommercial 1.0.0, subject to THIRD_PARTY_NOTICES.md. New first-party contributions follow the contribution licensing terms below.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Access to an AI provider and a speech provider, configured after startup in `/welcome` or Admin

### First-time setup

```bash
git clone --recurse-submodules https://github.com/affromero/Sotto.git
cd sotto
npm run setup
```

`npm run setup` runs `scripts/setup.sh`, which:

1. Copies `.env.oss.example` to `.env.local` if no local env file exists.
2. Starts PostgreSQL and Redis via Docker Compose.
3. Runs `npm install` across all workspaces.
4. Pushes the Prisma schema (`npx prisma db push`).
5. Generates the Prisma client (`npx prisma generate`).

Start the development server, open `/welcome`, and save your provider credentials. Sidedoor encrypts them in the development database.

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
3. If the language requires a dedicated TTS voice profile, add an entry to `packages/shared/src/types/episode.ts` (`VoiceProfile`).
4. Add a Prisma migration if any database enum needs updating, then run `npx prisma generate`.
5. Add at least one Vitest test covering the new language code in `apps/web/src/`.

## Pre-commit Hook: enforce-test-sync

A pre-commit hook (`scripts/hooks/enforce-test-sync.sh`) blocks commits when a staged source file has a corresponding test file that is currently failing. This applies to all languages (TypeScript, Python, Swift, Go, Rust).

If the hook blocks your commit:

1. Run `npm test -- --run <failing-test-file>` to see the failure.
2. Fix the test (or the source) before re-staging.
3. Never use `--no-verify` to bypass the hook.

## Contribution licensing

This policy applies prospectively to new first-party contributions submitted
after its adoption. It grants no rights to existing contributions and does not
change the contribution terms of separately licensed components.

Before accepting a new contribution, maintainers require the contributor's
affirmative acceptance of an additional MIT license for the identified work.
The contributor keeps copyright. The grant permits incorporation in future
PolyForm Noncommercial releases and separate commercial licensing. It is not
a copyright assignment. Provide the copyright holder's name and retain the
applicable MIT copyright and permission notice with the contribution.

Confirm in the pull request that you own the work or are authorized by its
copyright owner, and that you additionally license the identified contribution
under the MIT License at https://opensource.org/license/mit. Identify third-party
material separately. If an employer owns the work, obtain its authorization.
Maintainers must resolve absent or conflicting permission before acceptance.

The repository's outbound license remains the root LICENSE with the exceptions
in THIRD_PARTY_NOTICES.md. No grant is inferred from an earlier contribution, an
unchecked checkbox, silence or a Git author identity.

The additional MIT grant and its notices remain effective for the contribution
they cover. The combined release's outbound terms do not erase those component
rights. Preserve the applicable MIT notices when incorporating that work.

Existing AGPL releases keep their original grants. Separately licensed components
keep their own contribution terms.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be respectful and constructive. Harassment of any kind will not be tolerated.

## Pull Request Checklist

- [ ] `npm run ci` passes with zero errors and a successful build.
- [ ] No secrets or `.env` values are staged.
- [ ] Affected tests are updated and passing.
- [ ] Unused imports are removed.
- [ ] After Prisma schema changes, `npx prisma generate` has been run before type-checking.
- [ ] New environment variables are documented in both `.env.example` and `.env.oss.example`.
