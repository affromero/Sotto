# apps/ — Application Workspaces

| App        | Package      | Description                                                                              |
| ---------- | ------------ | ---------------------------------------------------------------------------------------- |
| `web/`     | `@sotto/web` | Next.js web app — App Router, Prisma, BullMQ workers, CSS Modules                        |
| `desktop/` | —            | Tauri desktop shell, built separately (excluded from npm workspaces via `!apps/desktop`) |

`web/` imports shared types, validations, and design tokens from `@sotto/shared` (`packages/shared/`).

## Running from root

All root scripts proxy to the web app:

```bash
npm run dev          # starts web + workers
npm run build        # builds web app
npm run ci           # lint + type-check + test + build (web)
```
