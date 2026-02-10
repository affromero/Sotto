---
name: update-pitch
description: Build versioned HTML pitch deck from docs/*.md using /md-to-html skill, stored in .pitch/ for the /pitch viewer. Includes auto-captured app screenshots.
---

# update-pitch Skill

Convert all `docs/*.md` files in the Sotto project to self-contained HTML5 documents and store them as a versioned build in `.pitch/yyyy-mm-dd/`. These builds are served by the `/pitch` page — a password-gated investor materials viewer.

Markdown files in `docs/` are the source of truth. This skill produces rendered HTML views.

## Trigger

Activate when the user says:

- `/update-pitch`
- "update pitch deck", "rebuild pitch", "generate pitch materials"

## Document Order

These docs are included in this exact presentation order:

| Order | File                         | Display Name           |
| ----- | ---------------------------- | ---------------------- |
| 0     | 99-app-showcase.md           | App Showcase           |
| 1     | 01-product-vision.md         | Product Vision         |
| 2     | 00-plan.md                   | Product Plan           |
| 3     | 02-market-analysis.md        | Market Analysis        |
| 4     | 11-unit-economics.md         | Unit Economics         |
| 5     | 05-ui-mockups.md             | UI Mockups             |
| 6     | 04-design-system.md          | Design System          |
| 7     | 03-technical-architecture.md | Technical Architecture |
| 8     | 06-authentication-setup.md   | Authentication Setup   |
| 9     | 07-stripe-billing.md         | Stripe Billing         |
| 10    | 08-ai-prompts.md             | AI Prompts             |
| 11    | 09-discovery-chat-flow.md    | Discovery Chat Flow    |
| 12    | 10-mobile-strategy.md        | Mobile Strategy        |
| 13    | 12-provider-pricing.md       | Provider Pricing       |
| 14    | 13-hosting-infrastructure.md | Hosting Infrastructure |
| 15    | 13-mvp-launch-guide.md       | MVP Launch Guide       |
| 16    | 14-ios-app-strategy.md       | iOS App Strategy       |
| 17    | 15-logo-brief.md             | Logo Brief             |
| 18    | 16-palette-brief.md          | Palette Brief          |
| 19    | 17-roles-and-dashboards.md   | Roles & Dashboards     |
| 20    | deploy-sotto-fm.md           | Deployment Guide       |

**Excluded:** `docs/CLAUDE.md` (project instructions, not documentation).

**Note:** `docs/99-app-showcase.md` is auto-generated (gitignored). It is created by `scripts/rebuild-pitch.sh` from live app screenshots.

## Procedure

### Step 0: Check for Automated Pipeline

The canonical way to rebuild the pitch is via `scripts/rebuild-pitch.sh`, which:

1. Seeds demo data (`prisma/seed-demo.ts`)
2. Captures live app screenshots via Playwright (`scripts/capture-pitch-screenshots.ts`)
3. Generates `docs/99-app-showcase.md` from the screenshot manifest
4. Converts all docs to HTML via pandoc
5. Builds `.pitch/manifest.json`

If the user wants the full pipeline including screenshots, run:

```bash
bash scripts/rebuild-pitch.sh
```

If the user wants only the HTML conversion (no screenshots), continue with the manual steps below.

### Step 1: Capture App Screenshots (Optional)

If the app is running and the user wants fresh screenshots:

```bash
npx tsx prisma/seed-demo.ts
npx tsx scripts/capture-pitch-screenshots.ts
```

This creates `/tmp/pitch-screenshots/manifest.json` with R2 URLs. Then generate the showcase doc:

```bash
# The rebuild-pitch.sh script handles this automatically
```

If skipping screenshots, check if `docs/99-app-showcase.md` already exists from a previous run. If not, it will simply be skipped in the build.

### Step 2: Check for Existing Same-Day Build

```bash
TODAY=$(date +%Y-%m-%d)
BUILD_DIR="/home/ubuntu/Code/Sotto/.pitch/$TODAY"
```

If `$BUILD_DIR` already exists, ask the user:

> "A build from today ($TODAY) already exists. Overwrite it?"

If yes, remove the existing directory. If no, abort.

### Step 3: Create Build Directory

```bash
mkdir -p "$BUILD_DIR"
```

### Step 4: Convert Each Document

For each document in the order table above:

1. Check that the source file exists at `docs/<filename>`. Skip with a warning if missing.
2. Invoke the `/md-to-html` skill to convert the file. Use:
   - **Palette**: Warm Amber (the Sotto palette — skip the branding question)
   - **Fonts**: DM Serif Display + Inter (skip the font question)
   - **Resource path**: `docs/` directory (so relative image paths resolve)
   - The `/md-to-html` skill should not ask branding questions — use its saved config which already has `warm-amber` palette and `dm-serif-inter` fonts.
3. The `/md-to-html` skill will produce an HTML file. Move/copy the output to `$BUILD_DIR/<filename-with-.html-extension>`.
   - For example: `01-product-vision.md` becomes `01-product-vision.html`

**Important**: Since this is a batch operation, tell `/md-to-html` the batch input directory `docs/` so it processes all files efficiently. Alternatively, invoke it once per file if batch mode doesn't support the specific ordering needed.

### Step 5: Build Manifest

After all documents are converted, build or update `.pitch/manifest.json`:

1. Read existing `.pitch/manifest.json` if it exists (may have previous versions).
2. Extract the display name for each document from its first `# heading` line. Fall back to the display names in the order table above if no heading found.
3. Create a new `PitchVersion` entry:

```json
{
  "date": "2026-02-10",
  "buildTime": "2026-02-10T14:30:00.000Z",
  "documents": [
    {
      "filename": "99-app-showcase.html",
      "displayName": "App Showcase",
      "order": 0,
      "sourceMarkdown": "docs/99-app-showcase.md"
    },
    {
      "filename": "01-product-vision.html",
      "displayName": "Product Vision",
      "order": 1,
      "sourceMarkdown": "docs/01-product-vision.md"
    }
  ]
}
```

4. If a version with the same date already exists in the manifest, replace it.
5. Sort versions descending by date. Set `latest` to the newest date.
6. Write `.pitch/manifest.json`:

```json
{
  "versions": [ ... ],
  "latest": "2026-02-10"
}
```

### Step 6: Report Summary

Output a summary:

```
Pitch build complete:
- Date: 2026-02-10
- Documents: 21
- Build directory: .pitch/2026-02-10/
- Total size: 12.3 MB
- Manifest updated: .pitch/manifest.json

View at /pitch (requires PITCH_PASSWORD)
```

## CI/CD Integration

The pitch deck is automatically rebuilt on every push to `main` via `.github/workflows/deploy.yml`. After the app deploys and passes health checks, the workflow SSHs into the server and runs `scripts/rebuild-pitch.sh`. This ensures the pitch deck always reflects the latest app state.

## Notes

- The `.pitch/` directory is gitignored (generated artifacts).
- `.pitch/.gitkeep` ensures the directory exists in git.
- `docs/99-app-showcase.md` is gitignored (generated from screenshots).
- Old builds are preserved for version history. The `/pitch` viewer has a version dropdown.
- If a markdown file has been deleted from `docs/`, it simply won't appear in the new build.
- The manifest is append-only (new versions added, old ones kept).
- Screenshots are stored on R2, not in git. The showcase doc references them by URL.
