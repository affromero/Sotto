# apps/ — Application Workspaces

| App | Package | Description |
|-----|---------|-------------|
| `web/` | `@sotto/web` | Next.js web app — App Router, Prisma, BullMQ workers, CSS Modules |
| `mobile/` | `@sotto/mobile` | React Native + Expo iOS app — expo-router, react-native-track-player |

Both apps import shared types, validations, and design tokens from `@sotto/shared` (`packages/shared/`).

## Running from root

All root scripts proxy to the web app:

```bash
npm run dev          # starts web + workers
npm run build        # builds web app
npm run ci           # lint + type-check + test + build (web)
```

## Key differences

| Concern | Web (`apps/web/`) | Mobile (`apps/mobile/`) |
|---------|-------------------|------------------------|
| Routing | Next.js App Router | expo-router |
| Styling | CSS Modules | React Native StyleSheet |
| Auth | NextAuth (server-side sessions) | SecureStore + API tokens |
| State | React Server Components + hooks | Zustand + React Query |
| Audio | HTML5 Audio API | react-native-track-player |
| Database | Prisma (direct) | API calls to web backend |
