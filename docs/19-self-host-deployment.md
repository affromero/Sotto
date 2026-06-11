# Self-Host Deployment Guide

**Date:** 2026-05-18

**Summary:** Step-by-step deployment guide for running Sotto on your own VPS with explicit env files, Caddy, Docker Compose, private podcast storage, and no hosted Sotto services.

---

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

| Type | Host | Value |
| --- | --- | --- |
| `A` | `@` | `YOUR_SERVER_IPV4` |
| `AAAA` | `@` | `YOUR_SERVER_IPV6` if used |
| `CNAME` | `www` | `your-domain.example` if you want the www redirect |
| `A` or `CNAME` | `maps` | your server or apex domain if exposing maps |

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
NEXTAUTH_URL=https://your-domain.example
AUTH_SECRET=<openssl rand -base64 32>
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

Choose explicit providers. One simple starting point:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=<your key>
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=<your key>
```

For local media storage:

```bash
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=./.sotto/storage
```

For optional Caddy blocks:

```bash
SOTTO_WWW_DOMAIN=www.your-domain.example
SOTTO_MAPS_DOMAIN=maps.your-domain.example
```

Leave optional domains unset if you do not want those hosts exposed.

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

The deploy script:

1. pulls the latest `main`;
2. copies `.env.production` to `.env` for Docker Compose;
3. renders and validates Caddy;
4. starts infra services from `docker-compose.infra.yml`;
5. builds the inactive app slot from `docker-compose.app.yml`;
6. runs Prisma schema sync;
7. health-checks the new web slot;
8. runs `scripts/smoke-prod.sh`;
9. rebuilds and restarts workers from `docker-compose.workers.yml`;
10. stops the previous app slot.

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

## 8. OAuth Providers

For each OAuth provider you enable, configure callback URLs using your exact app URL:

| Provider | Callback |
| --- | --- |
| Google | `https://your-domain.example/api/v1/auth/callback/google` |
| GitHub | `https://your-domain.example/api/v1/auth/callback/github` |
| Twitter/X | `https://your-domain.example/api/v1/auth/callback/twitter` |
| Apple | `https://your-domain.example/api/v1/auth/callback/apple` |

Providers are optional. If you leave a provider's env vars unset, its button is not shown.

## 9. Storage CORS

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

Do not use wildcard origins for private podcast audio.

## 10. Backups

Enable database backups:

```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo "0 3 * * * ~/sotto/scripts/backup.sh") | crontab -
```

Also back up the selected storage backend. A database backup without the generated audio files is not a complete restore path.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Deploy cannot find env | `SOTTO_ENV_FILE` path or `~/sotto/.env.production` |
| Caddy reload fails | `sudo caddy validate --config /etc/caddy/Caddyfile` |
| Health check fails | `docker compose -f docker-compose.app.yml -p sotto-blue logs web --tail 80` and the green equivalent |
| Workers do not process jobs | `REDIS_URL`, `DATABASE_URL`, and worker logs |
| OAuth redirect mismatch | Provider callback must exactly match `NEXTAUTH_URL` plus `/api/v1/auth/callback/{provider}` |
| Audio is not reachable | storage provider env, bucket CORS, and private stream route authorization |

## Update Flow

After the first deploy, updates are the same command:

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

The slot file at `~/.sotto-deploy-slot` records which app slot is active. Do not edit it during a deploy.
