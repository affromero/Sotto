# Telegram @SottoFMBot Integration

> **Date**: 2026-02-15
>
> **Summary**: Zero-to-hero guide for the @SottoFMBot Telegram bot. Users message the bot with a topic to generate a podcast automatically — either in one shot (specific topic) or via multi-turn discovery chat (vague topic). Covers BotFather setup, environment variables, account linking, the full pipeline, and troubleshooting.

---

## Overview

Sotto's Telegram integration lets any user with a linked account message **@SottoFMBot** to generate a podcast:

```
User: Make a podcast about the economics of space tourism
Bot: Ready to generate your podcast!
     Topic: The economics of space tourism
     Depth: standard | Audience: intermediate | Tone: casual
     [Generate Podcast]  [Edit Settings]
```

If the topic is vague, the bot enters a multi-turn discovery conversation — asking follow-up questions with tappable chip buttons — before presenting a confirmation.

When the podcast is ready, the bot sends a "Listen Now" button that links directly to sotto.fm.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Telegram account** | Any Telegram account for the bot (managed by [@BotFather](https://t.me/BotFather)) |
| **Workers running** | `npm run dev:workers` or `npm run dev` — polling starts at worker boot |
| **AI key** | Platform `ANTHROPIC_API_KEY`, or user BYOK key, or `AI_PROVIDER=claude-code` |
| **TTS key** | Platform `ELEVENLABS_API_KEY`, or user BYOK TTS key |
| **Redis running** | Required for session state, cursor tracking, and link codes |

---

## Step 1: Create a Telegram Bot via BotFather

### 1a. Start a chat with BotFather

1. Open Telegram and search for **@BotFather** (or go to [t.me/BotFather](https://t.me/BotFather))
2. Send `/newbot`
3. When prompted for a name, enter: `Sotto FM`
4. When prompted for a username, enter: `SottoFMBot` (must end in `Bot` and be globally unique)
5. BotFather replies with your **bot token** — save this, it's your `TELEGRAM_BOT_TOKEN`

The token looks like: `7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 1b. Configure the bot profile

Send these commands to @BotFather:

```
/setdescription
```
> Generate AI podcasts from any topic. Send me a message and I'll create a 2-voice conversational podcast for you.

```
/setabouttext
```
> The open podcast network — sotto.fm

```
/setuserpic
```
> Upload the Sotto logo (or any bot avatar)

```
/setcommands
```
> Paste:
> ```
> start - Link your Sotto account
> cancel - Cancel the current session
> help - Show usage instructions
> ```

This registers the bot's command menu so users see autocomplete when they type `/`.

### 1c. (Optional) Set bot privacy

By default, bots in groups only receive messages that mention them or start with `/`. For Sotto's bot, which works in private chats, the default privacy setting is fine. No changes needed.

---

### 1d. Create a dev bot (recommended)

Telegram's `getUpdates` only works with **one consumer per bot token**. If both local dev and production poll with the same token, they'll race for updates and messages will be split randomly.

Create a second bot for local development:

1. Send `/newbot` to @BotFather again
2. Name: `Sotto FM Dev`
3. Username: `SottoFMDevBot`
4. Save the token — this is your local `TELEGRAM_BOT_TOKEN`

| Bot | Username | Environment |
|---|---|---|
| **Production** | `@SottoFMBot` | sotto.fm server `.env` |
| **Development** | `@SottoFMDevBot` | local `.env` |

---

## Step 2: Configure Environment Variables

Add the **dev bot** token to your local `.env`:

```env
# ── Telegram @SottoFMDevBot (local dev) ──
TELEGRAM_BOT_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── Optional: polling interval (default 35s — 30s long poll + 5s buffer) ──
# TELEGRAM_POLL_INTERVAL_MS=35000
```

On the production server, set the **production bot** token instead.

That's it — only one variable is required. Compare this to Twitter's 8 variables.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Authenticates all Bot API calls |
| `TELEGRAM_POLL_INTERVAL_MS` | No | `35000` | Interval between polling jobs (ms) |

---

## Step 3: Start Workers and Verify Polling

```bash
# Start everything (web + workers)
npm run dev

# Or start workers only
npm run dev:workers
```

On startup, the worker orchestrator calls `isTelegramBotConfigured()` (checks `TELEGRAM_BOT_TOKEN`). If configured, it schedules a repeatable BullMQ job on the `telegram-bot` queue. Look for these lines in worker logs:

```
Telegram bot polling scheduled (intervalMs: 35000)
```

The polling worker uses Telegram's long polling: each request blocks for up to 30 seconds waiting for new messages, then returns. The 35-second BullMQ interval (30s poll + 5s buffer) prevents job queue buildup.

---

## Step 4: Link Your Telegram Account to Sotto

The bot matches incoming messages to Sotto users by looking up the Telegram user ID in the `Account` table. Without this link, the bot tells the user to run `/start`.

### Linking flow

1. Open a chat with @SottoFMBot in Telegram
2. Send `/start`
3. The bot replies with a **"Connect to Sotto"** URL button
4. Tap the button — it opens `sotto.fm/connect/telegram?code=<random-hex>`
5. If not logged in, you'll be redirected to the Sotto login page first
6. You'll see a confirmation page showing your Telegram name and Sotto account
7. Click **"Connect Account"**
8. The bot sends a confirmation: "Account connected! Send me a topic to generate a podcast."

### Under the hood

1. `/start` generates a random 32-character hex code
2. Stored in Redis: `telegram:link:<code>` → `{ telegramUserId, chatId, firstName }` (10-minute TTL)
3. User clicks the URL button → opens the web confirmation page (server component)
4. Page validates the code against Redis and shows the confirmation UI
5. Clicking "Connect" calls `POST /api/connect/telegram` which:
   - Creates an `Account` record: `{ provider: 'telegram', providerAccountId: <telegramUserId> }`
   - Sets `user.telegramEnabled = true`
   - Deletes the Redis link code
   - Sends a confirmation message to the Telegram chat

### Verify the link

```bash
# Open Prisma Studio
npx prisma studio --schema=apps/web/prisma/schema.prisma
```

Check the `Account` table for a record where:
- `provider` = `telegram`
- `providerAccountId` = your Telegram numeric user ID
- `userId` = your Sotto user ID

Also check the `User` table: `telegramEnabled` should be `true`.

---

## Step 5: Ensure AI + TTS Keys Are Available

The pipeline needs both an AI provider and a TTS provider.

| Provider | Options |
|---|---|
| **AI** | Platform `ANTHROPIC_API_KEY` in env, user BYOK key, or `AI_PROVIDER=claude-code` |
| **TTS** | Platform `ELEVENLABS_API_KEY` in env, or user BYOK TTS key |

If AI is missing: the bot replies with "You need to add an AI API key in your Sotto settings" and a link to the settings page.

If TTS is missing: the pipeline fails at audio generation and the bot replies with a failure message.

---

## Step 6: Generate a Podcast

### Option A: Direct topic (single message)

Send a specific, detailed topic:

```
Make a podcast about the history of the Silk Road trade routes,
focusing on cultural exchange between China and Rome
```

The bot's intent parser (Claude) determines this is **complete enough** to generate immediately. It shows a confirmation screen with extracted metadata and `[Generate Podcast]` / `[Edit Settings]` buttons.

### Option B: Discovery conversation (multi-turn)

Send a vague topic:

```
I want to learn about AI
```

The bot enters a **discovery session** — it asks follow-up questions with tappable chip buttons:

```
Bot: Interesting! What aspect of AI are you most curious about?
     [Machine Learning Basics]  [AI Ethics]
     [Neural Networks]          [AI in Healthcare]
```

You can tap a chip or type a free-text answer. The conversation continues until the bot has enough context (topic, depth, audience, tone), then it shows the confirmation screen.

### After confirmation

1. Tap **"Generate Podcast"**
2. The bot edits the message to "Generating your podcast... This may take a few minutes."
3. The full pipeline runs: content extraction → script generation → verification → audio generation → stitching
4. When complete, the bot sends: `Your podcast is ready! "Title" (X min)` with a **[Listen Now]** URL button

### Editing settings before generating

Tap **"Edit Settings"** on the confirmation screen to change:
- **Depth**: Quick Overview / Standard / Deep Dive
- **Tone**: Casual / Professional / Socratic

Tap a setting button to change it, then "Back to Confirmation" to return and generate.

---

## How It Works (Full Pipeline)

```
1. User messages @SottoFMBot: "Make a podcast about quantum computing"

2. telegram-bot worker polls Telegram Bot API
   POST /getUpdates (long poll, timeout=30s)
   ↓
3. Cursor check: offset = last_update_id + 1 (stored in Redis)
   ↓
4. Account lookup: find Sotto user by Telegram user ID
   - Not found → "Link your account first. Send /start"
   - Found but telegramEnabled=false → "Integration disabled"
   - Found but no AI key → "Add an AI key in settings"
   ↓
5. Parse intent via Claude → determines if topic is complete
   - Complete → show confirmation screen
   - Incomplete → start discovery session (multi-turn)
   ↓
6. User taps [Generate Podcast]
   ↓
7. Create TelegramMessage record (status: GENERATING)
   Create Podcast (source: TELEGRAM, visibility: PUBLIC)
   Create Discovery (metadata from session)
   ↓
8. Queue EXTRACT_CONTENT job → full pipeline runs automatically:
   content-extraction → script-generation → script-verification →
   reference-validation → audio-generation (parallel) → audio-stitching

   KEY: Telegram-source podcasts skip the SCRIPT_READY pause
   (no manual script review — auto-approved, same as Twitter)
   ↓
9. audio-stitching worker detects source=TELEGRAM
   Updates TelegramMessage (status: READY)
   Queues REPLY_TELEGRAM job
   ↓
10. telegram-reply worker sends:
    "Your podcast is ready! "Quantum Computing" (10 min)"
    [Listen Now] → sotto.fm/podcast/{id}
    Updates TelegramMessage (status: REPLIED)
```

### TelegramMessage Status Flow

```
PENDING ──→ DISCOVERING ──→ GENERATING ──→ READY ──→ REPLIED ✓
   │              │              │            │
   └──────────────┴──────────────┴────────────┴──→ FAILED ✗
                                                   IGNORED (disabled/no key)
```

### Redis Keys

| Key | TTL | Purpose |
|---|---|---|
| `telegram:last_update_id` | None | Cursor for getUpdates polling (highest processed update_id) |
| `telegram:session:<chatId>` | 1 hour | Active discovery session (messages, metadata, state) |
| `telegram:link:<code>` | 10 min | Account linking code → `{ telegramUserId, chatId, firstName }` |

---

## Testing Without a Real User

### Option A: Message the bot directly (simplest)

Since you own the bot and have a linked account:

1. Open @SottoFMBot in Telegram
2. Send: `Make a podcast about the history of jazz`
3. Wait for the confirmation screen → tap Generate Podcast
4. Watch worker logs for pipeline progress

### Option B: Simulate an update via BullMQ (no Telegram needed)

Bypass the Telegram API entirely by inserting a fake update into Redis for the polling worker to process. This is useful for CI or automated testing.

The polling worker reads from the Telegram API directly, so to truly skip Telegram you'd need to mock the API. Instead, it's easier to just message the bot from any Telegram account.

### Monitor progress

```bash
# Watch worker logs (if running via npm run dev, logs appear in terminal)

# Or open Prisma Studio
npx prisma studio --schema=apps/web/prisma/schema.prisma
```

In Prisma Studio, check:

| Table | What to look for |
|---|---|
| `TelegramMessage` | Status progression: GENERATING → READY → REPLIED |
| `Podcast` | New podcast with `source: TELEGRAM`, check `status` field |
| `Segment` | Audio segments being created as TTS completes |

---

## Key Implementation Files

| File | Purpose |
|---|---|
| `src/lib/telegram.ts` | Telegram Bot API client: `getUpdates()`, `sendMessage()`, `answerCallbackQuery()`, `editMessageText()`, `isTelegramBotConfigured()` |
| `src/lib/telegram-parser.ts` | Claude-powered intent extraction: topic, title, depth, tone, `isComplete` flag |
| `src/types/telegram.ts` | TypeScript types for Telegram API payloads, sessions, parse results |
| `src/workers/telegram-bot.worker.ts` | Polls updates, routes messages, manages discovery sessions, creates podcasts |
| `src/workers/telegram-reply.worker.ts` | Sends "Listen Now" reply (or failure message) when pipeline completes |
| `src/workers/audio-stitching.worker.ts` | Queues `REPLY_TELEGRAM` job after successful stitching (lines 274-290) |
| `src/workers/index.ts` | Registers telegram-bot + telegram-reply workers, schedules polling |
| `src/app/connect/telegram/page.tsx` | Account linking confirmation page (server component) |
| `src/app/connect/telegram/ConnectForm.tsx` | "Connect Account" button (client component) |
| `src/app/api/connect/telegram/route.ts` | API route: validates link code, creates Account record |
| `src/lib/validations.ts` | `telegramConnectSchema` for the POST body |
| `src/middleware.ts` | `/connect/telegram` added to `PUBLIC_ROUTES` |

All paths are relative to `apps/web/`.

---

## Differences from Twitter Integration

| Aspect | Twitter | Telegram |
|---|---|---|
| **Credentials** | 8 env vars (OAuth 1.0a + 2.0 + Bearer) | 1 env var (`TELEGRAM_BOT_TOKEN`) |
| **Cost** | $100/mo (Basic tier for mentions API) | Free (Bot API is free) |
| **Account linking** | OAuth 2.0 redirect (NextAuth) | Custom link-code flow via Redis |
| **Interaction** | Single tweet, no follow-up | Multi-turn discovery with chip buttons |
| **Message format** | Plain text (280 chars) | Markdown + inline keyboards |
| **Polling** | 60s interval, mentions endpoint | 35s interval, long polling (30s blocks) |
| **Discovery** | Parse only — no conversational flow | Full multi-turn with `getDiscoveryResponse()` |
| **Duration** | Fixed 10 min | Configurable via discovery (default 10 min) |
| **Settings edit** | Not possible (tweet is fire-and-forget) | Inline keyboard for depth/tone before generating |

---

## Bot Commands Reference

| Command | What it does |
|---|---|
| `/start` | Generates a link code and sends a "Connect to Sotto" URL button |
| `/cancel` | Clears the active discovery session for this chat |
| `/help` | Shows usage instructions and tips |

---

## Troubleshooting

### Bot doesn't respond to messages

| Check | Action |
|---|---|
| Workers running? | `npm run dev:workers` — look for "Telegram bot polling scheduled" in logs |
| Token correct? | Verify `TELEGRAM_BOT_TOKEN` in `.env.local` matches BotFather's output |
| Redis running? | `docker-compose up -d` — polling uses Redis for cursor tracking |
| Bot exists? | Message @SottoFMBot in Telegram — if it doesn't exist, create it via BotFather |

### Bot responds but doesn't generate

| Check | Action |
|---|---|
| Account linked? | Check `Account` table in Prisma Studio for `provider: 'telegram'` |
| `telegramEnabled`? | Check `User` table — should be `true` |
| AI key available? | Check `ANTHROPIC_API_KEY` in env, or BYOK key in `UserAiKey` table |
| Session expired? | Sessions last 1 hour. If expired, send a new message to start over |

### Bot generates but doesn't send "Listen Now"

| Check | Action |
|---|---|
| Pipeline complete? | Check `Podcast.status` in Prisma Studio — should be `READY` |
| TelegramMessage status? | If `READY` but not `REPLIED`, the reply job may have failed |
| Reply worker running? | Check worker logs for `telegram-reply` errors |
| Bot blocked? | If the user blocked the bot, `sendMessage` fails silently |

### Link code expired

Link codes expire after 10 minutes. If the user gets "Link Expired" on the web page:

1. Go back to @SottoFMBot in Telegram
2. Send `/start` again to get a fresh link
3. Complete the linking within 10 minutes

### "Account already linked to another user"

A Telegram account can only be linked to one Sotto account. If you see this error:

1. Check the `Account` table for the existing record
2. Delete the old Account record if it's from a test user
3. Or use a different Telegram account

---

## Limitations

| Limitation | Details |
|---|---|
| **Private chats only** | The bot currently handles private (1:1) chats. Group messages are received but not processed. |
| **No voice preference in Telegram** | Users can't pick TTS voices from Telegram — it uses their account preferences or the default voice pool. Set voice preferences at `sotto.fm/settings/voices`. |
| **No rate limit enforcement** | The platform rate limits (20 generations/hour, 100/day) are enforced at the API route level, not in the Telegram worker. A user could exceed limits via rapid messaging. |
| **Public only** | Telegram-generated podcasts are always `visibility: PUBLIC`. |
| **Callback data 64-byte limit** | Telegram restricts `callback_data` to 64 bytes. Long chip suggestions are truncated to fit. |
| **No file/media handling** | The bot only processes text messages. Sending images, audio, or documents is ignored. |
| **Session is per-chat** | If a user messages from a different device/chat, the session doesn't carry over (sessions are keyed by `chatId`). |
