---
name: deploy-ios
description: |
  Deploy Sotto iOS app to TestFlight via GitHub Actions.
  Triggers the ios.yml workflow, monitors the run, and reports status.
---

# Deploy iOS — Sotto TestFlight Skill

Builds the Sotto iOS app via EAS and submits to TestFlight.

## Trigger

`/deploy-ios`

## Mode Detection

The skill has two modes — **auto-detected** based on context:

### Server-direct mode (via sotto-prod SSH)

Activated when **any** of these are true:
- `/sotto-deploy` was also invoked in the same conversation
- GitHub Actions billing is blocked (check: `gh run list --workflow=ci.yml --limit=1` shows billing error)
- User explicitly says "from the server" or "direct"

In this mode, the build runs on `sotto-prod` via SSH using `eas build` (which builds in Expo's cloud). The server is the trigger machine, not GitHub Actions.

### GitHub Actions mode (default)

When none of the above apply, trigger the `ios.yml` workflow via `gh workflow run`.

---

## Step 1: Pre-flight Checks

### 1a. Build number (no action needed)

Build numbers are managed by EAS remotely (`appVersionSource: "remote"` in `eas.json`). EAS auto-increments the build number on its servers — no local `app.json` changes needed. Just proceed.

### 1b. Check CI status

**Server-direct mode:** Run CI locally with `npm run ci`. If it fails, stop.

**GitHub Actions mode:** Check via API:
```bash
gh run list --workflow=ci.yml --branch=$(git branch --show-current) --limit=1 --json conclusion,status,headBranch,url
```

- If `conclusion` is **not** `"success"`, stop and report:

  > CI is failing on {branch}. Fix the build before deploying.
  > Last run: {url}

  Do **not** proceed — no `AskUserQuestion` override. A green CI is a hard gate.

- If `status` is `"in_progress"` or `"queued"`, report:

  > CI is still running on {branch}. Wait for it to finish before deploying.
  > Run: {url}

  Stop here.

- **Exception:** If the CI run failed due to GitHub billing/payment issues (not code), treat it as if CI passed and proceed — the billing block is the reason we're using server-direct mode.

### 1c. Check for uncommitted changes

```bash
git status --porcelain
```

If there are uncommitted changes, warn the user:

> There are uncommitted changes. The build will use the latest pushed commit, not your local changes. Continue?

Use `AskUserQuestion` with options:
- "Continue anyway" — proceed with the build
- "Cancel" — stop and let the user commit first

If clean, proceed.

---

## Step 2a: Server-Direct Deploy

Run the entire build + submit over SSH to `sotto-prod`. This is a **long-running operation** (30-60 minutes) — run with a 60-minute timeout.

```bash
ssh sotto-prod 'bash -s' << 'ENDSSH'
set -euo pipefail
cd ~/sotto

echo "=== Pulling latest code ==="
git pull origin main

echo "=== Configuring EAS auth ==="
export EXPO_TOKEN=$(doppler secrets get EXPO_TOKEN --plain)

echo "=== Syncing EXPO_PUBLIC vars to EAS ==="
doppler secrets download --no-file --format env | grep '^EXPO_PUBLIC_' > /tmp/expo-public.env
cd apps/mobile
eas env:push production --path /tmp/expo-public.env --force
rm -f /tmp/expo-public.env

echo "=== Building iOS app (EAS cloud) ==="
eas build --platform ios --profile production --non-interactive --wait

echo "=== Writing ASC API key ==="
doppler secrets get ASC_API_KEY_P8 --plain > /tmp/asc-api-key.p8
export ASC_API_KEY_ID=$(doppler secrets get ASC_API_KEY_ID --plain)
export ASC_ISSUER_ID=$(doppler secrets get ASC_ISSUER_ID --plain)

echo "=== Submitting to TestFlight ==="
eas submit --platform ios --latest --non-interactive

echo "=== Cleaning up ==="
rm -f /tmp/asc-api-key.p8

echo "=== iOS deploy complete ==="
ENDSSH
```

**Important:** Run this with `run_in_background: true` since it takes 30-60 minutes. Tell the user they'll be notified when it finishes.

After the SSH command completes (success or failure), send a Telegram notification (Step 3).

---

## Step 2b: GitHub Actions Deploy

Trigger the workflow:

```bash
gh workflow run ios.yml
```

If this fails, check:
- Is `gh` authenticated? (`gh auth status`)
- Does the workflow exist? (`gh workflow list`)

Report the error and stop if it fails.

Wait for the run to register, then fetch the URL:

```bash
sleep 5
gh run list --workflow=ios.yml --limit=1 --json databaseId,status,url,headBranch,createdAt
```

Display:
```
iOS build triggered!
  Branch: {headBranch}
  Run:    {url}
  Status: {status}
```

Ask to monitor:
- "Monitor until done" — `gh run watch {runId} --exit-status`
- "Done, I'll check later" — stop here (Telegram notification from workflow)

---

## Step 3: Telegram Notification (server-direct mode only)

Read bot token from `~/.claude/skills/telegram/config.json` (use `sotto` bot).
Send to Andrés (chat_id: `668874307`).

**On success:**
```
✅ <b>Sotto iOS TestFlight build submitted</b> <i>(server-direct)</i>
<code>{COMMIT_SHA}</code>  <i>{COMMIT_MSG}</i>
by {AUTHOR}
```

**On failure:**
```
❌ <b>Sotto iOS build failed</b> <i>(server-direct)</i>
<code>{COMMIT_SHA}</code>  <i>{COMMIT_MSG}</i>
by {AUTHOR}

⚠️ <b>Reason: {last error line from SSH output}</b>
```

Use the sotto bot token: send via `curl` to Telegram Bot API with `parse_mode: "HTML"`.

---

## Server Prerequisites

The following must be set up on `sotto-prod` (one-time):

### Runtime (already installed)
- Node.js 20 (`/usr/bin/node`)
- eas-cli (`/usr/lib/node_modules/eas-cli/`)
- Doppler CLI

### Doppler secrets (project: sotto, config: prd)

These must exist in Doppler `prd` config:

| Secret | Purpose |
|--------|---------|
| `EXPO_TOKEN` | EAS CLI authentication (create at https://expo.dev/settings/access-tokens) |
| `ASC_API_KEY_ID` | Apple App Store Connect API key ID |
| `ASC_ISSUER_ID` | Apple App Store Connect issuer ID |
| `ASC_API_KEY_P8` | Apple App Store Connect private key (full .p8 file contents) |

Add with: `doppler secrets set KEY=value --project sotto --config prd`
