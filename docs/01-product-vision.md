# Product Vision - Sotto

> **Date**: 2026-05-15
>
> **Summary**: Sotto is free, open-source, self-hostable language-learning infrastructure. Learners bring their own agent, keys, and context, then work through mastery-gated CEFR courses across grammar, reading, adaptive listening, speaking, and writing. Its value is learner progress, data ownership, explicit provider control, and a private vocabulary memory graph, not generic AI content generation, billing gates, or social discovery.

---

## 1. Thesis

Most serious language-learning products are closed, hosted, and subscription-funded. The learner's progress, vocabulary, recordings, and teaching model live on someone else's servers. Sotto inverts that:

- Give learners ownership of the learning stack, progress data, vocabulary graph, audio, and recordings.
- Let technical users bring their own Claude Code, Codex, OpenClaw, Hermes, local models, TTS, STT, storage, and hosting.
- Make the core product free, open source, self-hostable, and useful without any Sotto billing path.
- Use mastery-gated CEFR progression, spaced repetition, adaptive listening, speaking feedback, and writing correction as the core loop.
- Keep social primitives out of the product completely.

Sotto should feel less like a content platform and more like a private language tutor running on infrastructure the learner controls.

---

## 2. Product Definition

Sotto teaches a language in the learner's own context:

- A placement test assigns the starting CEFR level for a native-language to target-language course.
- Mastery-gated classes cover grammar, reading, adaptive listening, speaking, and writing.
- Ungated practice lets a learner drill one skill without advancing the course.
- Mock exams provide self-assessment modeled on the format of flagship CEFR exams where available.
- Course notes, learner interests, sourced class inputs, and agent-provided context personalize lessons.
- A course-scoped memory graph tracks vocabulary and grammar with SM-2 spaced repetition.
- The audio engine is reused for adaptive listening lessons and spoken reference audio.

The output is progress through a private course and a memory graph the learner owns. Sotto can run locally, on a VPS, or on managed infrastructure if that product surface exists, but the self-hosted build remains free and fully featured.

---

## 3. Product Boundaries

Sotto must keep these boundaries clear:

- Free and self-hostable by default. Full learning features are not gated by plans, tiers, quotas, or payment state.
- BYOK and local-agent operation are first-class. Provider choice must be explicit and observable.
- No public discovery feed.
- No follows, follower counts, likes, comments, forks, remix graph, leaderboards, community rank, or public activity ranking.
- No implicit provider fallback chains. If the selected provider is missing credentials or capability, show a precise setup error.
- No legacy social compatibility mode.
- No podcast-platform, briefing, news-digest, or creator-network positioning as current behavior.

These boundaries make the open source release credible. Reviewers should be able to scan the README, schema, API routes, docs, and tests and see the same language-learning product.

---

## 4. Why This Is Not A Generic AI Tutor Wrapper

Generic AI tutor products usually start with a chat box and leave the learner to manage structure, recall, level, and review. Sotto is useful because the language-learning loop is explicit and durable:

| Dimension | Generic AI tutor | Sotto |
|---|---|---|
| Starting point | Open-ended chat prompt | Placement into a native-language to target-language course |
| Progression | User asks for the next thing | Mastery-gated CEFR class sequence |
| Skills | Whatever the chat covers | Grammar, reading, adaptive listening, speaking, and writing |
| Review | Manual or ad hoc | Course-scoped vocabulary and grammar memory graph |
| Audio | Optional generated clip | Reused audio engine for adaptive listening and pronunciation support |
| Configuration | Vendor-managed model choices | Explicit local, BYOK, or configured provider selection |
| Privacy posture | Hosted vendor workspace | Self-hosted or learner-controlled workspace |
| Business model | Subscription or usage gates | Free OSS self-hosting; provider costs belong to the key owner |

The goal is not to be "chat with a language model." The goal is a self-hostable learning system that turns the learner's own context into structured practice and measurable progress.

---

## 5. Primary Users

### 5.1 Technical Self-Hosters

These users already run tools on a laptop, workstation, or VPS. They want Sotto because it gives them:

- A local-first app they can inspect and modify.
- A full language-learning loop without a hosted subscription.
- Explicit LLM, TTS, and STT routing.
- Local-agent integrations that work with their existing CLI tools.
- A course, practice, exam, and memory graph system they can keep on their own hardware.

Their ideal onboarding is: run the installer or source setup, connect one provider key or local agent, choose a language pair, take placement, and start the first class.

### 5.2 AI-Experienced Learners

These users understand API keys but do not want to assemble a learning system from scratch. They want:

- One-key or clearly separated BYOK setup for LLM, TTS, and STT.
- Clear provider readiness and setup errors.
- A course that adapts to their goals, work, interests, and current level.
- Speaking and writing feedback without giving up ownership of recordings or progress.
- No public sharing pressure, streak manipulation, or leaderboard dynamics.

Their ideal onboarding is: sign in, add the needed keys or local agent, take placement, add a short course note, and begin a class or practice session.

### 5.3 Household And Non-Technical Learners

These users want the outcome but not the operational details. They should be offered:

- A simple first-run flow on an existing self-hosted instance.
- Owner-managed household invites where each learner's courses, keys, progress, and memory graph stay isolated.
- Web and iPad access to the same course data.
- Clear data export and deletion paths.

No user should need a paid plan to unlock privacy or the full learning loop in the self-hosted product.

---

## 6. Core Workflows

### 6.1 Placement And Course Creation

The learner chooses a native language and target language. Sotto generates or serves placement questions, scores the result, creates a `Course`, stores the `PlacementResult`, and sets the starting CEFR level.

### 6.2 Mastery-Gated Classes

The learner starts the next class in the course sequence. Sotto instantiates a `CourseClass` from the curriculum and generates grammar, reading, listening, speaking, and writing sections. The learner advances only after demonstrating mastery. Failed sections regenerate in a similar-but-not-identical form.

### 6.3 Adaptive Listening

The listening section reuses the existing audio-generation engine: content specification, script generation, script verification, reference validation where applicable, TTS generation, stitching, and playback. Listening lessons are seeded by the lesson objective and weak or due vocabulary from the memory graph.

### 6.4 Speaking And Writing Feedback

Speaking prompts capture learner recordings, run STT, and return pronunciation feedback through the configured STT and scoring path. Writing prompts are graded synchronously by the resolved learning LLM and return inline corrections, feedback, and a score.

### 6.5 Memory Graph And Ungated Practice

Classes and practice sessions update a course-scoped graph of vocabulary and grammar. Due items drive SM-2 review, seed listening lessons, and appear in ungated practice sessions for vocabulary, grammar, reading, listening, speaking, and writing.

### 6.6 Practice Exams

Mock exams are self-assessment only. They are modeled on available flagship exam formats for the target language or on a generic CEFR structure. They return a mock band and feedback but never advance the learner's course level.

### 6.7 Contextual Inputs

Sotto can personalize learning with course notes, interests, sourced class inputs, and agent-provided context. Those inputs should feed course generation and memory extraction, not create public content streams.

---

## 7. Onboarding Principles

Onboarding must aggressively reduce manual setup:

- The local path starts with the installer or `npm run setup`.
- The BYOK path uses explicit provider choices for LLM, TTS, and STT.
- The local-agent path detects available CLIs and explains only the missing pieces.
- The first learning action should be placement or resuming an existing course.
- Every setup screen should show exact missing requirements, not generic failure messages.
- No onboarding step should introduce billing, plans, quotas, public sharing, or social ranking.

The first-run state should answer five questions:

1. Which native and target languages will this learner use?
2. Where will generation run?
3. Which provider or local agent is selected?
4. Which TTS and STT providers are selected?
5. What course note or context should personalize the first class?

---

## 8. Operating Model

The open source product should be useful without paying Sotto. The default operating model is self-hosted BYOK:

- The operator hosts PostgreSQL, Redis, storage, web, and workers.
- Learners or operators provide provider keys for AI, speech, image, video, and related services when those features need external providers.
- Local LLM, STT, and TTS paths can run without cloud keys when explicitly configured.
- Sotto does not sell feature tiers, daily quota upgrades, generation credits, or paid unlocks.
- Provider costs belong to the key owner and remain visible for operations, not monetization.

---

## 9. Success Criteria

The open source release is credible when:

- A technical user can run the app locally from the README without Doppler.
- A learner can take placement and start a course for a language pair.
- A learner can complete or retry a mastery-gated class across the five skills.
- Listening sections use the reused audio engine without presenting Sotto as a podcast platform.
- Speaking, writing, practice, exams, notes, and the memory graph are documented as current behavior where they exist.
- BYOK and local-agent setup errors are explicit.
- Social schema tables, social routes, social UI, billing gates, plans, tiers, and quota language are absent from the current product docs.
- Full learning features are available without Sotto billing or plan state.

Longer-term product success is visible when learners keep returning because the memory graph, mastery gates, and contextual lessons measurably help them progress.
