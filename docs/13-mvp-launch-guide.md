# MVP Launch Guide — Sotto

This guide walks you through deploying Sotto to production for beta testing with friends. The goal is a functional, stable MVP that handles 50-100 beta users generating interactive AI podcasts.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Service Setup](#service-setup)
3. [Database & Cache](#database--cache)
4. [Storage & CDN](#storage--cdn)
5. [API Keys & Integrations](#api-keys--integrations)
6. [Authentication](#authentication)
7. [Payments](#payments)
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
- **Vercel account**: Free hobby tier works for web frontend
- **Railway account**: For worker processes ($5/mo starter plan)
- **GitHub account**: For repo hosting and CI/CD
- **Cloudflare account**: For R2 storage (10GB free)
- **Stripe account**: For billing (test mode is free)

### Required API Keys

- **Anthropic API key**: Sign up at console.anthropic.com ($5 minimum credit)
- **ElevenLabs API key**: Sign up at elevenlabs.io (Starter $5/mo or Creator $22/mo)

### Required Database Services

Choose one option for PostgreSQL:

- **Neon** (recommended): Free tier, 0.5GB storage, serverless
- **Supabase**: Free tier, 500MB storage, includes Redis alternative
- **Railway**: $5/mo, includes PostgreSQL + Redis together

Choose one option for Redis:

- **Upstash** (recommended): Free tier, 10K commands/day, serverless
- **Railway**: $5/mo, bundled with PostgreSQL

### Local Tools

- Node.js 18+ and npm
- Git
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

### PostgreSQL Setup (Neon)

1. Go to [console.neon.tech](https://console.neon.tech)
2. Click "Create Project"
3. Choose region closest to your users
4. Copy the connection string (looks like `postgresql://user:pass@host/db?sslmode=require`)
5. Add to `.env.production`:

```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
```

6. Push schema to database:

```bash
npx prisma db push --schema prisma/schema.prisma
```

7. Verify connection:

```bash
npx prisma studio
```

### Redis Setup (Upstash)

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create Redis database
3. Choose region closest to your PostgreSQL instance
4. Copy the connection URL (looks like `rediss://default:xxx@us1-xxx.upstash.io:6379`)
5. Add to `.env.production`:

```env
REDIS_URL="rediss://default:xxx@us1-xxx.upstash.io:6379"
```

6. Test connection:

```bash
# Install redis-cli or use Upstash web console
redis-cli -u "rediss://default:xxx@us1-xxx.upstash.io:6379" PING
# Should return: PONG
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

### Anthropic Claude

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Add credit ($5 minimum)
3. Create API key under "API Keys"
4. Set monthly budget limit (e.g., $50/month)
5. Add to `.env.production`:

```env
ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

**Cost estimation**: Each podcast generation uses ~10K-30K tokens ($0.03-0.09). Budget $10-30/month for 50 beta users.

### ElevenLabs

1. Go to [elevenlabs.io](https://elevenlabs.io)
2. Sign up for Starter ($5/mo, 30K characters) or Creator ($22/mo, 100K characters)
3. Go to Profile → API Keys → Generate new key
4. Add to `.env.production`:

```env
ELEVENLABS_API_KEY="your-elevenlabs-key"
```

**Cost estimation**: 10-minute podcast = ~1500 words = ~9K characters. ElevenLabs Scale tier ($99/mo) provides sufficient character allocation for Studio-tier users. For beta, recommend Scale tier.

### Voice Selection

ElevenLabs provides multiple voices. For Sotto's 2-speaker format:

- **Host voice** (warm, conversational): Try `Rachel`, `Bella`, `Elli`
- **Expert voice** (authoritative, clear): Try `Adam`, `Antoni`, `Josh`

The `src/lib/elevenlabs.ts` file includes a voice pool system. Update the voice IDs based on your ElevenLabs account:

```typescript
// In src/lib/elevenlabs.ts
const VOICE_POOL = {
  hosts: [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  ],
  experts: [
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
  ],
};
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

**Note**: Apple Sign In requires a paid Apple Developer account ($99/year). Skip for initial MVP if budget-constrained.

---

## Payments

### Stripe Setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Activate your account (provides business details, tax info)
3. Go to "Developers" → "API keys"
4. Copy "Publishable key" and "Secret key" (use live mode for production)
5. Add to `.env.production`:

```env
STRIPE_PUBLISHABLE_KEY="pk_live_xxxxx"
STRIPE_SECRET_KEY="sk_live_xxxxx"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_xxxxx"
```

### Create Products

1. Go to "Products" → "Add product"
2. Create six products:

**Subscription Tiers**:

**Starter Tier**:

- Name: "Sotto Starter"
- Pricing: Recurring, $9/month
- Billing period: Monthly

**Pro Tier**:

- Name: "Sotto Pro"
- Pricing: Recurring, $24/month
- Billing period: Monthly

**Studio Tier**:

- Name: "Sotto Studio"
- Pricing: Recurring, $49/month
- Billing period: Monthly

**One-Time Credit Packs**:

**3 Credits Pack**:

- Name: "Sotto 3 Credits"
- Pricing: One-time, $5

**10 Credits Pack**:

- Name: "Sotto 10 Credits"
- Pricing: One-time, $15

**25 Credits Pack**:

- Name: "Sotto 25 Credits"
- Pricing: One-time, $30

3. Copy Price IDs (e.g., `price_xxxxx`)
4. Add to `.env.production`:

```env
STRIPE_PRICE_ID_STARTER="price_xxxxx"
STRIPE_PRICE_ID_PRO="price_xxxxx"
STRIPE_PRICE_ID_STUDIO="price_xxxxx"
STRIPE_PRICE_ID_CREDITS_3="price_xxxxx"
STRIPE_PRICE_ID_CREDITS_10="price_xxxxx"
STRIPE_PRICE_ID_CREDITS_25="price_xxxxx"
```

### Webhook Setup

1. Go to "Developers" → "Webhooks" → "Add endpoint"
2. Endpoint URL: `https://yourdomain.com/api/webhooks/stripe`
3. Listen to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy "Signing secret" (looks like `whsec_xxxxx`)
5. Add to `.env.production`:

```env
STRIPE_WEBHOOK_SECRET="whsec_xxxxx"
```

---

## Deployment

### Deploy Web Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com)
2. "Import Project" → Connect GitHub repo
3. Project settings:
   - Framework: Next.js
   - Root directory: `./`
   - Build command: `npm run build`
   - Output directory: `.next`
4. Environment variables: Paste all `.env.production` values
   - **Important**: Include `NEXT_PUBLIC_*` variables for client-side access
5. Deploy
6. Vercel will assign a URL: `https://sotto-xxxxx.vercel.app`

### Custom Domain (Vercel)

1. Go to project settings → "Domains"
2. Add your domain: `yourdomain.com`
3. Follow DNS instructions:
   - Add A record: `76.76.21.21`
   - Add CNAME for www: `cname.vercel-dns.com`
4. Wait for DNS propagation (5-60 minutes)
5. Vercel automatically provisions SSL certificate

### Deploy Workers (Railway)

1. Go to [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub repo"
3. Connect Sotto repository
4. Create new service: "Sotto Workers"
5. Settings:
   - Build command: `npm install && npm run build`
   - Start command: `npm run dev:workers`
   - Dockerfile: Use `Dockerfile.workers`

Railway Dockerfile (`Dockerfile.workers`):

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install FFmpeg for audio stitching
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Start workers
CMD ["node", "dist/workers/index.js"]
```

6. Environment variables: Paste all `.env.production` values
7. Deploy

**Important**: Workers need separate Redis connections. Railway automatically handles this via environment variables.

### Verify Deployment

1. Web: Visit `https://yourdomain.com`
2. Workers: Check Railway logs for "Worker started" messages
3. Health check: `curl https://yourdomain.com/api/health`

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

Edit `prisma/seed.ts` to create real example podcasts:

```typescript
// Example topics:
// 1. "How Does Bitcoin Work?" (10 min, beginner-friendly)
// 2. "The History of Jazz Music" (15 min, intermediate)
// 3. "Introduction to Quantum Computing" (12 min, technical)
// 4. "Welcome to Sotto" (5 min, platform explanation)
```

### Configure Rate Limiting

Update `src/middleware.ts` to add production rate limits:

```typescript
// Per user: 10 podcast generations per hour
// Per IP: 50 requests per minute
```

### Enable Analytics (Optional)

For MVP, use Vercel Analytics (free):

1. Go to Vercel project → "Analytics"
2. Enable "Vercel Analytics"
3. Add to `src/app/layout.tsx`:

```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

---

## Cost Breakdown

Monthly costs for MVP with 50 beta users (estimated):

| Service              | Tier          | Cost          | Notes                                |
| -------------------- | ------------- | ------------- | ------------------------------------ |
| **Vercel**           | Hobby         | $0            | Up to 100GB bandwidth                |
| **Railway**          | Starter       | $5            | Workers + 512MB RAM                  |
| **Neon PostgreSQL**  | Free          | $0            | 0.5GB storage, 1GB data transfer     |
| **Upstash Redis**    | Free          | $0            | 10K commands/day                     |
| **Cloudflare R2**    | Free          | $0            | 10GB storage, 10M Class A requests   |
| **Anthropic Claude** | Pay-as-you-go | $15-30        | ~100-300 podcast generations         |
| **ElevenLabs**       | Creator       | $22           | 100K characters/month (~11 podcasts) |
| **Stripe**           | Pay-as-you-go | $0-10         | 2.9% + $0.30 per transaction         |
| **Domain**           | Annual        | $1-2/mo       | `.com` domain                        |
| **Total**            |               | **$43-69/mo** | Scales with usage                    |

### Cost Scaling

**At 100 users**:

- Railway: $10 (1GB RAM)
- Neon: $20 (3GB storage)
- Upstash: $10 (100K commands/day)
- Claude: $50-100
- ElevenLabs: $99 (Indie tier, 500K characters)
- **Total: ~$200/mo**

**At 500 users**:

- Vercel: $20 (Pro tier)
- Railway: $50 (4GB RAM)
- Neon: $50 (10GB storage)
- Upstash: $50 (1M commands/day)
- Claude: $200-500
- ElevenLabs: $330 (Growth tier, 2M characters)
- **Total: ~$700-1000/mo**

---

## Testing Checklist

Before sharing with beta users, test every core flow:

### Authentication

- [ ] Sign up with email works
- [ ] Email verification link works
- [ ] Sign in with Google works
- [ ] Sign in with GitHub works
- [ ] Logout works
- [ ] Session persists across page reloads

### Podcast Creation

- [ ] Chat discovery flow loads
- [ ] AI responds with conversational questions
- [ ] Chip suggestions are tappable
- [ ] Can paste URL for source material
- [ ] Shows recommendations before generating
- [ ] "Create mine" starts generation
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

### Billing

- [ ] Pricing page loads with correct tiers
- [ ] "Upgrade" button redirects to Stripe Checkout
- [ ] Can complete test payment (use `4242 4242 4242 4242`)
- [ ] Redirects back to dashboard after payment
- [ ] Subscription shows as "Pro" in billing page
- [ ] "Manage subscription" opens Stripe portal
- [ ] Can cancel subscription in portal

### Mobile (PWA)

- [ ] "Add to Home Screen" prompt appears
- [ ] Installs as standalone app
- [ ] App icon shows on home screen
- [ ] Opens without browser chrome
- [ ] Offline fallback page works
- [ ] Push notifications work on Android

### Performance

- [ ] Lighthouse score > 90 for Performance
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] No console errors on production

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
I built Sotto — podcasts that listen back.

Chat with AI to describe what you want to learn, and it generates a 2-voice conversational podcast. While listening, you can interrupt to ask questions, and the AI answers in context.

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
- Pricing and limits (30s)
- How to give feedback (30s)

Pin this podcast to the top of the feed so every new user sees it.

### Beta Feedback Form

Create a simple feedback form at `/feedback`:

```typescript
// src/app/feedback/page.tsx
// Form fields:
// - What did you like?
// - What was confusing?
// - What features are missing?
// - Would you pay for this? (Yes / No / Maybe)
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

### Vercel Logs

1. Go to Vercel project → "Logs"
2. Filter by:
   - Error logs: `level:error`
   - Slow requests: `duration:>5000`
   - API routes: `path:/api/*`

### Railway Logs

1. Go to Railway project → "Sotto Workers" → "Logs"
2. Filter by worker type:
   - `[script-generation]`
   - `[audio-generation]`
   - `[audio-stitching]`
3. Watch for errors: `level:error`

### BullMQ Dashboard (Optional)

Add Bull Board for visual queue monitoring:

```bash
npm install @bull-board/api @bull-board/express
```

```typescript
// src/app/api/admin/queues/route.ts
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

For MVP, use console.error logs. For production, add Sentry:

```bash
npm install @sentry/nextjs
```

```typescript
// src/lib/logger.ts
import * as Sentry from '@sentry/nextjs';

export function logError(error: Error, context?: any) {
  console.error(error, context);
  if (process.env.NODE_ENV === 'production') {
    Sentry.captureException(error, { extra: context });
  }
}
```

### Key Metrics to Watch

1. **Podcast generation success rate**: Should be > 95%
2. **Audio generation time**: Should be < 5 minutes for 10-minute podcast
3. **API error rate**: Should be < 1%
4. **Database connection pool**: Should not exceed 80%
5. **Redis memory usage**: Should stay under free tier limit
6. **R2 storage usage**: Monitor approaching 10GB limit

### Set Up Alerts

**Vercel**:

- Deploy failure notifications (email)
- Error rate > 5% (email)

**Railway**:

- Worker crash notifications (email)
- Memory usage > 90% (email)

**Upstash**:

- Commands approaching daily limit (email)

---

## Troubleshooting

### Common Issues

#### "Database connection failed"

**Cause**: Invalid `DATABASE_URL` or database not accepting connections

**Fix**:

1. Verify connection string in Neon dashboard
2. Check IP allowlist (Neon allows all by default)
3. Test connection: `npx prisma studio`

#### "Redis connection timeout"

**Cause**: Invalid `REDIS_URL` or free tier commands exceeded

**Fix**:

1. Check Upstash dashboard for daily command usage
2. Upgrade to paid tier if exceeded
3. Optimize Redis usage (reduce cache TTL, use batch operations)

#### "Audio generation stuck at 50%"

**Cause**: ElevenLabs rate limit exceeded or worker crashed

**Fix**:

1. Check ElevenLabs dashboard for quota usage
2. Check Railway logs for worker errors
3. Retry failed jobs: Go to BullMQ dashboard, select job, click "Retry"

#### "Stripe webhook not receiving events"

**Cause**: Webhook endpoint not accessible or incorrect signing secret

**Fix**:

1. Test webhook: Stripe dashboard → Webhooks → Send test event
2. Check Vercel logs for incoming webhook requests
3. Verify `STRIPE_WEBHOOK_SECRET` matches dashboard value

#### "Push notifications not working"

**Cause**: VAPID keys incorrect or service worker not registered

**Fix**:

1. Verify `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is accessible client-side
2. Check browser console for service worker errors
3. Re-register service worker: Clear site data, refresh

#### "Podcast audio is choppy or distorted"

**Cause**: FFmpeg normalization issue or R2 upload incomplete

**Fix**:

1. Check Railway logs for FFmpeg errors
2. Re-run stitching job
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

---

## Next Steps After MVP

Once you have 50+ beta users and stable performance:

1. **Gather feedback**: Analyze feedback form responses, identify top feature requests
2. **Optimize costs**: Monitor usage, upgrade/downgrade tiers as needed
3. **Improve onboarding**: Add tutorial overlay for first-time users
4. **Add mobile apps**: React Native or PWA enhancement
5. **Expand OAuth**: Add LinkedIn, Twitter/X
6. **Studio features**: Voice marketplace, analytics dashboard
7. **Analytics dashboard**: Show creators their podcast stats
8. **Public API**: Let developers build on Sotto
9. **Monetization**: Enable Starter/Pro/Studio tier conversions with in-app prompts

---

## Final Checklist

Before considering MVP "launched":

- [ ] All services are deployed and healthy
- [ ] All environment variables are set correctly
- [ ] Database schema is pushed and seeded
- [ ] Custom domain is configured with SSL
- [ ] OAuth providers are working (Google, GitHub)
- [ ] Stripe products and webhook are configured
- [ ] 3-5 example podcasts are seeded
- [ ] All critical user flows tested end-to-end
- [ ] Error tracking is set up (logs at minimum)
- [ ] Feedback form is live
- [ ] Push notifications are working on Android
- [ ] Monitoring dashboards are accessible
- [ ] Cost alerts are configured
- [ ] Beta user invite list is ready
- [ ] "Welcome to Sotto" podcast is created
- [ ] Social sharing links are tested

---

**You're ready to launch Sotto. Good luck!**

For questions or support, refer to:

- `CLAUDE.md` — Codebase overview
- `docs/00-plan.md` — Full product plan
- `docs/03-technical-architecture.md` — System design
- `docs/06-authentication-setup.md` — Auth deep dive
- `docs/07-stripe-billing.md` — Billing deep dive
- `docs/13-hosting-infrastructure.md` — Infrastructure details
