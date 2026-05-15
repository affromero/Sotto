# Twitter Bot Integration - Private Sotto Sources

> **Date**: 2026-05-15
>
> **Summary**: Twitter/X integration should be an owner-scoped source that creates private Sotto episodes from bot commands. Self-hosted users can run it on their own VPS. Managed users can pay Sotto to operate polling, webhooks, retries, and replies. The bot must not recreate a public social layer inside Sotto.

---

## 1. Product Role

The Twitter bot is an input source, not a distribution strategy.

Supported use cases:

- "Turn this thread into a private briefing."
- "Summarize this URL as an episode."
- "Add this topic to my next daily briefing."
- "Generate a private episode from this mention."

Unsupported use cases:

- Ranking public episodes by external engagement.
- Publishing public Sotto feeds.
- Creating public comment or remix flows.
- Treating likes or reposts as Sotto product signals.

---

## 2. Deployment Modes

| Mode | Owner | Infrastructure |
|---|---|---|
| Local development | developer | local workers poll or process test fixtures |
| VPS self-hosted | user | user runs workers on Hetzner or equivalent |
| BYOK hosted | Sotto | Sotto runs bot infra, user supplies provider keys |
| Fully managed hosted | Sotto | Sotto runs bot infra and selected providers during/after trial |

The same code path should create private user-owned episodes in all modes.

---

## 3. Credentials

Twitter/X credentials change by API product and account configuration, so this doc intentionally avoids hard-coded plan assumptions. The integration needs credentials capable of:

- identifying the bot account
- reading owner-scoped commands or mentions
- posting optional replies as the bot account
- completing OAuth account linking when login/linking is enabled

Environment variables used by the current integration:

```env
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_BEARER_TOKEN=
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
TWITTER_SOTTO_USER_ID=
TWITTER_POLL_INTERVAL_MS=60000
```

Feature requirements:

| Feature | Required |
|---|---|
| account linking | OAuth client ID and secret |
| mention/command ingestion | bearer token and bot user ID |
| bot replies | API key/secret and access token/secret |
| full owner-scoped flow | all credentials above plus selected LLM and TTS providers |

---

## 4. Account Linking

Incoming Twitter events must resolve to a Sotto user before creating work.

Resolution order:

1. Match Twitter numeric user ID to a linked `Account` record.
2. Confirm the linked user has Twitter ingestion enabled.
3. Confirm the user has a selected generation provider and TTS provider.
4. Create a private source event.
5. Enqueue episode generation.

If no linked owner exists, ignore the event or reply with setup instructions depending on deployment settings. Do not create public orphan content.

---

## 5. Event Flow

```text
worker starts
  -> reads Twitter source config
  -> polls mentions or receives webhook event
  -> normalizes event
  -> resolves linked Sotto user
  -> validates selected providers
  -> creates source event with idempotency key
  -> enqueues private episode job
  -> optionally replies with status or private link
```

Idempotency key:

```text
twitter:<tweet-id>:<target-user-id>
```

The worker should store enough event metadata for debugging but avoid persisting unnecessary raw private messages.

---

## 6. Private Episode Rules

Twitter-created episodes must:

- belong to the linked Sotto user
- default to private visibility
- appear in the user's private library
- be eligible for the user's private RSS only when ready
- never increment social counters
- never create public activity events

Optional replies should respect user settings:

| Setting | Behavior |
|---|---|
| replies disabled | no public reply |
| status replies only | reply when accepted, ready, or failed |
| private link replies | reply with a link that still requires authorization or private token handling |

---

## 7. Provider Handling

Twitter generation uses the same explicit provider rules as manual creation:

- selected LLM or local agent for parsing and script generation
- selected TTS provider for audio
- selected STT provider only if media transcription is needed

Missing credentials should create a typed setup error on the source event. The worker should not choose another provider because another key exists.

---

## 8. Self-Hosted Setup

Self-hosted users need:

1. a running Sotto deployment
2. workers enabled
3. Twitter credentials
4. linked Sotto user account
5. selected LLM/local-agent provider
6. selected TTS provider
7. private RSS token if they want podcast-app delivery

Run workers:

```bash
npm run dev:workers
```

Production VPS deployments should run workers under the same process manager or Docker Compose stack as the web app.

---

## 9. Managed Hosting Setup

Managed hosting should hide infrastructure details:

1. user enables Twitter source
2. user connects Twitter account
3. user selects provider custody: BYOK or Sotto-managed
4. Sotto validates credentials
5. source appears in readiness checklist
6. trial creates a first private episode

Billing is for operated infrastructure and bot reliability:

- polling/webhook runtime
- retries
- queue operations
- storage
- provider custody if selected
- monitoring and support

---

## 10. Tests

Required tests:

- account linking required before event processing
- disabled Twitter source ignores events
- missing selected provider creates setup error
- idempotency prevents duplicate jobs
- created podcast defaults to private
- bot reply is skipped when replies are disabled
- worker does not read or write social counters

OSS guard tests should fail if Twitter thresholds depend on likes, public forks, comments, followers, or public rank.
