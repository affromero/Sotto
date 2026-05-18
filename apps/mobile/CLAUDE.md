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

- **Dev**: Email login → `POST /api/auth/mobile` → `{token, user}`
- **Google**: Native sign-in → `idToken` → backend
- **Apple** (iOS only): Native sign-in → `identityToken` → backend
- **GitHub**: Browser flow → code exchange → backend

Token lifecycle: SecureStore → Axios interceptor attaches Bearer → backend validates SHA-256 hash → 401 clears token → `useProtectedRoute()` redirects to login.

## Navigation

```
app/
├── _layout.tsx            # Root (fonts, providers, QueryClient, auth gate)
├── (tabs)/
│   ├── index.tsx          # Private library
│   ├── create.tsx         # 5-step: discovery → voice → scripting → preview → generating
│   ├── notifications.tsx  # Notifications
│   └── profile.tsx        # Current user profile
├── auth/login.tsx         # Login (dev: email, prod: OAuth)
├── ideas.tsx              # Saved ideas — swipe to dismiss, tap to generate
├── settings.tsx           # Settings hub — BYOK keys, logout
├── settings/api-keys.tsx  # BYOK key management
└── podcast/[id].tsx       # Full-screen player
```

## Lib Files

| File | Purpose |
|------|---------|
| `api.ts` | Axios client, Bearer token, `onAuthRevoked()` on 401 |
| `auth.ts` | SecureStore token management |
| `theme.ts` | @sotto/shared tokens → RN StyleSheet helpers |
| `formatters.ts` | `formatDuration`, `formatCount`, `timeAgo`, etc. |
| `audio-player.ts` | react-native-track-player setup + track loading |
| `notifications.ts` | Push notification handler + token registration |
| `event-buffer.ts` | Event batching: 5s flush, AppState-aware, silent failure |
| `usePlaybackTelemetry.ts` | Observes RNTP state, fires playback events |

## Components

| File | Purpose |
|------|---------|
| `Avatar.tsx` | Image with fallback initial circle |
| `EmptyState.tsx` / `ErrorState.tsx` | Empty + error patterns |
| `PodcastCard.tsx` | `variant="feed"` (full) / `variant="compact"` (row) |
| `SwipeCard.tsx` / `SwipeQuiz.tsx` | Gesture-driven taste quiz |
| `InspireMe.tsx` | Tabbed sections (forYou, trending, news, curiosity) |
| `BottomSheet.tsx` / `OptionPicker.tsx` | Bottom sheet + selectable list |
| `PillGroup.tsx` | Horizontal scrollable pill buttons |
| `AiModelSelector.tsx` / `TtsModelSelector.tsx` | Model pickers (persist to SecureStore) |
| `VoicePickerSheet.tsx` | Voice selection with auto-assign toggle |
| `DurationPicker.tsx` / `VisibilityPicker.tsx` | Duration + visibility pickers |
| `GenerationProgress.tsx` | 8-step pipeline progress indicator |
| `ScriptPreview.tsx` | Read-only script preview with approve/regenerate |
| `EventProvider.tsx` | React context providing `track()` + userId sync |

## Creation Flow

5-step state machine in `app/(tabs)/create.tsx`:

1. **discovery** — Chat with AI model selector pill
2. **voice** — VoicePickerSheet, TtsModelSelector, DurationPicker, VisibilityPicker
3. **scripting** — GenerationProgress, 3s polling, auto-advances on SCRIPT_READY
4. **script-preview** — Approve → generating, regenerate → scripting
5. **generating** — GenerationProgress, 3s polling, navigates to podcast on READY

Preferences persist via SecureStore: `sotto:aiModel`, `sotto:ttsOption`.

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
