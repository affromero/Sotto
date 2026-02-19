# MVP Launch Guide — Sotto

This guide walks you through deploying Sotto to production for beta testing with friends. The goal is a functional, stable MVP that handles 50-100 beta users generating interactive AI podcasts.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Service Setup](#service-setup)
3. [Database & Cache](#database--cache)
4. [Storage & CDN](#storage--cdn)
5. [API Keys & Integrations](#api-keys--integrations)
6. [Authentication](#authentication)
7. [BYOK & Voice Marketplace](#byok--voice-marketplace)
8. [Deployment](#deployment)
9. [Post-Deployment Configuration](#post-deployment-configuration)
10. [Cost Breakdown](#cost-breakdown)
11. [Testing Checklist](#testing-checklist)
12. [Sharing with Beta Users](#sharing-with-beta-users)
13. [Monitoring & Debugging](#monitoring--debugging)
14. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

### Required Accounts

- **Domain name**: `sotto.fm`, `trysotto.com`, or similar
- **Hetzner account**: For VPS hosting (CPX31 ~$11/mo runs everything)
- **GitHub account**: For repo hosting and CI/CD
- **Cloudflare account**: For R2 storage (10GB free)
- **Stripe account**: For voice marketplace payments (Stripe Connect)

### Required API Keys

- **Anthropic API key**: Sign up at console.anthropic.com ($5 minimum credit)
- **ElevenLabs API key**: Sign up at elevenlabs.io (Starter $5/mo or Creator $22/mo)

**Note**: Sotto uses a BYOK (Bring Your Own Key) model — users provide their own AI and TTS API keys. Platform keys are only needed as fallback for the free tier.

### Local Tools

- Node.js 18+ and npm
- Git
- Docker + Docker Compose
- Prisma CLI: `npm install -g prisma`

---

## Service Setup

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/sotto.git
cd sotto
npm install
```

### 2. Create `.env.production` File

Copy `.env.example` to `.env.production`. We'll fill in values in the following sections.

```bash
cp .env.example .env.production
```

---

## Database & Cache

Sotto runs PostgreSQL and Redis as Docker containers on the same VPS. No external database services needed.

### PostgreSQL Setup (Docker)

PostgreSQL 16 with pgvector runs as a Docker Compose service:

```yaml
# In docker-compose.prod.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: sotto
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: sotto
    volumes:
      - sotto_postgres_data:/var/lib/postgresql/data
```

The `DATABASE_URL` is configured automatically inside the Docker network:

```env
DATABASE_URL="postgresql://sotto:${POSTGRES_PASSWORD}@postgres:5432/sotto?schema=public"
```

Push schema to database:

```bash
npx prisma db push --schema=apps/web/prisma/schema.prisma
```

Verify connection:

```bash
npx prisma studio
```

### Redis Setup (Docker)

Redis 7 runs as a Docker Compose service with AOF persistence:

```yaml
# In docker-compose.prod.yml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - sotto_redis_data:/data
```

The `REDIS_URL` is configured automatically:

```env
REDIS_URL="redis://redis:6379"
```

---

## Storage & CDN

### Cloudflare R2 Setup

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → R2
2. Click "Create bucket"
3. Name it `sotto-podcasts-prod`
4. Create API token:
   - Go to "Manage R2 API Tokens"
   - Create new token with "Edit" permissions
   - Copy Account ID, Access Key ID, Secret Access Key
5. Enable public access:
   - Go to bucket settings → "Public Access"
   - Click "Allow Access"
   - Note the public URL: `https://pub-xxxxx.r2.dev`

6. Configure CORS for bucket:

Create a file `r2-cors.json`:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "https://www.yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply CORS config using Wrangler CLI:

```bash
npm install -g wrangler
wrangler login
wrangler r2 bucket cors set sotto-podcasts-prod --config r2-cors.json
```

7. Add to `.env.production`:

```env
R2_ACCOUNT_ID="your-account-id"
R2_ACCESS_KEY_ID="your-access-key"
R2_SECRET_ACCESS_KEY="your-secret-key"
R2_BUCKET_NAME="sotto-podcasts-prod"
R2_PUBLIC_URL="https://pub-xxxxx.r2.dev"
```

---

## API Keys & Integrations

### Anthropic Claude (Platform Fallback)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Add credit ($5 minimum)
3. Create API key under "API Keys"
4. Set monthly budget limit (e.g., $50/month)
5. Add to `.env.production`:

```env
ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

**Note**: This key serves as the platform fallback for free-tier users. Most users will provide their own keys via BYOK.

### ElevenLabs (Platform Fallback)

1. Go to [elevenlabs.io](https://elevenlabs.io)
2. Sign up for Starter ($5/mo, 30K characters) or Creator ($22/mo, 100K characters)
3. Go to Profile → API Keys → Generate new key
4. Add to `.env.production`:

```env
ELEVENLABS_API_KEY="your-elevenlabs-key"
```

### BYOK Encryption Key

Generate the encryption key used to store user API keys (AES-256-GCM):

```bash
openssl rand -hex 32
```

Add to `.env.production`:

```env
BYOK_ENCRYPTION_KEY="your-generated-hex-key"
```

### Voice Selection

ElevenLabs provides multiple voices. Sotto uses a voice pool system with 16 curated voices across 5 TTS providers. The `src/lib/voice-pool.ts` file handles deterministic voice pair selection per podcast:

```typescript
// In apps/web/src/lib/voice-pool.ts
// selectVoicePair(podcastId) hashes the podcast ID to pick a unique HOST + EXPERT pair
// resolveVoiceId() maps logical voice IDs to provider-specific IDs
```

---

## Authentication

### NextAuth.js Configuration

1. Generate secret key:

```bash
openssl rand -base64 32
```

2. Add to `.env.production`:

```env
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="your-generated-secret"
```

### OAuth Providers

#### Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create new project: "Sotto Production"
3. Enable "Google+ API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Application type: "Web application"
6. Authorized redirect URIs:
   - `https://yourdomain.com/api/auth/callback/google`
7. Copy Client ID and Client Secret
8. Add to `.env.production`:

```env
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

#### GitHub OAuth

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. "New OAuth App"
3. Application name: "Sotto"
4. Homepage URL: `https://yourdomain.com`
5. Authorization callback URL: `https://yourdomain.com/api/auth/callback/github`
6. Copy Client ID and Client Secret
7. Add to `.env.production`:

```env
GITHUB_CLIENT_ID="your-client-id"
GITHUB_CLIENT_SECRET="your-client-secret"
```

#### Twitter OAuth

1. Go to [developer.twitter.com](https://developer.twitter.com)
2. Create a project and app
3. Enable OAuth 2.0 (User authentication settings)
4. Callback URL: `https://yourdomain.com/api/auth/callback/twitter`
5. Copy Client ID and Client Secret
6. Add to `.env.production`:

```env
TWITTER_CLIENT_ID="your-client-id"
TWITTER_CLIENT_SECRET="your-client-secret"
```

#### Apple Sign In (Optional for MVP)

1. Go to [developer.apple.com](https://developer.apple.com)
2. Create App ID and Service ID
3. Configure Sign in with Apple
4. Download private key
5. Add to `.env.production`:

```env
APPLE_CLIENT_ID="your-service-id"
APPLE_CLIENT_SECRET="your-private-key"
APPLE_TEAM_ID="your-team-id"
APPLE_KEY_ID="your-key-id"
```

**Note**: Apple Sign In requires a paid Apple Developer account ($99/year). Required for the iOS app, optional for web-only MVP.

---

## BYOK & Voice Marketplace

### BYOK (Bring Your Own Key)

Sotto uses a BYOK model — all generation features are free when users provide their own API keys. No subscription tiers or credits.

**User-provided keys** (encrypted with AES-256-GCM via `BYOK_ENCRYPTION_KEY`):

| Key Type | Supported Providers | Stored In |
|----------|-------------------|-----------|
| AI key | Anthropic, OpenAI | `UserAiKey` model |
| TTS key | ElevenLabs, OpenAI, PlayHT, Cartesia, Hume | `UserTtsKey` model |

**Free tier fallback**: The `FreeTierConfig` singleton controls platform-provided AI/TTS for users without their own keys. Admin-configurable at `/admin`.

**Rate limits** (abuse prevention): 20 generations/hour, 100/day per user. 60 interactions/hour.

### Voice Marketplace (Stripe Connect)

Voice owners can sell their custom voice clones on a per-podcast basis via Stripe Connect.

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Activate your account
3. Enable **Stripe Connect** (for voice marketplace payouts)
4. Go to "Developers" → "API keys"
5. Copy "Publishable key" and "Secret key"
6. Add to `.env.production`:

```env
STRIPE_PUBLISHABLE_KEY="pk_live_xxxxx"
STRIPE_SECRET_KEY="sk_live_xxxxx"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_xxxxx"
```

**How it works**:

- Voice owners connect their Stripe account and set a per-podcast price (or free)
- Buyers pay once per podcast using that voice
- Payment is authorized upfront, captured when podcast reaches READY, cancelled on FAILED
- Platform takes 10% via `application_fee_amount`
- Free access paths: owner, allowlisted user, approved VoiceRequest, or existing purchase

### Webhook Setup

1. Go to "Developers" → "Webhooks" → "Add endpoint"
2. Endpoint URL: `https://yourdomain.com/api/webhooks/stripe`
3. Listen to events:
   - `account.updated` (Connect account status)
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy "Signing secret" (looks like `whsec_xxxxx`)
5. Add to `.env.production`:

```env
STRIPE_WEBHOOK_SECRET="whsec_xxxxx"
```

---

## Deployment

### Provision Hetzner VPS

1. Go to [console.hetzner.cloud](https://console.hetzner.cloud)
2. Create a new project: "Sotto"
3. Add a server:
   - Location: Choose closest to your users (e.g., Falkenstein, Ashburn)
   - Image: Ubuntu 22.04
   - Type: **CPX31** (4 vCPU, 8GB RAM, 160GB SSD) — €10/mo (~$11)
   - Add your SSH key
4. Note the server IP address

### Server Setup

SSH into your server and install dependencies:

```bash
ssh root@your-server-ip

# Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh

# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

### Deploy with Docker Compose

1. Clone the repo on the server:

```bash
git clone https://github.com/yourusername/sotto.git /opt/sotto
cd /opt/sotto
```

2. Copy `.env.production` to `.env`:

```bash
# Upload your .env.production file, then:
cp .env.production .env
```

3. Start all services:

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts 4 containers:
- **postgres**: PostgreSQL 16 with pgvector
- **redis**: Redis 7 with AOF persistence
- **web**: Next.js app on port 3000 (internal)
- **workers**: 23 BullMQ workers

4. Run database migration:

```bash
docker compose -f docker-compose.prod.yml --profile migration run --rm migrate \
  npx prisma db push --schema=apps/web/prisma/schema.prisma
```

### Configure Caddy (Reverse Proxy + SSL)

1. Copy the Caddyfile:

```bash
cp /opt/sotto/Caddyfile /etc/caddy/Caddyfile
```

2. Edit to use your domain:

```bash
# Replace sotto.fm with your domain
nano /etc/caddy/Caddyfile
```

3. Point your domain DNS to the server IP (A record)
4. Reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy automatically provisions and renews Let's Encrypt SSL certificates.

### Verify Deployment

1. Web: Visit `https://yourdomain.com`
2. Workers: Check logs for "23 workers started":
   ```bash
   docker compose -f docker-compose.prod.yml logs workers --tail=50
   ```
3. Health check: `curl https://yourdomain.com/api/health`

### CI/CD (GitHub Actions)

Sotto deploys via GitHub Actions SSH. On push to `main`:

1. SSH into the Hetzner VPS
2. Pull latest code
3. Rebuild Docker images
4. Restart containers with zero downtime

See `.github/workflows/` for the deployment workflow.

---

## Post-Deployment Configuration

### Push Notifications (Web Push)

1. Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

2. Add to `.env.production` and redeploy:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY="your-public-key"
VAPID_PRIVATE_KEY="your-private-key"
VAPID_SUBJECT="mailto:you@yourdomain.com"
```

### Seed Example Podcasts

Create 3-5 example podcasts on diverse topics to showcase the platform:

```bash
# On production database
npx prisma db seed
```

Edit `apps/web/prisma/seed.ts` to create real example podcasts:

```typescript
// Example topics:
// 1. "How Does Bitcoin Work?" (10 min, beginner-friendly)
// 2. "The History of Jazz Music" (15 min, intermediate)
// 3. "Introduction to Quantum Computing" (12 min, technical)
// 4. "Welcome to Sotto" (5 min, platform explanation)
```

### Configure Rate Limiting

Rate limits are enforced via Redis-backed sliding window counters in `src/middleware.ts`:

- 20 podcast generations/hour per user
- 100 generations/day per user
- 60 interactions/hour per user

### Configure Free Tier

Set platform defaults at `/admin` → Free Tier Config:

- AI provider + model for free-tier users
- TTS provider for free-tier users
- Generation limit for users without BYOK keys

---

## Cost Breakdown

Monthly costs for MVP with 50 beta users (estimated):

| Service | Tier | Cost | Notes |
|---------|------|------|-------|
| **Hetzner VPS** | CPX31 (4 vCPU, 8GB) | $11 | Web + workers + PostgreSQL + Redis |
| **Cloudflare R2** | Free | $0 | 10GB storage, 10M Class A requests |
| **Anthropic Claude** | Pay-as-you-go | $15-30 | Platform fallback only (most users BYOK) |
| **ElevenLabs** | Creator | $22 | Platform fallback only (most users BYOK) |
| **Stripe** | Pay-as-you-go | $0-5 | 2.9% + $0.30 per voice marketplace transaction |
| **Domain** | Annual | $1-2/mo | `.com` or `.fm` domain |
| **Total** | | **$49-70/mo** | Drops to ~$13/mo when most users BYOK |

### Cost Scaling

**At 100 users** (most providing own keys):

- Hetzner: $11 (CPX31 still sufficient)
- Claude: $10-20 (free tier fallback only)
- ElevenLabs: $22 (free tier fallback only)
- **Total: ~$45/mo**

**At 500 users**:

- Hetzner: $21 (upgrade to CPX41, 8 vCPU, 16GB RAM)
- Claude: $20-50 (free tier fallback)
- ElevenLabs: $22-99 (depends on free tier usage)
- R2: $0.23 (15GB storage)
- **Total: ~$65-195/mo**

**At 2,000+ users**:

- Hetzner: $50 (CCX33 dedicated CPU, separate DB)
- Claude: $50-100
- ElevenLabs: $99-330
- **Total: ~$200-500/mo**

**Key insight**: The BYOK model means platform AI/TTS costs stay low regardless of user count. Most costs scale with free-tier usage, not total users.

---

## Testing Checklist

Before sharing with beta users, test every core flow:

### Authentication

- [ ] Sign in with Google works
- [ ] Sign in with GitHub works
- [ ] Sign in with Twitter works
- [ ] Logout works
- [ ] Session persists across page reloads

### BYOK Key Management

- [ ] Can add Anthropic API key in settings
- [ ] Can add OpenAI API key in settings
- [ ] Can add ElevenLabs API key in settings
- [ ] Can add PlayHT / Cartesia / Hume API key
- [ ] Keys are encrypted (verify in DB — no plaintext)
- [ ] Key validation worker runs (24h cycle)
- [ ] Generation works with user's own keys
- [ ] Generation works with free tier (platform keys)
- [ ] Rate limits enforced (20/hour, 100/day)

### Podcast Creation

- [ ] Chat discovery flow loads
- [ ] AI responds with conversational questions
- [ ] Chip suggestions are tappable
- [ ] Can paste URL for source material
- [ ] Shows recommendations before generating
- [ ] "Create mine" starts generation
- [ ] Script verification runs (claim check + sourcing)
- [ ] Reference validation runs (4-layer verification)
- [ ] Script review pause works (SCRIPT_READY)
- [ ] User can edit, approve, or regenerate script
- [ ] Progress bar updates in real-time
- [ ] Push notification arrives when ready
- [ ] Generated podcast appears in "My Podcasts"

### Audio Playback

- [ ] Player loads and plays audio
- [ ] Waveform visualization animates
- [ ] Play/pause works
- [ ] Seek bar scrubbing works
- [ ] Volume control works
- [ ] Playback speed control works (1x, 1.5x, 2x)
- [ ] Works on mobile Safari
- [ ] Works on Chrome Android
- [ ] Mini player appears when scrolling

### Interactive Features

- [ ] "Ask a Question" button pauses playback
- [ ] Can type and submit a question
- [ ] AI response appears inline
- [ ] "Was that clear?" prompt appears
- [ ] "Update podcast" adds new segment
- [ ] Updated podcast re-generates correctly

### Social Features

- [ ] Feed page shows public podcasts
- [ ] Can search podcasts by keyword
- [ ] Tag filters work
- [ ] Trending section appears
- [ ] Like button works (increments count)
- [ ] Save button works (adds to "Saved")
- [ ] Can view another user's profile
- [ ] Follow button works
- [ ] Fork button creates a copy

### Voice Marketplace

- [ ] Voice owner can connect Stripe account
- [ ] Voice owner can set per-podcast price
- [ ] Buyer can purchase voice access
- [ ] Payment authorized on generation start
- [ ] Payment captured on READY
- [ ] Payment cancelled on FAILED
- [ ] Free access paths work (owner, allowlist, purchase)

### Mobile App (React Native + Expo)

- [ ] iOS app builds and runs on TestFlight
- [ ] Login works (API token auth via SecureStore)
- [ ] Podcast playback works (react-native-track-player)
- [ ] Background audio continues when app is backgrounded
- [ ] Push notifications work on iOS

### Performance

- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] No console errors on production
- [ ] Docker containers healthy (`docker compose ps`)

---

## Sharing with Beta Users

### Launch Sequence

1. **Soft launch** (Day 1-3): Share with 5-10 close friends
   - Gather initial feedback
   - Fix critical bugs
   - Monitor error logs closely

2. **Beta launch** (Day 4-14): Expand to 50 users
   - Share on Twitter, Product Hunt "Coming Soon"
   - Invite friends, colleagues, niche communities
   - Set up feedback form: `/feedback` page

3. **Public launch** (Day 15+): Open to general public
   - Product Hunt launch
   - Hacker News "Show HN"
   - Twitter announcement
   - Blog post explaining the product

### Share Message Template

```
I built Sotto — the open podcast network.

Chat with AI to describe what you want to learn, and it generates a 2-voice conversational podcast. While listening, you can interrupt to ask questions, and the AI answers in context.

Bring your own API keys — all features are free.

Try it: https://yourdomain.com

It's in beta, so I'd love your feedback!
```

### Create Welcome Podcast

Record a 3-5 minute podcast explaining Sotto:

**Script outline**:

- What is Sotto? (30s)
- How to create your first podcast (1 min)
- How to interrupt and ask questions (1 min)
- Social features: feed, follow, fork (1 min)
- Setting up your API keys (BYOK) (30s)
- How to give feedback (30s)

Pin this podcast to the top of the feed so every new user sees it.

### Beta Feedback Form

Create a simple feedback form at `/feedback`:

```typescript
// apps/web/src/app/feedback/page.tsx
// Form fields:
// - What did you like?
// - What was confusing?
// - What features are missing?
// - Would you use this regularly? (Yes / No / Maybe)
// - Email (optional, for follow-up)
```

Store responses in `Feedback` model:

```prisma
model Feedback {
  id        String   @id @default(cuid())
  userId    String?
  liked     String?
  confusing String?
  missing   String?
  wouldPay  String?
  email     String?
  createdAt DateTime @default(now())
}
```

---

## Monitoring & Debugging

### Docker Logs

Monitor all services:

```bash
# All containers
docker compose -f docker-compose.prod.yml logs -f

# Web app only
docker compose -f docker-compose.prod.yml logs -f web

# Workers only
docker compose -f docker-compose.prod.yml logs -f workers

# Filter by worker type
docker compose -f docker-compose.prod.yml logs workers | grep "\[script-generation\]"
docker compose -f docker-compose.prod.yml logs workers | grep "\[audio-generation\]"
docker compose -f docker-compose.prod.yml logs workers | grep "ERROR"
```

### BullMQ Dashboard (Optional)

Add Bull Board for visual queue monitoring:

```bash
npm install @bull-board/api @bull-board/express
```

```typescript
// apps/web/src/app/api/admin/queues/route.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [
    new BullMQAdapter(scriptGenerationQueue),
    new BullMQAdapter(audioGenerationQueue),
    // ... other queues
  ],
  serverAdapter,
});

// Access at: https://yourdomain.com/api/admin/queues
```

**Secure this route**: Add auth middleware to only allow admin access.

### Error Tracking (Sentry, Optional)

For MVP, use structured logging via `src/lib/logger.ts`. For production, add Sentry:

```bash
npm install @sentry/nextjs
```

### Key Metrics to Watch

1. **Podcast generation success rate**: Should be > 95%
2. **Audio generation time**: Should be < 5 minutes for 10-minute podcast
3. **API error rate**: Should be < 1%
4. **Docker container health**: All containers should be "healthy"
5. **Redis memory usage**: Should stay under 512MB limit
6. **VPS resource usage**: CPU < 80%, Memory < 80%
7. **R2 storage usage**: Monitor approaching 10GB free limit

### Set Up Alerts

**Hetzner**:

- Server monitoring (CPU, memory, disk) via Hetzner Cloud Console
- Set alerts for CPU > 90% or disk > 80%

**Docker**:

- Container restart alerts (configure `restart: unless-stopped`)
- Use `docker compose ps` to check container health

**Application**:

- Monitor `/api/health` endpoint with an uptime service (e.g., UptimeRobot, free tier)

---

## Troubleshooting

### Common Issues

#### "Database connection failed"

**Cause**: PostgreSQL container not running or not healthy

**Fix**:

1. Check container status: `docker compose -f docker-compose.prod.yml ps postgres`
2. Check logs: `docker compose -f docker-compose.prod.yml logs postgres`
3. Verify `POSTGRES_PASSWORD` is set in `.env`
4. Test connection: `docker compose -f docker-compose.prod.yml exec postgres psql -U sotto -d sotto -c "SELECT 1"`

#### "Redis connection timeout"

**Cause**: Redis container not running or memory limit exceeded

**Fix**:

1. Check container status: `docker compose -f docker-compose.prod.yml ps redis`
2. Check memory usage: `docker compose -f docker-compose.prod.yml exec redis redis-cli INFO memory`
3. If maxmemory exceeded, increase limit in `docker-compose.prod.yml` (default: 512mb)

#### "Audio generation stuck at 50%"

**Cause**: ElevenLabs rate limit exceeded or worker crashed

**Fix**:

1. Check ElevenLabs dashboard for quota usage
2. Check worker logs: `docker compose -f docker-compose.prod.yml logs workers | grep audio-generation`
3. Retry failed jobs via BullMQ dashboard or admin panel

#### "Stripe webhook not receiving events"

**Cause**: Webhook endpoint not accessible or incorrect signing secret

**Fix**:

1. Test webhook: Stripe dashboard → Webhooks → Send test event
2. Check web logs: `docker compose -f docker-compose.prod.yml logs web | grep webhook`
3. Verify `STRIPE_WEBHOOK_SECRET` matches dashboard value
4. Verify Caddy is proxying correctly to port 3000

#### "Push notifications not working"

**Cause**: VAPID keys incorrect or service worker not registered

**Fix**:

1. Verify `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is accessible client-side
2. Check browser console for service worker errors
3. Re-register service worker: Clear site data, refresh

#### "Podcast audio is choppy or distorted"

**Cause**: FFmpeg normalization issue or R2 upload incomplete

**Fix**:

1. Check worker logs: `docker compose -f docker-compose.prod.yml logs workers | grep audio-stitching`
2. Re-run stitching job via admin panel
3. Verify R2 file integrity: Download and play locally

#### "Feed page loads slowly"

**Cause**: Database query not optimized or missing index

**Fix**:

1. Add database indexes:
   ```sql
   CREATE INDEX idx_podcasts_visibility ON "Podcast"(visibility, "createdAt");
   CREATE INDEX idx_podcasts_user ON "Podcast"("userId", "createdAt");
   ```
2. Implement pagination: Limit to 20 podcasts per page
3. Add Redis caching for trending podcasts

#### "Container keeps restarting"

**Cause**: Out of memory, missing env var, or application crash

**Fix**:

1. Check logs before crash: `docker compose -f docker-compose.prod.yml logs --tail=100 <service>`
2. Check memory: `docker stats`
3. If OOM, upgrade VPS or increase swap:
   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   ```

---

## Next Steps After MVP

Once you have 50+ beta users and stable performance:

1. **Gather feedback**: Analyze feedback form responses, identify top feature requests
2. **Optimize costs**: Monitor BYOK adoption — higher adoption = lower platform costs
3. **Improve onboarding**: Add tutorial overlay for first-time users
4. **Scale VPS**: Upgrade to CPX41 ($21/mo) when CPU consistently > 70%
5. **Voice marketplace growth**: Onboard voice creators, promote voice clones
6. **Analytics dashboard**: Show creators their podcast stats (already built at `/analytics`)
7. **Twitter bot**: Enable @sottofm mention-to-podcast pipeline (`docs/25-twitter-integration.md`)
8. **Telegram bot**: Enable Telegram podcast creation (`docs/26-telegram-integration.md`)

---

## Final Checklist

Before considering MVP "launched":

- [ ] All Docker containers are healthy (`docker compose ps`)
- [ ] All environment variables are set correctly
- [ ] Database schema is pushed and seeded
- [ ] Custom domain is configured with SSL (Caddy auto-provisions)
- [ ] OAuth providers are working (Google, GitHub, Twitter)
- [ ] BYOK key management is working (add, validate, encrypt)
- [ ] Voice marketplace Stripe Connect is configured
- [ ] 3-5 example podcasts are seeded
- [ ] All critical user flows tested end-to-end
- [ ] Error tracking is set up (structured logging at minimum)
- [ ] Feedback form is live
- [ ] Push notifications are working
- [ ] Docker health checks are passing
- [ ] Uptime monitoring is configured
- [ ] Beta user invite list is ready
- [ ] "Welcome to Sotto" podcast is created
- [ ] Social sharing links are tested
- [ ] iOS TestFlight build is available (see `docs/24-ios-testflight-appstore-guide.md`)

---

**You're ready to launch Sotto. Good luck!**

For questions or support, refer to:

- `CLAUDE.md` — Codebase overview
- `docs/05-plan.md` — Full product plan
- `docs/16-technical-architecture.md` — System design
- `docs/17-authentication-setup.md` — Auth deep dive
- `docs/18-hosting-infrastructure.md` — Infrastructure details
- `docs/19-deploy-sotto-fm.md` — Hetzner VPS deployment guide
