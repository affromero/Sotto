# Self-Host Deployment Guide

**Date:** 2026-09-10

**Summary:** Install Sotto on your computer with Docker, or deploy it to a VPS with explicit settings and private storage.

---

## Install on your computer

Start Docker and confirm `docker info` and `docker compose version` succeed.
Use Linux or macOS, or a WSL2 terminal with Docker Desktop integration on Windows.
Then run:

```bash
curl -fsSL https://sotto.fm/install.sh | bash
```

The installer verifies a matching published image pair before changing your
configuration. It downloads the release's Compose file, migrates the database,
seeds the curriculum, and waits for health. It stores settings in `~/.sotto/.env`.
Keep this file private and back it up along with your database and audio files.

Use the URL and instance password printed at completion. The default URL is
`http://localhost:3000`. The welcome wizard lets you configure languages and
providers. An OpenAI key covers generation and speech. Anthropic and local agent
logins cover generation; configure a speech provider for listening and speaking.

Choose option 5 to configure providers later in the browser. For unattended
installation, download the script first and pass the prompt settings to Bash:

```bash
curl -fsSL https://sotto.fm/install.sh -o install.sh
SOTTO_YES=1 SOTTO_AGENT_CHOICE=5 bash install.sh
```

Sotto Host is a desktop controller for an installed stack. Run the installer
first, then use the launcher to start or stop it. A Windows home directory differs
from a WSL home; use the browser from WSL if the launcher cannot find the stack.

```bash
sotto-host status
sotto-host update --check
sotto-host update
```

Updates use published images, rather than assuming the newest source commit has
a finished build. Failed downloads and pulls preserve your configuration.
`sotto-host rollback` restores the previous deployment files and images after an
update. Database migrations are forward-only; image rollback does not restore the
database. Keep the backup created before an update.

The Sidedoor conversion prepares canonical provider, model, storage, learner,
and encrypted credential state before switching releases. The active release
keeps its source tables during the candidate health check. Finalization removes
those tables only after health succeeds. Any preparation or finalization error
rolls back its database transaction and stops the update.

| Problem                                               | Action                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Docker is installed but unavailable                   | Start Docker Desktop or the Docker daemon. Confirm `docker info` works as your user.                                               |
| `denied` or `unauthorized` while pulling Sotto images | The public package or release is unavailable. Maintainers must fix registry visibility; a new user should not need a GitHub token. |
| `no matching manifest`                                | The selected release lacks an image for your architecture. Use a release with matching platform support.                           |
| Port is already in use                                | Choose another port when prompted. Open the URL printed by the installer.                                                          |
| Startup or migration fails                            | Run `cd ~/.sotto && docker compose logs --tail 100 web workers postgres`. Resolve the reported error before retrying.              |
| Linux AppImage reports missing `appsink`              | Use a launcher release that bundles the media framework. Reinstalling the Docker stack does not fix an older launcher binary.      |

The VPS instructions below are for operators deploying behind their own domain.

## Before You Start

You need:

- a Linux VPS with Ubuntu 24.04 or equivalent;
- a domain you control;
- DNS access for that domain;
- an SSH key installed on the VPS;
- provider accounts for the AI and TTS services you choose;
- a storage decision: local disk for first install, or S3-compatible object storage for production.

This guide assumes the app lives at `https://your-domain.example`. Replace that value everywhere with your own domain.

## 1. Provision the VPS

Run the server bootstrap as root:

```bash
ssh root@YOUR_SERVER_IP
bash -s < /path/to/local/scripts/setup-server.sh
```

The script creates a `sotto` user, installs Docker and Caddy, opens ports `22`, `80`, and `443`, and disables SSH password/root login.

Log back in as the app user:

```bash
ssh sotto@YOUR_SERVER_IP
```

## 2. Clone the Repository

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git ~/sotto
cd ~/sotto
```

## 3. Configure DNS

Create DNS records at your registrar:

| Type    | Host  | Value                                              |
| ------- | ----- | -------------------------------------------------- |
| `A`     | `@`   | `YOUR_SERVER_IPV4`                                 |
| `AAAA`  | `@`   | `YOUR_SERVER_IPV6` if used                         |
| `CNAME` | `www` | `your-domain.example` if you want the www redirect |

Wait until this resolves from your local machine:

```bash
dig your-domain.example +short
```

## 4. Create the Production Env File

```bash
cd ~/sotto
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

Set these first:

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.example
BYOK_ENCRYPTION_KEY=<openssl rand -base64 32>
```

Set database and Redis values for the included compose stack:

```bash
POSTGRES_USER=sotto
POSTGRES_PASSWORD=<strong password>
POSTGRES_DB=sotto
DATABASE_URL=postgresql://sotto:<strong password>@pgbouncer:5432/sotto?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://sotto:<strong password>@postgres:5432/sotto
REDIS_PASSWORD=<strong password>
REDIS_URL=redis://:<strong password>@redis:6379
```

Storage ownership uses `DIRECT_DATABASE_URL` for session-level PostgreSQL locks.
Point it at PostgreSQL directly or a session pool, never a transaction pool.
When it is unset, storage uses `DATABASE_URL`, which must meet the same requirement.
An invalid or unavailable configured direct connection fails without switching databases.

Start the stack, open `/welcome`, and choose the AI, speech, and storage providers. Save hosted credentials or local service URLs there. Sidedoor encrypts credentials and applies the same configuration to web and worker processes. Provider usage and limits are configured in Admin alongside the corresponding saved credential.

For local media storage, select **Local** in `/welcome` or Admin and save the mounted shared storage root.

For optional Caddy www-redirect:

```bash
SOTTO_WWW_DOMAIN=www.your-domain.example
```

Leave that unset if you do not want the optional www-redirect Caddy block rendered.

## 5. Configure Caddy Import

As root, make sure `/etc/caddy/Caddyfile` imports fragments:

```bash
sudo mkdir -p /etc/caddy/conf.d
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
{
	email admin@your-domain.example
}

import /etc/caddy/conf.d/*
CADDY
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`scripts/deploy.sh` renders the repository `Caddyfile` template with your `NEXT_PUBLIC_APP_URL` host and installs the result as `/etc/caddy/conf.d/sotto.conf`.

## 6. Deploy

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

Production deployment uses `SOTTO_IMAGE_SOURCE=registry` and rejects server builds. Build the web and worker images on a separate machine or CI runner. The web image must include your `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` at build time. Local development and the OSS installer keep their existing compose workflows.

Set `SOTTO_RELEASE_SHA` to the full committed checkout SHA and provide complete digest references in `SOTTO_WEB_IMAGE_REF` and `SOTTO_WORKERS_IMAGE_REF`. Both images must carry that revision in the `org.opencontainers.image.revision` label. Supply measured positive byte counts from the builder: `SOTTO_WEB_IMAGE_BYTES`, `SOTTO_WEB_TRANSFER_BYTES`, `SOTTO_WORKERS_IMAGE_BYTES`, and `SOTTO_WORKERS_TRANSFER_BYTES`. Expanded image sizes and compressed transfer sizes are separate inputs. The checkout and submodules must be clean and match the selected release; the script does not pull a moving branch.

Install your reviewed shared-host capacity checker before using this production script. `PRODUCTION_CAPACITY_CHECKER` defaults to `/usr/local/lib/production/production_capacity.py`. Its `before-import` command receives `--image-bytes` and `--transfer-bytes`; `before-switch` checks remaining capacity after imports. A missing checker or rejected allocation stops deployment. Use a policy that reserves at least 10 GiB, rejects disk or inode usage at 85%, and requires 100,000 free inodes. The script holds `/var/lock/production-build.lock` through health verification. Preinstall any required infrastructure/helper images through the same admission process; service commands cannot pull unbudgeted images.

Provide `SOTTO_BACKUP_BYTES` as a measured allowance for the database archive. The checker reserves that allocation alongside absent images; exact digests already present need no import budget. `SOTTO_BACKUP_DIR` defaults to `$HOME/.local/state/sotto-backups/$SOTTO_STACK`. Before migrations, the script checks database size, creates a custom-format `pg_dump`, reads the full archive with `pg_restore` without restoring a database, and retains its checksum. Completed deployments retain the newest ten successful backups and all backups younger than thirty days, including the current and previous deployment. Cleanup removes only older backups with matching success metadata and checksums. Failed, unmarked, malformed, and symlinked backups remain for review.

Existing-stack deployments require identical Prisma schema and migration assets between current and candidate workers. Handle schema changes through a separately reviewed migration procedure. For these code-only releases, a failed candidate restores prior worker images and Caddy routing before retiring the old web slot. Public routing is switched to the verified candidate and checked while the previous slot remains available.

Rollback protection records live in `PRODUCTION_IMAGE_RETENTION_DIR`, defaulting to `$HOME/.local/state/production-image-retention`. Each attempt protects its incoming and existing image IDs before service changes. Success retains the new images and pre-deploy images; failed-attempt records remain until reviewed maintenance retires them. Deployment does not prune images, build caches or volumes.

If your host already uses rollback tags, set `SOTTO_WORKERS_ROLLBACK_TAG` and `SOTTO_WEB_ROLLBACK_TAG` to those exact existing references. After successful health verification, the script updates them to the captured pre-deploy image IDs. Failed deployments leave those tags unchanged.

The deploy script:

1. verifies the exact committed release and acquires the shared lock;
2. copies `.env.production` to `.env` for Docker Compose;
3. admits the measured image budget, pulls verified digests and rechecks capacity;
4. records rollback image protection and validates Caddy;
5. starts existing infra images from `docker-compose.infra.yml`;
6. runs Prisma migrations using the verified worker image;
7. health-checks the new web slot;
8. runs `scripts/smoke-prod.sh`;
9. restarts workers from the prepared `docker-compose.workers.yml` image;
10. stops the previous app slot and records successful image retention after final capacity verification.

## 7. Verify

```bash
curl -s https://your-domain.example/api/v1/health
docker compose -f docker-compose.infra.yml ps
docker compose -f docker-compose.workers.yml ps
```

Check app-slot containers by project name:

```bash
docker compose -f docker-compose.app.yml -p sotto-blue ps
docker compose -f docker-compose.app.yml -p sotto-green ps
```

Exactly one app slot should be active after a successful deploy.

## 8. Storage CORS

For S3-compatible storage, restrict CORS to your exact public app URL:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.example"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Do not use wildcard origins for private episode audio.

## 9. Backups

Enable database backups:

```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo "0 3 * * * ~/sotto/scripts/backup.sh") | crontab -
```

Also back up the selected storage backend. A database backup without the generated audio files is not a complete restore path.

## Troubleshooting

| Symptom                     | Check                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Deploy cannot find env      | `SOTTO_ENV_FILE` path or `~/sotto/.env.production`                                                   |
| Caddy reload fails          | `sudo caddy validate --config /etc/caddy/Caddyfile`                                                  |
| Health check fails          | `docker compose -f docker-compose.app.yml -p sotto-blue logs web --tail 80` and the green equivalent |
| Workers do not process jobs | `REDIS_URL`, `DATABASE_URL`, and worker logs                                                         |
| Audio is not reachable      | storage provider env, bucket CORS, and private stream route authorization                            |

## Update Flow

After the first deploy, updates are the same command:

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

The slot file at `~/.sotto-deploy-slot` records which app slot is active. Do not edit it during a deploy.
