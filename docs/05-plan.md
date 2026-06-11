# Plan - Private-First Open Source Sotto

> **Date**: 2026-05-15
>
> **Summary**: This is the implementation plan for turning Sotto into a private-first open source product with simple onboarding, explicit provider routing, private RSS delivery, local-agent support, meeting ingestion, news briefings, and bot workflows.

---

## 1. Goal

Release Sotto as open source infrastructure that lets users keep lessons private while connecting their own agents, sources, and providers.

The product should support self-hosted paths:

1. **Local OSS**: self-host locally with `npm run setup`, local PostgreSQL, local Redis, local storage, and a provider key or local agent.
2. **VPS self-hosted**: deploy on a Hetzner-style VPS with Docker Compose and Caddy.

The first release should be credible without managed infrastructure or Sotto billing.

---

## 2. Non-Negotiables

- Privacy is default behavior, not a paid upgrade.
- No public social layer.
- No compatibility code for removed social features.
- No implicit provider fallback chains.
- No manual multi-page setup as the only onboarding path.
- No hosted-only assumptions in the OSS quickstart.
- No docs that describe removed product surfaces as current.
- Every refactor stage must include tests or guardrails.

Provider selection must be explicit. If a selected provider is missing credentials, the app should fail with a precise configuration error and a setup action.

---

## 3. Current State

Completed in this refactor:

- Private RSS token model and API exist.
- New podcasts and imports default to private.
- Local storage is the default storage provider.
- Doppler is no longer required for default local dev.
- Public feed routes and API have been removed.
- Like, comment, fork, follow, activity, collection-follow, and vote tables have been removed.
- Social counters and social export payloads have been removed.
- Social demo and automation harness flows have been removed.
- OSS guard tests cover major private-first surfaces.

Remaining release work:

- Finalize open source license.
- Finish first-run onboarding for provider selection and private RSS setup.
- Add local-agent ingestion endpoints and CLI docs.
- Add meeting ingestion.
- Add scheduled news briefings.
- Harden bot hosting around private episode creation.
- Replace stale release docs and presentation tooling.

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

1. User selects "OpenAI only" or another supported one-key profile.
2. User pastes one key.
3. App configures LLM, TTS, and STT to that provider where supported.
4. App validates the provider profile with a small health check.
5. User creates first private episode.

Implementation requirements:

- Add provider-profile presets backed by explicit config.
- Store provider choice in the same settings path used by existing resolvers.
- Show missing capability errors when a selected profile cannot do a task.
- Do not silently move to another provider when one capability fails.

### 4.3 Local-Agent Path

Target experience:

1. User selects a local agent profile.
2. App detects whether the CLI exists.
3. App shows auth status and the exact command needed when auth is missing.
4. User selects TTS provider separately.
5. Generation uses the selected local agent for script work.

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
3. Learners create or schedule their first briefing.
4. The instance stays free of Sotto billing and commercial access controls.

Deployment success should be measured by workflow activation, not signups:

- Private RSS token created.
- At least one ready episode.
- At least one recurring source or webhook connected.

---

## 5. First-Run Product Flow

First-run should be short and operational:

1. **Choose runtime**: local self-hosted or VPS self-hosted.
2. **Choose generation**: one-key provider, local agent, or advanced separate providers.
3. **Choose voice/TTS**: explicit provider and voice profile.
4. **Choose delivery**: create private RSS token or continue with in-app listening.
5. **Create first source**: manual topic, agent inbox, meeting, news, or webhook.

The setup UI should show a compact readiness checklist:

| Capability | Ready state |
|---|---|
| Database | Connected |
| Queue | Connected |
| Storage | Local or hosted provider selected |
| Generation | Provider or local agent selected |
| TTS | Provider and voice selected |
| RSS | Token created or skipped |

Errors should name the missing capability and link to the exact settings section.

---

## 6. Source Workflows

### 6.1 Manual Topic Or URL

This is the simplest creation path and should remain the smoke test for the pipeline. It verifies generation, TTS, storage, database writes, private library, and private RSS.

### 6.2 Agent Inbox

Add an authenticated ingestion endpoint for agents:

```http
POST /api/v1/ingest/agent
```

Payload:

```json
{
  "source": "claude-code",
  "project": "sotto",
  "title": "Daily engineering update",
  "summary": "What changed and what needs attention",
  "items": [
    {
      "type": "commit",
      "title": "Remove social schema",
      "url": "https://example.local/commit"
    }
  ]
}
```

Requirements:

- Token-authenticated.
- User-scoped.
- Private episode by default.
- Optional project-level podcast stream.
- Idempotency key support to avoid duplicates.

### 6.3 Meeting Ingestion

Add a meeting source that accepts uploaded audio, uploaded transcript, or an invited recorder integration.

Outputs:

- Meeting recap episode.
- Action items.
- Decisions.
- Open questions.
- Optional roll-up into the daily work briefing.

Privacy rules:

- Meeting sources are private-only by default.
- Raw recordings and transcripts must be deletable.
- Generated summaries must retain source references where possible.

### 6.4 News Briefing

Add a separate scheduled news podcast. It should not mix with personal work unless explicitly configured.

Requirements:

- User-selected sources.
- Cadence control.
- Citation/reference tracking.
- Clear source timestamp.
- Option to create separate categories such as world, technology, finance, or local.

### 6.5 Generic Webhook

Add a generic webhook source for GitHub Actions, calendar systems, support tools, and custom automation.

Requirements:

- Per-source token.
- Signature validation when supported by the caller.
- Idempotency key.
- Rate limits.
- Structured payload normalization.

---

## 7. Architecture Work

### 7.1 Provider Profiles

Create explicit provider profiles:

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

Add a source abstraction only when needed by implementation:

- Manual.
- Agent.
- Meeting.
- News.
- Webhook.

Each source should have user ownership, status, cadence, last run, and error state.

### 7.3 Private Delivery

Private RSS remains the core delivery primitive:

- Token shown once.
- Token hash stored in database.
- Revocation supported.
- Episode eligibility scoped to owner and ready status.
- No public creator RSS routes.

### 7.4 Storage

Local storage must stay first-class for OSS. Hosted deployments can use S3/R2-compatible storage.

No worker should require cloud storage when `STORAGE_PROVIDER=local` is selected.

---

## 8. Testing Plan

Every stage should add guardrails:

- Unit tests for provider-profile resolution.
- API tests for private RSS token creation, listing, and revocation.
- API tests for agent ingestion auth and idempotency.
- Worker tests for source-to-episode job creation.
- Component tests for first-run onboarding.
- E2E smoke test for local one-key onboarding when provider calls are mocked.
- OSS guard tests that fail if removed social routes, schema tables, or docs return.

Before every commit:

```bash
npm run ci
```

Known non-fatal build warnings should be documented only when they are unrelated to the change and the command exits successfully.

---

## 9. Release Plan

### Stage 1 - Release Consistency

- Replace stale docs.
- Update root agent guidance.
- Update presentation/release packet script.
- Add doc guard tests.
- Commit once CI passes.

### Stage 2 - First-Run Onboarding

- Add setup readiness model.
- Add onboarding UI for runtime, provider, TTS, and private RSS.
- Add tests for readiness states.
- Commit once CI passes.

### Stage 3 - Provider Profiles

- Add explicit provider-profile data model or config module.
- Wire existing resolvers to profile selection.
- Remove scattered provider assumptions.
- Add tests for missing credentials and capability mismatch.
- Commit once CI passes.

### Stage 4 - Agent Ingestion

- Add agent source token model if needed.
- Add `/api/v1/ingest/agent`.
- Add queue integration.
- Add tests for auth, idempotency, and private episode creation.
- Commit once CI passes.

### Stage 5 - Meeting Ingestion

- Add transcript/audio upload path.
- Add meeting recap prompt and worker path.
- Add raw-source retention/deletion controls.
- Add tests.
- Commit once CI passes.

### Stage 6 - News Briefing

- Add source list, cadence, and scheduled job.
- Add citation-preserving prompt.
- Add tests for source isolation and generated private episodes.
- Commit once CI passes.

### Stage 7 - Source Operations

- Add self-hosted deployment docs.
- Add self-hosted operations controls.
- Add tests.
- Commit once CI passes.

### Stage 8 - Self-Host Hardening

- Remove remaining hosted billing assumptions.
- Keep privacy independent from deployment topology.
- Add self-host regression tests.
- Commit once CI passes.

---

## 10. Launch Checklist

- License file added.
- README quickstart tested on a fresh clone.
- `.env.oss.example` is complete.
- `npm run setup` works without Doppler.
- `npm run ci` passes.
- Private RSS works end to end.
- Local storage works end to end.
- At least one BYOK provider path works end to end.
- At least one local-agent path works end to end.
- No stale social-network docs are included in the release packet.
- SECURITY.md or equivalent reporting guidance exists.
- Self-hosted language clearly keeps Sotto billing out of feature access.
