# Mobile Strategy

> PWA implementation for launch, React Native roadmap for the future, mobile-first CSS approach, audio playback on mobile, performance budgets, and app store considerations.

**Date:** 2026-02-08

---

## Overview

Sotto is designed mobile-first. The primary usage scenario is a user on their commute creating and listening to podcasts on their phone. The platform strategy is:

| Phase         | Platform               | Technology          | Timeline    |
| ------------- | ---------------------- | ------------------- | ----------- |
| Phase 1 (MVP) | Web (mobile + desktop) | Next.js PWA         | Launch      |
| Phase 2       | iOS                    | React Native + Expo | Post-launch |
| Phase 3       | Android                | React Native + Expo | After iOS   |

The web app is a Progressive Web App (PWA) from day one, providing a near-native experience on mobile browsers with offline support, push notifications, and add-to-homescreen capability. Native apps will be built later using React Native with Expo, sharing API endpoints and design tokens with the web app.

---

## PWA Implementation

### manifest.json

The web app manifest is at `public/manifest.json`:

```json
{
  "name": "Sotto — Podcasts That Listen Back",
  "short_name": "Sotto",
  "description": "Generate AI podcasts, interrupt to ask questions, share knowledge.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FEFCF8",
  "theme_color": "#D97706",
  "orientation": "portrait",
  "categories": ["education", "entertainment", "productivity"],
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "shortcuts": [
    {
      "name": "Create Podcast",
      "short_name": "Create",
      "url": "/create",
      "icons": [{ "src": "/icons/create-shortcut.png", "sizes": "96x96" }]
    },
    {
      "name": "My Podcasts",
      "short_name": "Dashboard",
      "url": "/dashboard",
      "icons": [{ "src": "/icons/dashboard-shortcut.png", "sizes": "96x96" }]
    }
  ]
}
```

Key manifest properties:

- `display: "standalone"` removes the browser chrome, making it feel like a native app
- `orientation: "portrait"` locks to portrait since podcast listening and chat-based creation are both vertical experiences
- `theme_color: "#D97706"` sets the status bar color on Android to Sotto's golden amber
- `background_color: "#FEFCF8"` sets the splash screen background to soft cream
- `shortcuts` provide quick-launch actions from the homescreen long-press menu
- `maskable` icon purpose ensures the icon renders correctly on all Android device shapes

### Link in HTML Head

The manifest is linked in the root layout (`src/app/layout.tsx`):

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#D97706" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Sotto" />
<link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
```

### Service Worker

The service worker (`public/sw.js`) handles offline caching, push notification display, and background audio continuity.

#### Caching Strategy

```javascript
const CACHE_NAME = 'sotto-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/fonts/DMSerifDisplay-Regular.woff2',
  '/fonts/Inter-Variable.woff2',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

// Fetch: network-first for API/pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls and pages: network first, fall back to cache
  if (url.pathname.startsWith('/api/') || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache first, fall back to network
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
```

#### Offline Support

When offline, the PWA serves cached versions of:

- The app shell (HTML, CSS, JavaScript)
- Fonts (DM Serif Display, Inter)
- Previously visited pages (cached on first load)
- Previously played podcast audio (if cached via the audio player)

Features that require network access (discovery chat, generation, search) show a clear offline indicator with a retry button.

### Push Notifications

Push notifications are delivered via the Web Push API using VAPID keys.

#### Registration Flow

```
User clicks "Enable notifications" (PushPrompt component)
    |
    v
Browser shows native permission dialog
    |
    v (if granted)
navigator.serviceWorker.ready
    |
    v
registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY
})
    |
    v
Client sends subscription to POST /api/notifications/push-register
    |
    v
Server stores PushSubscription {endpoint, p256dh, auth} in database
```

#### Server-Side Sending

```typescript
// apps/web/src/lib/push-notifications.ts
export async function sendPushNotification(params: {
  userId: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
}): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: params.userId },
  });

  const webpush = await import('web-push');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url || '/',
    data: params.data,
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  // Clean up expired subscriptions (HTTP 410)
  const expiredIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected' && result.reason?.statusCode === 410) {
      expiredIds.push(subscriptions[index].id);
    }
  });
  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }
}
```

#### Service Worker Push Handler

```javascript
// In public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sotto', {
      body: data.body || 'You have a notification',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

#### Push Notification Types

| Notification   | When                       | Title                        | Body Example                                        |
| -------------- | -------------------------- | ---------------------------- | --------------------------------------------------- |
| Podcast Ready  | Generation complete        | "Your podcast is ready!"     | "Transformers Intuition is ready to play"           |
| Podcast Liked  | Someone likes your podcast | "Someone liked your podcast" | "@sarah liked your podcast 'Quantum Computing'"     |
| New Follower   | Someone follows you        | "New follower!"              | "@deeplearner is now following you"                 |
| Podcast Forked | Someone forks your podcast | "Your podcast was forked"    | "@student42 created a version of 'Black Holes 101'" |

### Add to Homescreen

The PWA install prompt appears when the browser detects the app meets PWA criteria (manifest, service worker, HTTPS). Sotto proactively prompts users with a custom banner after their second visit:

```typescript
// src/hooks/useInstallPrompt.ts
function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show banner on second visit
      const visits = parseInt(localStorage.getItem('sotto-visits') || '0');
      if (visits >= 2) {
        setShowBanner(true);
      }
      localStorage.setItem('sotto-visits', String(visits + 1));
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  return { showBanner, install, dismiss: () => setShowBanner(false) };
}
```

---

## Mobile-First CSS Approach

All CSS in Sotto follows mobile-first methodology: base styles target mobile screens, and `min-width` media queries add desktop enhancements.

### Breakpoints

| Breakpoint | Variable       | Width   | Target                         |
| ---------- | -------------- | ------- | ------------------------------ |
| Mobile     | (default)      | 0-639px | Phone portrait                 |
| Tablet     | `--bp-tablet`  | 640px+  | Phone landscape, small tablets |
| Desktop    | `--bp-desktop` | 1024px+ | Laptops, large tablets         |
| Wide       | `--bp-wide`    | 1440px+ | Desktop monitors               |

Defined in `src/styles/globals.css`:

```css
:root {
  --bp-tablet: 640px;
  --bp-desktop: 1024px;
  --bp-wide: 1440px;
}
```

### CSS Module Pattern

```css
/* PodcastCard.module.css */

/* Mobile first (default) */
.card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.title {
  font-size: 1.125rem;
  line-height: 1.4;
}

/* Tablet and up */
@media (min-width: 640px) {
  .card {
    flex-direction: row;
    padding: 20px;
    gap: 16px;
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .card {
    padding: 24px;
    gap: 20px;
  }

  .title {
    font-size: 1.25rem;
  }
}
```

### Layout Patterns

| Layout         | Mobile                  | Tablet                  | Desktop                   |
| -------------- | ----------------------- | ----------------------- | ------------------------- |
| Feed grid      | Single column           | 2 columns               | 3-4 columns               |
| Sidebar        | Hidden (hamburger menu) | Hidden (hamburger menu) | Visible (240px fixed)     |
| Player         | Full-width bottom bar   | Full-width bottom bar   | Full-width bottom bar     |
| Discovery chat | Full screen             | Full screen             | Centered card (640px max) |
| Pricing cards  | Stacked vertically      | Stacked vertically      | Side by side (3 columns)  |

---

## Touch Targets

All interactive elements follow accessibility touch target guidelines:

| Element          | Minimum Size    | Implementation                                      |
| ---------------- | --------------- | --------------------------------------------------- |
| Buttons          | 48x48px         | `min-height: 48px; min-width: 48px;`                |
| Chip suggestions | 48px height     | `height: 48px; padding: 0 20px;`                    |
| Icon buttons     | 48x48px         | `width: 48px; height: 48px;` with icon centered     |
| List items       | 48px row height | `min-height: 48px;`                                 |
| Links in text    | 48px tap target | `padding: 8px 0;` to extend vertical hit area       |
| Player controls  | 56px            | Larger for play/pause: `width: 56px; height: 56px;` |
| Mini player      | 64px height     | Entire bar is tappable to expand                    |

### Spacing Between Touch Targets

Adjacent interactive elements must have at least 8px of space between them to prevent accidental taps:

```css
.chipRow {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 4px 0;
}

.chip {
  height: 48px;
  padding: 0 20px;
  border-radius: 24px;
  white-space: nowrap;
  flex-shrink: 0;
}
```

---

## Audio Playback on Mobile

Audio playback on mobile browsers has several constraints that require specific handling.

### Background Playback

Mobile browsers typically pause audio when the tab is backgrounded or the screen is locked. Sotto needs audio to continue playing because users listen while doing other things.

**Solution:** Use the Media Session API to register as an active media session:

```typescript
// src/hooks/useAudioPlayer.ts
function setupMediaSession(metadata: PodcastMetadata) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: metadata.title,
    artist: 'Sotto',
    album: metadata.creatorName,
    artwork: [
      { src: metadata.coverUrl || '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: metadata.coverUrl || '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  });

  navigator.mediaSession.setActionHandler('play', () => audioElement.play());
  navigator.mediaSession.setActionHandler('pause', () => audioElement.pause());
  navigator.mediaSession.setActionHandler('seekbackward', () => {
    audioElement.currentTime = Math.max(0, audioElement.currentTime - 15);
  });
  navigator.mediaSession.setActionHandler('seekforward', () => {
    audioElement.currentTime = Math.min(audioElement.duration, audioElement.currentTime + 15);
  });
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined) {
      audioElement.currentTime = details.seekTime;
    }
  });
}
```

### Lock Screen Controls

The Media Session API provides lock screen controls on both iOS and Android:

| Control       | Handler          | Behavior                |
| ------------- | ---------------- | ----------------------- |
| Play/Pause    | `play` / `pause` | Toggle playback         |
| Skip backward | `seekbackward`   | Jump back 15 seconds    |
| Skip forward  | `seekforward`    | Jump forward 15 seconds |
| Seek          | `seekto`         | Scrub to position       |

The lock screen also shows:

- Podcast title
- Creator name
- Cover artwork (or Sotto default icon)
- Progress bar

### iOS Audio Restrictions

iOS Safari requires a user gesture to start audio playback. The first `audio.play()` call must originate from a user tap:

```typescript
// First play must be from a user interaction (click/tap handler)
async function handlePlayTap() {
  try {
    await audioRef.current.play();
    setIsPlaying(true);
  } catch (err) {
    // Silently handle autoplay rejection on iOS
    console.warn('Playback requires user interaction');
  }
}
```

After the first user-initiated play, subsequent play/pause calls can be programmatic (e.g., from push notification handlers or media session actions).

### Audio Element Configuration

```typescript
const audio = new Audio();
audio.preload = 'auto'; // Preload metadata and some audio data
audio.crossOrigin = 'anonymous'; // Required for R2/CDN audio files
audio.playbackRate = 1.0; // User-adjustable: 0.5x to 2.0x
```

### Playback Rate Control

Users can adjust playback speed. The available rates are:

| Rate  | Label     | Use Case                         |
| ----- | --------- | -------------------------------- |
| 0.5x  | Slow      | Language learners, dense content |
| 0.75x | Slower    | Careful listening                |
| 1.0x  | Normal    | Default                          |
| 1.25x | Faster    | Casual review                    |
| 1.5x  | Fast      | Experienced podcast listeners    |
| 2.0x  | Very fast | Scanning content                 |

```css
.speedButton {
  min-width: 48px;
  min-height: 48px;
  font-size: 0.875rem;
  font-weight: 600;
}
```

---

## Performance Budgets

Sotto targets fast load times on mobile networks. The performance budget is:

| Metric                         | Budget   | Measurement          |
| ------------------------------ | -------- | -------------------- |
| First Contentful Paint (FCP)   | < 1.5s   | 3G connection        |
| Largest Contentful Paint (LCP) | < 2.5s   | 3G connection        |
| Time to Interactive (TTI)      | < 3.5s   | 3G connection        |
| Cumulative Layout Shift (CLS)  | < 0.1    | Across page lifetime |
| Total JavaScript bundle        | < 200 KB | gzipped              |
| Initial HTML + CSS             | < 50 KB  | gzipped              |
| Font files                     | < 100 KB | woff2 compressed     |
| Image assets                   | < 500 KB | Per page             |

### Performance Strategies

| Strategy               | Implementation                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Server Components      | All pages are Server Components by default; only interactive widgets use `'use client'` |
| Code splitting         | Next.js automatic route-based code splitting                                            |
| Font optimization      | `next/font` for DM Serif Display and Inter with `display: swap`                         |
| Image optimization     | `next/image` with automatic WebP/AVIF conversion and responsive sizes                   |
| Lazy loading           | Audio player loads only when needed; feed images use `loading="lazy"`                   |
| Streaming SSR          | Next.js streaming with `<Suspense>` boundaries for progressive rendering                |
| CSS Modules            | No CSS-in-JS runtime cost; styles are statically extracted at build time                |
| Service worker caching | Static assets cached on first visit; subsequent loads are instant                       |

### Bundle Analysis

Run bundle analysis to identify large dependencies:

```bash
ANALYZE=true npm run build
```

Key dependencies to keep small:

- No Tailwind runtime (CSS Modules only)
- Anthropic SDK: server-only, not bundled to client
- Stripe.js: loaded asynchronously only on billing pages
- web-push: server-only, not bundled to client

---

## React Native Roadmap

React Native apps are planned for Phase 2 (iOS) and Phase 3 (Android), built with Expo.

### Architecture

```
                    +-------------------+
                    |   Sotto Backend   |  (Next.js API routes)
                    |   (shared)        |  Same API for web + native
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
     +--------v---------+        +---------v--------+
     |   Next.js Web     |        |   React Native   |
     |   (PWA)           |        |   (Expo)         |
     +-------------------+        +------------------+
```

The React Native app shares the backend API with the web app. No separate backend is needed.

### Shared Across Web and Native

| Shared                     | How                                                                       |
| -------------------------- | ------------------------------------------------------------------------- |
| API endpoints              | Same `/api/*` routes serve both web and native clients                    |
| Database                   | Same PostgreSQL database                                                  |
| Auth tokens                | JWT tokens work in both contexts                                          |
| Design tokens              | Colors, spacing, typography values exported as shared constants           |
| Business logic             | Tier limits, validation schemas, queue jobs                               |
| Push notification payloads | Same payload format; different delivery mechanism (Web Push vs Expo Push) |

### Native-Only Features

| Feature                | Why Native                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| Apple Sign In (native) | Native Apple Sign In SDK provides better UX on iOS                            |
| Background audio       | iOS AVAudioSession handles background audio natively (more reliable than PWA) |
| CarPlay integration    | iOS CarPlay API for in-car listening (future)                                 |
| Siri Shortcuts         | "Hey Siri, play my latest Sotto podcast"                                      |
| Haptic feedback        | Physical feedback on chip taps, play/pause, like                              |
| Voice input            | Native speech-to-text for the "Ask a Question" feature                        |
| Offline audio download | Robust file management for downloaded podcasts                                |
| Widgets                | iOS 14+ widgets showing latest podcast or generation progress                 |

### Implementation Plan

| Phase | Milestone      | Features                                                |
| ----- | -------------- | ------------------------------------------------------- |
| 2a    | iOS Alpha      | Core playback, auth, feed, basic create flow            |
| 2b    | iOS Beta       | Push notifications, offline downloads, background audio |
| 2c    | iOS Launch     | CarPlay, Siri Shortcuts, App Store submission           |
| 3a    | Android Alpha  | Core playback, auth, feed                               |
| 3b    | Android Beta   | Push notifications, offline downloads                   |
| 3c    | Android Launch | Android Auto, Play Store submission                     |

---

## App Store Considerations

### PWA vs Native Trade-offs

| Factor             | PWA                           | Native (React Native)                                            |
| ------------------ | ----------------------------- | ---------------------------------------------------------------- |
| Discovery          | No app store presence         | App Store / Play Store SEO                                       |
| Install friction   | One tap "Add to Home Screen"  | Download from app store                                          |
| Updates            | Instant (no app review)       | 1-7 day app review process                                       |
| Push notifications | Web Push API (limited on iOS) | Full native push (APNs/FCM)                                      |
| Background audio   | Inconsistent on iOS           | Reliable via native audio session                                |
| Payment            | Stripe (no Apple/Google cut)  | Must use IAP on iOS (30% cut on subscriptions, 15% after year 1) |
| Performance        | Good (modern browsers)        | Better (native rendering)                                        |
| Development cost   | Shared with web codebase      | Separate codebase (shared API)                                   |

### iOS App Store Strategy

Apple's App Store guidelines require that apps offering digital content subscriptions use In-App Purchase (IAP), which takes a 30% commission (15% after the first year of a subscription through the Small Business Program).

| Subscription | Direct (Stripe) | IAP Price (covering 30% cut)      |
| ------------ | --------------- | --------------------------------- |
| Starter      | $9/mo           | $9.99/mo (exact Apple tier match) |
| Pro          | $24/mo          | $29.99/mo (nearest Apple tier)    |
| Studio       | $49/mo          | $59.99/mo (nearest Apple tier)    |

Credit packs would be priced as consumable IAPs:

| Credit Pack | Direct (Stripe) | IAP Price (covering 30% cut) |
| ----------- | --------------- | ---------------------------- |
| 3 credits   | $5              | $5.99                        |
| 10 credits  | $15             | $19.99                       |
| 25 credits  | $30             | $34.99                       |

Options to mitigate the IAP tax:

1. **Reader rule**: If Sotto qualifies as a "reader" app (consuming pre-existing content), the app can link out to the web for purchases. This is unlikely since Sotto generates content.
2. **Web-first pricing**: Keep the web app at $9/$24/$49, price the iOS app at $9.99/$29.99/$59.99 to maintain margin.
3. **Delayed native launch**: Focus on PWA for the first year. By the time a native app is needed, the platform may have better economics to absorb the Apple tax.
4. **StoreKit 2 external purchase links**: As of 2024-2025, Apple allows apps to link to external purchase pages in certain regions with conditions. Monitor policy changes.

### Android Play Store

Google Play takes a 15% commission on the first $1M in annual revenue (then 30%). The same IAP strategy applies. However, Android allows sideloading and alternative app stores, giving more flexibility.

### PWA as Primary

For MVP and early growth, the PWA is the primary mobile distribution channel:

- No app store approval process
- No revenue share with Apple/Google
- Instant updates
- Single codebase
- Users install directly from the browser
- Full push notification support on Android; limited but functional on iOS 16.4+

iOS 16.4+ added Web Push support for PWAs added to the homescreen, making the PWA strategy viable for iOS push notifications without a native app.
