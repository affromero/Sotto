# AGENTS.md - Sotto

> Single source of agent instructions for every coding agent. There are no `CLAUDE.md` files; Claude Code loads this file through the `SessionStart` hook in `.claude/settings.json`.

> Open-source, self-hostable language-learning infrastructure. Learn a language with the agent that already knows you. Canonical brand copy lives in `packages/shared/src/brand.ts`.

## What Is Sotto?

Sotto is open-source, self-hostable language-learning infrastructure. Learners work through mastery-gated CEFR courses across four skills — grammar, reading, adaptive listening, and speaking — on a stack they fully control, connected to their own AI agent and API keys (BYOK).

1. Learners are placed at the right CEFR level and progress through grammar, reading, adaptive listening, and speaking modules gated by demonstrated mastery.
2. The adaptive listening backbone delivers AI-generated audio lessons; learners can pause, ask contextual questions, and receive spoken clarifications.
3. Speaking practice captures learner recordings and returns pronunciation feedback through the configured STT/TTS providers.
4. A personal vocabulary memory graph tracks words and grammar points across all four skills, surfacing spaced-repetition review when needed.
5. Self-hosters connect their own agents (Claude Code, Codex, OpenClaw, Hermes) and any supported TTS/STT/LLM provider through BYOK configuration.
6. Non-technical learners can use managed Sotto-hosted infrastructure when the product offers it.
7. Each learner works in a private, single-learner space; their courses, progress, and vocabulary graph stay theirs, on a stack they control.

Sotto is fully free and self-hosted: every learner gets full access on infrastructure they control. Learner progress and ownership of the learning stack are the differentiators.

## Tech Stack

| Layer      | Technology                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Frontend   | Next.js 16 App Router, TypeScript, CSS Modules                                                   |
| Database   | PostgreSQL 17 + Prisma 7                                                                         |
| Auth       | None — single-learner self-hosted instance with no login                                         |
| Queue      | Redis 7 + BullMQ worker pool                                                                     |
| AI         | Provider-resolved LLM generation through configured model settings                               |
| Audio      | ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate, and local/provider-specific TTS integrations |
| Storage    | Local file storage by default; S3/R2-compatible storage for hosted deployments                   |
| Deployment | Local Docker Compose for OSS; Hetzner/Docker/Caddy for hosted deployments                        |

## Monorepo

npm workspaces:

- `@sotto/web` in `apps/web/`
- `@sotto/shared` in `packages/shared/`
- `@sotto/mcp` in `packages/mcp/`
- `groundcheck` in `packages/groundcheck/`

`tui/` is the `sotto` terminal client — a standalone Rust + ratatui crate (the `sotto` binary), **outside** the npm workspaces. It consumes `/api/v1` over HTTP via a progenitor-generated client built from the OpenAPI spec `@sotto/shared` emits. Build/test it with `cargo` (`cd tui && cargo test`), not npm. See `tui/AGENTS.md`.

Root `package.json` proxies the main web commands to `@sotto/web`. Each major directory has its own `AGENTS.md`; follow the closest applicable file.

## Build Commands

```bash
npm run setup                  # Install deps, start local services, write .env.local, push schema, generate Prisma
npm install                    # Install all workspaces only
docker compose up -d postgres redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev                    # Local web + workers
SKIP_DB_SYNC=1 npm run dev     # Faster start without DB sync
npm run dev:web                # Web only
npm run dev:workers            # Workers only
npm run ci                     # lint + type-check + test + build
```

## Subdirectory AGENTS.md Index

| Directory                  | What Is Documented                                                   |
| -------------------------- | -------------------------------------------------------------------- |
| `apps/`                    | Application workspace differences                                    |
| `apps/web/src/app/`        | Pages and API routes                                                 |
| `apps/web/src/components/` | Component conventions                                                |
| `apps/web/src/lib/`        | Provider clients, auth helpers, pipeline libraries                   |
| `apps/web/src/workers/`    | Worker responsibilities and pipeline flow                            |
| `apps/web/src/types/`      | Type re-exports from `@sotto/shared`                                 |
| `apps/web/src/styles/`     | Design system tokens                                                 |
| `apps/web/prisma/`         | Prisma schema and database rules                                     |
| `packages/`                | Shared package boundaries                                            |
| `tui/`                     | Rust `sotto` terminal client: API/audio/contract-codegen conventions |

## Design System

SottoDesign "aula": Primary `#3F4FB0` (aula blue). Accent `#2A3550` (ink slate). Background `#F5F4F0` (paper). Surface `#FFFFFF`. Text `#1E2128` (ink) / `#565B68`. Dark mode uses the "terminal" palette (`#121310` paper, `#E9E3D3` ink, `#6A9BFF` primary). The wordmark name carries a blue to pink gradient (`#6AA0FF` to `#FF8FB1`), and the glass-bead mark uses the same.

Fonts: Newsreader (serif) for headings and voice, IBM Plex Sans for body and UI, IBM Plex Mono for labels. Tokens live in `apps/web/src/styles/globals.css` and mirror to `packages/shared/src/theme.ts`.

## Generation Pipeline

The audio generation pipeline powers the adaptive listening skill and any spoken feedback in other skills.

```text
lesson spec, vocabulary set, CEFR level, or exercise prompt
  -> content extraction / curriculum resolution
  -> deep research
  -> creative planning
  -> evidence-linked script writing
  -> fail-closed compilation and claim-support verification
  -> audio generation
  -> audio stitching
  -> learner library (private per-user)
```

Status flow:

```text
PENDING -> DISCOVERING -> EXTRACTING -> SCRIPTING -> VERIFYING_SCRIPT -> VALIDATING_REFERENCES -> SCRIPT_READY -> GENERATING_AUDIO -> STITCHING -> READY
```

## Engineering Patterns

- Component: `Name.tsx` + `Name.module.css`, typed props, named export, `styles.root`.
- API route: `auth()` -> Zod validation -> Prisma -> `NextResponse.json()`.
- Worker: `export async function processJob(job: Job)` -> `job.updateProgress()` -> return typed result.
- Lib: class-based client or small pure helpers, singleton export only when it matches existing local style.

## DO

- Use CSS Modules for all web styling.
- Use TypeScript strict mode; do not use `any`.
- Use Server Components by default; add `'use client'` only when required.
- Validate all API inputs with Zod schemas.
- Return proper HTTP status codes from API routes.
- Protect dashboard/API routes via middleware and route-level `auth()`.
- Use BullMQ for async/heavy work; do not run heavy processing in API routes.
- Give each BullMQ worker its own Redis connection.
- Design mobile-first CSS and preserve 375px layouts.
- Add ARIA labels, keyboard navigation, and semantic HTML.
- Keep local OSS onboarding simple: `.env.oss.example`, `.env.local`, local PostgreSQL, local Redis, local storage.
- Update `.env.example`, `.env.oss.example`, and docs when adding env vars.
- Add or update affected tests in the same commit as source changes.

## DON'T

- Do not use Tailwind, inline styles, or styled-components.
- Do not hardcode model names or provider IDs.
- Do not create fallback chains that pick providers by key availability. Use explicit provider selection through `resolveSttProvider()`, `resolveTtsProvider()`, `resolveAutoModel()`, or the closest existing resolver.
- Do not reuse the same two voices for every generated lesson unless the learner explicitly selected them.
- Do not create admin endpoints or scripts that bulk-delete R2 files. Segment audio and episode audio are protected in `deleteFile()`; never bypass that guard.
- Do not require Doppler for local OSS workflows.

## Frontend Quality

- Touch targets must be at least 44x44px.
- Animations must respect `prefers-reduced-motion` and only animate `transform` or `opacity`.
- Verify mobile layouts at 375px minimum and keep content clear of the MiniPlayer.
- No inline styles, no `eval()`, and use `next/image` for remote or optimized images.

## Mandatory Test Sync

When modifying any source file that has a corresponding test file, update the test in the same change.

- Before editing a source file, check for test files that import it.
- After editing source, run the affected test with `npm test -- --run <test-file>`.
- If tests fail, fix them in the same commit.
- When changing function signatures, mock return shapes, required fields, or enum values, search all tests for the old shape and update every occurrence.
- The pre-commit hook blocks commits when affected tests fail.

## Commit Checklist

Run `npm run ci` before every commit. No exceptions.

- [ ] `npm run ci` passes with zero errors and a successful build.
- [ ] No secrets or `.env` values are staged.
- [ ] Lint errors, type errors, and test failures are fixed.
- [ ] Unused imports are removed.
- [ ] Affected tests are updated and passing.
- [ ] After Prisma schema changes, run `npx prisma generate` before type-checking.
- [ ] In RTL tests, `waitFor` a visible UI state before interactions, not mock call counts.

## Environment Variables

Local OSS development uses `.env.oss.example` copied to `.env.local`. Root npm scripts source `.env.local` through `scripts/run-with-env.sh`; set `SOTTO_ENV_FILE` to point them at a different env file.

Critical local variables: `DATABASE_URL`, `REDIS_URL`, `BYOK_ENCRYPTION_KEY`, `STORAGE_PROVIDER`.

Provider variables are optional until the selected workflow needs them. Common examples: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `R2_*`, `AI_PROVIDER`, `TTS_PROVIDER`, `STT_PROVIDER`.

## Known Gotchas

- Alpine + Chromium: pin Alpine version to match the Chromium version available in its repos. Alpine 3.22+ works with Chromium 136+.
- Docker service names: workers reach sidecars via Docker service names (e.g. `http://local-tts:8000`); use `localhost` only for local dev outside Docker.
- Prisma in Docker: always run `npx prisma generate` inside the Docker build because the generated client is platform-specific.
- Compose files stay at the repo root: the `docker-compose*.yml` files resolve `build.context: .`, `env_file: .env`, and `${VAR}` substitution from the project directory (their own location). Moving them to a subfolder breaks every invocation in `scripts/install.sh`, `scripts/deploy.sh`, and the docs unless each adds `--project-directory`/`--env-file`, and `docker-compose.selfhost.yml` is downloaded standalone by the installer and must keep flat paths. None of this is CI-verifiable, so a wrong path silently breaks deploy or self-host install. Keep them at root.
- Monorepo paths: avoid `__dirname`-relative paths across package boundaries. Use `process.cwd()` for cross-package references.
- DB enum values are uppercase, for example `USER`, `ADMIN`, and `SYSTEM`.

## Reference

Architecture: `docs/01-technical-architecture.md`
Local setup: `docs/04-local-development.md`
