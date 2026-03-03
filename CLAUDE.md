# CLAUDE.md — Sotto

> **Sotto** — Every voice. Every topic. One feed. Canonical brand copy lives in `packages/shared/src/brand.ts`.

## What is Sotto?

Sotto (from "sotto voce" — soft voice in Italian) is the social podcast network where:

1. Users chat with AI → AI generates a 2-voice conversational podcast
2. Users **interrupt mid-playback** to ask questions → AI answers in context
3. Podcasts can be **updated** with Q&A baked in
4. **Fork any podcast** — remix with your own angle
5. **Import any podcast** — human or AI-made — add social features on top
6. Public podcasts on a **social feed** — discover, listen, fork, follow

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14+ (App Router), TypeScript, CSS Modules |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | NextAuth.js v5 (Google, GitHub, Apple; Twitter for linking only) |
| Queue | Redis 7 + BullMQ (25 worker types) |
| AI | Anthropic Claude — swappable via `AI_PROVIDER` |
| Audio | ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate (multi-provider TTS) |
| Storage | Cloudflare R2 (S3-compatible) — swappable via `STORAGE_PROVIDER` |
| BYOK | Users bring own LLM + TTS keys — all features free |
| Hosting | Hetzner VPS (Docker Compose + Caddy), GitHub Actions deploy |

## Monorepo

npm workspaces: `@sotto/web` (`apps/web/`), `@sotto/mobile` (`apps/mobile/`), `@sotto/shared` (`packages/shared/`), `@sottofm/verification-standard` (`packages/verification-standard/`).
Root `package.json` proxies to `@sotto/web`. Each subdirectory has its own `CLAUDE.md`.

## Build Commands

```bash
npm install                    # All workspaces
docker-compose up -d           # PostgreSQL + Redis + KittenTTS
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev                    # Syncs prod DB + starts web + workers
SKIP_DB_SYNC=1 npm run dev     # Fast start (skip DB sync)
npm run dev:web                # Web only
npm run dev:workers            # Workers only
npm run ci                     # Full CI: lint + type-check + test + build
```

## Subdirectory CLAUDE.md Index

| Directory | What's documented |
|-----------|-------------------|
| `src/app/` | All pages + API routes |
| `src/components/` | 15 component directories |
| `src/lib/` | 40+ lib files, 7 hooks, providers |
| `src/workers/` | 25 workers, pipeline flow |
| `src/types/` | Type re-exports from @sotto/shared |
| `src/styles/` | Design system tokens |
| `prisma/` | 60 Prisma models |

## Design System: "Warm Intimacy"

Primary: `#D97706` (Golden Amber) — CTAs, Host speaker.
Accent: `#1E3A5F` (Deep Navy) — Expert speaker, secondary actions.
Background: `#FEFCF8` (Soft Cream). Surface: `#FFFFFF`. Text: `#1A1A1A` / `#6B7280`.
Fonts: DM Serif Display (headings), Inter (body).

## Generation Pipeline

content-extraction → script-generation → script-verification (≤3 loops) → reference-validation → SCRIPT_READY pause → audio-generation (parallel, multi-provider TTS) → audio-stitching (FFmpeg) → notification → bot reply.

**Status**: PENDING → DISCOVERING → EXTRACTING → SCRIPTING → VERIFYING_SCRIPT → VALIDATING_REFERENCES → SCRIPT_READY → GENERATING_AUDIO → STITCHING → READY

## Engineering Patterns

- **Component**: `Name.tsx` + `Name.module.css`. Typed props, named export, `styles.root`.
- **API Route**: `auth()` → Zod validate → Prisma → `NextResponse.json()`.
- **Worker**: `export async function processJob(job: Job)` → `job.updateProgress()` → return.
- **Lib**: Class-based client, singleton export, retry logic.

## DO

- Use CSS Modules for all styling
- Use TypeScript strict mode — type everything properly
- Use Server Components by default — `'use client'` only when needed
- Validate all API inputs with Zod schemas
- Return proper HTTP status codes from API routes
- Protect dashboard/API routes via middleware.ts
- Use BullMQ for async/heavy work — never in API routes
- Give each BullMQ worker its own Redis connection
- Design mobile-first CSS
- Add ARIA labels, keyboard nav, semantic HTML
- Use voice pool system for distinct voice pairs per podcast
- Update `.env.example` when adding env vars
- Add mobile equivalent for every web creation feature

## DON'T

- Use Tailwind, inline styles, or styled-components
- Use `any` type
- Hardcode model names or provider IDs — always resolve from DB config (`AutoModelConfig`), env vars, or user settings. Never write fallback chains that pick providers by key availability — use `resolveSttProvider()`, `resolveTtsProvider()`, or `resolveAutoModel()` instead
- Reuse the same 2 voices for every podcast
- Do heavy processing in API routes

## Frontend Quality

- Touch targets ≥44x44px; no swipe/scroll conflicts; keyboard nav; visible focus states
- Animations respect `prefers-reduced-motion`; only animate `transform` and `opacity`
- Test at 375px min (iPhone SE); verify nothing hidden behind MiniPlayer
- No inline styles (CSP); no `eval()`; use `next/image`

## MANDATORY — Test Sync

**When modifying ANY source file that has a corresponding test file, you MUST update the test to match. No exceptions.**

- Before editing a source file, check for test files that import it (in `tests/` mirror or co-located)
- After editing source, run the affected test: `npm test -- --run <test-file>`
- If tests fail, fix them in the SAME commit — never leave broken tests
- When changing function signatures, mock return shapes, adding required fields, or modifying enum values: grep ALL test files for the old shape and update every occurrence
- A pre-commit hook (`enforce-test-sync.sh`) will block commits when affected tests fail

## Commit Checklist

**Run `npm run ci` before every commit — no exceptions.**

- [ ] `npm run ci` passes (zero errors + successful build)
- [ ] No secrets or `.env` values in staged files
- [ ] All lint errors, type errors, and test failures fixed before presenting work as complete
- [ ] Unused imports removed proactively
- [ ] **Affected test files updated and passing** (the pre-commit hook enforces this)
- After Prisma schema changes: run `npx prisma generate` before type-checking
- In RTL tests: `waitFor` a visible UI state before interactions, not mock call counts

## Environment Variables

All secrets via **Doppler** — NEVER suggest `.env` files, dotenv, or hardcoded environment variables. Project: `sotto`, config: `dev`. Scripts wrap with `doppler run --`.

Critical: `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `R2_*`, `BYOK_ENCRYPTION_KEY`, `KITTENTTS_URL`.
Swappable: `AI_PROVIDER`, `TTS_PROVIDER`, `STT_PROVIDER`, `STORAGE_PROVIDER`, `PAYMENT_PROVIDER`.

## Reference

Full product plan: `docs/00-plan.md`
