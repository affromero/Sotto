# Twitter @sottofm Integration

> **Date**: 2026-02-15
>
> **Summary**: Zero-to-hero guide for the @sottofm Twitter bot. Users tag @sottofm in a tweet to generate a podcast automatically. Covers Twitter Developer setup, environment variables, account linking, the full pipeline, and troubleshooting.

---

## Overview

Sotto's Twitter integration lets any user with a linked account tweet at **@sottofm** to generate a podcast:

```
@sottofm make a podcast about quantum computing
```

The system polls for mentions, parses the tweet via Claude, runs the full generation pipeline (script → audio → stitch), and replies with a link to the finished podcast — all automatically.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Twitter Developer account** | [developer.twitter.com](https://developer.twitter.com) — Basic tier ($100/mo) for mentions endpoint |
| **@sottofm Twitter account** | The bot account that receives mentions and posts replies |
| **Workers running** | `npm run dev:workers` or `npm run dev` — polling starts at worker boot |
| **AI key** | Platform `ANTHROPIC_API_KEY`, or user BYOK key, or `AI_PROVIDER=claude-code` |
| **TTS key** | Platform `ELEVENLABS_API_KEY`, or user BYOK TTS key |

---

## Step 1: Create a Twitter Developer Account and App

### 1a. Sign up for Twitter Developer access

1. Go to [developer.twitter.com](https://developer.twitter.com) and sign in with the **@sottofm** Twitter account (the bot account, not your personal account)
2. Click **Sign up for Free Account** if you don't have developer access yet
3. The Free tier only allows posting tweets — it does **not** include the mentions endpoint. You need **Basic tier** ($100/month) for mention polling. You can start with Free to get set up, then upgrade when ready to test.
4. Fill in the use case description: "Automated podcast generation bot. Users mention @sottofm to generate AI podcasts from their tweet topics."
5. Accept the developer agreement

### 1b. Create a Project and App

1. In the [Developer Portal Dashboard](https://developer.twitter.com/en/portal/dashboard), click **+ Add Project**
2. Project name: `Sotto`
3. Use case: select **Making a bot**
4. Project description: "AI podcast generation from tweet mentions"
5. Click **Create a new App** inside the project
6. App name: `sotto-bot` (must be unique across all Twitter apps)
7. Click **Complete**

### 1c. Configure User Authentication

1. In your app settings, scroll to **User authentication settings** and click **Set up**
2. Configure:
   - **App permissions**: **Read and write** (critical — needed for posting replies)
   - **Type of App**: **Web App, Automated App or Bot**
   - **Callback URI / Redirect URL**: Add both:
     - `http://localhost:3000/api/auth/callback/twitter` (for local dev)
     - `https://sotto.fm/api/auth/callback/twitter` (for production)
   - **Website URL**: `https://sotto.fm`
3. Click **Save**

### 1d. Upgrade to Basic tier

1. Go to [developer.twitter.com/en/portal/products](https://developer.twitter.com/en/portal/products)
2. Subscribe to **Basic** ($100/month)
3. This unlocks the `GET /2/users/:id/mentions` endpoint (required for polling)

---

## Step 2: Collect All Credentials

You need credentials from several sections of the Developer Portal. Log in at [developer.twitter.com/en/portal/dashboard](https://developer.twitter.com/en/portal/dashboard), click on your app, and navigate to **Keys and tokens**.

### 2a. OAuth 2.0 Client ID and Secret (for user login)

Under **OAuth 2.0 Client ID and Client Secret**:

1. Copy the **Client ID** → this is your `TWITTER_CLIENT_ID`
2. Copy the **Client Secret** → this is your `TWITTER_CLIENT_SECRET`

These allow users to "Sign in with Twitter" on Sotto, which links their Twitter account to their Sotto account.

### 2b. Bearer Token (for reading mentions)

Under **Bearer Token**:

1. If not generated yet, click **Regenerate**
2. Copy the token → this is your `TWITTER_BEARER_TOKEN`

### 2c. API Key and Secret (Consumer Keys)

Under **Consumer Keys**:

1. Copy the **API Key** → this is your `TWITTER_API_KEY`
2. Copy the **API Key Secret** → this is your `TWITTER_API_SECRET`

### 2d. Access Token and Secret (for posting as @sottofm)

Under **Authentication Tokens > Access Token and Secret**:

1. Click **Generate** (make sure you're logged into the Developer Portal as @sottofm)
2. Copy the **Access Token** → this is your `TWITTER_ACCESS_TOKEN`
3. Copy the **Access Token Secret** → this is your `TWITTER_ACCESS_SECRET`

**Important**: These tokens must be generated **after** setting app permissions to "Read and write". If you generated them before, click **Regenerate** — old tokens keep old permissions.

### 2e. Bot User ID

Find the numeric user ID for the @sottofm account:

1. Go to [tweeterid.com](https://tweeterid.com/)
2. Enter `@sottofm`
3. Copy the numeric ID → this is your `TWITTER_SOTTO_USER_ID`

### Summary of all credentials

| Variable | Source | Purpose |
|---|---|---|
| `TWITTER_CLIENT_ID` | OAuth 2.0 Client ID | User login ("Sign in with Twitter") |
| `TWITTER_CLIENT_SECRET` | OAuth 2.0 Client Secret | User login |
| `TWITTER_BEARER_TOKEN` | Bearer Token | Reading mentions (app-only auth) |
| `TWITTER_API_KEY` | API Key (Consumer Key) | Posting replies (OAuth 1.0a) |
| `TWITTER_API_SECRET` | API Key Secret (Consumer Secret) | Posting replies |
| `TWITTER_ACCESS_TOKEN` | Access Token | Posting as @sottofm |
| `TWITTER_ACCESS_SECRET` | Access Token Secret | Posting as @sottofm |
| `TWITTER_SOTTO_USER_ID` | tweeterid.com | Identifies which account to poll mentions for |

---

## Step 3: Configure Environment Variables

Add all credentials to `.env.local`:

```env
# ── Twitter OAuth 2.0 (user login) ──
TWITTER_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxx
TWITTER_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxx

# ── Twitter @sottofm Bot ──
TWITTER_BEARER_TOKEN=xxxxxxxxxxxxxxxxxxxxx
TWITTER_API_KEY=xxxxxxxxxxxxxxxxxxxxx
TWITTER_API_SECRET=xxxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_SECRET=xxxxxxxxxxxxxxxxxxxxx
TWITTER_SOTTO_USER_ID=xxxxxxxxxxxxxxxxxxxxx

# ── Optional: polling interval (default 60s) ──
# TWITTER_POLL_INTERVAL_MS=60000
```

### Minimum for each feature

| Feature | Required variables |
|---|---|
| **User links Twitter account** (login) | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` |
| **Bot polls for mentions** | `TWITTER_BEARER_TOKEN`, `TWITTER_SOTTO_USER_ID` |
| **Bot posts replies** | All OAuth 1.0a vars: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |
| **Full flow (end-to-end)** | All 8 variables above |

---

## Step 4: Link Your Twitter Account to Sotto

The bot matches incoming mentions to Sotto users by looking up the Twitter numeric user ID in the `Account` table (NextAuth). Without this link, the bot can't attribute the tweet to a Sotto user.

1. Start the app: `npm run dev`
2. Go to `http://localhost:3000/auth/login`
3. Click **Sign in with Twitter** (only appears if `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` are set)
4. Complete the OAuth flow — this creates an `Account` record with `provider: 'twitter'` and your numeric user ID
5. On link, the system automatically sets `twitterEnabled = true` and stores your Twitter handle

### Verify the link

```bash
# Open Prisma Studio
npx prisma studio --schema=apps/web/prisma/schema.prisma
```

Check the `Account` table for a record where:
- `provider` = `twitter`
- `providerAccountId` = your Twitter numeric user ID
- `userId` = your Sotto user ID

Or hit the API:

```bash
curl http://localhost:3000/api/users/me/twitter \
  -H "Cookie: <your-session-cookie>"
```

Should return:

```json
{
  "connected": true,
  "twitterHandle": "afromero",
  "twitterEnabled": true
}
```

---

## Step 5: Ensure AI + TTS Keys Are Available

The pipeline needs both an AI provider (for Claude to parse the tweet and generate the script) and a TTS provider (for audio generation).

| Provider | Options |
|---|---|
| **AI** | Platform `ANTHROPIC_API_KEY` in env, user BYOK key, or `AI_PROVIDER=claude-code` |
| **TTS** | Platform `ELEVENLABS_API_KEY` in env, or user BYOK TTS key |

If AI is missing: the mention is saved as `IGNORED` with error "No AI provider configured".

If TTS is missing: the pipeline fails at audio generation and the bot replies with a failure message.

---

## Step 6: Start Workers and Test

```bash
# Start everything
npm run dev

# Or start workers only (if web is already running)
npm run dev:workers
```

On startup, the worker orchestrator checks `isTwitterConfigured()` (requires `TWITTER_BEARER_TOKEN` + `TWITTER_SOTTO_USER_ID`). If configured, it schedules a repeatable BullMQ job on the `twitter-mentions` queue that polls every 60 seconds. Look for this line in worker logs:

```
Twitter mention polling started (interval: 60000ms)
```

### Testing without going public

You don't need a public tweet to test the full pipeline. There are three approaches, from simplest to most complete:

#### Option A: Simulate a mention via BullMQ (no Twitter needed)

Bypass the polling entirely by manually inserting a job into the queue. Open a Node REPL connected to your local Redis:

```bash
npx tsx -e "
const { Queue } = require('bullmq');
const { createRedisConnection } = require('./apps/web/src/lib/redis');
const q = new Queue('twitter-mentions', { connection: createRedisConnection() });
q.add('process-single-mention', {
  tweet: {
    id: 'test-' + Date.now(),
    text: '@sottofm make a podcast about the history of jazz',
    author_id: 'YOUR_TWITTER_NUMERIC_USER_ID',  // from tweeterid.com for @afromero
    created_at: new Date().toISOString(),
  }
}).then(() => { console.log('Job queued'); process.exit(0); });
"
```

This feeds a fake mention directly into the worker, skipping the Twitter API entirely. The rest of the pipeline (parsing, podcast creation, audio generation) runs exactly as it would for a real mention.

#### Option B: Private tweet (Twitter API, but not visible to followers)

If you want to test the real polling + Twitter API path without a public tweet:

1. Make your @afromero Twitter account **private** (Settings > Privacy > Protect your posts)
2. Make sure @sottofm follows @afromero (required to see protected tweets in mentions)
3. Tweet: `@sottofm make a podcast about the history of jazz`
4. Wait up to 60 seconds for the next poll
5. Verify in worker logs and Prisma Studio
6. After testing, unprotect your account if desired

**Note**: Twitter's mentions API only returns mentions from accounts that the bot follows (or public accounts). If @afromero is private and @sottofm doesn't follow you, the mention won't show up.

#### Option C: Reply to your own tweet (lower visibility)

Instead of a standalone mention (visible on your timeline), reply to one of your own tweets:

1. Post any tweet from @afromero (or find an existing one)
2. Reply to it: `@sottofm make a podcast about this`
3. Replies are less prominent than standalone tweets — they don't appear on your main timeline unless someone expands the thread

The worker fetches the parent tweet for context, so it works well for testing the "reply to a tweet" flow.

### Monitor progress

Once a mention is picked up, track it through the pipeline:

```bash
# Watch worker logs in real time
# (if running via npm run dev, logs appear in the terminal)

# Or open Prisma Studio to inspect database records
npx prisma studio --schema=apps/web/prisma/schema.prisma
```

In Prisma Studio, check:

| Table | What to look for |
|---|---|
| `TweetMention` | Status progression: PARSING → GENERATING → READY → REPLIED |
| `Podcast` | New podcast with `source: TWITTER`, check `status` field |
| `Segment` | Audio segments being created as TTS completes |

### Verify the reply was posted

After the pipeline completes, check the `TweetMention` record:

- `status` = `REPLIED` → reply was posted successfully
- `replyTweetId` → the ID of the reply tweet @sottofm posted
- `podcastId` → links to the generated podcast

You can also check @sottofm's Twitter replies tab to see the posted reply.

---

## How It Works (Full Pipeline)

```
1. @afromero tweets: "@sottofm make a podcast about quantum computing"

2. twitter-mentions worker polls Twitter API v2
   GET /2/users/{SOTTO_USER_ID}/mentions?since_id={cursor}
   ↓
3. Dedup check: have we seen this tweet ID before?
   ↓
4. Account lookup: find Sotto user by Twitter numeric user ID
   - Not found → reply with "Sign up at sotto.fm" CTA (once per user)
   - Found but twitterEnabled=false → save as IGNORED
   - Found but no AI key → save as IGNORED
   ↓
5. Create TweetMention record (status: PARSING)
   ↓
6. Fetch parent tweet context (if mention is a reply to another tweet)
   ↓
7. Claude parses tweet → extracts topic, title, depth, tone, audience
   ↓
8. Create Podcast (source: TWITTER, visibility: PUBLIC, duration: 10min)
   Update TweetMention (status: GENERATING, link to podcast)
   ↓
9. Full generation pipeline runs automatically:
   content-extraction → script-generation → script-verification →
   reference-validation → audio-generation (parallel) → audio-stitching

   KEY DIFFERENCE: Twitter-source podcasts skip the SCRIPT_READY pause
   (no manual script review — auto-approved)
   ↓
10. audio-stitching worker detects source=TWITTER
    Updates TweetMention (status: READY)
    Queues twitter-reply job
    ↓
11. twitter-reply worker posts reply:
    'Your podcast is ready! "Quantum Computing" (10 min)
    Listen: https://sotto.fm/podcast/{id}'
    Updates TweetMention (status: REPLIED)
```

### TweetMention Status Flow

```
PARSING ──→ GENERATING ──→ READY ──→ REPLIED ✓
   │             │            │
   └─────────────┴────────────┴──→ FAILED ✗
                                   IGNORED (disabled/no key)
```

---

## Key Implementation Files

| File | Purpose |
|---|---|
| `src/lib/twitter.ts` | Twitter API client: `getMentions()`, `getTweet()`, `getThread()`, `replyToTweet()`, `postTweet()`, `searchPopularTweets()`, `isTwitterConfigured()` |
| `src/lib/tweet-parser.ts` | Claude-powered tweet intent extraction: topic, title, depth, tone; thread parsing |
| `src/lib/twitter-config.ts` | Singleton `TwitterConfig` row: auto-tweet thresholds, trend polling settings, tweet template |
| `src/lib/twitter-auto-tweet.ts` | `checkAutoTweetThreshold(podcastId)` — fire-and-forget after like/fork/play; `manualTweet()` for admin |
| `src/workers/twitter-mentions.worker.ts` | Polls mentions, matches users, creates podcasts, kicks off pipeline |
| `src/workers/twitter-reply.worker.ts` | Posts reply tweets with podcast links (or failure messages) |
| `src/workers/twitter-auto-tweet.worker.ts` | Auto-tweets when a podcast crosses engagement thresholds (likes, plays, forks) |
| `src/workers/twitter-trend-poll.worker.ts` | Polls trending tweets (repeatable, every 2hrs), scores + deduplicates, creates podcasts as @sotto |
| `src/workers/admin-thread-to-podcast.worker.ts` | Fetches a Twitter thread by URL, parses intent, creates podcast as @sotto (admin-triggered) |
| `src/workers/index.ts` | Schedules the repeatable polling jobs on startup |
| `src/lib/auth.ts` | `linkAccount` event: auto-sets `twitterEnabled` + `twitterHandle` on Twitter OAuth |
| `src/app/api/users/me/twitter/route.ts` | API for checking/toggling Twitter connection and preferences |
| `src/app/(admin)/admin/twitter/page.tsx` | Admin Twitter dashboard: analytics, auto-tweet config, trend monitoring, thread→podcast |

All paths are relative to `apps/web/`.

---

## User Settings API

Users can manage their Twitter integration via `GET/PATCH/DELETE /api/users/me/twitter`:

| Method | Action |
|---|---|
| `GET` | Returns `connected`, `twitterHandle`, `twitterEnabled`, voice preferences |
| `PATCH` | Toggle `twitterEnabled`, set voice preferences via `voicePreferences` array |
| `DELETE` | Disconnect Twitter: removes Account record, clears handle, sets `twitterEnabled = false` |

---

## Behavior for Unlinked Users

When someone without a Sotto account tweets at @sottofm:

1. No `Account` record is found for their Twitter numeric user ID
2. The bot replies **once** with a CTA: "Sign up at sotto.fm and connect your Twitter account to generate podcasts from tweets!"
3. A Redis key `twitter:cta_sent:{author_id}` is set (no expiry) to prevent repeat CTAs
4. No `TweetMention` record is created — only the Redis flag

---

## Troubleshooting

### Bot doesn't pick up mentions

| Check | Command / Action |
|---|---|
| Workers running? | `npm run dev:workers` — look for "Twitter mention polling started" in logs |
| Env vars set? | Verify `TWITTER_BEARER_TOKEN` and `TWITTER_SOTTO_USER_ID` are in `.env.local` |
| Correct user ID? | Look up @sottofm at [tweeterid.com](https://tweeterid.com/) — must be the numeric ID |
| Twitter API tier? | Basic tier ($100/mo) required for the mentions endpoint |
| Rate limited? | Twitter API v2 Basic allows 10,000 tweet reads/month |

### Bot picks up mention but doesn't generate

| Check | Action |
|---|---|
| Account linked? | Check `Account` table in Prisma Studio for `provider: 'twitter'` + your user ID |
| `twitterEnabled`? | Check `User` table — should be `true`. Or `GET /api/users/me/twitter` |
| AI key available? | Check `ANTHROPIC_API_KEY` in env, or BYOK key in `UserAiKey` table |
| TweetMention status? | Check `TweetMention` table — if `IGNORED`, read the `errorMessage` |

### Bot generates but doesn't reply

| Check | Action |
|---|---|
| OAuth 1.0a vars set? | All 4 needed: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |
| App permissions? | Must be "Read and write" in Twitter Developer Portal |
| Check worker logs | Look for errors in the `twitter-reply` worker output |
| TweetMention status? | If `READY` but not `REPLIED`, the reply job may have failed |

### "403 Forbidden" when posting replies

The @sottofm app needs **Read and write** permissions. If you changed permissions after generating access tokens, you must **regenerate the access token and secret** — old tokens retain the old permissions.

---

## Limitations

| Limitation | Details |
|---|---|
| **Fixed 10-minute duration** | All Twitter-generated podcasts use `durationTarget: 10`. No way to specify duration in the tweet. |
| **No TTS pre-check** | The worker checks for AI key availability but not TTS. If TTS is missing, the pipeline fails at audio generation and posts a failure reply. |
| **No rate limit enforcement** | The platform rate limits (20 generations/hour, 100/day) are enforced at the API route level, not in the Twitter worker. A user could potentially exceed limits via tweet spam. |
| **Public only** | Twitter-generated podcasts are always `visibility: PUBLIC`. |
| **No thread parsing (mentions)** | The mention worker parses only the direct tweet (and one parent if it's a reply). For full thread parsing, use the admin thread-to-podcast feature. |

---

## Admin Twitter Dashboard (`/admin/twitter`)

The admin dashboard at `/admin/twitter` provides controls for the extended Twitter features:

| Section | Description |
|---|---|
| **Analytics** | 30-day engagement metrics: impressions, mentions processed, podcasts generated, replies posted |
| **Auto-Tweet** | Configure thresholds (min likes, plays, forks) for auto-tweeting popular podcasts. Toggle on/off, customize tweet template with `{{title}}`, `{{topic}}`, `{{url}}` placeholders. Manual "Tweet this" for any podcast. |
| **Trend Polling** | Search trending tweets by configurable queries, score by engagement, auto-generate podcasts as @sotto. Configurable interval (default 2hrs) and max podcasts/day. |
| **Thread→Podcast** | Paste a tweet/thread URL → fetches the full thread → generates a podcast as @sotto. Useful for turning viral threads into audio content. |

### Admin API Routes

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/twitter/config` | GET/PATCH | Read/update TwitterConfig singleton (thresholds, template, trend settings) |
| `/api/admin/twitter/auto-tweet` | GET/POST | List recent auto-tweets / manually trigger a tweet for a podcast |
| `/api/admin/twitter/trends` | GET/POST | Fetch live trending topics / generate podcast from a trending topic |
| `/api/admin/twitter/thread-to-podcast` | POST | Queue a thread-to-podcast conversion job |
| `/api/admin/twitter/analytics` | GET | 30-day Twitter engagement analytics |
