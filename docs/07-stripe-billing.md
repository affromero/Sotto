# Stripe Billing Integration

> Stripe product/price setup, webhook handler, subscription lifecycle, customer portal, checkout flow, and tier limit enforcement.

**Date:** 2026-02-08

---

## Overview

Sotto uses Stripe for subscription billing with three tiers: Free ($0), Pro ($14/month), and Creator ($29/month). All users start on the Free tier with no Stripe involvement. When a user upgrades, a Stripe Checkout session is created. Stripe webhooks update the local database as subscription state changes (renewals, cancellations, payment failures). The Stripe Customer Portal allows users to manage their own billing, update payment methods, and cancel subscriptions without any custom UI.

| Component | File | Purpose |
|-----------|------|---------|
| Stripe client | `src/lib/stripe.ts` | Stripe SDK init, tier limits, checkout, portal |
| Subscription management | `src/lib/subscription.ts` | Get tier, check usage, enforce limits |
| Webhook handler | `src/app/api/webhooks/stripe/route.ts` | Process Stripe events |
| Billing API | `src/app/api/billing/route.ts` | Checkout + portal session creation |
| Billing page | `src/app/(dashboard)/billing/page.tsx` | User-facing subscription management |

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Yes (for billing) | Stripe API secret key | `sk_test_xxxxxxxxxxxx` |
| `STRIPE_PUBLISHABLE_KEY` | Yes (for billing) | Stripe publishable key (client-side) | `pk_test_xxxxxxxxxxxx` |
| `STRIPE_WEBHOOK_SECRET` | Yes (for billing) | Webhook endpoint signing secret | `whsec_xxxxxxxxxxxx` |
| `STRIPE_PRICE_ID_PRO` | Yes (for billing) | Price ID for Pro tier ($14/mo) | `price_xxxxxxxxxxxx` |
| `STRIPE_PRICE_ID_CREATOR` | Yes (for billing) | Price ID for Creator tier ($29/mo) | `price_xxxxxxxxxxxx` |

All variables are optional in the sense that the app starts without them. Billing features are disabled gracefully when `STRIPE_SECRET_KEY` is missing.

---

## Stripe Dashboard Setup

### Step 1: Create a Stripe Account

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) and create an account
2. Enable test mode (toggle in the top-right of the dashboard)
3. Copy the test API keys from **Developers > API keys**

### Step 2: Create Products and Prices

Create two products in the Stripe Dashboard (or via the API). The Free tier has no Stripe product because there is no charge.

**Product 1: Sotto Pro**

| Field | Value |
|-------|-------|
| Product name | Sotto Pro |
| Description | 8 podcasts/month, 10 interactions/podcast, 3 premium voice credits, private podcasts, downloads |
| Pricing model | Standard pricing |
| Price | $14.00 USD |
| Billing period | Monthly |
| Price ID | Copy this into `STRIPE_PRICE_ID_PRO` |

**Product 2: Sotto Creator**

| Field | Value |
|-------|-------|
| Product name | Sotto Creator |
| Description | 30 podcasts/month, unlimited interactions, 10 premium voice credits, marketplace, analytics |
| Pricing model | Standard pricing |
| Price | $29.00 USD |
| Billing period | Monthly |
| Price ID | Copy this into `STRIPE_PRICE_ID_CREATOR` |

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
3. Under **Products**, add both Sotto Pro and Sotto Creator so users can switch between them
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
    podcastsPerMonth: 2,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 2,
    premiumVoiceCredits: 0,
    maxVoiceClones: 0,
    hasPremiumSfx: false,
    canDownload: false,
    canMakePrivate: false,
  },
  PRO: {
    podcastsPerMonth: 8,
    maxDurationMinutes: 10,
    interactionsPerPodcast: 10,
    premiumVoiceCredits: 3,
    maxVoiceClones: 2,
    hasPremiumSfx: false,
    canDownload: true,
    canMakePrivate: true,
  },
  CREATOR: {
    podcastsPerMonth: 30,
    maxDurationMinutes: 10,
    interactionsPerPodcast: Infinity,
    premiumVoiceCredits: 10,
    maxVoiceClones: 5,
    hasPremiumSfx: true,
    canDownload: true,
    canMakePrivate: true,
  },
} as const;
```

### Tier Comparison

| Feature | Free | Pro ($14/mo) | Creator ($29/mo) |
|---------|------|-------------|------------------|
| Podcasts per month | 2 | 8 | 30 |
| Max duration | 10 min | 10 min | 10 min |
| Interactions per podcast | 2 | 10 | Unlimited |
| Premium voice credits | 0 | 3/mo | 10/mo |
| Voice clones | 0 | 2 | 5 |
| Sound effects | Standard | Standard | Premium (ElevenLabs SFX) |
| Download MP3 / PDF | No | Yes | Yes |
| Private/Unlisted podcasts | No | Yes | Yes |
| Voice library browsing | No | Yes | Yes |
| Marketplace / Analytics | No | No | Yes |

### Limit Enforcement Points

Limits are checked at the following points in the application:

| Check | Where | What Happens |
|-------|-------|-------------|
| Podcast creation limit | `POST /api/podcasts` | Returns 403 with usage message |
| Duration limit | `script-generation.worker.ts` | Truncates script to max duration |
| Interaction limit | `POST /api/podcasts/[id]/interact` | Returns 403 after limit reached |
| Visibility restriction | `PATCH /api/podcasts/[id]` | Returns 403 if trying to set private on Free |
| Download restriction | `GET /api/podcasts/[id]/download` | Returns 403 for Free tier |
| Voice count | Discovery agent | Limits voice choices in discovery chat |

The helper functions for limit checking are in `src/lib/stripe.ts`:

```typescript
export function canCreatePodcast(
  tier: TierName,
  podcastsUsed: number
): { allowed: boolean; reason?: string } {
  const limits = TIER_LIMITS[tier];
  if (podcastsUsed >= limits.podcastsPerMonth) {
    return {
      allowed: false,
      reason: `You've used all ${limits.podcastsPerMonth} podcasts this month. Upgrade to create more.`,
    };
  }
  return { allowed: true };
}

export function canInteract(
  tier: TierName,
  interactionCount: number
): { allowed: boolean; reason?: string } {
  const limits = TIER_LIMITS[tier];
  if (interactionCount >= limits.interactionsPerPodcast) {
    return {
      allowed: false,
      reason: `Free tier allows ${limits.interactionsPerPodcast} interactions per podcast. Upgrade for unlimited.`,
    };
  }
  return { allowed: true };
}
```

The subscription tier is resolved by looking up the `Subscription` model:

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

  const priceId = tier === 'pro'
    ? process.env.STRIPE_PRICE_ID_PRO
    : process.env.STRIPE_PRICE_ID_CREATOR;

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
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
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
- Switching between Pro and Creator plans
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

| Event | When It Fires | What the Handler Does |
|-------|--------------|----------------------|
| `checkout.session.completed` | User completes payment on Stripe Checkout | Creates `Subscription` record, links Stripe customer ID to user, sets tier to PRO or CREATOR, sets status to ACTIVE |
| `customer.subscription.updated` | Subscription renews, plan changes, or period updates | Updates tier (if plan changed), updates `currentPeriodStart`/`currentPeriodEnd`, updates status, resets monthly usage on period renewal |
| `customer.subscription.deleted` | Subscription is canceled (after period end) or immediately deleted | Sets subscription status to CANCELED, downgrades user to FREE tier limits |
| `invoice.payment_failed` | Payment attempt fails (card declined, insufficient funds) | Sets subscription status to PAST_DUE, creates in-app notification to update payment method |
| `invoice.paid` | Invoice is successfully paid (includes renewals) | Resets `podcastsUsed` counter to 0 for the new billing period, ensures subscription status is ACTIVE |

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
  const tier = priceId === process.env.STRIPE_PRICE_ID_CREATOR ? 'CREATOR' : 'PRO';

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
  const tier = priceId === process.env.STRIPE_PRICE_ID_CREATOR ? 'CREATOR' : 'PRO';

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

    // Reset usage on period renewal
    if (newPeriodEnd.getTime() > previousPeriodEnd.getTime()) {
      await prisma.user.update({
        where: { id: dbSubscription.userId },
        data: { podcastsUsed: 0 },
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

    // Reset user to free tier limits
    await prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        podcastsAllowed: 3,
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
[ACTIVE - PRO or CREATOR]
      |
      +----> [Period renews: invoice.paid]
      |          Reset podcastsUsed = 0
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

### Usage Reset Logic

The `podcastsUsed` counter on the `User` model tracks how many podcasts a user has created in the current billing period. This counter resets to 0 when:

1. A new billing period starts (detected by comparing `currentPeriodEnd` timestamps in the `customer.subscription.updated` webhook)
2. An `invoice.paid` event fires for a renewal invoice

For Free tier users, there is no Stripe subscription, so the counter resets on a calendar-month basis. This is handled by checking the `createdAt` dates of podcasts created in the current month rather than relying on a counter reset.

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
  PRO
  CREATOR
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

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 3220` | 3D Secure authentication required |
| `4000 0000 0000 9995` | Payment declined (insufficient funds) |
| `4000 0000 0000 0341` | Payment fails after attaching to customer |

Use any future expiration date, any 3-digit CVC, and any billing address.

### Full Local Testing Workflow

1. Start the app: `npm run dev`
2. Start the Stripe CLI listener: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
3. Copy the `whsec_` signing secret from the CLI output into `.env`
4. Navigate to `http://localhost:3000/pricing`
5. Sign in and click "Upgrade to Pro"
6. Use test card `4242 4242 4242 4242`
7. Complete the checkout
8. Verify in Prisma Studio (`npx prisma studio`) that a `Subscription` record was created with `status: ACTIVE` and `tier: PRO`
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
- `User`: `podcastsUsed` should reset to 0 on period renewal

---

## Handling Edge Cases

### Duplicate Webhooks

Stripe may send the same webhook event multiple times. The `SubscriptionEvent.stripeEventId` unique constraint prevents duplicate processing. Wrap event handling in a try/catch that ignores unique constraint violations.

### Race Conditions

If `checkout.session.completed` and `customer.subscription.updated` arrive simultaneously, the `upsert` operation on the `Subscription` model handles this gracefully. The last write wins, and both events write the same essential data.

### Cancellation Grace Period

When a user cancels their subscription through the customer portal, Stripe sets `cancel_at_period_end: true`. The user retains access to paid features until the current billing period ends. At that point, `customer.subscription.deleted` fires and the handler downgrades them.

The `cancelAtPeriodEnd` flag on the `Subscription` model is used to show a "Your subscription will end on [date]" message on the billing page.

### Subscription Switching (Pro to Creator or Creator to Pro)

When a user changes their plan through the customer portal, Stripe sends a `customer.subscription.updated` event with the new price ID. The handler maps the price ID to the tier and updates the database. Stripe handles proration automatically (charging or crediting the difference for the remaining period).

### Failed Payment Recovery

Stripe automatically retries failed payments according to your retry schedule (configurable in **Settings > Billing > Subscriptions and emails > Manage failed payments**). The recommended retry schedule for Sotto:

| Retry | Timing | After |
|-------|--------|-------|
| 1st retry | 3 days after failure | invoice.payment_failed |
| 2nd retry | 5 days after first retry | invoice.payment_failed |
| 3rd retry | 7 days after second retry | invoice.payment_failed |
| Final | Mark subscription as canceled | customer.subscription.deleted |

During the retry period, the subscription is `PAST_DUE`. The user sees a banner on the billing page prompting them to update their payment method.
