# Hosting Infrastructure

**Date:** 2026-05-18

**Summary:** Self-hosting options, the recommended single-VPS topology, and the production services Sotto expects when released as private-first open source software.

---

## Goals

The open source deployment should be boring to operate:

- one Linux server is enough for an initial private deployment;
- operators bring their own domain, AI provider, TTS provider, and storage choice;
- secrets live in the operator's own env file or secret manager;
- the app does not depend on hosted Sotto infrastructure;
- the same repository commands work locally and on the server.

## Hosting Options

| Option | Best For | Tradeoff |
| --- | --- | --- |
| Single VPS | Most self-hosters and small teams | Lowest operational complexity; vertical scaling first |
| Managed app + managed Postgres/Redis | Teams that want less server maintenance | More vendor-specific setup and higher monthly cost |
| Multi-node container platform | Larger managed-hosting operators | More moving pieces; useful only after load requires it |

The default documentation assumes a single Ubuntu 24.04 VPS. Hetzner, DigitalOcean, Fly Machines, EC2, or any Docker-capable host can work.

## Production Topology

The repository ships the production services as three compose files:

| File | Services | Lifecycle |
| --- | --- | --- |
| `docker-compose.infra.yml` | Postgres, PgBouncer, Redis, Pinchtab | Long-lived, rarely restarted |
| `docker-compose.app.yml` | Web app | Blue-green deployment slots |
| `docker-compose.workers.yml` | BullMQ worker groups | Recreated after the new app slot passes health checks |

`scripts/deploy.sh` coordinates those files. It loads `.env.production` by default, copies it to `.env` for Docker Compose, renders `Caddyfile` with the operator's domain, starts infra, builds the next app slot, runs Prisma, smoke-tests the new slot, restarts workers, and stops the old slot.

## Recommended Server Setup

Run the server bootstrap as root on a fresh Ubuntu VPS:

```bash
ssh root@YOUR_SERVER_IP
bash -s < /path/to/local/scripts/setup-server.sh
```

Or after cloning the repo on the server:

```bash
sudo bash scripts/setup-server.sh
```

The script installs Docker, Caddy, core utilities, configures a `sotto` user, enables the firewall for SSH/HTTP/HTTPS, and hardens SSH password/root login.

## DNS

Point your own domain at the VPS:

| Record | Host | Value |
| --- | --- | --- |
| `A` | `@` | `YOUR_SERVER_IPV4` |
| `AAAA` | `@` | `YOUR_SERVER_IPV6` if enabled |
| `CNAME` | `www` | your apex domain, if you want a www redirect |

Use the exact public URL in both `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL`.

## Environment File

Create the production env file on the server:

```bash
cd ~/sotto
cp .env.example .env.production
chmod 600 .env.production
```

Minimum required production categories:

| Category | Variables |
| --- | --- |
| Public URL | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` |
| Auth | `AUTH_SECRET` |
| Database | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `DIRECT_DATABASE_URL` |
| Redis | `REDIS_PASSWORD`, `REDIS_URL` |
| Storage | `STORAGE_PROVIDER` plus the matching local or S3/R2 values |
| AI | explicit `AI_PROVIDER` and provider credentials |
| TTS | explicit `TTS_PROVIDER` and provider credentials |
| BYOK | `BYOK_ENCRYPTION_KEY` |

Optional Caddy host for www redirect:

```bash
SOTTO_WWW_DOMAIN=www.your-domain.example
```

Leave that unset if you do not want the optional Caddy www-redirect block rendered.

## Caddy

Ensure the system Caddyfile imports site fragments:

```caddyfile
{
	email admin@your-domain.example
}

import /etc/caddy/conf.d/*
```

`scripts/deploy.sh` renders the repository `Caddyfile` template and installs it to `/etc/caddy/conf.d/sotto.conf` by default. Override with `CADDY_SITE_PATH` only if your server uses a different Caddy layout.

## Deploy

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

Expected deploy phases:

1. Pull latest code and submodules.
2. Load `.env.production` into `.env` for Docker Compose.
3. Render and validate Caddy config.
4. Start infra services and wait for Postgres, Redis, and PgBouncer.
5. Build the inactive blue-green app slot.
6. Run Prisma schema sync against `DIRECT_DATABASE_URL` when present.
7. Start and health-check the new slot.
8. Run production smoke checks.
9. Build and restart workers.
10. Stop the previous app slot.

## Storage

Use local storage for the simplest self-hosted install:

```bash
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=./.sotto/storage
```

For internet-facing deployments, prefer an S3-compatible bucket such as Cloudflare R2, MinIO, AWS S3, or another provider. Configure CORS for your exact `NEXT_PUBLIC_APP_URL`; do not use wildcard origins for private episode audio.

Private playback paths go through authenticated app routes or private RSS tokens:

```text
/api/v1/episodes/{episodeId}/stream
/api/v1/rss/private/{token}
```

## Backups

At minimum, back up Postgres and the selected storage backend.

```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo "0 3 * * * ~/sotto/scripts/backup.sh") | crontab -
```

For single-VPS deployments, also enable provider snapshots or equivalent block-volume backups. Test restore before treating the deployment as production.

## Scaling Path

| Stage | Move |
| --- | --- |
| Initial private install | Single VPS, local or S3-compatible storage |
| Worker pressure | Increase worker presets or move workers to a separate host |
| Database pressure | Move Postgres to managed Postgres or a dedicated database host |
| Media pressure | Use object storage plus CDN in front of generated media |
| Managed-hosting business | Split customer deployments by environment, not by shared data plane |

## Release Checklist

- `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` use the operator's domain.
- `.env.production` exists on the server and is mode `600`.
- Caddy imports `/etc/caddy/conf.d/*`.
- DNS points to the server.
- Provider keys are set only for the explicit providers selected.
- `SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh` completes.
- `https://your-domain.example/api/v1/health` returns healthy JSON.
- Backups have been restored in a test path at least once.
