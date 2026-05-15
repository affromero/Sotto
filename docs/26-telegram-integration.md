# Telegram Bot Integration - Private Sotto Sources

> **Date**: 2026-05-15
>
> **Summary**: Telegram integration should let a linked user create private Sotto episodes from bot messages. It can run in local development, on a self-hosted VPS, or as a managed Sotto source. It must stay owner-scoped and private by default.

---

## 1. Product Role

The Telegram bot is an input source for private audio workflows.

Supported commands:

- create an episode from a topic
- summarize a URL
- add an item to a daily briefing
- start a short discovery exchange
- check generation status
- cancel the current session

The bot should not publish a public catalog or rank episodes.

---

## 2. Bot Setup

Create a bot with BotFather:

```text
/newbot
```

Recommended commands:

```text
start - Link your Sotto account
help - Show usage
cancel - Cancel current session
status - Check current generation
```

Environment variables:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_URL=
TELEGRAM_POLL_INTERVAL_MS=5000
```

Local development can use polling. Hosted production can use webhook mode when the deployment has a stable HTTPS URL.

---

## 3. Account Linking

Telegram events must resolve to a Sotto user before creating work.

Flow:

1. User sends `/start`.
2. Bot returns a short-lived link code or login URL.
3. User signs in to Sotto.
4. Sotto stores the Telegram account ID against the user.
5. Future Telegram messages resolve to that user.

If the account is not linked, the bot should send setup instructions and should not create content.

---

## 4. Event Flow

```text
Telegram update
  -> normalize message
  -> resolve linked Sotto user
  -> validate source is enabled
  -> validate selected provider profile
  -> create idempotent source event
  -> enqueue private episode job
  -> send status message
```

Idempotency key:

```text
telegram:<chat-id>:<message-id>:<user-id>
```

Messages with attached audio can route to transcription only when an STT provider is explicitly selected.

---

## 5. Private Episode Rules

Telegram-created episodes must:

- belong to the linked Sotto user
- default to private visibility
- appear in the user's private library
- become available through that user's private RSS only when ready
- never create public discovery records
- never increment public engagement counters

The bot can return an in-app link, private RSS instructions, or a status-only reply depending on user settings.

---

## 6. Provider Handling

Telegram source generation uses the same explicit provider rules:

- selected LLM or local agent for parsing and script generation
- selected TTS provider for audio
- selected STT provider for voice messages or audio attachments

Missing credentials should create a typed setup error visible in source status. The bot can message the user with the missing capability.

---

## 7. Self-Hosted Operation

Self-hosted users need:

1. running Sotto web app
2. running Sotto workers
3. Telegram bot token
4. linked account
5. selected LLM/local-agent provider
6. selected TTS provider
7. private RSS token if they want podcast-app delivery

Run workers locally:

```bash
npm run dev:workers
```

Production VPS deployments should run the Telegram worker alongside the rest of the worker stack.

---

## 8. Managed Operation

Managed hosting should make Telegram setup a short source-connection flow:

1. user enables Telegram source
2. Sotto shows bot link and setup code
3. user links account
4. Sotto validates provider profile
5. source appears in readiness checklist
6. first message creates a private episode

Billing covers operated bot infrastructure, retries, worker runtime, storage, monitoring, and support.

---

## 9. Tests

Required tests:

- unlinked Telegram message does not create work
- linked message creates owner-scoped private source event
- duplicate update does not enqueue duplicate job
- missing selected provider returns setup error
- voice message requires explicit STT provider
- disabled source ignores messages
- bot reply mode respects user settings
