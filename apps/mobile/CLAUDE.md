# apps/mobile/ — Sotto iOS App (React Native + Expo)

## Quick Start

```bash
# Prerequisites: Xcode 16+, iOS Simulator, Node 20+

# 1. Install dependencies (from repo root)
npm install

# 2. Copy env and set your local IP (NOT localhost — simulator needs a routable address)
cp apps/mobile/.env.example apps/mobile/.env
# Edit .env → set EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000/api

# 3. Start the web backend (the mobile app is a thin client)
npm run dev

# 4. Start Expo dev server with iOS Simulator
npm run mobile:ios
# Or from apps/mobile/:
# npx expo start --ios
```

**Finding your LAN IP**: `ifconfig en0 | grep 'inet '` — use the `192.168.x.x` address.

## Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Framework | React Native 0.81 + Expo SDK 54 | Installed |
| Navigation | expo-router (file-based) | Installed |
| State | React Query (server state) | Installed |
| API | Axios → EXPO_PUBLIC_API_URL | Installed |
| Auth | expo-secure-store + expo-auth-session + expo-apple-authentication | Installed |
| Fonts | expo-font + @expo-google-fonts (DM Serif Display, Inter) | Installed |
| Animations | react-native-reanimated | Installed |
| Types | @sotto/shared (shared with web) | Installed |
| Audio | react-native-track-player (background playback) | Installed |
| Notifications | expo-notifications (push) | Installed |

## Architecture

The mobile app is a **thin client** — all business logic lives in the web backend's API routes.

```
┌──────────────────────────┐
│   iOS App (Expo)         │
│   - UI rendering         │
│   - Background audio     │
│   - Push notifications   │
│   - SecureStore auth     │
└───────────┬──────────────┘
            │ HTTPS (Axios)
            ▼
┌──────────────────────────┐
│   Web Backend (Next.js)  │
│   /api/podcasts, /feed   │
│   /api/discovery, etc.   │
│   /api/auth/mobile       │
└──────────────────────────┘
```

## Auth Flow

Mobile uses API key-based auth (`sk_sotto_` tokens), not NextAuth sessions.

**Dev mode** (`__DEV__`): Email-only login → `POST /api/auth/mobile` with `{email}` → receives `{token, user}`.

**Production**: OAuth buttons (Apple, Google, GitHub, Twitter) → native/browser OAuth flow → sends `{provider, idToken}` to `POST /api/auth/mobile` → receives `{token, user}`.

Token lifecycle:
1. Token stored in `expo-secure-store` via `lib/auth.ts`
2. Axios interceptor in `lib/api.ts` attaches `Authorization: Bearer sk_sotto_...` to every request
3. Backend's `authenticateRequest()` validates via SHA-256 hash lookup in `ApiKey` model
4. On 401, `api.ts` clears token and fires `onAuthRevoked()` event
5. `_layout.tsx`'s `useProtectedRoute()` hook listens for auth revocation → redirects to `/auth/login`

## Navigation Structure

```
app/
├── _layout.tsx            # Root layout (fonts, providers, QueryClient, auth gate)
├── (tabs)/
│   ├── _layout.tsx        # Tab navigator (Ionicons icons)
│   ├── index.tsx          # Feed (home) — infinite scroll, sort chips
│   ├── create.tsx         # Create podcast — chat-based discovery
│   ├── notifications.tsx  # Notifications — mark read, mark all read
│   └── profile.tsx        # Current user profile — podcasts list, logout
├── auth/
│   └── login.tsx          # Login screen (dev: email, prod: OAuth)
├── podcast/
│   └── [id].tsx           # Full-screen player — audio, transcript, Q&A
└── user/
    └── [userId].tsx       # Public profile — follow/unfollow, podcasts
```

## Lib Files

| File | Purpose |
|------|---------|
| `api.ts` | Axios client — reads `EXPO_PUBLIC_API_URL` from env, attaches Bearer token, fires `onAuthRevoked()` on 401 |
| `auth.ts` | SecureStore token management (get, set, delete, isAuthenticated) |
| `theme.ts` | Imports @sotto/shared tokens → `globalStyles` RN StyleSheet helpers |
| `formatters.ts` | Shared formatting: `formatDuration`, `formatCount`, `timeAgo`, `formatTime`, `formatDurationMinutes` |
| `audio-player.ts` | react-native-track-player setup (`setupPlayer`) and track loading (`loadTrack`) |
| `notifications.ts` | expo-notifications handler + push token registration via `POST /notifications/push` |

## Components

| File | Purpose |
|------|---------|
| `Avatar.tsx` | Image with fallback initial circle (`<Avatar uri={...} name={...} size={36} />`) |
| `EmptyState.tsx` | Centered icon + title + subtitle pattern |
| `ErrorState.tsx` | Error message + optional retry button |
| `PodcastCard.tsx` | Unified podcast card with `variant="feed"` (full card with avatar, tags, stats) and `variant="compact"` (list row) |

## Environment Variables

See `.env.example`. Key variables:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `EXPO_PUBLIC_API_URL` | Yes (dev) | `https://sotto.fm/api` | Backend API base URL |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | For builds | — | EAS Build project ID |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | For prod auth | — | Google OAuth client ID |
| `EXPO_PUBLIC_GITHUB_CLIENT_ID` | For prod auth | — | GitHub OAuth client ID |
| `EXPO_PUBLIC_TWITTER_CLIENT_ID` | For prod auth | — | Twitter OAuth client ID |

In dev, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP so the iOS Simulator can reach the web backend.

## Commands

```bash
# ── From repo root ──
npm run mobile              # Start Expo dev server
npm run mobile:ios           # Start with iOS Simulator
npm run mobile:xcode         # Generate native project + open in Xcode
npm run mobile:build         # Dev client build (EAS)
npm run mobile:build:preview # TestFlight build (EAS)
npm run mobile:build:production # App Store build (EAS)
npm run mobile:submit        # Upload to App Store Connect

# ── From apps/mobile/ ──
npx expo start              # Dev server (scan QR or press i for iOS)
npx expo start --ios         # iOS Simulator directly
npx expo start --clear       # Clear Metro cache (fix stale bundles)
npm run ios:open              # Generate ios/ folder + open Xcode workspace
npm run type-check           # tsc --noEmit

# ── EAS builds (from apps/mobile/) ──
eas build --platform ios --profile development   # Custom dev client
eas build --platform ios --profile preview       # TestFlight internal
eas build --platform ios --profile production    # App Store release
eas submit --platform ios --latest               # Upload to App Store Connect
eas update --branch production --message "fix: description"  # OTA update
```

### First App Store Submission

Before the first `eas submit`, add the `submit` block to `eas.json` with your Apple Developer credentials:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "me@afromero.co",
      "ascAppId": "<from App Store Connect → App Information → Apple ID>",
      "appleTeamId": "<from developer.apple.com → Membership → Team ID>"
    }
  }
}
```

## Conventions

- **No web code** — this app calls the web API, it doesn't import web app code
- **Shared types** — import from `@sotto/shared`, never duplicate type definitions
- **Design tokens** — use `lib/theme.ts` which bridges @sotto/shared to React Native
- **Shared formatters** — use `lib/formatters.ts` for all display formatting, never define local format functions
- **Shared components** — use `components/` for reusable UI (Avatar, EmptyState, ErrorState, PodcastCard)
- **Screen files** — one screen per file in the `app/` directory (expo-router convention)
- **StyleSheet only** — no styled-components, no NativeWind. Use `StyleSheet.create()`
- **No inline styles** — define all styles in a `styles` const at the bottom of the file

## Adding a New Screen

1. Create the file in `app/` following expo-router conventions
2. Import types from `@sotto/shared`
3. Use `lib/api.ts` for API calls (auth token attached automatically)
4. Use `lib/theme.ts` for colors/spacing/typography and `globalStyles` for common containers
5. Use `lib/formatters.ts` for display formatting
6. Use shared components from `components/` (Avatar, EmptyState, ErrorState, PodcastCard)
7. Add navigation entry in the appropriate layout file if needed

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Network request failed" | Check `EXPO_PUBLIC_API_URL` — must be LAN IP, not `localhost` |
| Stale JS bundle | `npx expo start --clear` to reset Metro cache |
| Fonts not rendering | Check `_layout.tsx` — fonts load async via `useFonts` hook |
| SecureStore error in simulator | SecureStore works in simulators, but clear app data if tokens get stale |
| Build fails on EAS | Run `eas build --platform ios --profile development --local` for local debug |
| Auth redirect loop | Check that `_layout.tsx` auth gate is working — `useProtectedRoute()` hook |
| 401 errors on all API calls | Token may be expired/invalid — clear SecureStore and re-login |
