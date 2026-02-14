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
| State | Zustand (local) + React Query (server) | Installed |
| API | Axios → EXPO_PUBLIC_API_URL | Installed |
| Auth | expo-secure-store (token storage) | Installed |
| Fonts | expo-font + @expo-google-fonts (DM Serif Display, Inter) | Installed |
| Animations | react-native-reanimated | Installed |
| Types | @sotto/shared (shared with web) | Installed |
| Audio | react-native-track-player (background playback) | **Not yet installed** — needs dev client build |
| Notifications | expo-notifications (push) | **Not yet installed** — needs dev client build |

### Adding native packages (audio, notifications)

These require a custom dev client (can't use Expo Go):

```bash
cd apps/mobile
npx expo install react-native-track-player expo-notifications
npm run ios:build   # builds custom dev client with native modules
```

Then update `lib/audio-player.ts` and `lib/notifications.ts` with real implementations.

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
│   (no changes needed)    │
└──────────────────────────┘
```

## Navigation Structure

```
app/
├── _layout.tsx            # Root layout (fonts, providers, QueryClient)
├── (tabs)/
│   ├── _layout.tsx        # Tab navigator
│   ├── index.tsx          # Feed (home)
│   ├── create.tsx         # Create podcast
│   ├── notifications.tsx  # Notifications
│   └── profile.tsx        # Current user profile
├── auth/
│   └── login.tsx          # Login screen
├── podcast/
│   └── [id].tsx           # Full-screen player
└── user/
    └── [userId].tsx       # Public profile
```

## Lib Files

| File | Purpose | Status |
|------|---------|--------|
| `api.ts` | Axios client — reads `EXPO_PUBLIC_API_URL` from env, attaches Bearer token | Working |
| `auth.ts` | SecureStore token management (get, set, delete, isAuthenticated) | Working |
| `theme.ts` | Imports @sotto/shared tokens → RN StyleSheet helpers | Working |
| `audio-player.ts` | react-native-track-player setup and controls | Stub — needs package install |
| `notifications.ts` | expo-notifications handler + push token registration | Stub — needs package install |

## Environment Variables

See `.env.example`. The critical one:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `EXPO_PUBLIC_API_URL` | Yes (dev) | `https://sotto.fm/api` | Backend API base URL |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | For builds | — | EAS Build project ID |

In dev, set this to your machine's LAN IP so the iOS Simulator can reach the web backend.

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

## Conventions

- **No web code** — this app calls the web API, it doesn't import web app code
- **Shared types** — import from `@sotto/shared`, never duplicate type definitions
- **Design tokens** — use `lib/theme.ts` which bridges @sotto/shared to React Native
- **Screen files** — one screen per file in the `app/` directory (expo-router convention)
- **StyleSheet only** — no styled-components, no NativeWind. Use `StyleSheet.create()`
- **No inline styles** — define all styles in a `styles` const at the bottom of the file

## Adding a New Screen

1. Create the file in `app/` following expo-router conventions
2. Import types from `@sotto/shared`
3. Use `lib/api.ts` for API calls (auth token attached automatically)
4. Use `lib/theme.ts` for colors/spacing/typography
5. Add navigation entry in the appropriate layout file if needed

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Network request failed" | Check `EXPO_PUBLIC_API_URL` — must be LAN IP, not `localhost` |
| Stale JS bundle | `npx expo start --clear` to reset Metro cache |
| Fonts not rendering | Check `_layout.tsx` — fonts load async via `useFonts` hook |
| SecureStore error in simulator | SecureStore works in simulators, but clear app data if tokens get stale |
| Build fails on EAS | Run `eas build --platform ios --profile development --local` for local debug |
| "Cannot find module react-native-track-player" | Package not yet installed — see "Adding native packages" above |
