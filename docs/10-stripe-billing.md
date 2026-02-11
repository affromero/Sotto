# Stripe Billing Integration

> Stripe product/price setup, webhook handler, subscription lifecycle, customer portal, checkout flow, and tier limit enforcement.

**Date:** 2026-02-08

---

## Overview

Sotto uses Stripe for subscription billing with four paid tiers: Free ($0), Starter ($9/month), Pro ($24/month), and Studio ($49/month). All users start on the Free tier with no Stripe involvement. When a user upgrades, a Stripe Checkout session is created. Stripe webhooks update the local database as subscription state changes (renewals, cancellations, payment failures). The Stripe Customer Portal allows users to manage their own billing, update payment methods, and cancel subscriptions without any custom UI.

**Credit-based pricing**: Each podcast generation costs 1 credit (+ premium voice surcharge if applicable). Monthly credits roll over per-tier limits. One-time credit packs available for paid tiers only.

| Component               | File                                   | Purpose                                        |
| ----------------------- | -------------------------------------- | ---------------------------------------------- |
| Stripe client           | `src/lib/stripe.ts`                    | Stripe SDK init, tier limits, checkout, portal |
| Subscription management | `src/lib/subscription.ts`              | Get tier, check usage, enforce limits          |
| Webhook handler         | `src/app/api/webhooks/stripe/route.ts` | Process Stripe events                          |
| Billing API             | `src/app/api/billing/route.ts`         | Checkout + portal session creation             |
| Billing page            | `src/app/(dashboard)/billing/page.tsx` | User-facing subscription management            |

---

## Environment Variables

| Variable                  | Required          | Description                          | Example                |
| ------------------------- | ----------------- | ------------------------------------ | ---------------------- |
| `STRIPE_SECRET_KEY`       | Yes (for billing) | Stripe API secret key                | `sk_test_xxxxxxxxxxxx` |
| `STRIPE_PUBLISHABLE_KEY`  | Yes (for billing) | Stripe publishable key (client-side) | `pk_test_xxxxxxxxxxxx` |
| `STRIPE_WEBHOOK_SECRET`   | Yes (for billing) | Webhook endpoint signing secret      | `whsec_xxxxxxxxxxxx`   |
| `STRIPE_PRICE_ID_STARTER` | Yes (for billing) | Price ID for Starter tier ($9/mo)    | `price_xxxxxxxxxxxx`   |
| `STRIPE_PRICE_ID_PRO`     | Yes (for billing) | Price ID for Pro tier ($24/mo)       | `price_xxxxxxxxxxxx`   |
| `STRIPE_PRICE_ID_STUDIO`  | Yes (for billing) | Price ID for Studio tier ($49/mo)    | `price_xxxxxxxxxxxx`   |

All variables are optional in the sense that the app starts without them. Billing features are disabled gracefully when `STRIPE_SECRET_KEY` is missing.

---

## Stripe Dashboard Setup

### Step 1: Create a Stripe Account

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) and create an account
2. Enable test mode (toggle in the top-right of the dashboard)
3. Copy the test API keys from **Developers > API keys**

### Step 2: Create Products and Prices

Create three products in the Stripe Dashboard (or via the API). The Free tier has no Stripe product because there is no charge.

**Product 1: Sotto Starter**

| Field          | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Product name   | Sotto Starter                                                                  |
| Description    | 5 credits/month (2 rollover), 5 interactions/podcast, 1 voice clone, downloads |
| Pricing model  | Standard pricing                                                               |
| Price          | $9.00 USD                                                                      |
| Billing period | Monthly                                                                        |
| Price ID       | Copy this into `STRIPE_PRICE_ID_STARTER`                                       |

**Product 2: Sotto Pro**

| Field          | Value                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Product name   | Sotto Pro                                                                                                      |
| Description    | 15 credits/month (5 rollover), unlimited interactions, 3 voice clones, private podcasts, analytics, PDF export |
| Pricing model  | Standard pricing                                                                                               |
| Price          | $24.00 USD                                                                                                     |
| Billing period | Monthly                                                                                                        |
| Price ID       | Copy this into `STRIPE_PRICE_ID_PRO`                                                                           |

**Product 3: Sotto Studio**

| Field          | Value                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Product name   | Sotto Studio                                                                                                           |
| Description    | 50 credits/month (20 rollover), unlimited interactions, 10 voice clones, 0 premium surcharge, marketplace, premium SFX |
| Pricing model  | Standard pricing                                                                                                       |
| Price          | $49.00 USD                                                                                                             |
| Billing period | Monthly                                                                                                                |
| Price ID       | Copy this into `STRIPE_PRICE_ID_STUDIO`                                                                                |

To create via Stripe Dashboard:

1. Navigate to **Products** in the sidebar
2. Click **Add product**
3. Fill in the name, description, and monthly price
4. After creation, click into the product and find the Price ID (starts with `price_`)
5. Copy each Price ID into your `.env` file

### Step 3: Configure the Customer Portal

The customer portal lets users manage their subscription without custom UI:

1. Navigate to **Settings > Billing > Customer portal**
2. Enable the following features:
   - **Invoices**: allow customers to view invoice history
   - **Payment methods**: allow updating payment method
   - **Subscriptions**: allow canceling, and switching between Pro and Creator
   - **Cancel subscription**: enable with "Cancel at end of billing period" behavior
3. Under **Products**, add Sotto Starter, Sotto Pro, and Sotto Studio so users can switch between them
4. Set the **Default return URL** to `https://sotto.fm/billing` (or `http://localhost:3000/billing` for dev)
5. Save the configuration

### Step 4: Set Up the Webhook Endpoint

**For production:**

1. Navigate to **Developers > Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://sotto.fm/api/webhooks/stripe`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`) into `STRIPE_WEBHOOK_SECRET`

**For local development:** Use the Stripe CLI (see "Testing with Stripe CLI" section below).

---

## Pricing Tiers and Limits

Tier limits are defined in `src/lib/stripe.ts` and enforced throughout the application:

```typescript
export const TIER_LIMITS = {
  FREE: {
    creditsPerMonth: 2,
    maxRolloverCredits: 0,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 2,
    maxVoiceClones: 0,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: false,
    canMakePrivate: false,
    hasVoiceLibrary: false,
    hasMarketplace: false,
    hasAnalytics: false,
    hasPdfExport: false,
  },
  STARTER: {
    creditsPerMonth: 5,
    maxRolloverCredits: 2,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 5,
    maxVoiceClones: 1,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: false,
    hasVoiceLibrary: false,
    hasMarketplace: false,
    hasAnalytics: false,
    hasPdfExport: false,
  },
  PRO: {
    creditsPerMonth: 15,
    maxRolloverCredits: 5,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: 3,
    premiumVoiceSurcharge: 1,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: true,
    hasVoiceLibrary: true,
    hasMarketplace: false,
    hasAnalytics: true,
    hasPdfExport: true,
  },
  STUDIO: {
    creditsPerMonth: 50,
    maxRolloverCredits: 20,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: 10,
    premiumVoiceSurcharge: 0,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    hasVoiceLibrary: true,
    hasMarketplace: true,
    hasAnalytics: true,
    hasPdfExport: true,
  },
  ADMIN: {
    creditsPerMonth: Infinity,
    maxRolloverCredits: Infinity,
    maxDurationMinutes: 60,
    interactionsPerPodcast: Infinity,
    maxVoiceClones: Infinity,
    premiumVoiceSurcharge: 0,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
    hasVoiceLibrary: true,
    hasMarketplace: true,
    hasAnalytics: true,
    hasPdfExport: true,
  },
} as const;
```

### Tier Comparison

| Feature                   | Free     | Starter ($9/mo) | Pro ($24/mo) | Studio ($49/mo)          | Admin     |
| ------------------------- | -------- | --------------- | ------------ | ------------------------ | --------- |
| Credits per month         | 2        | 5               | 15           | 50                       | Infinity  |
| Rollover credits          | 0        | 2               | 5            | 20                       | Infinity  |
| Max duration              | 10 min   | 10 min          | 10 min       | 10 min                   | 60 min    |
| Interactions per podcast  | 2        | 5               | Unlimited    | Unlimited                | Unlimited |
| Voice clones              | 0        | 1               | 3            | 10                       | Unlimited |
| Premium voice surcharge   | +1       | +1              | +1           | 0 (included)             | 0         |
| Sound effects             | Standard | Standard        | Standard     | Premium (ElevenLabs SFX) | Premium   |
| Download MP3              | No       | Yes             | Yes          | Yes                      | Yes       |
| PDF transcript export     | No       | No              | Yes          | Yes                      | Yes       |
| Private/Unlisted podcasts | No       | No              | Yes          | Yes                      | Yes       |
| Voice library browsing    | No       | No              | Yes          | Yes                      | Yes       |
| Marketplace               | No       | No              | No           | Yes                      | Yes       |
| Analytics                 | No       | No              | Yes          | Yes                      | Yes       |

### Limit Enforcement Points

Limits are checked at the following points in the application:

| Check                   | Where                              | What Happens                                         |
| ----------------------- | ---------------------------------- | ---------------------------------------------------- |
| Credit availability     | `POST /api/podcasts`               | Returns 403 if insufficient credits                  |
| Premium voice surcharge | `POST /api/podcasts`               | Deducts extra credits if using premium voices        |
| Duration limit          | `script-generation.worker.ts`      | Truncates script to max duration                     |
| Interaction limit       | `POST /api/podcasts/[id]/interact` | Returns 403 after limit reached                      |
| Visibility restriction  | `PATCH /api/podcasts/[id]`         | Returns 403 if trying to set private on Free/Starter |
| Download restriction    | `GET /api/podcasts/[id]/download`  | Returns 403 for Free tier                            |
| PDF export restriction  | `GET /api/podcasts/[id]/pdf`       | Returns 403 for Free/Starter tiers                   |
| Voice clone limit       | Discovery agent                    | Limits voice choices based on tier                   |

The helper functions for limit checking are in `src/lib/stripe.ts`:

```typescript
export function canGenerate(
  tier: TierName,
  creditsAvailable: number,
  usePremiumVoice: boolean = false
): { allowed: boolean; reason?: string; cost: number } {
  const limits = TIER_LIMITS[tier];
  const cost = 1 + (usePremiumVoice ? limits.premiumVoiceSurcharge : 0);

  if (creditsAvailable < cost) {
    return {
      allowed: false,
      reason: `Insufficient credits. Need ${cost} credit${cost > 1 ? 's' : ''}, you have ${creditsAvailable}.`,
      cost,
    };
  }
  return { allowed: true, cost };
}

export function canInteract(
  tier: TierName,
  interactionCount: number
): { allowed: boolean; reason?: string } {
  const limits = TIER_LIMITS[tier];
  if (interactionCount >= limits.interactionsPerPodcast) {
    return {
      allowed: false,
      reason: `Your tier allows ${limits.interactionsPerPodcast} interactions per podcast. Upgrade for more.`,
    };
  }
  return { allowed: true };
}

export async function consumeCredit(userId: string, amount: number = 1): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { creditsAvailable: { decrement: amount } },
  });
}
```

The subscription tier and credit balance are resolved by looking up the `Subscription` and `User` models:

```typescript
// src/lib/subscription.ts
export async function getUserTier(userId: string): Promise<TierName> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription || subscription.status !== 'ACTIVE') {
    return 'FREE';
  }

  return subscription.tier as TierName;
}

export async function getUserCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditsAvailable: true },
  });

  return user?.creditsAvailable ?? 0;
}
```

---

## Checkout Flow

The checkout flow creates a Stripe Checkout Session and redirects the user to Stripe's hosted payment page.

### Sequence

```
User clicks "Upgrade to Pro" on /pricing or /billing
    |
    v
POST /api/billing/checkout  { tier: "pro" }
    |
    v
Server creates Stripe Checkout Session
    - mode: 'subscription'
    - customer_email: user's email
    - line_items: [{ price: STRIPE_PRICE_ID_PRO, quantity: 1 }]
    - success_url: /billing?success=true
    - cancel_url: /billing?canceled=true
    - metadata: { userId: user.id }
    |
    v
Server returns checkout session URL
    |
    v
Client redirects to Stripe Checkout
    |
    v
User enters payment details on Stripe
    |
    v
Stripe processes payment
    |
    v
Stripe sends checkout.session.completed webhook
    |
    v
Webhook handler creates/updates Subscription record
    |
    v
User is redirected to /billing?success=true
```

### Checkout Session Creation

```typescript
// src/lib/stripe.ts
export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.userEmail,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { userId: params.userId },
  });

  return session.url || '';
}
```

### API Route

```typescript
// src/app/api/billing/checkout/route.ts
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { tier } = checkoutSchema.parse(body);

  const priceIdMap: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_ID_STARTER,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    studio: process.env.STRIPE_PRICE_ID_STUDIO,
  };

  const priceId = priceIdMap[tier];

  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
  }

  const url = await createCheckoutSession({
    userId: session.user.id,
    userEmail: session.user.email!,
    priceId,
    successUrl: `${process.env.NEXTAUTH_URL}/billing?success=true`,
    cancelUrl: `${process.env.NEXTAUTH_URL}/billing?canceled=true`,
  });

  return NextResponse.json({ url });
}
```

---

## Customer Portal

The customer portal allows users to manage their subscription without any custom billing UI:

```typescript
// src/lib/stripe.ts
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}
```

Users access the portal from the `/billing` page. The portal allows:

- Viewing invoice history
- Updating payment method
- Switching between Starter, Pro, and Studio plans
- Canceling the subscription (takes effect at end of billing period)

---

## Webhook Handler

The webhook handler at `src/app/api/webhooks/stripe/route.ts` processes Stripe events and updates the database accordingly.

### Webhook Signature Verification

Every webhook request is verified using the signing secret to ensure it came from Stripe and was not tampered with:

```typescript
export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Process event...
  return NextResponse.json({ received: true });
}
```

### Handled Events

| Event                           | When It Fires                                                      | What the Handler Does                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`    | User completes payment on Stripe Checkout                          | Creates `Subscription` record, links Stripe customer ID to user, sets tier to STARTER/PRO/STUDIO, sets status to ACTIVE, grants monthly credits                  |
| `customer.subscription.updated` | Subscription renews, plan changes, or period updates               | Updates tier (if plan changed), updates `currentPeriodStart`/`currentPeriodEnd`, updates status, grants monthly credits and processes rollover on period renewal |
| `customer.subscription.deleted` | Subscription is canceled (after period end) or immediately deleted | Sets subscription status to CANCELED, downgrades user to FREE tier limits, resets credits                                                                        |
| `invoice.payment_failed`        | Payment attempt fails (card declined, insufficient funds)          | Sets subscription status to PAST_DUE, creates in-app notification to update payment method                                                                       |
| `invoice.paid`                  | Invoice is successfully paid (includes renewals)                   | Grants monthly credits + rollover (capped at tier limit), ensures subscription status is ACTIVE                                                                  |

### Event Processing Logic

**checkout.session.completed:**

```typescript
case 'checkout.session.completed': {
  const checkoutSession = event.data.object;
  const userId = checkoutSession.metadata?.userId;
  const subscriptionId = checkoutSession.subscription as string;
  const customerId = checkoutSession.customer as string;

  if (!userId) break;

  // Retrieve the subscription to get price details
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = stripeSubscription.items.data[0].price.id;

  // Determine tier from price ID
  let tier: 'STARTER' | 'PRO' | 'STUDIO' = 'PRO';
  if (priceId === process.env.STRIPE_PRICE_ID_STARTER) tier = 'STARTER';
  else if (priceId === process.env.STRIPE_PRICE_ID_STUDIO) tier = 'STUDIO';

  // Create or update subscription record
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      tier,
      status: 'ACTIVE',
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      tier,
      status: 'ACTIVE',
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    },
  });

  // Log event
  await prisma.subscriptionEvent.create({
    data: {
      userId,
      type: 'checkout.session.completed',
      stripeEventId: event.id,
      data: event.data.object as any,
    },
  });

  break;
}
```

**customer.subscription.updated:**

```typescript
case 'customer.subscription.updated': {
  const subscription = event.data.object;
  const priceId = subscription.items.data[0].price.id;

  let tier: 'STARTER' | 'PRO' | 'STUDIO' = 'PRO';
  if (priceId === process.env.STRIPE_PRICE_ID_STARTER) tier = 'STARTER';
  else if (priceId === process.env.STRIPE_PRICE_ID_STUDIO) tier = 'STUDIO';

  // Map Stripe status to our enum
  const statusMap: Record<string, string> = {
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
    unpaid: 'UNPAID',
    trialing: 'TRIALING',
  };

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (dbSubscription) {
    const previousPeriodEnd = dbSubscription.currentPeriodEnd;
    const newPeriodEnd = new Date(subscription.current_period_end * 1000);

    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        tier,
        stripePriceId: priceId,
        status: statusMap[subscription.status] || 'ACTIVE',
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: newPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    // Grant monthly credits + rollover on period renewal
    if (newPeriodEnd.getTime() > previousPeriodEnd.getTime()) {
      const limits = TIER_LIMITS[tier];
      const user = await prisma.user.findUnique({
        where: { id: dbSubscription.userId },
        select: { creditsAvailable: true },
      });

      const currentCredits = user?.creditsAvailable ?? 0;
      const rollover = Math.min(currentCredits, limits.maxRolloverCredits);
      const newCredits = limits.creditsPerMonth + rollover;

      await prisma.user.update({
        where: { id: dbSubscription.userId },
        data: { creditsAvailable: newCredits },
      });
    }
  }

  break;
}
```

**customer.subscription.deleted:**

```typescript
case 'customer.subscription.deleted': {
  const subscription = event.data.object;

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (dbSubscription) {
    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: 'CANCELED',
        tier: 'FREE',
      },
    });

    // Reset user to free tier credits
    await prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        creditsAvailable: TIER_LIMITS.FREE.creditsPerMonth,
      },
    });
  }

  break;
}
```

**invoice.payment_failed:**

```typescript
case 'invoice.payment_failed': {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription as string;

  const dbSubscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (dbSubscription) {
    await prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status: 'PAST_DUE' },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        userId: dbSubscription.userId,
        type: 'PODCAST_READY', // Using closest type; consider adding PAYMENT_FAILED
        title: 'Payment failed',
        message: 'Your subscription payment failed. Please update your payment method to continue using Pro/Creator features.',
        data: { action: 'update_payment' },
      },
    });
  }

  break;
}
```

---

## Subscription Lifecycle

### State Diagram

```
[No Subscription]
      |
      | User signs up (Free tier)
      v
[FREE - No Stripe record]
      |
      | User clicks "Upgrade"
      | Creates Stripe Checkout Session
      v
[Checkout in progress]
      |
      | checkout.session.completed webhook
      v
[ACTIVE - STARTER/PRO/STUDIO]
      |
      +----> [Period renews: invoice.paid]
      |          Grant monthly credits + rollover via grantMonthlyCredits()
      |          Update currentPeriodEnd
      |          Loop back to ACTIVE
      |
      +----> [Payment fails: invoice.payment_failed]
      |          |
      |          v
      |      [PAST_DUE]
      |          |
      |          +----> Retried successfully: invoice.paid --> back to ACTIVE
      |          |
      |          +----> All retries fail: customer.subscription.deleted
      |                     |
      |                     v
      |                 [CANCELED --> effectively FREE]
      |
      +----> [User cancels via portal: customer.subscription.updated]
      |          cancelAtPeriodEnd = true
      |          Still ACTIVE until period ends
      |          |
      |          v (at period end)
      |      customer.subscription.deleted --> CANCELED
      |
      +----> [User switches plan: customer.subscription.updated]
                 Tier changes (PRO <-> CREATOR)
                 Proration applied by Stripe
```

### Credit Grant & Rollover Logic

The `creditsAvailable` counter on the `User` model tracks how many credits a user currently has. Credits are granted and rolled over when:

1. A new billing period starts (detected by comparing `currentPeriodEnd` timestamps in the `customer.subscription.updated` webhook)
2. An `invoice.paid` event fires for a renewal invoice

**Rollover calculation:**

- Current unused credits are carried over up to the tier's `maxRolloverCredits` limit
- New credits = `creditsPerMonth` + `min(currentCredits, maxRolloverCredits)`
- Example: Pro user with 8 unused credits → rollover capped at 5 → receives 15 + 5 = 20 credits

**Credit consumption:**

- Each podcast generation costs 1 credit
- Premium voice usage adds the tier's `premiumVoiceSurcharge` (0 for Studio/Admin, 1 for others)
- Credits are deducted immediately upon generation start via `consumeCredit()`

For Free tier users, there is no Stripe subscription, so credits reset to 2 on a calendar-month basis (tracked via `lastCreditResetAt` timestamp on the `User` model).

---

## Subscription Database Model

```prisma
model Subscription {
  id                   String             @id @default(cuid())
  userId               String             @unique
  stripeCustomerId     String             @unique
  stripeSubscriptionId String             @unique
  stripePriceId        String
  status               SubscriptionStatus @default(PENDING)
  tier                 SubscriptionTier   @default(FREE)
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime
  cancelAtPeriodEnd    Boolean            @default(false)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum SubscriptionStatus {
  PENDING
  ACTIVE
  PAST_DUE
  CANCELED
  UNPAID
  TRIALING
}

enum SubscriptionTier {
  FREE
  STARTER
  PRO
  STUDIO
}

model SubscriptionEvent {
  id            String   @id @default(cuid())
  userId        String
  type          String
  stripeEventId String   @unique
  data          Json
  createdAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

The `SubscriptionEvent` model logs every Stripe webhook event for audit purposes. The `stripeEventId` unique constraint ensures idempotent processing (the same event cannot be processed twice).

---

## Testing with Stripe CLI

The [Stripe CLI](https://stripe.com/docs/stripe-cli) forwards webhook events to your local development server.

### Installation

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Linux
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe
```

### Setup

```bash
# Login to your Stripe account
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI will output a webhook signing secret starting with `whsec_`. Copy this into your `.env` file as `STRIPE_WEBHOOK_SECRET`.

### Trigger Test Events

```bash
# Simulate a complete checkout flow
stripe trigger checkout.session.completed

# Simulate a subscription update
stripe trigger customer.subscription.updated

# Simulate a subscription deletion
stripe trigger customer.subscription.deleted

# Simulate a failed payment
stripe trigger invoice.payment_failed

# Simulate a successful invoice payment
stripe trigger invoice.paid
```

### Test Card Numbers

When testing the checkout flow in the browser with Stripe's test mode:

| Card Number           | Scenario                                  |
| --------------------- | ----------------------------------------- |
| `4242 4242 4242 4242` | Successful payment                        |
| `4000 0000 0000 3220` | 3D Secure authentication required         |
| `4000 0000 0000 9995` | Payment declined (insufficient funds)     |
| `4000 0000 0000 0341` | Payment fails after attaching to customer |

Use any future expiration date, any 3-digit CVC, and any billing address.

### Full Local Testing Workflow

1. Start the app: `npm run dev`
2. Start the Stripe CLI listener: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
3. Copy the `whsec_` signing secret from the CLI output into `.env`
4. Navigate to `http://localhost:3000/pricing`
5. Sign in and click "Upgrade to Starter" (or Pro/Studio)
6. Use test card `4242 4242 4242 4242`
7. Complete the checkout
8. Verify in Prisma Studio (`npx prisma studio`) that a `Subscription` record was created with `status: ACTIVE` and `tier: STARTER/PRO/STUDIO`, and that `User.creditsAvailable` was updated
9. Verify the `SubscriptionEvent` was logged
10. Check the Stripe CLI terminal for the received webhook events

### Verifying Webhook Processing

After triggering a test event, verify the database state:

```bash
npx prisma studio
```

Check these tables:

- `Subscription`: status, tier, currentPeriodEnd should be updated
- `SubscriptionEvent`: event should be logged with the Stripe event ID
- `User`: `creditsAvailable` should be updated with monthly grant + rollover on period renewal

---

## Handling Edge Cases

### Duplicate Webhooks

Stripe may send the same webhook event multiple times. The `SubscriptionEvent.stripeEventId` unique constraint prevents duplicate processing. Wrap event handling in a try/catch that ignores unique constraint violations.

### Race Conditions

If `checkout.session.completed` and `customer.subscription.updated` arrive simultaneously, the `upsert` operation on the `Subscription` model handles this gracefully. The last write wins, and both events write the same essential data.

### Cancellation Grace Period

When a user cancels their subscription through the customer portal, Stripe sets `cancel_at_period_end: true`. The user retains access to paid features until the current billing period ends. At that point, `customer.subscription.deleted` fires and the handler downgrades them.

The `cancelAtPeriodEnd` flag on the `Subscription` model is used to show a "Your subscription will end on [date]" message on the billing page.

### Subscription Switching (Between Starter/Pro/Studio)

When a user changes their plan through the customer portal, Stripe sends a `customer.subscription.updated` event with the new price ID. The handler maps the price ID to the tier and updates the database. Stripe handles proration automatically (charging or crediting the difference for the remaining period).

**Credit adjustment on plan change:**
When upgrading mid-cycle, existing credits are preserved and the new tier's monthly grant is prorated. When downgrading, excess credits beyond the new tier's limit are forfeited.

### Failed Payment Recovery

Stripe automatically retries failed payments according to your retry schedule (configurable in **Settings > Billing > Subscriptions and emails > Manage failed payments**). The recommended retry schedule for Sotto:

| Retry     | Timing                        | After                         |
| --------- | ----------------------------- | ----------------------------- |
| 1st retry | 3 days after failure          | invoice.payment_failed        |
| 2nd retry | 5 days after first retry      | invoice.payment_failed        |
| 3rd retry | 7 days after second retry     | invoice.payment_failed        |
| Final     | Mark subscription as canceled | customer.subscription.deleted |

During the retry period, the subscription is `PAST_DUE`. The user sees a banner on the billing page prompting them to update their payment method.
