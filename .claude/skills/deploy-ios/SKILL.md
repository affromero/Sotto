---
name: deploy-ios
description: |
  Deploy Sotto iOS app to TestFlight via GitHub Actions.
  Triggers the ios.yml workflow, monitors the run, and reports status.
---

# Deploy iOS — Sotto TestFlight Skill

Triggers the `ios.yml` GitHub Actions workflow to build and submit the Sotto iOS app to TestFlight.

## Trigger

`/deploy-ios`

---

## Step 1: Pre-flight Checks

### 1a. Check build number

Read the current `buildNumber` from `apps/mobile/app.json`. EAS will auto-increment this before building (`autoIncrement: true` in `eas.json`). If a previous build was cancelled after EAS already submitted a build to Apple, the local `app.json` may be stale and EAS will attempt to re-use a build number Apple already has.

If the last `gh run list --workflow=ios.yml` shows a **cancelled** run that lasted > 30 minutes, warn:

> ⚠️ A previous iOS build was cancelled after running for a long time. EAS may have already uploaded build number {N} to Apple. If the next run fails with "bundle version must be higher than previously uploaded version", update `apps/mobile/app.json` → `buildNumber` to match the already-submitted build number, then re-run.

### 1c. Check CI status on the current branch

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

### 1d. Check for uncommitted changes

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

## Step 2: Trigger the Workflow

```bash
gh workflow run ios.yml
```

If this fails, check:
- Is `gh` authenticated? (`gh auth status`)
- Does the workflow exist? (`gh workflow list`)

Report the error and stop if it fails.

---

## Step 3: Get the Run URL

Wait a few seconds for GitHub to register the run, then fetch it:

```bash
sleep 5
gh run list --workflow=ios.yml --limit=1 --json databaseId,status,url,headBranch,createdAt
```

Extract the run URL and display it:

```
iOS build triggered!
  Branch: {headBranch}
  Run:    {url}
  Status: {status}
```

---

## Step 4: Ask to Monitor

Use `AskUserQuestion`:

- "Monitor until done" — poll the run status every 30s and report when finished
- "Done, I'll check later" — stop here (Telegram notification will arrive when done)

### If monitoring:

Poll with:

```bash
gh run watch {runId} --exit-status
```

When complete, report the result:

- On success: "TestFlight build submitted! You'll receive a Telegram notification shortly."
- On failure: Fetch the failed step logs with `gh run view {runId} --log-failed` and show the relevant error.
