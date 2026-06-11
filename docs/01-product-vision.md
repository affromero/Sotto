# Product Vision - Sotto

> **Date**: 2026-05-15
>
> **Summary**: Sotto is private-first open source infrastructure for turning personal agents, meetings, sources, bots, and manual requests into owned audio briefings. The product is not a public podcast network and should not compete as a generic AI content wrapper. Its value is the private delivery layer, simple provider onboarding, and optional managed infrastructure for people who do not want to operate the stack themselves.

---

## 1. Thesis

People are increasingly tired of generic AI-generated content sold back to them as a product. A paid service that exists only to call a model, produce a synthetic conversation, and host the output is weak. The durable value is different:

- Give users private ownership of recurring audio workflows.
- Let technical users bring their own agents, models, TTS providers, storage, and hosting.
- Let non-technical users pay for managed infrastructure after a short trial.
- Keep the core product private by default and open source.
- Remove the public social layer completely.

Sotto should feel less like a content platform and more like a private audio operating system for the user's work and information streams.

---

## 2. Product Definition

Sotto turns structured input into private podcasts:

- Local agent outputs from Claude Code, Codex, OpenClaw, Hermes, or another assistant.
- Meeting recordings, transcripts, and notes.
- Manual topics and URLs.
- Imported audio that the user owns or has permission to process.
- Scheduled news digests for a separate "world briefing" podcast.
- Twitter, Telegram, or webhook events when self-hosted or managed.

The output is a private library plus private RSS delivery. The user can listen in Sotto or subscribe from any podcast app that accepts an authenticated RSS URL.

---

## 3. Product Boundaries

Sotto must keep these boundaries clear:

- Private by default. New episodes start private unless the user explicitly changes visibility.
- Private/unlisted access is not a paid feature.
- No public discovery feed.
- No follows, follower counts, likes, comments, forks, remix graph, or public activity ranking.
- No implicit provider fallback chains. Provider choice must be explicit and observable.
- No legacy social compatibility mode.
- No paid feature tiers, daily quotas, or billing gates.

These boundaries make the open source release credible. Reviewers should be able to scan the schema, API routes, docs, and tests and see the same product.

---

## 4. Why This Is Not A NotebookLM Wrapper

NotebookLM-style products usually start with documents and produce a one-off synthetic conversation. Sotto is useful when the audio is part of a recurring private workflow:

| Dimension | Notebook-style generator | Sotto |
|---|---|---|
| Starting point | Uploaded documents | Agents, meetings, bots, URLs, imports, news, manual topics |
| Cadence | One-off generation | Scheduled or event-driven briefings |
| Delivery | Product-specific playback or export | Private RSS owned by the user |
| Configuration | Vendor-managed model choices | Explicit local, BYOK, or managed provider selection |
| Privacy posture | Vendor workspace | Self-hosted or managed private workspace |
| Business model | Content generation product | Infrastructure, hosting, automation, and operations |

The goal is not to be "NotebookLM with a different UI." The goal is a private audio router that turns the user's existing information systems into listenable briefings.

---

## 5. Primary Users

### 5.1 Technical Self-Hosters

These users already run tools on a laptop, workstation, or VPS. They want Sotto because it gives them:

- A local-first app they can inspect and modify.
- A private RSS delivery path.
- Explicit model and TTS routing.
- Agent integrations that work with their existing CLI tools.
- Bot endpoints they can host on Hetzner, Fly, Render, or their own hardware.

Their ideal onboarding is: clone, run setup, add one provider key or local agent, create a private RSS token, subscribe in a podcast app.

### 5.2 AI-Experienced Knowledge Workers

These users understand API keys but do not want to maintain a full pipeline. They want:

- One-key setup when possible.
- Clear provider cost expectations.
- Private meeting and news briefings.
- No public sharing pressure.
- A dashboard that explains what is configured and what is missing.

Their ideal onboarding is: sign in, paste one key, choose a voice, generate a daily briefing, subscribe privately.

### 5.3 Non-Technical Users

These users want the outcome but not the infrastructure. They should be offered:

- Managed hosting with a short trial.
- Provider and storage managed by Sotto.
- Private RSS setup handled by the app.
- Simple cancellation and data export.

Charging here is defensible because the user is paying for operated infrastructure, monitoring, scheduled jobs, storage, bot hosting, and updates.

---

## 6. Core Workflows

### 6.1 Private Briefing Creation

The user provides a topic, URL, transcript, file, or agent output. Sotto extracts the important structure, writes an audio-native script, verifies references, generates audio, stitches the final episode, and places it in the private library.

### 6.2 Interactive Playback

The user can pause an episode and ask a contextual question. Sotto answers using the episode script, current timestamp, source material, and user settings. If the user chooses, the answer can be adapted into the episode so the private recording improves over time.

### 6.3 Private RSS

The user creates one or more private RSS tokens. Tokens are displayed once, stored only as hashes, and can be revoked. Podcast apps receive only the user's ready, non-deleted private and unlisted episodes.

### 6.4 Agent Ingestion

Agents can send summaries, logs, task outcomes, diffs, and links into Sotto. The user can route those inputs into a daily work briefing, a project-specific podcast, or an on-demand episode.

### 6.5 Meeting Ingestion

Sotto should allow a user to invite an agent or recorder to meetings. The transcript and action items can become a meeting recap episode and can also be rolled into the user's daily briefing.

### 6.6 World News Briefing

News should be a separate podcast stream from personal work. The user chooses sources and cadence. Sotto summarizes what happened in the world, cites source material, and avoids mixing public news with private meeting or agent content unless the user explicitly creates a combined briefing.

### 6.7 Bot Workflows

Twitter, Telegram, and webhook integrations should create private episodes for the owner. A self-hosted user can run the bot on their own VPS. A managed user can pay Sotto to host polling, webhooks, retries, and reply handling.

---

## 7. Onboarding Principles

Onboarding must aggressively reduce manual setup:

- The local path starts with `npm run setup`.
- The one-key path uses a single provider for LLM, TTS, and transcription when supported.
- The local-agent path detects available CLIs and explains only the missing pieces.
- The hosted path hides infrastructure choices during trial setup.
- Every setup screen should show exact missing requirements, not generic failure messages.
- Users should be able to create a private RSS token during first-run setup.

The first-run state should answer four questions:

1. Where will generation run?
2. Which provider or local agent is selected?
3. Where will audio be stored?
4. How will the user listen?

---

## 8. Operating Model

The open source product should be useful without paying Sotto. The default operating model is self-hosted BYOK:

- The operator hosts PostgreSQL, Redis, storage, web, and workers.
- Learners or operators provide provider keys for AI, speech, image, video, and avatar services.
- Sotto does not sell feature tiers, daily quota upgrades, or paid unlocks.
- Provider costs belong to the key owner and remain visible for operations, not monetization.

---

## 9. Success Criteria

The open source release is credible when:

- A technical user can run the app locally from the README without Doppler.
- A user can generate an episode with a single provider key.
- A user can use a local agent plus a TTS provider.
- A user can create and revoke private RSS tokens.
- Social schema tables, social routes, and social UI are absent.
- Docs and tests consistently describe the private-first product.
- Full generation features are available without Sotto billing or plan state.

Longer-term product success is visible when users keep recurring private audio streams connected after the novelty of generation wears off.
