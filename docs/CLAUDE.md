# docs/ - Project Documentation

Docs are part of the product surface for the open source release. They must describe the private-first Sotto architecture that exists on this branch, not the removed public-network strategy.

## Active Release Docs

| File | Purpose |
|---|---|
| `01-product-vision.md` | Private-first product vision, positioning, and boundaries |
| `05-plan.md` | Implementation plan for OSS onboarding, providers, agents, meetings, news, and webhooks |
| `07-ai-prompts.md` | Prompt architecture for discovery, generation, verification, and Q&A |
| `11-provider-pricing.md` | Provider pricing reference |
| `16-technical-architecture.md` | System architecture and private data model |
| `17-authentication-setup.md` | OAuth and auth setup |
| `18-hosting-infrastructure.md` | Self-hosting infrastructure guide |
| `19-self-host-deployment.md` | Deployment guide |
| `20-roles-and-dashboards.md` | Role/admin behavior |
| `21-logo-brief.md` | Logo design reference |
| `23-local-development.md` | Local OSS setup without Doppler |
| `24-ios-testflight-appstore-guide.md` | iOS distribution guide |
| `27-launch-readiness-status.md` | Launch readiness tracking |

## Removed Pitch-Era Docs

The old investor-pitch docs for public discovery, community ranking, creator network effects, and remix behavior were removed because they contradicted the active schema and routes. Do not re-add them as "historical context" in the release packet.

## Rules

- Every active doc must have a title, date, and summary at the top.
- Keep docs aligned with code in the same commit.
- When removing a product surface, remove its docs and update `scripts/rebuild-pitch.sh`.
- Do not describe removed social primitives as current behavior.
- Do not require Doppler for local OSS setup docs.
- Do not document provider fallback chains. Document explicit provider selection and typed setup errors.
- Use tables for comparisons and code blocks for exact commands or payloads.
- Avoid stale external pricing claims unless the doc includes a verification date.
