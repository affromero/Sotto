# apps/mobile/ — Sotto Mobile App (iOS + Android)

## Quick Start

```bash
npm install                    # From repo root
npm run dev                    # Start web backend (mobile is a thin client)
npm run mobile:ios             # iOS Simulator (syncs EXPO_PUBLIC_* from .env.local)
npm run mobile:android         # Android emulator (syncs EXPO_PUBLIC_* from .env.local)
```

Env is synced from the repo root `.env.local` by `npm run mobile:env`. `EXPO_PUBLIC_API_URL` is required and may be derived from `NEXT_PUBLIC_APP_URL`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81 + Expo SDK 54 |
| Navigation | expo-router (file-based) |
| State | React Query |
| API | Axios → EXPO_PUBLIC_API_URL |
| Auth | Google (native SDK), Apple (expo-apple-auth, iOS), GitHub (expo-auth-session) |
| Storage | expo-secure-store |
| Fonts | expo-font + @expo-google-fonts (DM Serif Display, Inter) |
| Audio | react-native-track-player (background playback) |
| Types | @sotto/shared |

## Architecture

Thin client — all business logic in web backend API. Mobile handles UI, background audio, push notifications, and SecureStore auth.

## Auth Flow

Uses API key-based auth (`sk_sotto_` tokens), not NextAuth sessions.

- **Dev**: Email login → `POST /api/v1/auth/mobile` → `{token, user}`
- **Google**: Native sign-in → `idToken` → backend
- **Apple** (iOS only): Native sign-in → `identityToken` → backend
- **GitHub**: Browser flow → code exchange → backend

Token lifecycle: SecureStore → Axios interceptor attaches Bearer → backend validates SHA-256 hash → 401 clears token → `useProtectedRoute()` redirects to login.

## Navigation

```
app/
├── _layout.tsx            # Root (fonts, providers, QueryClient, connect gate → auth gate)
├── connect.tsx            # First-run "connect to your server" (enter URL) — routed to when no server is configured
├── (tabs)/
│   ├── index.tsx          # Private library
│   ├── notifications.tsx  # Notifications
│   └── profile.tsx        # Current user profile
├── auth/login.tsx         # Login (dev: email, prod: OAuth)
├── settings.tsx           # Settings hub — BYOK keys, logout
├── settings/api-keys.tsx  # BYOK key management
├── podcast/[id].tsx       # Full-screen player
└── learn/
    ├── placement.tsx      # Placement test (PlacementQuiz component)
    ├── memory.tsx         # Memory graph (MemoryGraphWebView)
    ├── [classId].tsx      # Class runner — all 4 skill sections
    └── class/[classId].tsx # Alias route / deep-link target for a specific class
```

## Lib Files

| File | Purpose |
|------|---------|
| `api.ts` | Axios client, Bearer token, `onAuthRevoked()` on 401. `baseURL` resolved per-request (not frozen at import) so a runtime-paired server takes effect without restart |
| `auth.ts` | SecureStore token management |
| `server-url.ts` | Runtime server URL (SecureStore + sync cache): `loadStoredServerUrl()`, `getStoredServerUrl()`, `setStoredServerUrl()`, `hasServerConfigured()`. Lets one build connect to any self-hosted server |
| `connect.ts` | `connectToServer(url)` (store a server) + `pairWithToken(url, token)` (redeem a "scan to connect" pairing token → session) + `normalizeServerUrl()` |
| `theme.ts` | @sotto/shared tokens → RN StyleSheet helpers |
| `formatters.ts` | `formatDuration`, `formatCount`, `timeAgo`, etc. |
| `audio-player.ts` | react-native-track-player setup + track loading |
| `notifications.ts` | Push notification handler + token registration |
| `learn-api.ts` | Learn flow API calls: placement, courses, classes, submit, speaking upload, memory graph |

## Components

| File | Purpose |
|------|---------|
| `Avatar.tsx` | Image with fallback initial circle |
| `EmptyState.tsx` / `ErrorState.tsx` | Empty + error patterns |
| `PodcastCard.tsx` | `variant="feed"` (full) / `variant="compact"` (row) |
| `BottomSheet.tsx` | Bottom sheet container |
| `learn/PlacementQuiz.tsx` | Multi-step placement test UI — fetches questions, submits answers |
| `learn/MCSection.tsx` | Multiple-choice section renderer for grammar/reading/listening |
| `learn/ListeningSection.tsx` | Listening section: embedded audio player + MC questions |
| `learn/SpeakingExercise.tsx` | Microphone capture for a SpeakingPrompt, polls for SCORED status |
| `learn/MemoryGraphWebView.tsx` | WebView wrapping the web memory graph at `/memory?courseId=…` |
| `learn/ClassWorksheet.tsx` | Displays the printable worksheet PDF + PencilKit ink overlay (requires custom dev build) |

## Environment Variables

All `EXPO_PUBLIC_*` values come from the repo root `.env.local`. `npm run mobile:env` writes `apps/mobile/.env` for Expo.

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_URL` | Backend API base URL |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS Build project ID |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in web client ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in iOS client ID |
| `EXPO_PUBLIC_GITHUB_CLIENT_ID` | GitHub OAuth client ID |

## Commands

```bash
npm run mobile:ios / mobile:android   # Start with simulator/emulator
npm run mobile:ios:build              # Dev client (EAS)
npm run mobile:ios:build:preview      # TestFlight (EAS)
npm run mobile:ios:build:production   # App Store (EAS)
npm run mobile:android:build          # Dev APK (EAS)
npm run mobile:android:build:production  # Play Store AAB (EAS)
```

## DO

- Import types from `@sotto/shared` — never duplicate definitions
- Use `lib/theme.ts` for design tokens, `lib/formatters.ts` for display formatting
- Use shared components (`Avatar`, `EmptyState`, `ErrorState`, `PodcastCard`)
- Use `StyleSheet.create()` for all styles
- Define styles in a `styles` const at bottom of file
- Use `lib/api.ts` for API calls (auth token attached automatically)

## DON'T

- Import web app code — mobile calls the web API only
- Use styled-components or NativeWind
- Use inline styles
- Define local format functions — use `lib/formatters.ts`
- Duplicate type definitions — use `@sotto/shared`

## Native Modules

- **`modules/sotto-pencilkit/`** — optional native iOS PencilKit module for ink-layer capture on class worksheets. Feature-detected at runtime (`modules/sotto-pencilkit/index.ts`). Requires a custom dev build (`npm run mobile:ios:build`); the standard Expo Go client does not include it. Android gracefully degrades (no ink layer).

## Platform Notes

- **iOS**: Apple Sign In (hidden on Android). Universal Links via `associatedDomains`.
- **Android**: Google Sign In (native SDK). Notification icon must be monochrome. `google-services.json` required. App Links via `intentFilters`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Network request failed" | `npm run mobile:env` to re-sync. Check `EXPO_PUBLIC_API_URL` reaches the web backend from the simulator/device |
| Stale JS bundle | `npx expo start --clear` |
| Auth redirect loop | Check `useProtectedRoute()` in `_layout.tsx` |
| 401 on all calls | Clear SecureStore, re-login |
| EAS build fails | Add `--local` for local debug |
