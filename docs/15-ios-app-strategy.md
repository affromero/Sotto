# iOS App Strategy

> A three-phase approach to bringing Sotto to iOS: PWA, React Native, and Native Enhancements

## Executive Summary

Sotto's iOS strategy prioritizes speed-to-market with a PWA foundation, then progressively enhances the experience with native features critical for podcast listening: background audio, push notifications, and offline playback.

**Timeline**: Phase 1 (complete), Phase 2 (Months 2-3), Phase 3 (Month 4+)

**Recommendation**: React Native + Expo over Flutter or SwiftUI for maximum code sharing with web experience and faster iteration cycles.

---

## Phase 1: PWA (Now — Already Built)

### Current Implementation

The existing web app is already PWA-ready:

**Manifest**: `/public/manifest.json`

```json
{
  "name": "Sotto",
  "short_name": "Sotto",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#D97706",
  "background_color": "#FEFCF8",
  "icons": [...]
}
```

**Service Worker**: `/public/sw.js`

- Offline caching for static assets
- API response caching with stale-while-revalidate
- Audio file caching for offline playback

**iOS Safari Compatibility**

- Works on iOS 11.3+ (PWA support introduced)
- Add-to-homescreen prompt via native browser UI
- Audio playback via `<audio>` element
- Full-screen playback UI with native controls

### Limitations on iOS

| Feature             | Status         | Workaround                      |
| ------------------- | -------------- | ------------------------------- |
| Background audio    | Not available  | User must keep app open         |
| Push notifications  | iOS 16.4+ only | Email notifications as fallback |
| Badge notifications | Not available  | None                            |
| Share extensions    | Not available  | Copy-link only                  |
| Apple Pay           | Not available  | Stripe web checkout             |
| Siri integration    | Not available  | None                            |

### What Works Well

- Full UI rendering (CSS Modules render perfectly)
- Audio playback with custom controls
- Offline caching for previously played podcasts
- Form inputs, OAuth login flows
- Web Share API (iOS 12+)

### User Flow

1. User visits `sotto.app` on iOS Safari
2. Browser suggests "Add to Home Screen"
3. User taps, app icon appears on home screen
4. Tap icon → opens in standalone mode (no browser chrome)
5. Service worker loads cached content instantly

### Conversion Strategy

**In-app prompt**: Show a dismissible banner on iOS Safari:

```tsx
// src/components/mobile/PWAInstallPrompt.tsx
"Add Sotto to your home screen for the best experience"
[Show Me How] [Dismiss]
```

**Target metric**: 20% of iOS users add to home screen within 3 visits

---

## Phase 2: React Native + Expo (Months 2-3)

### Why React Native + Expo?

| Option                  | Pros                                                                                                                   | Cons                                                                                       | Verdict         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| **React Native + Expo** | - 70% code sharing with web<br>- Fast iteration (OTA updates)<br>- Mature podcast app ecosystem<br>- TypeScript-native | - Bundle size larger than native<br>- Some animations less smooth                          | **Recommended** |
| Flutter                 | - Fast rendering<br>- Single codebase (iOS + Android)                                                                  | - Zero code sharing with existing React/Next.js app<br>- Smaller podcast library ecosystem | Not ideal       |
| SwiftUI                 | - Best performance<br>- First-class iOS features                                                                       | - Zero code sharing<br>- iOS-only (need separate Android)                                  | Too slow for v1 |

**Decision**: React Native with Expo managed workflow.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     iOS App (React Native)               │
│  ┌────────────┬────────────┬────────────┬────────────┐ │
│  │  Feed      │  Player    │  Create    │  Profile   │ │
│  │  Screen    │  Screen    │  Screen    │  Screen    │ │
│  └────────────┴────────────┴────────────┴────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Native Features                                  │  │
│  │  - Background Audio (react-native-track-player)  │  │
│  │  - Push Notifications (expo-notifications)       │  │
│  │  - Secure Storage (expo-secure-store)            │  │
│  │  - Share Extensions (expo-sharing)               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS (same API as web)
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Existing Next.js Backend                    │
│  /api/podcasts, /api/discovery, /api/feed, etc.        │
│  (No backend changes needed)                             │
└─────────────────────────────────────────────────────────┘
```

### Key Principle: API-First

**No backend rewrites**. The mobile app is a thin client consuming existing Next.js API routes.

**Shared**:

- Authentication (NextAuth tokens via secure storage)
- Business logic (all in API routes)
- Data models (same Prisma schema)
- Worker pipeline (same BullMQ jobs)

**Mobile-specific**:

- Native UI rendering
- Background audio playback
- Push notification registration
- Local caching (AsyncStorage)

### Tech Stack

```json
{
  "dependencies": {
    "expo": "~50.0.0",
    "expo-router": "^3.4.0", // File-based routing (like Next.js)
    "react-native-track-player": "^4.0.0", // Background audio
    "expo-av": "~13.10.0", // Audio recording (for voice questions)
    "expo-notifications": "~0.27.0", // Push notifications
    "expo-secure-store": "~12.8.0", // Token storage
    "expo-sharing": "~11.10.0", // Share extension
    "expo-linking": "~6.2.0", // Deep links
    "react-native-reanimated": "~3.6.0", // Smooth animations
    "zustand": "^4.5.0", // State management
    "axios": "^1.6.0", // API client
    "react-native-svg": "14.1.0" // Waveforms
  }
}
```

### Screen Breakdown

#### 1. Feed Screen (`app/(tabs)/feed.tsx`)

**UI Components**:

- Masonry grid of podcast cards (vertical scroll)
- Pull-to-refresh
- Tag filter chips (horizontal scroll)
- Search bar with debounced input

**API Calls**:

- `GET /api/feed?tags=&search=&sort=trending`
- `POST /api/podcasts/[id]/like`
- `POST /api/podcasts/[id]/save`

**Native Features**:

- Share extension: tap Share → opens iOS share sheet
- Infinite scroll with `FlatList` virtualization

#### 2. Player Screen (`app/podcast/[id].tsx`)

**Critical**: This is the most complex screen.

**UI Components**:

- Full-screen waveform visualization
- Playback controls (play/pause, skip 15s, speed)
- Transcript panel (teleprompter scrolling)
- "Ask a Question" button (bottom sheet)
- Like, Share, Fork buttons

**Audio Implementation**:

```typescript
// lib/audio-player.native.ts
import TrackPlayer, { Capability, Event, State, RepeatMode } from 'react-native-track-player';

export async function setupPlayer() {
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipForward,
      Capability.SkipBackward,
      Capability.SeekTo,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause],
    progressUpdateEventInterval: 1, // 1 second updates
  });
}

export async function loadPodcast(podcast: Podcast) {
  await TrackPlayer.add({
    id: podcast.id,
    url: podcast.audioUrl,
    title: podcast.title,
    artist: 'Sotto Podcast',
    artwork: podcast.coverImageUrl || DEFAULT_ARTWORK,
    duration: podcast.duration,
  });
}
```

**Background Audio**:

- Continues playing when app is backgrounded
- Lock screen controls (play/pause, skip)
- Now Playing widget on lock screen
- Interruption handling (phone calls, Siri)

**Transcript Sync**:

```typescript
// Sync transcript highlighting with playback position
useEffect(() => {
  const interval = setInterval(async () => {
    const position = await TrackPlayer.getPosition();
    const currentSegment = segments.find((s) => s.startTime <= position && s.endTime > position);
    setActiveSegmentId(currentSegment?.id);
  }, 100); // Update every 100ms for smooth scrolling

  return () => clearInterval(interval);
}, [segments]);
```

**Ask a Question Flow**:

1. User taps "Ask a Question" → pause audio, open bottom sheet
2. User types question or uses voice input (expo-av recording)
3. POST `/api/podcasts/[id]/interact` with `{question, timestamp}`
4. Interaction worker processes (existing backend)
5. Show answer in chat bubble
6. "Was this helpful?" → "Update podcast with this?"

#### 3. Create Screen (`app/create/index.tsx`)

**UI Components**:

- Chat interface (like iMessage)
- Animated suggestion chips
- URL/PDF upload button
- "Create Podcast" CTA (appears after discovery complete)

**API Calls**:

- `POST /api/discovery` (streaming response via EventSource or WebSocket)
- `GET /api/recommendations`
- `POST /api/podcasts` (trigger generation)

**Chat Implementation**:

```typescript
// Use EventSource for streaming Claude responses
import EventSource from 'react-native-sse';

const eventSource = new EventSource('https://sotto.app/api/discovery', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: userMessage }),
});

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'token') {
    appendToLastMessage(data.content);
  } else if (data.type === 'chips') {
    setSuggestionChips(data.chips);
  }
});
```

**Voice Input**:

- Microphone button → record question
- `expo-av` audio recording
- Send audio file to `/api/discovery` (backend handles transcription via Claude)

#### 4. Profile Screen (`app/profile/[userId].tsx`)

**UI Components**:

- Profile header (avatar, bio, follower count)
- Follow/Unfollow button
- Grid of user's podcasts
- Tabs: Created, Liked, Saved

**API Calls**:

- `GET /api/users/[userId]`
- `GET /api/users/[userId]/podcasts`
- `POST /api/users/[userId]/follow`

### Navigation Structure

```
app/
├── (auth)/
│   ├── login.tsx
│   └── signup.tsx
├── (tabs)/
│   ├── _layout.tsx          # Tab navigator
│   ├── feed.tsx             # Home feed
│   ├── create.tsx           # Create podcast
│   ├── notifications.tsx    # Notification list
│   └── profile.tsx          # Own profile
├── podcast/
│   └── [id].tsx             # Player screen (full screen, not in tabs)
└── user/
    └── [userId].tsx         # Public profile
```

### Authentication Flow

**Strategy**: Use existing NextAuth backend, store JWT in secure storage.

```typescript
// lib/auth.native.ts
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

export async function login(email: string, password: string) {
  const response = await axios.post('https://sotto.app/api/auth/signin', {
    email,
    password,
  });

  const { accessToken, refreshToken } = response.data;
  await SecureStore.setItemAsync('accessToken', accessToken);
  await SecureStore.setItemAsync('refreshToken', refreshToken);

  // Configure axios interceptor for all future requests
  axios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
}

export async function logout() {
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
  axios.defaults.headers.common['Authorization'] = '';
}
```

**Social Login**:

- Google Sign-In: `expo-auth-session` + `expo-google-app-auth`
- Apple Sign-In: `expo-apple-authentication` (required for App Store)
- GitHub: Same OAuth flow as web

### Push Notifications

**Registration Flow**:

```typescript
// lib/notifications.native.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    alert('Push notifications only work on physical devices');
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return;
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  // Send token to backend
  await axios.post('https://sotto.app/api/notifications/register', {
    token,
    platform: Platform.OS,
  });
}
```

**Notification Types**:

- Podcast ready: "Your podcast '[Title]' is ready to listen"
- Interaction answered: "[User] asked a question on your podcast"
- New follower: "[User] followed you"
- Podcast liked/forked: "[User] liked your podcast"

**Handling**:

```typescript
// App.tsx
Notifications.addNotificationReceivedListener((notification) => {
  console.log('Notification received:', notification);
});

Notifications.addNotificationResponseReceivedListener((response) => {
  const { podcastId } = response.notification.request.content.data;
  // Navigate to podcast screen
  router.push(`/podcast/${podcastId}`);
});
```

### Offline Support

**Strategy**: Cache podcasts for offline playback.

```typescript
// lib/offline.native.ts
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function downloadPodcast(podcast: Podcast) {
  const localUri = `${FileSystem.documentDirectory}podcasts/${podcast.id}.mp3`;

  // Download audio file
  const downloadResumable = FileSystem.createDownloadResumable(
    podcast.audioUrl,
    localUri,
    {},
    (downloadProgress) => {
      const progress =
        downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
      console.log(`Download progress: ${progress * 100}%`);
    }
  );

  await downloadResumable.downloadAsync();

  // Store metadata
  await AsyncStorage.setItem(
    `podcast:${podcast.id}`,
    JSON.stringify({
      ...podcast,
      localAudioUrl: localUri,
      downloadedAt: new Date().toISOString(),
    })
  );
}

export async function getOfflinePodcasts(): Promise<Podcast[]> {
  const keys = await AsyncStorage.getAllKeys();
  const podcastKeys = keys.filter((k) => k.startsWith('podcast:'));
  const podcasts = await AsyncStorage.multiGet(podcastKeys);
  return podcasts.map(([_, value]) => JSON.parse(value!));
}
```

**UI**:

- Download icon on podcast cards (in feed, on player screen)
- "Downloads" tab in profile
- Automatic cleanup after 30 days or 5GB limit

### Development Workflow

**Setup**:

```bash
# Install Expo CLI
npm install -g expo-cli eas-cli

# Create Expo app
npx create-expo-app sotto-mobile --template expo-template-blank-typescript

# Install dependencies
npm install expo-router react-native-track-player expo-notifications

# Start development server
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on physical device
# Scan QR code with Expo Go app
```

**Folder Structure**:

```
sotto-mobile/
├── app/                    # Expo Router screens
├── components/             # Shared components
├── lib/                    # API client, auth, audio
├── hooks/                  # React hooks
├── assets/                 # Images, fonts
├── app.json                # Expo config
└── eas.json                # Build config
```

**Shared Code Strategy**:

- Copy type definitions from `src/types/*.ts`
- Copy validation schemas from `src/lib/validations.ts`
- Rewrite UI components (CSS Modules → StyleSheet)
- Share API contract (same endpoints)

**Hot Reloading**:

- Expo offers fast refresh (sub-second updates)
- Over-the-air (OTA) updates for non-native code changes
- No App Store approval needed for JS updates

### App Store Submission

**Requirements**:

1. **Apple Developer Account**: $99/year
2. **App Store Connect**: Create app listing
3. **Privacy Policy**: Required for App Store (link in app)
4. **Age Rating**: 12+ (AI-generated content, no filtering)
5. **App Review Guidelines Compliance**:
   - AI-generated content must be labeled
   - No "replica" apps (Sotto is unique, not generic podcast player)
   - No hidden features or undocumented functionality

**AI-Generated Content Policy**:

> Apps that use AI to generate content must include a disclaimer that content is AI-generated and may not be accurate.

**Implementation**:

- Add "AI-Generated" badge to all podcasts
- Disclaimer on create screen: "This podcast is generated by AI based on your description"
- Feedback mechanism for inaccurate content

**Review Timeline**:

- First submission: 7-14 days
- Updates: 1-3 days
- Expedited review available (1-2 per year)

**Build Process**:

```bash
# Configure EAS
eas build:configure

# Build for App Store
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios
```

**Release Strategy**:

- Month 2: Internal TestFlight beta (10-20 users)
- Month 3: Public TestFlight (100+ users)
- Month 3 end: App Store v1.0 release

### Monetization: In-App Purchase vs Web Billing

**Apple's 30% Cut**:

- In-app subscriptions via Apple: Apple takes 30% (15% after year 1)
- Web subscriptions: Apple takes 0%

**Legal Options**:

| Approach                | Legality                                | Implementation                                       |
| ----------------------- | --------------------------------------- | ---------------------------------------------------- |
| **Link to web billing** | Allowed since 2022 (after Epic lawsuit) | Show link "Manage subscription at sotto.app/billing" |
| **In-app purchases**    | Always allowed                          | Use `expo-in-app-purchases` or `react-native-iap`    |
| **Hybrid**              | Recommended                             | Allow both, default to web for existing users        |

**Recommended Strategy**:

1. New iOS users see "Subscribe" button → opens in-app browser to `sotto.app/pricing`
2. Stripe Checkout in WebView → subscription managed on web
3. App checks subscription status via existing `/api/billing` endpoint
4. Apple gets 0%, Stripe takes 2.9% + 30¢

**Alternative**: Implement IAP for iOS-only users, sync with backend:

```typescript
// lib/iap.native.ts
import * as InAppPurchases from 'expo-in-app-purchases';

export async function purchaseProPlan() {
  await InAppPurchases.connectAsync();

  const products = await InAppPurchases.getProductsAsync(['sotto_pro_monthly']);
  const purchase = await InAppPurchases.purchaseItemAsync('sotto_pro_monthly');

  // Validate receipt with Apple
  const receipt = purchase.transactionReceipt;

  // Send to backend for validation + subscription creation
  await axios.post('https://sotto.app/api/billing/apple-iap', {
    receipt,
    productId: 'sotto_pro_monthly',
  });
}
```

**Backend Changes Required**:

- Add `/api/billing/apple-iap` route
- Validate Apple receipts via `app-store-server-api`
- Create subscription in Prisma with `provider: 'APPLE'`

**Decision**: Start with web billing (0% to Apple), add IAP in Phase 3 if conversion is low.

---

## Phase 3: Native Enhancements (Month 4+)

### 1. Offline Download Management

**Goal**: Let users download podcasts for airplane mode.

**Implementation**:

- Background download queue (continue downloads when app is backgrounded)
- Smart storage limits (5GB max, auto-delete oldest first)
- Download quality options (High/Medium/Low bitrate)
- "Download over Wi-Fi only" setting

**UI**:

- Download icon on podcast cards
- "Downloads" tab in profile
- Download progress indicator
- Storage usage display

### 2. Apple Watch Companion

**Goal**: Control playback from wrist.

**Features**:

- Now Playing screen (title, artwork, play/pause)
- Skip forward/backward 15s
- Volume control
- Browse recent podcasts

**Tech**:

- WatchOS app (separate target in Xcode)
- WatchConnectivity framework for sync
- Complication: "Latest podcast" shortcut

**Development Effort**: 2-3 weeks (requires native Swift)

### 3. CarPlay Integration

**Goal**: Safe podcast listening while driving.

**Features**:

- Browse feed (voice-controlled)
- Now Playing screen
- Playback controls
- "What's new?" voice command

**Tech**:

- CarPlay framework (requires entitlement from Apple)
- Audio app template (provided by Apple)

**Apple Requirements**:

- Must submit CarPlay entitlement request
- Must follow audio app UI guidelines (limited customization)

**Development Effort**: 1-2 weeks

### 4. Siri Shortcuts

**Goal**: "Hey Siri, play my latest Sotto podcast"

**Implementation**:

```swift
// Swift code in native module
import Intents

class PlayLatestPodcastIntent: INIntent {
  // Register shortcut
}

INVoiceShortcutCenter.shared.setShortcutSuggestions([
  INShortcut(intent: PlayLatestPodcastIntent())
])
```

**Exposed Shortcuts**:

- "Play latest podcast"
- "Resume current podcast"
- "Create a podcast about [topic]"

**Development Effort**: 1 week

### 5. Home Screen Widget

**Goal**: Quick access to recent podcasts.

**Widget Types**:

- Small: Latest podcast cover art + title
- Medium: 3 recent podcasts
- Large: 5 recent podcasts + "Create" button

**Tech**:

- WidgetKit (SwiftUI)
- Timeline provider (refresh every 15 minutes)
- Deep links to podcast player

**Development Effort**: 1 week

### 6. Live Activities (iOS 16.1+)

**Goal**: Lock screen mini-player with live progress bar.

**Implementation**:

- Show now-playing info on lock screen
- Live-updating progress bar
- Control buttons (play/pause, skip)

**Tech**:

- ActivityKit framework
- Push-to-update or app-driven updates

**Development Effort**: 3-5 days

---

## Development Timeline

### Month 2: Core App Development

**Week 1-2: Foundation**

- Set up Expo project
- Configure expo-router navigation
- Implement authentication (login, signup, token storage)
- Build shared API client
- Design system setup (colors, fonts, spacing)

**Week 3-4: Core Screens**

- Feed screen (grid, filters, search)
- Player screen (audio, transcript, controls)
- Create screen (chat UI, streaming responses)
- Profile screen

**Week 5-6: Background Features**

- react-native-track-player integration
- Background audio playback
- Lock screen controls
- Push notification setup

**Week 7-8: Polish**

- Animations (page transitions, loading states)
- Error handling
- Offline support (AsyncStorage caching)
- TestFlight internal beta

**Deliverable**: Internal beta on TestFlight (10-20 users)

### Month 3: Public Beta & Launch

**Week 9-10: Public Beta**

- Expand TestFlight to 100+ users
- Collect feedback
- Fix critical bugs
- Performance optimization

**Week 11-12: App Store Submission**

- Prepare marketing materials (screenshots, preview video)
- Write app description
- Submit for review
- Address App Review feedback

**Week 13-14: Launch**

- App Store release (v1.0.0)
- Marketing push (Product Hunt, social media)
- Monitor crash reports (Sentry)
- Gather user reviews

**Deliverable**: Sotto iOS app live on App Store

### Month 4+: Phase 3 Enhancements

**Week 15-16**: Offline download management
**Week 17-18**: Apple Watch companion
**Week 19-20**: CarPlay integration
**Week 21**: Siri Shortcuts
**Week 22**: Home screen widget
**Week 23**: Live Activities

---

## Team Structure

### Recommended Team

**For Phase 2 (Months 2-3)**:

- 1x React Native Developer (senior, full-time)
- 1x Backend Developer (existing team, 25% time for mobile API support)
- 1x Designer (part-time, mobile UI/UX)
- 1x QA Tester (part-time, TestFlight testing)

**For Phase 3 (Month 4+)**:

- 1x iOS Native Developer (contract, for WatchOS/CarPlay/Widgets)
- Same React Native developer (maintenance + new features)

**External**:

- App Store asset designer (screenshots, preview video): 1-2 days
- Legal review (privacy policy, terms): 1-2 days

### Skills Required

**React Native Developer Must Have**:

- 2+ years React Native experience
- Expo experience (managed workflow)
- Background audio implementation (track-player or similar)
- App Store submission experience
- TypeScript proficiency

**Nice to Have**:

- Podcast app development experience
- WebSocket/SSE streaming experience
- Animation libraries (Reanimated, Lottie)
- Native module development (bridging)

---

## Technical Decisions & Trade-offs

### 1. React Native vs Flutter vs Native SwiftUI

**Decision**: React Native + Expo

**Reasoning**:

- 70% code sharing with existing React/Next.js web app (types, API client, business logic)
- Faster iteration (OTA updates, hot reload)
- Rich ecosystem for podcast apps (track-player, notifications)
- Team familiarity with React/TypeScript

**Trade-offs**:

- Slightly larger bundle size than native (15-20 MB)
- Some animations less smooth (mitigated with Reanimated)
- Occasional native module bugs (mitigated with Expo's stable APIs)

### 2. Expo Managed Workflow vs Bare Workflow

**Decision**: Managed workflow

**Reasoning**:

- Faster development (no Xcode required for most features)
- OTA updates for JS changes
- EAS Build handles complex build process
- Expo SDK covers 90% of needed features

**When to Eject to Bare**:

- If we need custom native modules not available in Expo
- If we need deep CarPlay customization
- If bundle size becomes a major issue (unlikely)

**Currently**: Stay in managed workflow. Eject only if necessary in Phase 3.

### 3. Audio Library: expo-av vs react-native-track-player

**Decision**: react-native-track-player

**Reasoning**:

- Built specifically for podcast/music apps
- Excellent background audio support
- Lock screen controls out-of-the-box
- Active community (5k+ stars on GitHub)

**Trade-off**:

- Not part of Expo SDK (requires custom development build)
- Slightly more complex setup than expo-av

**Alternative**: Use expo-av for MVP, migrate to track-player in Phase 2 Week 5.

### 4. State Management: Redux vs Zustand vs React Query

**Decision**: Zustand + React Query

**Reasoning**:

- Zustand: Lightweight, simple, perfect for global state (auth, player)
- React Query: Handles API caching, refetching, optimistic updates
- Combined: Best of both worlds

**Trade-off**:

- Two libraries instead of one (but both are tiny)
- Less boilerplate than Redux

**State Architecture**:

```typescript
// Global state (Zustand)
- authStore: { user, token, isAuthenticated }
- playerStore: { currentPodcast, isPlaying, position }
- notificationStore: { unreadCount, notifications }

// Server state (React Query)
- useQuery('feed', fetchFeed)
- useQuery(['podcast', id], fetchPodcast)
- useMutation('createPodcast', createPodcast)
```

### 5. Styling: StyleSheet vs Styled Components vs NativeWind

**Decision**: StyleSheet (React Native's built-in)

**Reasoning**:

- Best performance (compiled to native)
- No additional dependencies
- Familiar to React Native developers

**Trade-off**:

- More verbose than CSS Modules (no cascading)
- Need to define theme tokens separately

**Theme System**:

```typescript
// theme.ts
export const theme = {
  colors: {
    primary: '#D97706',
    accent: '#1E3A5F',
    background: '#FEFCF8',
    surface: '#FFFFFF',
    textPrimary: '#1A1A1A',
    textSecondary: '#6B7280',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  fonts: {
    heading: 'DMSerifDisplay-Regular',
    body: 'Inter-Regular',
  },
};
```

### 6. Deep Linking Strategy

**Decision**: Universal links (sotto.app/podcast/[id] opens app if installed)

**Implementation**:

```json
// app.json
{
  "expo": {
    "scheme": "sotto",
    "ios": {
      "associatedDomains": ["applinks:sotto.app"]
    }
  }
}
```

**Routing**:

```typescript
// app/_layout.tsx
import * as Linking from 'expo-linking';

const prefix = Linking.createURL('/');

export default function RootLayout() {
  return (
    <NavigationContainer
      linking={{
        prefixes: [prefix, 'https://sotto.app'],
        config: {
          screens: {
            Podcast: 'podcast/:id',
            Profile: 'profile/:userId',
          },
        },
      }}
    >
      {/* Routes */}
    </NavigationContainer>
  );
}
```

**User Experience**:

- User taps link in iMessage/Email → app opens directly to podcast
- User without app → opens in Safari PWA

---

## App Store Submission Strategy

### App Listing

**Name**: Sotto - Interactive AI Podcasts

**Subtitle**: Podcasts that listen back

**Description**:

```
Sotto turns any topic into a conversational podcast, powered by AI.

- Chat with AI to describe what you want to learn
- AI generates a 2-voice podcast in minutes
- Interrupt to ask questions mid-episode
- Share your podcasts with the world

Perfect for:
- Commuters who want bite-sized learning
- Students studying complex topics
- Curious minds exploring new ideas

How it works:
1. Tell us what you want to learn
2. AI creates a custom podcast for you
3. Listen, interrupt, and interact
4. Share your discoveries with the community

Powered by Claude AI and ElevenLabs voice technology.
```

**Keywords**: podcast, AI, learning, education, audio, interactive, Claude, voice

**Category**: Education (primary), News (secondary)

**Age Rating**: 12+ (Infrequent/Mild Mature/Suggestive Themes)

**Privacy Policy**: https://sotto.app/privacy

**Support URL**: https://sotto.app/support

### Screenshots (Required: 6.7", 5.5", 12.9")

**1. Feed Screen** (iPhone 15 Pro Max)
Caption: "Discover AI-generated podcasts on any topic"

**2. Player Screen**
Caption: "Interactive playback with live transcript"

**3. Interrupt Flow**
Caption: "Tap to ask questions mid-episode"

**4. Create Screen**
Caption: "Chat with AI to create your perfect podcast"

**5. Profile Screen**
Caption: "Build your podcast library and follow creators"

### App Preview Video (Required, 15-30 seconds)

**Script**:

```
[0:00] Opening shot: Sotto logo on warm background
[0:02] Tap "Create Podcast" → chat interface appears
[0:04] AI asks: "What would you like to learn about?"
[0:06] User types: "The history of coffee"
[0:08] AI generates podcast → waveform appears
[0:10] Tap play → audio starts, transcript scrolls
[0:12] Tap "Ask a Question" → "Why is espresso so bitter?"
[0:14] AI answers in context
[0:16] Tap "Share" → share sheet appears
[0:18] Closing shot: "Podcasts that listen back"
[0:20] Download on the App Store
```

**Production**:

- Use Figma mockups for UI
- Screen recording on iPhone 15 Pro Max
- Add subtle animations (fade in/out)
- Background music (royalty-free from Epidemic Sound)

### App Review Guidelines Compliance

**2.3.8 - AI-Generated Content**

> "Apps that create content using AI must clearly label AI-generated content and provide a mechanism for users to report inaccurate content."

**Implementation**:

- Badge: "AI-Generated" on all podcast cards
- Disclaimer on create screen
- "Report inaccurate content" link in player menu

**4.2.2 - Minimum Functionality**

> "Apps should include features, content, and UI that elevate it beyond a repackaged website."

**How Sotto Complies**:

- Background audio playback (not available on web)
- Push notifications
- Offline downloads
- Native UI optimized for iOS

**5.1.1 - Privacy Policy**

> "All apps that collect user or usage data must have a privacy policy."

**Required Disclosures**:

- Email address (authentication)
- Usage data (analytics)
- Identifiers (device ID for push notifications)

**Privacy Nutrition Label**:

```yaml
Data Used to Track You: None
Data Linked to You:
  - Email Address
  - User Content (podcasts, interactions)
  - Identifiers (push token)
Data Not Linked to You:
  - Diagnostics (crash reports)
```

### Launch Checklist

**Pre-Submission**:

- [ ] All features tested on physical device
- [ ] No console warnings or errors
- [ ] Privacy policy published at sotto.app/privacy
- [ ] Terms of service published at sotto.app/terms
- [ ] Support email set up (support@sotto.app)
- [ ] Crash reporting configured (Sentry)
- [ ] Analytics configured (Mixpanel or Amplitude)

**App Store Connect**:

- [ ] App listing complete (name, subtitle, description, keywords)
- [ ] Screenshots uploaded (3 device sizes)
- [ ] App preview video uploaded
- [ ] Privacy nutrition label filled out
- [ ] Age rating set (12+)
- [ ] Support URL set
- [ ] Marketing URL set (optional)

**Build**:

- [ ] Version number set (1.0.0)
- [ ] Build number incremented
- [ ] Release notes written
- [ ] TestFlight beta tested (at least 50 testers)
- [ ] No critical bugs reported

**Post-Submission**:

- [ ] Monitor App Review status daily
- [ ] Respond to App Review questions within 24h
- [ ] Prepare launch marketing (Product Hunt, Twitter, email)
- [ ] Set up App Store analytics

### Rejection Risk Areas

**Common Rejection Reasons**:

1. **AI content not labeled** → Add "AI-Generated" badge
2. **Missing privacy policy** → Publish at sotto.app/privacy
3. **Crashes on launch** → Test on multiple devices
4. **Buttons don't work** → Test every interaction
5. **Replica app** → Emphasize unique interactive features

**How to Respond to Rejection**:

1. Read rejection reason carefully
2. Fix the issue (don't argue)
3. Reply to App Review explaining the fix
4. Resubmit within 24-48 hours

**Expedited Review**:

- Request only for critical bugs affecting live users
- Explain severity + urgency
- Available 1-2 times per year

---

## Analytics & Monitoring

### Key Metrics to Track

**Engagement**:

- DAU/MAU (daily/monthly active users)
- Avg. podcasts created per user
- Avg. listening time per session
- Interrupt rate (questions per podcast)
- Completion rate (% of podcast listened)

**Retention**:

- Day 1, 7, 30 retention
- Churn rate by subscription tier
- Reactivation rate (lapsed users who return)

**Conversion**:

- Free → Pro conversion rate
- App Store → signup conversion rate
- Feature usage (download, share, fork, follow)

**Technical**:

- Crash-free rate (target: >99.5%)
- App launch time (target: <2s)
- API response time (target: <500ms)
- Background audio interruptions

### Tools

**Analytics**: Mixpanel or Amplitude
**Crash Reporting**: Sentry
**Performance Monitoring**: Firebase Performance
**A/B Testing**: Optimizely or Firebase Remote Config

---

## Risk Mitigation

### Risk 1: App Store Rejection

**Likelihood**: Medium
**Impact**: High (delays launch by 1-2 weeks)

**Mitigation**:

- Study App Review Guidelines thoroughly
- Test on multiple devices before submission
- Have legal review privacy policy
- Prepare detailed response for common rejection reasons

### Risk 2: Background Audio Issues

**Likelihood**: Medium
**Impact**: High (core feature broken)

**Mitigation**:

- Use battle-tested library (react-native-track-player)
- Test on real devices (not just simulator)
- Handle interruptions (phone calls, Siri, alarms)
- Test with low battery/low power mode

### Risk 3: OTA Update Limits

**Likelihood**: Low
**Impact**: Medium (need App Store update for critical fix)

**Mitigation**:

- Expo OTA updates only work for JS code (not native)
- If we add custom native modules, OTA won't work for those
- Plan for App Store updates every 2-4 weeks

### Risk 4: Poor Performance on Older Devices

**Likelihood**: Medium
**Impact**: Medium (bad reviews, churn)

**Mitigation**:

- Set minimum iOS version to 14.0 (covers 90%+ devices)
- Test on older devices (iPhone X, iPhone 8)
- Optimize bundle size (lazy load components)
- Use FlatList for long lists (feed, transcript)

---

## Summary

**Phase 1 (Now)**: PWA works on iOS Safari, limited by browser capabilities.

**Phase 2 (Months 2-3)**: React Native + Expo app with background audio, push notifications, native UI. Launch on App Store.

**Phase 3 (Month 4+)**: Apple Watch, CarPlay, Siri Shortcuts, offline downloads, widgets.

**Key Decisions**:

- React Native + Expo (not Flutter or native)
- Web billing (not IAP) to avoid 30% Apple fee
- Same API backend (no rewrites)
- Managed workflow (not bare) for faster iteration

**Timeline**: MVP on App Store in 3 months, full feature set in 6 months.

**Team**: 1 senior React Native dev, 1 backend dev (part-time), 1 designer (part-time).

**Cost**: $99/year (Apple Developer), $299/month (EAS Build), $0 (Expo SDK is free).
