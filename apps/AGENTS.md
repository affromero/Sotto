# apps/ — Application Workspaces

| App        | Package      | Description                                                                                            |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `web/`     | `@sotto/web` | Next.js web app — App Router, Prisma, BullMQ workers, CSS Modules                                      |
| `desktop/` | —            | Tauri desktop shell, built separately (excluded from npm workspaces via `!apps/desktop`)               |
| `ios/`     | —            | Universal iPhone + iPad SwiftUI client (`Sotto.xcodeproj`); pairs with a server over `/api/v1`         |
| `android/` | —            | Native Kotlin/Compose phone and tablet client; standalone Gradle project for pairing and partner games |

`web/` imports shared types, validations, and design tokens from `@sotto/shared` (`packages/shared/`).
Both native clients test against the exact generated `packages/shared/fixtures/play/contract.json`.
Shared Play contracts, fixtures, exporter and engine changes select both native CI gates.

## Running from root

All root scripts proxy to the web app:

```bash
npm run dev          # starts web + workers
npm run build        # builds web app
npm run ci           # lint + type-check + test + build (web)
```
