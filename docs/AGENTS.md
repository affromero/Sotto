# docs/ - Project Documentation

User-facing documentation for self-hosting, deploying, developing, and extending Sotto. These are the docs that matter to a public reader — a self-hoster or contributor.

## Docs

| File                             | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `01-technical-architecture.md`   | System architecture and data model                  |
| `02-hosting-infrastructure.md`   | Self-hosting infrastructure and topology            |
| `03-self-host-deployment.md`     | Deployment guide                                    |
| `04-local-development.md`        | Local OSS setup (no hosted secret manager)          |
| `05-provider-extension-guide.md` | Local/no-code and native provider extension recipes |
| `06-user-flows.md`               | End-to-end self-hosted learner and operator flows   |
| `07-architecture-diagrams.md`    | Mermaid diagrams for architecture and API flows     |

## Rules

- Every doc must open with a title, date, and one-line summary.
- Keep docs aligned with code in the same commit.
- Describe the self-hostable, private-first, single-learner product.
- Do not require a hosted secret manager for local OSS setup.
- Document explicit provider selection and typed setup errors, never provider fallback chains.
- Use tables for comparisons and code blocks for exact commands or payloads.
- Avoid stale external pricing claims unless the doc includes a verification date.
