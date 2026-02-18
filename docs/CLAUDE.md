# docs/ — Project Documentation

Comprehensive documentation following the Quvo philosophy: document everything, make it the source of truth.

## Pitch Deck Story Order

Docs are numbered to match the investor pitch order in `scripts/rebuild-pitch.sh`. The `/pitch` viewer (password-gated) presents them in this sequence.

| #   | File                           | Act                 | Purpose                                                |
| --- | ------------------------------ | ------------------- | ------------------------------------------------------ |
| 01  | `01-product-vision.md`         | **The Hook**        | Problem, solution, target users, personas              |
| 02  | `02-ui-mockups.md`             |                     | Page-by-page layout specifications                     |
| 03  | `03-market-analysis.md`        | **The Opportunity** | TAM/SAM/SOM, competitor deep dives                     |
| 04  | `04-post-pivot-analysis.md`    |                     | Competitive reassessment, odds & verdict, YC path      |
| 05  | `05-plan.md`                   | **The Product**     | Master plan: user flows, architecture, pricing, phases |
| 06  | `06-discovery-chat-flow.md`    |                     | Chat agent behavior, recommendation logic              |
| 07  | `07-ai-prompts.md`             |                     | System prompts for discovery, script gen, Q&A          |
| 08  | `08-design-system.md`          |                     | Component specs, spacing rules, color usage            |
| 09  | `09-unit-economics.md`         | **The Business**    | Cost per user, revenue projections, breakeven          |
| 10  | `10-stripe-billing.md`         |                     | Stripe products, webhooks, subscription lifecycle      |
| 11  | `11-provider-pricing.md`       |                     | AI provider comparison: LLM, TTS, exact pricing        |
| 12  | `12-shipping-roadmap.md`       | **The Honest Take** | P0-P3 priorities, week-by-week launch plan             |
| 13  | `13-mvp-launch-guide.md`       |                     | Deployment checklist, cost breakdown, testing          |
| 14  | `14-mobile-strategy.md`        |                     | PWA now, React Native roadmap                          |
| 15  | `15-ios-app-strategy.md`       |                     | Three-phase iOS plan                                   |
| 16  | `16-technical-architecture.md` | **Appendix**        | System design, data flow diagrams                      |
| 17  | `17-authentication-setup.md`   |                     | NextAuth config, OAuth provider setup                  |
| 18  | `18-hosting-infrastructure.md` |                     | Hosting: Hetzner VPS + Docker Compose + Caddy          |
| 19  | `19-deploy-sotto-fm.md`        |                     | Hetzner VPS deployment, early access gate              |
| 20  | `20-roles-and-dashboards.md`   |                     | User roles, admin capabilities                         |
| 21  | `21-logo-brief.md`             |                     | Logo design brief                                      |
| 22  | `22-palette-brief.md`          |                     | Color palette brief                                    |
| 23  | `23-local-development.md`      |                     | Local dev setup, env vars, what works without API keys |
| 24  | `24-ios-testflight-appstore-guide.md` |              | TestFlight builds, App Store submission, OTA updates   |
| 25  | `25-twitter-integration.md`   |                     | @sottofm bot: Twitter Developer setup, pipeline, testing |
| 26  | `26-telegram-integration.md`  |                     | @SottoFMBot Telegram bot: BotFather setup, discovery chat, pipeline |
| —   | `accounting/`                  | —                   | Beancount ledger, import scripts, monthly close        |

```bash
# Rebuild pitch locally
bash scripts/rebuild-pitch.sh

# Also rebuilt automatically on push to main via CI/CD
```

## Rules

- Every doc must have a clear title, date, and summary at the top
- Include links to pricing pages, external resources, and references
- Keep docs up to date when code changes — outdated docs are worse than no docs
- Use tables for comparisons, code blocks for examples
- Number files to match pitch story order — no gaps, no duplicates
- When adding or removing a doc, update **both** this file and `scripts/rebuild-pitch.sh`
