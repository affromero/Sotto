# CLAUDE.md - Sotto

> Private audio briefings from your agents, meetings, workflows, and trusted sources. Canonical brand copy lives in `packages/shared/src/brand.ts`.

## What Is Sotto?

Sotto is private-first open source audio infrastructure for people who want self-owned podcasts from their own tools and sources.

1. Users create briefings from topics, URLs, imported audio, transcripts, meeting recordings, agents, news, or bot events.
2. Users can pause playback, ask contextual questions, and optionally update their private episode with the clarification.
3. Ready episodes are delivered through private RSS tokens that the user controls.
4. Self-hosters can connect local agents such as Claude Code, Codex, OpenClaw, or Hermes plus their preferred TTS provider.
5. Non-technical users can use managed Sotto-hosted infrastructure when the product offers it.
6. There is no social layer: no public feed, follows, likes, comments, forks, remix graph, or community ranking.

Hosted billing, if present, must charge for infrastructure and convenience: workers, storage, scheduled ingestion, bot hosting, provider routing, monitoring, and updates. Do not position generic AI-generated podcast content as the core value.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14+ App Router, TypeScript, CSS Modules |
| Mobile | Expo React Native, expo-router, react-native-track-player |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | NextAuth.js v5 for web sessions; mobile uses API-token flows |
| Queue | Redis 7 + BullMQ worker pool |
| AI | Provider-resolved LLM generation through configured model settings |
| Audio | ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate, and local/provider-specific TTS integrations |
| Storage | Local file storage by default; S3/R2-compatible storage for hosted deployments |
| Deployment | Local Docker Compose for OSS; Hetzner/Docker/Caddy for hosted deployments |

## Monorepo

npm workspaces:

- `@sotto/web` in `apps/web/`
- `@sotto/mobile` in `apps/mobile/`
- `@sotto/shared` in `packages/shared/`
- `@sotto/maps` in `packages/maps/`
- `@sotto/mcp` in `packages/mcp/`
- `@sottofm/verification-standard` in `packages/verification-standard/`
- `@sotto/remotion-service` in `services/remotion/`

Root `package.json` proxies the main web commands to `@sotto/web`. Each major directory has its own `CLAUDE.md`; follow the closest applicable file.

## Build Commands

```bash
npm run setup                  # Install deps, start local services, write .env.local, push schema, generate Prisma
npm install                    # Install all workspaces only
docker compose up -d postgres redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev                    # Local web + workers
npm run dev:web                # Web only
npm run dev:workers            # Workers only
npm run ci                     # lint + type-check + test + build
```

## Subdirectory CLAUDE.md Index

| Directory | What Is Documented |
|-----------|--------------------|
| `apps/` | Application workspace differences |
| `apps/web/src/app/` | Pages and API routes |
| `apps/web/src/components/` | Component conventions |
| `apps/web/src/lib/` | Provider clients, auth helpers, pipeline libraries |
| `apps/web/src/workers/` | Worker responsibilities and pipeline flow |
| `apps/web/src/types/` | Type re-exports from `@sotto/shared` |
| `apps/web/src/styles/` | Design system tokens |
| `apps/web/prisma/` | Prisma schema and database rules |
| `packages/` | Shared package boundaries |

## Design System

Primary: `#D97706` (Golden Amber). Accent: `#1E3A5F` (Deep Navy). Background: `#FEFCF8` (Soft Cream). Surface: `#FFFFFF`. Text: `#1A1A1A` / `#6B7280`.

Fonts: DM Serif Display for headings, Inter for body text.

## Generation Pipeline

```text
topic, source, meeting, transcript, agent output, or bot event
  -> content extraction
  -> script generation
  -> script verification
  -> reference validation
  -> audio generation
  -> audio stitching
  -> private library + private RSS
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

- Do not reintroduce social primitives: public feeds, follows, likes, comments, forks, remix lineage, community counters, or activity feeds.
- Do not use Tailwind, inline styles, or styled-components.
- Do not hardcode model names or provider IDs.
- Do not create fallback chains that pick providers by key availability. Use explicit provider selection through `resolveSttProvider()`, `resolveTtsProvider()`, `resolveAutoModel()`, or the closest existing resolver.
- Do not reuse the same two voices for every generated episode unless the user explicitly selected them.
- Do not create admin endpoints or scripts that bulk-delete R2 files. Segment audio and podcast audio are protected in `deleteFile()`; never bypass that guard.
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

Critical local variables: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `BYOK_ENCRYPTION_KEY`, `STORAGE_PROVIDER`, `PAYMENT_PROVIDER`.

Provider variables are optional until the selected workflow needs them. Common examples: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `R2_*`, `AI_PROVIDER`, `TTS_PROVIDER`, `STT_PROVIDER`.

## Known Gotchas

- Alpine + Chromium: pin Alpine version to match the Chromium version available in its repos. Alpine 3.22+ works with Chromium 136+.
- Docker service names: workers reach sidecars via Docker service names such as `http://remotion:3100`; use `localhost` only for local dev outside Docker.
- Prisma in Docker: always run `npx prisma generate` inside the Docker build because the generated client is platform-specific.
- Monorepo paths: avoid `__dirname`-relative paths across package boundaries. Use `process.cwd()` for cross-package references.
- DB enum values are uppercase, for example `AI_ILLUSTRATION`, `STOCK_FOOTAGE`, and `TEXT_CARD`.

## Reference

Active product plan: `docs/05-plan.md`
Architecture: `docs/16-technical-architecture.md`
Local setup: `docs/23-local-development.md`
