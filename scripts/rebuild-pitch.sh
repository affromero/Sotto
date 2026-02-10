#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────
APP_URL="${APP_URL:-http://localhost:3000}"
TODAY=$(date +%Y-%m-%d)
SOTTO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$SOTTO_DIR/.pitch/$TODAY"
SCREENSHOT_DIR="/tmp/pitch-screenshots"
MANIFEST_FILE="$SCREENSHOT_DIR/manifest.json"
SHOWCASE_FILE="$SOTTO_DIR/docs/99-app-showcase.md"

# AI-Skills repo (github.com/affromero/AI-Skills) provides pandoc template + lua filters
AI_SKILLS_DIR="$HOME/.claude"
# Use GITHUB_TOKEN for authenticated access to private repo (passed by CI/CD or set locally)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AI_SKILLS_REPO="https://x-access-token:${GITHUB_TOKEN}@github.com/affromero/AI-Skills.git"
else
  AI_SKILLS_REPO="https://github.com/affromero/AI-Skills.git"
fi

# Pandoc template and lua filter locations (from AI-Skills repo)
PANDOC_TEMPLATE="$AI_SKILLS_DIR/skills/md-to-html/templates/default.html"
DOWNLOAD_IMAGES_FILTER="$AI_SKILLS_DIR/skills/md-to-pdf/filters/download-images.lua"

echo "================================================"
echo "  Sotto Pitch Rebuild — $TODAY"
echo "================================================"
echo ""
echo "App URL:   $APP_URL"
echo "Build dir: $BUILD_DIR"
echo ""

cd "$SOTTO_DIR"

# ── Step 0: Ensure AI-Skills repo is available ────────────────────
if [ ! -f "$PANDOC_TEMPLATE" ]; then
  echo "=== Step 0: Clone AI-Skills repo ==="
  if [ -d "$AI_SKILLS_DIR/.git" ]; then
    echo "  AI-Skills repo exists but template missing — pulling latest..."
    (cd "$AI_SKILLS_DIR" && git pull origin main 2>/dev/null || true)
  elif [ -d "$AI_SKILLS_DIR" ]; then
    echo "  ~/.claude exists but is not a git repo — cloning AI-Skills into it..."
    (cd "$AI_SKILLS_DIR" && git init && git remote add origin "$AI_SKILLS_REPO" && git fetch origin && git checkout origin/main -- skills/ agents/ references/ README.md .gitignore) 2>/dev/null || true
  else
    echo "  Cloning AI-Skills repo to ~/.claude..."
    git clone "$AI_SKILLS_REPO" "$AI_SKILLS_DIR" 2>/dev/null || true
  fi

  if [ -f "$PANDOC_TEMPLATE" ]; then
    echo "  Pandoc template found."
  else
    echo "  Warning: Could not obtain pandoc template. HTML will use plain pandoc styling."
  fi
  echo ""
fi

# ── Step 1: Seed demo data ────────────────────────────────────────
echo "=== Step 1: Seed demo data ==="
npx tsx prisma/seed-demo.ts
echo ""

# ── Step 2: Capture screenshots ───────────────────────────────────
echo "=== Step 2: Capture screenshots ==="
npx tsx scripts/capture-pitch-screenshots.ts
echo ""

# ── Step 3: Generate showcase doc ─────────────────────────────────
echo "=== Step 3: Generate app showcase doc ==="

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "Warning: Screenshot manifest not found at $MANIFEST_FILE"
  echo "Skipping showcase doc generation."
else
  # Read manifest and generate markdown
  cat > "$SHOWCASE_FILE" << 'HEADER'
---
title: App Showcase
subtitle: Live screenshots from sotto.fm
---

# App Showcase

Real screenshots captured from the live Sotto application.

HEADER

  # Desktop screenshots (ordered)
  declare -A DESKTOP_LABELS=(
    ["landing"]="Landing Page"
    ["login"]="Authentication"
    ["dashboard"]="Creator Dashboard"
    ["create"]="Podcast Creation (Discovery Chat)"
    ["podcast-player"]="Podcast Player"
    ["feed"]="Public Feed"
    ["pricing"]="Pricing"
    ["billing"]="Billing & Credits"
    ["profile"]="Creator Profile"
    ["admin-overview"]="Admin Dashboard"
    ["admin-users"]="Admin — User Management"
    ["settings"]="Settings"
  )

  DESKTOP_ORDER=(
    "landing" "login" "dashboard" "create" "podcast-player"
    "feed" "pricing" "billing" "profile"
    "admin-overview" "admin-users" "settings"
  )

  for name in "${DESKTOP_ORDER[@]}"; do
    url=$(python3 -c "import json,sys; m=json.load(open('$MANIFEST_FILE')); print(m.get('$name',''))" 2>/dev/null || echo "")
    label="${DESKTOP_LABELS[$name]}"
    if [ -n "$url" ]; then
      cat >> "$SHOWCASE_FILE" << EOF
## $label

![${label}](${url})

EOF
    fi
  done

  # Mobile screenshots
  MOBILE_NAMES=("mobile-landing" "mobile-dashboard" "mobile-player" "mobile-feed")
  MOBILE_LABELS=("Landing" "Dashboard" "Player" "Feed")

  has_mobile=false
  for name in "${MOBILE_NAMES[@]}"; do
    url=$(python3 -c "import json,sys; m=json.load(open('$MANIFEST_FILE')); print(m.get('$name',''))" 2>/dev/null || echo "")
    if [ -n "$url" ]; then
      has_mobile=true
      break
    fi
  done

  if $has_mobile; then
    echo "## Mobile Experience" >> "$SHOWCASE_FILE"
    echo "" >> "$SHOWCASE_FILE"
    echo "| ${MOBILE_LABELS[0]} | ${MOBILE_LABELS[1]} | ${MOBILE_LABELS[2]} | ${MOBILE_LABELS[3]} |" >> "$SHOWCASE_FILE"
    echo "|---------|-----------|--------|------|" >> "$SHOWCASE_FILE"

    row="| "
    for i in "${!MOBILE_NAMES[@]}"; do
      name="${MOBILE_NAMES[$i]}"
      label="${MOBILE_LABELS[$i]}"
      url=$(python3 -c "import json,sys; m=json.load(open('$MANIFEST_FILE')); print(m.get('$name',''))" 2>/dev/null || echo "")
      if [ -n "$url" ]; then
        row+="![Mobile ${label}](${url}) | "
      else
        row+="— | "
      fi
    done
    echo "$row" >> "$SHOWCASE_FILE"
    echo "" >> "$SHOWCASE_FILE"
  fi

  echo "Generated: $SHOWCASE_FILE"
fi
echo ""

# ── Step 4: Build HTML ────────────────────────────────────────────
echo "=== Step 4: Build HTML ==="

mkdir -p "$BUILD_DIR"

# Document order (same as update-pitch skill, with 99-app-showcase prepended)
DOCS=(
  "99-app-showcase.md:App Showcase"
  "01-product-vision.md:Product Vision"
  "00-plan.md:Product Plan"
  "02-market-analysis.md:Market Analysis"
  "11-unit-economics.md:Unit Economics"
  "05-ui-mockups.md:UI Mockups"
  "04-design-system.md:Design System"
  "03-technical-architecture.md:Technical Architecture"
  "06-authentication-setup.md:Authentication Setup"
  "07-stripe-billing.md:Stripe Billing"
  "08-ai-prompts.md:AI Prompts"
  "09-discovery-chat-flow.md:Discovery Chat Flow"
  "10-mobile-strategy.md:Mobile Strategy"
  "12-provider-pricing.md:Provider Pricing"
  "13-hosting-infrastructure.md:Hosting Infrastructure"
  "13-mvp-launch-guide.md:MVP Launch Guide"
  "14-ios-app-strategy.md:iOS App Strategy"
  "15-logo-brief.md:Logo Brief"
  "16-palette-brief.md:Palette Brief"
  "17-roles-and-dashboards.md:Roles & Dashboards"
  "deploy-sotto-fm.md:Deployment Guide"
)

# Build pandoc options
PANDOC_OPTS="--standalone --embed-resources --resource-path=docs/"

if [ -f "$PANDOC_TEMPLATE" ]; then
  PANDOC_OPTS="$PANDOC_OPTS --template=$PANDOC_TEMPLATE"
  echo "Using template: $PANDOC_TEMPLATE"
fi

if [ -f "$DOWNLOAD_IMAGES_FILTER" ]; then
  PANDOC_OPTS="$PANDOC_OPTS --lua-filter=$DOWNLOAD_IMAGES_FILTER"
  echo "Using filter: $DOWNLOAD_IMAGES_FILTER"
fi

# Warm Amber palette variables (matching Sotto design system)
PANDOC_OPTS="$PANDOC_OPTS -V primary-color=#D97706 -V accent-color=#1E3A5F"
PANDOC_OPTS="$PANDOC_OPTS -V bg-color=#FEFCF8 -V surface-color=#FFFFFF"
PANDOC_OPTS="$PANDOC_OPTS -V text-color=#1A1A1A -V muted-color=#6B7280"
PANDOC_OPTS="$PANDOC_OPTS -V heading-font='DM Serif Display' -V body-font=Inter"
PANDOC_OPTS="$PANDOC_OPTS --mathml --highlight-style=tango"

converted=0
skipped=0

for entry in "${DOCS[@]}"; do
  IFS=':' read -r filename display_name <<< "$entry"
  src="$SOTTO_DIR/docs/$filename"
  html_name="${filename%.md}.html"
  dest="$BUILD_DIR/$html_name"

  if [ ! -f "$src" ]; then
    echo "  Skip (not found): $filename"
    ((skipped++)) || true
    continue
  fi

  # Extract title from first heading if possible
  doc_title=$(grep -m1 '^# ' "$src" | sed 's/^# //' || echo "$display_name")
  if [ -z "$doc_title" ]; then
    doc_title="$display_name"
  fi

  echo "  Converting: $filename → $html_name"
  pandoc $PANDOC_OPTS \
    --metadata title="$doc_title" \
    -o "$dest" \
    "$src" 2>/dev/null || {
      echo "  Warning: pandoc failed for $filename, trying minimal conversion..."
      pandoc --standalone --embed-resources \
        --metadata title="$doc_title" \
        -o "$dest" \
        "$src" 2>/dev/null || {
          echo "  Error: Could not convert $filename"
          ((skipped++)) || true
          continue
        }
    }
  ((converted++)) || true
done

echo ""
echo "  Converted: $converted, Skipped: $skipped"
echo ""

# ── Step 5: Build manifest ────────────────────────────────────────
echo "=== Step 5: Build manifest ==="

PITCH_MANIFEST="$SOTTO_DIR/.pitch/manifest.json"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Build documents JSON array
doc_json="["
order=0
first=true
for entry in "${DOCS[@]}"; do
  IFS=':' read -r filename display_name <<< "$entry"
  html_name="${filename%.md}.html"

  if [ ! -f "$BUILD_DIR/$html_name" ]; then
    continue
  fi

  # Extract display name from heading
  src="$SOTTO_DIR/docs/$filename"
  if [ -f "$src" ]; then
    heading=$(grep -m1 '^# ' "$src" | sed 's/^# //' || echo "")
  fi
  if [ -z "${heading:-}" ]; then
    heading="$display_name"
  fi

  if $first; then
    first=false
  else
    doc_json+=","
  fi

  doc_json+=$(python3 -c "
import json
print(json.dumps({
    'filename': '$html_name',
    'displayName': '''$heading''',
    'order': $order,
    'sourceMarkdown': 'docs/$filename'
}))
")
  ((order++)) || true
done
doc_json+="]"

# Create version entry
new_version=$(python3 -c "
import json
print(json.dumps({
    'date': '$TODAY',
    'buildTime': '$BUILD_TIME',
    'documents': $doc_json
}))
")

# Merge with existing manifest
if [ -f "$PITCH_MANIFEST" ]; then
  python3 -c "
import json, sys

with open('$PITCH_MANIFEST') as f:
    manifest = json.load(f)

new_version = json.loads('''$new_version''')

# Replace existing version for today or add new one
versions = [v for v in manifest.get('versions', []) if v['date'] != '$TODAY']
versions.append(new_version)
versions.sort(key=lambda v: v['date'], reverse=True)

manifest['versions'] = versions
manifest['latest'] = versions[0]['date']

with open('$PITCH_MANIFEST', 'w') as f:
    json.dump(manifest, f, indent=2)
print('Updated existing manifest')
"
else
  python3 -c "
import json
manifest = {
    'versions': [json.loads('''$new_version''')],
    'latest': '$TODAY'
}
with open('$PITCH_MANIFEST', 'w') as f:
    json.dump(manifest, f, indent=2)
print('Created new manifest')
"
fi

echo "  Manifest: $PITCH_MANIFEST"
echo ""

# ── Summary ───────────────────────────────────────────────────────
total_size=$(du -sh "$BUILD_DIR" 2>/dev/null | cut -f1 || echo "unknown")

echo "================================================"
echo "  Pitch rebuild complete!"
echo "================================================"
echo ""
echo "  Date:       $TODAY"
echo "  Documents:  $converted"
echo "  Build dir:  $BUILD_DIR"
echo "  Total size: $total_size"
echo "  Manifest:   $PITCH_MANIFEST"
echo ""
echo "  View at /pitch (requires PITCH_PASSWORD)"
echo "================================================"
