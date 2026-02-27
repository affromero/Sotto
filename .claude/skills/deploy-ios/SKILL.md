---
name: deploy-ios
description: |
  Deploy Sotto iOS app to TestFlight.
  Supports 3 modes: GitHub Actions, Local (eas-cli), or Server-direct (SSH).
  Auto-detects mode from context or asks when ambiguous.
---

# Deploy iOS — Sotto TestFlight Skill

Builds the Sotto iOS app via EAS and submits to TestFlight.

## Trigger

`/deploy-ios [github|local|server]` — optional inline mode selector

---

## Step 0: Mode Selection

### Auto-detect shortcuts (skip the prompt)

| Signal | Mode |
|--------|------|
| User says "github" / "via github" / "actions" | GitHub Actions |
| User says "locally" / "from here" / "from my machine" | Local |
| User says "server" / "SSH" / "direct" / "sotto-prod" | Server-direct |
| `/sotto-deploy` also invoked in the same conversation | Server-direct |
| Inline arg: `/deploy-ios local`, `/deploy-ios github`, `/deploy-ios server` | As specified |

### When ambiguous — ask

If no signal matches, use `AskUserQuestion`:

| Option | Label | Description |
|--------|-------|-------------|
| GitHub Actions | `GitHub Actions` | Trigger `ios.yml` workflow (requires GH billing active) |
| Local | `Local` | Run `eas build` + `eas submit` from this machine via Doppler |
| Server-direct | `Server-direct` | SSH to `sotto-prod` and build there |

---

## Step 1: Pre-flight Checks

### 1a. Build number (no action needed)

Build numbers are managed by EAS remotely (`appVersionSource: "remote"` in `eas.json`). EAS auto-increments the build number on its servers — no local `app.json` changes needed. Just proceed.

### 1b. Check CI status

**Local mode & Server-direct mode:** Run CI locally with `npm run ci`. If it fails, stop.

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

- **Billing-aware exception:** If the CI run failed in <30 seconds with no steps executed, GitHub billing is likely blocked. Report:

  > GitHub Actions billing appears blocked — CI run failed with no steps executed.

  Then ask the user to choose **Local** or **Server-direct** mode instead. Do not proceed with GitHub Actions mode.

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

### 1d. Local pre-flight (Local mode only)

Verify local tooling before starting:

```bash
eas --version           # Confirm eas-cli installed
doppler secrets get EXPO_TOKEN --plain --project sotto --config prd  # Confirm Doppler prd access
```

If either fails, stop and report the error.

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

After the SSH command completes (success or failure), proceed to Step 3 (Telegram notification).

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

## Step 2c: Local Deploy

Run from the local machine using `eas-cli` + Doppler `prd` secrets. All commands run from `/Users/afromero/Code/Sotto/apps/mobile`.

### 1. Sync EXPO_PUBLIC vars

```bash
doppler secrets download --no-file --format env --project sotto --config prd \
  | grep '^EXPO_PUBLIC_' > /tmp/expo-public.env
doppler run --project sotto --config prd -- \
  eas env:push production --path /tmp/expo-public.env --force
rm -f /tmp/expo-public.env
```

### 2. Build (background, 60-min timeout)

```bash
cd /Users/afromero/Code/Sotto/apps/mobile
doppler run --project sotto --config prd -- \
  eas build --platform ios --profile production --non-interactive --wait
```

Run with `run_in_background: true` and 60-minute timeout. Tell the user they'll be notified when it finishes.

### 3. Write ASC key

```bash
doppler secrets get ASC_API_KEY_P8 --plain --project sotto --config prd > /tmp/asc-api-key.p8
```

### 4. Submit to TestFlight

```bash
cd /Users/afromero/Code/Sotto/apps/mobile
ASC_API_KEY_ID=$(doppler secrets get ASC_API_KEY_ID --plain --project sotto --config prd) \
ASC_ISSUER_ID=$(doppler secrets get ASC_ISSUER_ID --plain --project sotto --config prd) \
doppler run --project sotto --config prd -- \
  eas submit --platform ios --latest --non-interactive
```

### 5. Cleanup (always — even on failure)

```bash
rm -f /tmp/asc-api-key.p8
```

### 6. Proceed to Step 3 (Telegram notification with "(local)" label)

---

## Step 3: Telegram Notification

Read bot token from `~/.claude/skills/telegram/config.json` (use `sotto` bot).
Send to Andres (chat_id: `668874307`).

**Mode label:** Use `(local)` for Local mode, `(server-direct)` for Server-direct mode. Omit for GitHub Actions mode (the workflow has its own notify job).

**On success:**
```
<b>Sotto iOS TestFlight build submitted</b> <i>({mode_label})</i>
<code>{COMMIT_SHA}</code>  <i>{COMMIT_MSG}</i>
by {AUTHOR}
```

**On failure:**
```
<b>Sotto iOS build failed</b> <i>({mode_label})</i>
<code>{COMMIT_SHA}</code>  <i>{COMMIT_MSG}</i>
by {AUTHOR}

<b>Reason: {last error line from build output}</b>
```

Use the sotto bot token: send via `curl` to Telegram Bot API with `parse_mode: "HTML"`.

---

## Prerequisites

### Doppler secrets (project: sotto, config: prd)

These must exist in Doppler `prd` config for **all modes**:

| Secret | Purpose |
|--------|---------|
| `EXPO_TOKEN` | EAS CLI authentication (create at https://expo.dev/settings/access-tokens) |
| `ASC_API_KEY_ID` | Apple App Store Connect API key ID |
| `ASC_ISSUER_ID` | Apple App Store Connect issuer ID |
| `ASC_API_KEY_P8` | Apple App Store Connect private key (full .p8 file contents) |

Add with: `doppler secrets set KEY=value --project sotto --config prd`

### Server-direct mode (sotto-prod)

- Node.js 20 (`/usr/bin/node`)
- eas-cli (`/usr/lib/node_modules/eas-cli/`)
- Doppler CLI

### Local mode

- `eas-cli` installed locally (`npm install -g eas-cli`)
- Doppler CLI with access to `sotto/prd` config
