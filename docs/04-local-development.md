# Local Development Guide - Sotto

> **Date**: 2026-10-20
>
> **Summary**: Run Sotto locally without a hosted secret manager, production database sync, cloud storage, or hosted infrastructure. The default local path uses PostgreSQL, Redis, local file storage, and explicit provider configuration.

---

## 1. Prerequisites

| Tool                            | Version        | Why                               |
| ------------------------------- | -------------- | --------------------------------- |
| Node.js                         | 24             | Next.js, workers, scripts         |
| Docker Desktop or Docker Engine | Current stable | PostgreSQL and Redis              |
| FFmpeg                          | 6+             | Audio stitching and normalization |
| Git                             | 2.40+          | Source control                    |

CI and Docker images use Node.js 24. After changing Node majors, run `npm ci`
to rebuild native dependencies for the selected runtime. To verify Node 24
without changing your shell default, run
`npx --yes --package=node@24 -- sh -c 'npm ci && npm run ci'`.
Local worker builds use the `sotto-workers-base:node24` alias. Production
builds pin the verified worker base digest. Image smoke checks exercise native
file-lock contention and release on Alpine (musl) and Debian (glibc).
Dependabot keeps Node 24 patch and minor updates enabled. Node major upgrades
require a coordinated migration of Docker images, CI, and native smoke checks.

Optional:

- `uv` and `pandoc` for release packet generation.
- A local agent CLI such as Claude Code or Codex.
- A hosted provider key for LLM/TTS/STT.
- `qpdf` for optional verified PDF compression. The worker base includes it;
  local macOS development can install it with `brew install qpdf`.

---

## 2. Quick Start

```bash
npm run setup
npm run dev
```

Open `http://localhost:3000`.

`npm run setup`:

1. install dependencies
2. start PostgreSQL and Redis
3. create `.env.local` from `.env.oss.example`
4. generate local secrets when missing
5. push the Prisma schema
6. generate the Prisma client
7. keep storage local by default

The quickstart must not require a hosted secret manager.

---

## 3. Manual Setup

```bash
npm install
cp .env.oss.example .env.local
docker compose up -d postgres redis
npx prisma migrate deploy --config=prisma.config.ts
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev
```

Use `.env.oss.example` for local onboarding. `.env.example` may include hosted deployment references; the OSS template is the local source of truth.

---

## 4. Minimal `.env.local`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"
REDIS_URL="redis://localhost:6379"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BYOK_ENCRYPTION_KEY="<generated>"
SIDEDOOR_EXECUTION_DIR="./.sotto/executions"
```

Add provider and storage settings in `/welcome` or Admin for the workflow you are testing.

---

## 5. Provider Paths

Classes and FULL practice require five grammar questions, five reading questions,
three writing tasks, four listening questions when TTS is configured, and four
speaking prompts when STT is configured. Speaking reference audio requires both
providers. Missing speech access exempts the corresponding oral skill. A failing,
disabled, or invalid selected provider produces an error and keeps the work
incomplete. Grammar, reading, and writing remain required.

Generation is admitted through durable class and practice preparation jobs. Run
web and workers together with `npm run dev`, or start `npm run dev:workers`
alongside `npm run dev:web`. Leaving the page does not cancel preparation. Resume
saved work from the course page; use its cancellation and recovery controls for
interrupted generation. Unknown provider outcomes remain fenced until execution
cleanup is confirmed. Recovery does not waive required exercises.

Answers, drafts, recordings, and feedback belong to the saved learning attempt.
If another client changes progress, check saved progress before explicitly saving
your local edits. Classes advance only after every required skill passes. Practice
finishes after every exercise is answered or graded, including low scores.
Reading vocabulary is extracted from the exact passage and linked to course memory
without requiring audio.

Upgrades apply the `20260930100000_learning_requirements` Prisma migration before
starting the updated web and workers. Older progress and receipts remain readable.
An incomplete older class can be repaired without discarding retained successful
sections. Native clients should be updated with the server to consume preparation
responses and restored feedback. No additional environment variables are required.

### 5.1 One-Credential Hosted Provider

OpenAI can cover AI, TTS, and STT. Select OpenAI for all three capabilities and save one credential in `/welcome` or Admin.

### 5.2 Separate Providers

Select each specialized provider in the UI and save its credential. Sidedoor captures the selected credential before work is queued, so workers execute with the same authorized provider revision.

The dashboard usage widget shows provider usage from saved credentials and configured limits.

### 5.3 Local Agent

Choose Claude Code or Codex for generation and select a speech provider for audio. Local agent CLIs must be installed and authenticated outside Sotto. Sotto reports a setup error when the selected CLI is unavailable.

The model picker is populated from saved selections and local CLI discovery. Optional runtime variables can expose additional CLI model aliases:

```env
CLAUDE_CODE_MODEL="opus"
CLAUDE_CODE_MODELS="opus,sonnet,haiku,claude-fable-5"
CLAUDE_CODE_EFFORT="xhigh"
CLAUDE_CODE_EFFORTS="low,medium,high,xhigh,max"

CODEX_MODEL="gpt-5.5"
CODEX_MODELS="gpt-5.5,gpt-5.6"
CODEX_MODEL_REASONING_EFFORT="xhigh"
CODEX_MODEL_REASONING_EFFORTS="low,medium,high,xhigh,max"
```

### 5.4 Totally Local Models

Use the no-code local contracts when running your own models. Save the local AI URL and model, local STT URL and model, and local TTS URL, model, and voice IDs in `/welcome` or Admin.

Owners can also open **Speech selection** in Settings or Admin. Set the server
endpoint under **Advanced settings**, then select **Find voices** to see names
and languages. Use **Listen** to preview a voice before selecting 2 to 8 voices.
These checks leave the saved speech selection and cloud credentials unchanged.
Select **Use local speech** to save. Advanced settings also keeps custom model
and manual voice IDs available; discovery preserves existing selections.

See `docs/05-provider-extension-guide.md` for the exact LLM/STT/TTS contracts and native-provider checklists.

---

### Material processing and learning maps

Apply committed Prisma migrations and generate the client after updating an
existing instance. Keep the web app and workers at the same source revision.
Material extraction, visual recognition, analysis and optimization run through
Redis/BullMQ. `npm run dev:workers` starts these handlers; the web server alone
does not process uploaded documents.

The upload capability endpoint is `GET /api/v1/materials/uploads`.
Current `SOTTO_PARTS` limits are ten files per batch, 100 MiB per original,
250 MiB per batch and 4 MiB per part. A profile may hold twenty pending files
totalling 500 MiB. Reservations expire after 24 hours. Complete or explicitly
cancel pending transfers before reserving replacements.

PDF processing currently allows 1,000 pages, 8 million pixels per rendered page,
an 8,192-pixel dimension and 64 MiB text per page. Each parser run allows 512 MiB
of generated artifacts, in addition to its staged original. Optimization compares
separate original and candidate parser runs, so its total workspace can be larger.
The child process has a 512 MiB V8 heap and ten-minute deadline. These bounds
do not enforce a native RSS limit. Container memory settings remain a separate
deployment concern. Limits and parser failures leave originals retained and
report unresolved coverage rather than silently shortening the document.

Visual recognition needs an explicit visual model with saved credentials and
an operator-reviewed capability for that exact provider/model. Configure the
capability in Admin Providers, then admit recognition from the document's
processing view. Embedded text remains available when recognition is pending
or unavailable. Recognition and source analysis may incur configured provider
costs. Unknown outcomes must settle through their retained execution records
before another paid attempt is admitted.

Existing courses can preview missing map bindings and lesson links through the
authenticated maintenance CLI:

```bash
export SOTTO_API_KEY='your existing paired device key'
npx tsx scripts/learning-map/backfill.ts --base-url http://localhost:3000 --course COURSE_ID
npx tsx scripts/learning-map/backfill.ts --base-url http://localhost:3000 --course COURSE_ID --apply
```

`SOTTO_URL` supplies the URL when `--base-url` is omitted.

Dry-run is the default. The private checkpoint resumes the same course, profile,
catalog and source meaning. `--checkpoint PATH` chooses its location. Apply adds
missing canonical bindings and exact lesson links. Existing explicit links,
pinned requirements, placement provenance and assessment history remain intact.
The report identifies originals needing extraction or analysis; it dispatches
no paid work and invents no historical mastery. A changed course identity, band,
catalog or captured coverage requires a fresh preview with a new checkpoint path.
A source page that changes between preview and apply is rejected; inspect a new dry-run before
resuming apply. Repeating an interrupted apply adds only rows still missing.

`ORIGINAL_VERIFICATION_REQUIRED` means an older material has no retained original
SHA256 receipt. This command does not verify or repair original bytes. There is
no in-place original-verification endpoint. Download the owned original if it is
available, then re-upload through Course notes to create a new checksum-verified
material and extraction ledger. Keep the older material and its source links.
`ORIGINAL_UNAVAILABLE` requires obtaining the source file again; retained text
alone cannot prove or reconstruct the original. These steps do not change mastery.

---

### 5.5 Vocabulary study and materials

Open a course's **Vocabulary** page to search its dictionary, inspect source
quotes, edit accepted meanings, and practice selected words. Course notes files
start a durable background vocabulary index after attachment to a course. Use
**Import vocabulary** for older materials. Progress distinguishes queued work,
reviewed coverage, failures, and sources that need readable text. Image-only
documents need a reviewed transcription before vocabulary can be indexed.

Indexing processes the complete extracted text in bounded chunks, checks entry
coverage independently, and preserves existing mastery. Importing a word does
not demonstrate knowledge. New words remain unseen until studied or assessed.
Class and practice selection reuse due and weak dictionary words and pace new
introductions using demonstrated recall.

Flashcards reveal meanings without increasing mastery. Meaning, word, and
listening recall record each first response once, with feedback and spaced
review. Answers use dictionary meanings and explicitly saved aliases; editing
them affects future sessions. Recall estimates describe the current scheduler,
and one correct answer does not mean a word is mastered. Learners can optionally
describe vocabulary difficulties during onboarding and change that preference
in course settings. This guides practice support, rather than diagnosing a
fixed learning style.

Spaced practice and retrieval with feedback inform this approach. See the
[second-language spacing meta-analysis](https://doi.org/10.1111/lang.12479) and
[retrieval-practice experiment](https://doi.org/10.1126/science.1152408).
Sotto's exact pacing thresholds are product heuristics, not validated individual
memory measurements.

Pronunciation requires explicitly configured local speech. The first request
creates a course-owned cached asset; repeated playback reuses it. Changing the
local model, endpoint, voice, or word creates a different cache identity.
Disabled or unavailable local speech reports its configuration error. No paid
speech provider is selected automatically. Uncertain indexing or audio outcomes
remain visible and fenced until execution recovery confirms they can be retried.

Apply the vocabulary study, pronunciation, and material-index Prisma migrations
and regenerate Prisma when upgrading. No new environment variables are required.
iOS links these study sessions to the web; the terminal reports web continuation.

---

## 6. Live Provider Checks

Use the test action on each saved provider card in Admin. The request uses the same captured Sidedoor credential and endpoint policy as production work and reports the provider error directly.

---

## 7. What Works By Configuration Level

| Configuration                    | Available                                              |
| -------------------------------- | ------------------------------------------------------ |
| local DB + Redis + storage       | app shell, dashboard, settings, local library metadata |
| plus selected LLM or local agent | discovery, scripting, Q&A text paths                   |
| plus selected TTS                | end-to-end audio generation                            |
| plus selected STT                | meeting/audio transcription                            |

No missing capability should be hidden by an implicit provider fallback.

---

## 8. Development Commands

| Command                   | What it does                       |
| ------------------------- | ---------------------------------- |
| `npm run setup`           | bootstrap local OSS development    |
| `npm run dev`             | start web app and workers          |
| `npm run dev:web`         | start web app only                 |
| `npm run dev:workers`     | start workers only                 |
| `npm run lint`            | run ESLint                         |
| `npm run type-check`      | run TypeScript checks              |
| `npm run test`            | run Vitest                         |
| `npm run test:browser`    | run isolated learner browser tests |
| `npm run build`           | build web app                      |
| `npm run check:affected`  | checks for staged changes          |
| `npm run ci`              | full source validation             |
| `npm run prisma:push`     | push Prisma schema                 |
| `npm run prisma:generate` | generate Prisma client             |
| `npm run prisma:studio`   | open Prisma Studio                 |

Use Node 24, as recorded in `.node-version`, and install both Git hook stages:

```bash
pre-commit install --install-hooks
git add <changed-files>
git commit
```

The commit gate selects type checks and related tests from staged paths,
including deletions. Configuration and runtime inputs that cannot be covered
by the test import graph select the full affected workspace suite. Documentation
and native-only commits avoid web validation. Pushes run Rust checks when the
TUI or its shared contracts change, without repeating the web suite and build.
Use `npm run check:affected` to run the staged gate manually during debugging;
the commit hook already runs it.

GitHub runs full source validation for web, package, and tooling changes before
merge. Production and OSS images share the main revision's validation. Native
and documentation changes avoid backend validation. Run `npm run ci` locally
to investigate broader failures or qualify an offline release. A passing focused
check does not replace applicable remote checks for the exact release revision.

### Offline scheduler comparison

New class and practice submissions record private review observations alongside
their existing SM-2 updates. Apply the additive Prisma migration before running
updated web and worker processes. No historical events are fabricated. Deleting
a course, memory target, class or practice session also deletes its observations.

Run an owned course comparison with a fixed held-out cutoff:

```bash
npm run learning:compare -- --course-id COURSE_ID --user-id USER_ID --test-after 2026-10-20T00:00:00Z
```

Add `--export /private/path/reviews.json` to create a new private snapshot, or
use `--input /private/path/reviews.json` for an offline replay without database
access. The command refuses to overwrite an export. Snapshots contain private
target and question identifiers; keep them local.

The report compares fixed-default FSRS recall predictions with the existing
mastery estimate on single-question vocabulary recognition events. It scores
each answer before updating either history. Earlier observations warm the model;
same-day reviews update history but are excluded from held-out metrics. Replay
stops at the first aggregate, missing or invalid transition and preserves earlier
predictions. Left-truncated histories are excluded and counted. SM-2 replay
checks use the canonical scheduler. The mastery baseline is not an SM-2 recall
probability. These metrics do not establish fewer required reviews, improved
learning, or the effect of a different review policy. Live scheduling is unchanged.

### Browser tests

The browser suite exercises household sign-in, local-provider onboarding, course creation,
audio playback, microphone recording, grading, and completing a class at a 375px viewport.
It runs the production web build and speaking worker against real PostgreSQL, Redis,
and local storage. A local HTTP fixture supplies deterministic AI, STT, and audio responses.
This checks application integration; it does not assess a real model's teaching quality.

Install Chromium with `npx --no-install playwright install chromium`. Docker, FFmpeg,
and Chromaprint must also be available. Set `SIDEDOOR_TEST_DATABASE_URL` to a disposable
PostgreSQL server on `localhost` or `127.0.0.1`, with a database named `sidedoor_test`
and a role allowed to create databases. Then run `npm run test:browser`.

The runner creates and removes a unique database, Redis container, storage directory,
and provider fixture for each run. It supplies `SOTTO_BROWSER_DIRECTORY`,
`SOTTO_BROWSER_PROVIDER`, and `SOTTO_BROWSER_PORT` internally. Do not configure these
in application environments. Failure screenshots and traces are written to
`test-results/browser` and `playwright-report`; CI retains them for seven days.

---

## 10. Troubleshooting

### PostgreSQL or Redis port is already in use

Change the Docker Compose port mapping or stop the local service using the port, then update `.env.local`.

### Prisma client is stale

```bash
npx prisma generate --schema=apps/web/prisma/schema.prisma
```

### FFmpeg is missing

Install it with your package manager:

```bash
brew install ffmpeg
```

or:

```bash
sudo apt install ffmpeg
```

### Provider validation fails

Check that the selected provider exactly matches the configured key. Sotto should report the missing provider capability and should not reroute to another provider automatically.

### Local storage fails

Confirm that **Local** storage is saved in `/welcome` or Admin and that the process can create the configured storage root. Keep `SIDEDOOR_EXECUTION_DIR` writable as well.

### Workers cannot reach services

Local development outside Docker should use `localhost`. Full Docker deployments should use service names such as `postgres`, `redis`, and `local-tts`.
