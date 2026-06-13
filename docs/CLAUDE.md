# docs/ - Project Documentation

User-facing documentation for self-hosting, deploying, developing, and extending Sotto. These are the docs that matter to a public reader — a self-hoster or contributor. Internal vision, planning, and strategy notes are intentionally kept out.

## Docs

| File | Purpose |
|---|---|
| `01-technical-architecture.md` | System architecture and data model |
| `02-authentication-setup.md` | OAuth and authentication setup |
| `03-hosting-infrastructure.md` | Self-hosting infrastructure and topology |
| `04-self-host-deployment.md` | Deployment guide |
| `05-local-development.md` | Local OSS setup (no Doppler) |
| `06-provider-extension-guide.md` | Local/no-code and native provider extension recipes |

## Rules

- Every doc must open with a title, date, and one-line summary.
- Keep docs aligned with code in the same commit; remove a surface's docs when the surface is removed.
- Describe the self-hostable, private-first product only: no social primitives, no removed mobile app, no billing/plan gates.
- Do not require Doppler for local OSS setup.
- Document explicit provider selection and typed setup errors, never provider fallback chains.
- Use tables for comparisons and code blocks for exact commands or payloads.
- Avoid stale external pricing claims unless the doc includes a verification date.
