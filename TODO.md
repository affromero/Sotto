# TODO

Active backlog for the open-source private briefing release.

Historical community-product implementation tasks were removed from this file because the current product direction is private, self-hosted audio infrastructure.

## Release Readiness

- [ ] Finish the OSS surface audit for hardcoded hosted domains, private account names, and managed-only assumptions.
- [ ] Keep `npm run setup`, `npm run dev`, `npm run test`, and `npm run ci` working from a fresh clone with local services.
- [ ] Keep `.env.oss.example` aligned with every required local variable and every optional provider integration.
- [ ] Keep the privacy guard tests current as release blockers are found.

## Onboarding

- [ ] Reduce first-run setup to one command plus a guided local configuration check.
- [ ] Add clear health checks for PostgreSQL, Redis, storage, auth, AI providers, TTS providers, and worker queues.
- [ ] Make missing provider keys actionable without starting background jobs that cannot complete.

## Provider And Agent Integrations

- [ ] Document OpenClaw, Hermes, Claude Code, Codex, and local agent ingestion as first-class inputs.
- [ ] Keep BYOK routing explicit for AI, TTS, STT, and verification providers.
- [ ] Add meeting-recorder ingestion as a private source for daily briefings.
- [ ] Add news ingestion as a separate private briefing source with source attribution and verification.

## Managed Hosting

- [ ] Define the one-week hosted trial boundary and what happens when it expires.
- [ ] Keep managed-hosting code paths optional and isolated from the default self-host workflow.
- [ ] Document the operational minimum for Hetzner-style single-node deployments.

## Quality Bar

- [ ] Keep the app clearly differentiated from NotebookLM-style one-off document conversion.
- [ ] Keep public copy focused on private recurring workflows, not generic AI content generation.
- [ ] Keep CI, targeted tests, and OSS guard scans green before every stage commit.
