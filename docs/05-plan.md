# Plan - Private-First Open Source Sotto

> **Date**: 2026-05-15
>
> **Summary**: This is the active implementation plan for Sotto as a free, open-source, self-hostable language-learning platform. The current build centers on BYOK/local-agent setup, placement, mastery-gated CEFR courses, grammar/reading/listening/speaking/writing classes, ungated practice, mock exams, memory graph review, and the reused audio engine for adaptive listening. Old private-podcast, briefing, news, bot, billing, and social-roadmap items are removed from the current product plan.

---

## 1. Goal

Release Sotto as open-source language-learning infrastructure that lets learners keep their course data, recordings, vocabulary memory graph, provider keys, and learning context on infrastructure they control.

The product should support self-hosted paths:

1. **Local OSS**: self-host locally with `npm run setup`, local PostgreSQL, local Redis, local storage, and a BYOK provider or local agent.
2. **VPS self-hosted**: deploy with Docker Compose, Caddy, explicit env files, local or S3-compatible storage, and explicit provider selection.

The first release should be credible without managed infrastructure, Sotto billing, paid plans, tiers, quotas, or commercial access controls.

---

## 2. Non-Negotiables

- The full learning loop is free in the self-hosted build.
- No public social layer.
- No compatibility code for removed social features.
- No implicit provider fallback chains.
- No manual multi-page setup as the only onboarding path.
- No hosted-only assumptions in the OSS quickstart.
- No docs that describe removed product surfaces as current.
- No billing, plan, tier, generation-credit, or daily-quota gate for learning features.
- Every refactor stage must include tests or guardrails.

Provider selection must be explicit. If a selected provider is missing credentials, base URL, model, or capability, the app should fail with a precise configuration error and a setup action.

---

## 3. Current State

Completed in the language-learning pivot:

- README and brand copy position Sotto as open-source, self-hostable language-learning infrastructure.
- Placement creates a course and stores a `PlacementResult`.
- Courses are native-language to target-language enrollments with CEFR level state.
- Mastery-gated `CourseClass` generation exists across grammar, reading, listening, speaking, and writing.
- Failed sections can regenerate in a similar-but-not-identical form.
- The listening skill reuses the audio-generation engine and `Podcast` implementation details.
- Speaking recordings flow through STT and pronunciation feedback.
- Writing responses are graded with inline corrections and feedback.
- Ungated `PracticeSession` exists for skill-specific review, including vocabulary.
- Mock exams exist for self-assessment and never advance course level.
- `LearnerVocab`, `LearnerGrammar`, and `VocabEdge` form the course-scoped memory graph.
- Course notes personalize placement, classes, and practice.
- Live conversation can feed new vocabulary into the memory graph when the BYOK Google path is available.
- Local storage is the default storage provider.
- Doppler is no longer required for default local dev.
- BYOK and local providers are wired through explicit resolvers.
- Public feed routes and API have been removed.
- Like, comment, fork, follow, activity, collection-follow, and vote tables have been removed.
- Social counters and social export payloads have been removed.
- Social demo and automation harness flows have been removed.
- OSS guard tests cover major private-first and language-learning surfaces.

Removed from the old project plan:

- Private podcast platform positioning.
- Private RSS as the main product delivery primitive.
- Meeting recap ingestion as a current roadmap item.
- Scheduled news briefings as a current roadmap item.
- Generic webhook-to-episode workflows as a current roadmap item.
- Bot hosting around private episode creation.
- Hosted billing assumptions, plans, tiers, quotas, and paid unlocks.

Remaining release work:

- Replace stale docs and pitch copy.
- Keep docs, tests, and screenshots aligned with the current learning product.
- Harden setup readiness around BYOK/local LLM, TTS, STT, storage, database, and Redis.
- Keep the reused audio engine documented as an implementation detail for listening, not as product positioning.
- Run type-checks, tests, and build before release.

---

## 4. Onboarding Design

### 4.1 Local OSS Path

Target command:

```bash
npm run setup
npm run dev
```

The setup script should:

- Install dependencies.
- Start PostgreSQL and Redis.
- Write `.env.local` from `.env.oss.example`.
- Generate `AUTH_SECRET` and `BYOK_ENCRYPTION_KEY` when absent.
- Set `STORAGE_PROVIDER=local`.
- Push the Prisma schema.
- Generate the Prisma client.
- Print the local URL and next required provider action.

Acceptance test:

- A fresh clone can reach the app without Doppler.
- The app explains that generation requires a selected provider or local agent.
- No `.env.local` secrets are committed.

### 4.2 One-Key Provider Path

Target experience:

1. User selects a supported provider profile.
2. User pastes the required key.
3. App configures the explicit LLM, TTS, and STT selections that profile supports.
4. App validates the provider profile with a small health check.
5. User takes placement or starts/resumes a course.

Implementation requirements:

- Provider-profile presets must be backed by explicit config.
- Store provider choice in the same settings path used by existing resolvers.
- Show missing capability errors when a selected profile cannot do a task.
- Do not silently move to another provider when one capability fails.

### 4.3 Local-Agent Path

Target experience:

1. User selects a local agent profile.
2. App detects whether the CLI exists.
3. App shows auth status and the exact command needed when auth is missing.
4. User selects TTS and STT providers separately.
5. Learning generation uses the selected local agent for placement, class, practice, scoring, and memory work where supported.

Supported profiles should include:

- Claude Code.
- Codex.
- OpenClaw.
- Hermes.
- Generic command adapter.

The generic adapter should accept a command template, input file path, output file path, timeout, and working directory. It must be opt-in because arbitrary local command execution is sensitive.

### 4.4 VPS Self-Hosted Path

Target experience:

1. Operator deploys Sotto with Docker Compose and a reverse proxy.
2. Operator supplies app, worker, database, Redis, storage, and provider configuration.
3. Learners create or resume language courses.
4. The instance stays free of Sotto billing and commercial access controls.

Deployment success should be measured by learning activation, not signups:

- Placement completed.
- At least one course created.
- At least one class generated.
- At least one practice session or class submission completed.
- Memory graph has vocabulary or grammar nodes.

---

## 5. First-Run Product Flow

First-run should be short and learning-oriented:

1. **Connect runtime**: local self-hosted, VPS self-hosted, or existing hosted server.
2. **Choose generation**: one-key provider, local agent, or advanced separate providers.
3. **Choose speech**: explicit TTS and STT providers, including local Kokoro or Whisper paths when configured.
4. **Choose course**: native language, target language, and optional course note.
5. **Place learner**: run the placement test and create the course at the right CEFR level.
6. **Start learning**: begin the next class or choose ungated practice.

The setup UI should show a compact readiness checklist:

| Capability | Ready state |
|---|---|
| Database | Connected |
| Queue | Connected |
| Storage | Local or hosted provider selected |
| Learning LLM | Provider or local agent selected |
| TTS | Provider and voice selected |
| STT | Provider selected for speaking |
| Course | Language pair and placement complete |
| Memory | Graph ready for vocabulary and grammar |

Errors should name the missing capability and link to the exact settings section.

---

## 6. Source Workflows

### 6.1 Manual Topic Or URL

Current behavior: reframed as sourced classes, not podcast creation.

A learner can generate a class from a real article, paper, video link, or interest topic where the code path supports it. The class should be leveled to the learner's CEFR state, cite verified sources where available, and feed the same grammar, reading, listening, speaking, writing, and memory graph loop.

### 6.2 Agent Inbox

Current behavior: agent context is allowed only as private learning context, not as a briefing generator.

The active ingestion shape should support tools such as Claude Code, Codex, OpenClaw, Hermes, MCP, or custom agents sending learner-approved context into Sotto. That context can personalize a course or sourced class and can add vocabulary to the memory graph when appropriate.

Requirements:

- Token-authenticated.
- User-scoped.
- Private by default.
- Idempotency key support to avoid duplicates.
- No public distribution or episode feed semantics.

### 6.3 Meeting Ingestion

Removed from the active plan.

Meeting recap episodes, meeting roll-ups, and meeting-to-daily-briefing flows belonged to the old private audio briefing strategy. Do not document or build them as current behavior unless a future product decision reintroduces them as language-learning inputs with matching code, schema, tests, and user consent.

### 6.4 News Briefing

Removed from the active plan.

Scheduled news podcasts and world briefings belonged to the old private audio briefing strategy. They should not appear in current docs, tests, or pitch copy as Sotto behavior.

### 6.5 Generic Webhook

Removed from the active plan as a product workflow.

Generic webhook-to-episode automation belonged to the old briefing product. If external automation remains useful, it should target explicit learning endpoints or agent-context ingestion and stay private, user-scoped, and documented against current schema.

---

## 7. Architecture Work

### 7.1 Provider Profiles

Provider profiles remain important, but they serve learning capabilities:

```ts
type ProviderProfile = {
  id: string;
  label: string;
  llm: ExplicitProviderCapability;
  tts: ExplicitProviderCapability;
  stt?: ExplicitProviderCapability;
  requiredEnv: string[];
};
```

Profiles should be data, not conditionals scattered across routes. Resolvers should accept the selected profile and return either a concrete provider or a typed setup error.

### 7.2 Source Model

Do not add a broad old-style source model unless current implementation requires it.

Current learning inputs are:

- Placement.
- Course notes.
- Sourced class URL or topic.
- Agent context.
- Live conversation transcript.
- Practice, speaking, writing, and exam attempts.

Each input should have user ownership, privacy, validation, retention expectations, and a clear path into courses, classes, practice, exams, or memory.

### 7.3 Private Delivery

Learning delivery is the web/iPad course experience, not private RSS.

Current delivery surfaces:

- `/learn` course hub.
- `/learn/placement`.
- `/learn/class/[classId]`.
- `/learn/practice`.
- `/learn/exams`.
- `/memory`.
- worksheet pages and iPad PencilKit ink where enabled.
- mobile/iPad routes backed by the same `/api/v1` learning APIs.

Legacy audio routes can remain for the reused listening engine. Do not present RSS, public creator routes, or podcast feeds as the main product delivery layer.

### 7.4 Storage

Local storage must stay first-class for OSS. Hosted deployments can use S3/R2-compatible storage.

No worker should require cloud storage when `STORAGE_PROVIDER=local` is selected.

Storage must support:

- listening audio
- segment audio
- speaking recordings
- worksheets/PDFs
- generated media used by existing features

---

## 8. Testing Plan

Every stage should add guardrails:

- Unit tests for provider-profile and resolver behavior.
- API tests for placement, course creation, next-class, class submit, practice submit, exams, speaking upload, writing scoring, notes, and graph routes where code changes affect them.
- Worker tests for listening audio generation and speaking grading where those paths change.
- Component tests for first-run onboarding and learning dashboard changes.
- E2E smoke test for local onboarding when provider calls are mocked.
- OSS guard tests that fail if removed social, billing, plan, tier, quota, news, briefing, public-discovery, or podcast-platform product docs return.

Before every commit:

```bash
npm run ci
```

Known non-fatal build warnings should be documented only when they are unrelated to the change and the command exits successfully.

---

## 9. Release Plan

### Stage 1 - Release Consistency

- Replace stale docs.
- Update root agent guidance when product boundaries change.
- Keep presentation/release packet output aligned with language learning.
- Keep doc guard tests current.
- Commit once CI passes.

### Stage 2 - First-Run Onboarding

- Keep setup readiness focused on database, Redis, storage, LLM/local agent, TTS, STT, and course setup.
- Keep onboarding UI focused on runtime, provider, speech, course note, placement, and first class/practice.
- Add or update tests for readiness states when code changes.
- Commit once CI passes.

### Stage 3 - Provider Profiles

- Keep explicit provider-profile data or config modules aligned with current resolvers.
- Wire learning paths through `resolveLearningAi()`, `resolveTtsProvider()`, and `resolveSttProvider()`.
- Remove scattered provider assumptions when they appear.
- Add tests for missing credentials and capability mismatch.
- Commit once CI passes.

### Stage 4 - Agent Ingestion

- Keep agent ingestion private and learning-scoped.
- Do not route agent output into briefing or podcast-product surfaces.
- Add queue integration only when the learning workflow needs async processing.
- Add tests for auth, idempotency, and private course/memory effects.
- Commit once CI passes.

### Stage 5 - Meeting Ingestion

Removed from the active plan.

- Do not build meeting recap episodes.
- Do not document meeting roll-ups as current behavior.
- Revisit only with a new language-learning requirement, schema, and tests.

### Stage 6 - News Briefing

Removed from the active plan.

- Do not build scheduled news podcasts.
- Do not document world briefings as current behavior.
- Revisit only with a new language-learning requirement, schema, and tests.

### Stage 7 - Source Operations

Reframed as sourced-class and context operations.

- Keep sourced classes tied to course level, verified references, and memory extraction.
- Keep agent/context ingestion private and course-scoped.
- Add tests for unreadable sources, ownership, and citation/reference behavior when code changes.
- Commit once CI passes.

### Stage 8 - Self-Host Hardening

- Remove remaining hosted billing assumptions.
- Keep privacy independent from deployment topology.
- Keep local LLM, STT, and TTS documented and tested where possible.
- Add self-host regression tests when setup or deployment scripts change.
- Commit once CI passes.

---

## 10. Launch Checklist

- License file present.
- README quickstart tested on a fresh clone.
- `.env.oss.example` is complete.
- `npm run setup` works without Doppler.
- `npm run ci` passes.
- Placement works end to end.
- Course creation works end to end.
- At least one mastery-gated class works end to end.
- Listening audio works through the reused audio engine.
- Speaking upload and grading works where STT is configured.
- Writing scoring works where LLM is configured.
- Practice sessions update scores and memory.
- Mock exams are clearly marked as self-assessment and do not advance course level.
- Memory graph works end to end.
- At least one BYOK provider path works end to end.
- At least one local-agent path works end to end.
- No stale social-network, billing, plan, tier, quota, briefing, news, bot-workflow, or podcast-platform docs are included in the release packet.
- SECURITY.md or equivalent reporting guidance exists.
- Self-hosted language clearly keeps Sotto billing out of feature access.
