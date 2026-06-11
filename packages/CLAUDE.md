# packages/ — Shared Packages

## `shared/` (`@sotto/shared`)

Shared code consumed by both `apps/web/` and `apps/mobile/`.

### What belongs here

- **Types** — Prisma-free interfaces and string union enums (e.g., `PodcastStatus`, `Speaker`)
- **Validations** — Zod schemas used for client-side validation on both platforms
- **Design tokens** — Colors, spacing, typography constants from the "Warm Intimacy" design system
- **Content badges** — `content-badge.ts` — badge logic for content type, AI/TTS provider, and language
- **Provider display** — `provider-display.ts` — display name maps and label helpers for AI/TTS providers, models, and languages

### What does NOT belong here

- **Prisma models** — server-side only, stay in `apps/web/`
- **React components** — platform-specific (CSS Modules vs StyleSheet)
- **Server-side libs** — auth, queue, storage clients stay in `apps/web/src/lib/`
- **API route logic** — stays in `apps/web/src/app/api/v1/`

### Adding shared code

1. Add the type/validation/token to the appropriate file in `packages/shared/src/`
2. Export it from `packages/shared/src/index.ts`
3. If replacing a web-only type, update `apps/web/src/types/*.ts` to re-export from `@sotto/shared`
4. Run `npm run type-check` to verify both consumers compile
