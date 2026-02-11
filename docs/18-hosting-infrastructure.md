# Hosting & Infrastructure Guide

> Self-hosting alternatives, deployment options, and infrastructure decisions.
> Assumes no prior DevOps experience.

---

## Hosting Options Compared

### Option 1: Vercel + Railway (Easiest)

| Component | Service       | Cost/Month    | Pros                              | Cons                               |
| --------- | ------------- | ------------- | --------------------------------- | ---------------------------------- |
| Web app   | Vercel Pro    | $20           | Zero config, auto-scaling, CDN    | Vendor lock-in, expensive at scale |
| Workers   | Railway       | $5-20         | Easy deploy, auto-restart         | Limited GPU support                |
| Database  | Neon          | $0-25         | Serverless Postgres, auto-scaling | Cold starts on free tier           |
| Redis     | Upstash       | $0-10         | Serverless Redis, pay-per-request | Higher latency than self-hosted    |
| Storage   | Cloudflare R2 | $0-5          | No egress fees, S3-compatible     | Less tooling than AWS S3           |
| **Total** |               | **$25-80/mo** |                                   |                                    |

**Best for**: MVP, first 500 users, solo developer.

### Option 2: VPS (Hetzner/DigitalOcean) — Recommended for Sotto

Run everything on a single VPS. Cheapest at scale, full control.

| Component     | Setup                                   | Cost/Month           | Notes                           |
| ------------- | --------------------------------------- | -------------------- | ------------------------------- |
| VPS           | Hetzner CPX31 (4 vCPU, 8GB RAM)         | **€10/mo (~$11)**    | Runs web + workers + DB + Redis |
| VPS (bigger)  | Hetzner CPX41 (8 vCPU, 16GB RAM)        | **€19/mo (~$21)**    | For 1K+ users                   |
| VPS (scaling) | Hetzner CCX33 (8 vCPU, 32GB, dedicated) | **€50/mo (~$55)**    | For 5K+ users                   |
| Storage       | Hetzner Storage Box 1TB                 | **€4/mo**            | For podcast audio files         |
| Backups       | Hetzner automated backups               | **20% of VPS price** | Automatic daily snapshots       |
| Domain        | Any registrar                           | **$12/year**         | sotto.fm                        |
| SSL           | Let's Encrypt                           | **$0**               | Auto-renewed via Caddy/Certbot  |
| **Total**     |                                         | **~$17-75/mo**       |                                 |

**Hetzner pricing**: [hetzner.com/cloud](https://www.hetzner.com/cloud/)
**DigitalOcean pricing**: [digitalocean.com/pricing](https://www.digitalocean.com/pricing)

### Option 3: AWS/GCP/Azure (Enterprise)

| Component     | Service            | Cost/Month     | Notes                         |
| ------------- | ------------------ | -------------- | ----------------------------- |
| Web app       | AWS EC2 t3.medium  | $30            | Or ECS/Fargate for containers |
| Workers       | AWS EC2 t3.small   | $15            | Or Lambda for serverless      |
| Database      | AWS RDS PostgreSQL | $15-50         | Managed, auto-backups         |
| Redis         | AWS ElastiCache    | $13-25         | Managed Redis                 |
| Storage       | AWS S3             | $1-10          | Egress fees apply             |
| Load balancer | AWS ALB            | $16            | Required for HTTPS            |
| **Total**     |                    | **$90-150/mo** |                               |

**Best for**: Enterprise, compliance requirements, multi-region.

---

## Recommended Setup: Hetzner VPS (Step-by-Step)

### Why Hetzner?

- **50-80% cheaper** than AWS/DigitalOcean for equivalent specs
- EU-based (GDPR compliant by default)
- Excellent uptime (99.9%+ SLA)
- Simple pricing, no surprise bills
- 20TB/month bandwidth included

### Step 1: Create VPS

1. Sign up at [hetzner.com](https://www.hetzner.com/)
2. Create a Cloud Server:
   - **Image**: Ubuntu 24.04
   - **Type**: CPX31 (4 vCPU, 8GB RAM, 160GB SSD) — €10/mo
   - **Location**: Ashburn, VA (closest to US users) or Nuremberg (EU)
   - **Networking**: Enable IPv4 + IPv6
   - **SSH Key**: Add your public key (more secure than password)
3. Note the IP address

### Step 2: Initial Server Setup

```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Create non-root user
adduser sotto
usermod -aG sudo sotto

# Setup SSH for new user
mkdir -p /home/sotto/.ssh
cp ~/.ssh/authorized_keys /home/sotto/.ssh/
chown -R sotto:sotto /home/sotto/.ssh

# Install essentials
apt install -y curl git unzip build-essential

# Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
usermod -aG docker sotto

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Install Caddy (reverse proxy + auto HTTPS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/cloudflare-main.gpg' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/cloudflare-main.list' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

# Enable firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

### Step 3: Deploy with Docker Compose

Create `/home/sotto/sotto/docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://sotto:SECURE_PASSWORD@postgres:5432/sotto
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  workers:
    build:
      context: .
      dockerfile: Dockerfile.workers
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://sotto:SECURE_PASSWORD@postgres:5432/sotto
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: sotto
      POSTGRES_PASSWORD: SECURE_PASSWORD
      POSTGRES_DB: sotto
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U sotto']
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Step 4: Configure Caddy (HTTPS + Reverse Proxy)

Edit `/etc/caddy/Caddyfile`:

```
sotto.fm {
    reverse_proxy localhost:3000
    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

Caddy automatically obtains and renews HTTPS certificates from Let's Encrypt.

### Step 5: DNS Setup

Point your domain to the server:

- `A record`: `sotto.fm` → `YOUR_SERVER_IP`
- `AAAA record`: `sotto.fm` → `YOUR_SERVER_IPV6`
- `CNAME record`: `www.sotto.fm` → `sotto.fm`

### Step 6: Automated Backups

```bash
# Daily PostgreSQL backup to Hetzner Storage Box
cat > /home/sotto/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec sotto-postgres pg_dump -U sotto sotto | gzip > /backup/sotto_${DATE}.sql.gz
# Keep only last 30 days
find /backup -name "sotto_*.sql.gz" -mtime +30 -delete
EOF
chmod +x /home/sotto/backup.sh

# Add to crontab (runs daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /home/sotto/backup.sh") | crontab -
```

### Step 7: Monitoring

```bash
# Install Netdata (free, real-time monitoring)
curl https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
bash /tmp/netdata-kickstart.sh
```

Access monitoring dashboard at `https://sotto.fm:19999` (restrict via Caddy).

---

## Audio File Storage Strategy

Podcasts must be **always accessible** — public ones for all users, private ones for the owner.

### Option A: Local Storage + CDN (Recommended for VPS)

Store audio files on the VPS, serve via Caddy with caching headers:

```
sotto.fm {
    handle /audio/* {
        root * /data/sotto/audio
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

Add Cloudflare (free tier) in front for CDN + DDoS protection.

### Option B: Cloudflare R2 (S3-compatible, no egress fees)

- $0.015/GB/month storage
- **$0 egress** (no bandwidth charges, unlike S3)
- S3-compatible API
- Perfect for audio serving at scale

### Option C: Hetzner Storage Box

- €4/month for 1TB
- SFTP/CIFS/NFS access
- Good for backups, okay for serving (slower than CDN)

### Access Control for Private Podcasts

```
Public podcasts:  /audio/public/{podcastId}/audio.mp3  → served directly, CDN cached
Private podcasts: /api/podcasts/{id}/stream             → auth check → presigned URL or proxy
```

Private podcasts are served through the API, which verifies the user owns the podcast before streaming.

---

## Scaling Roadmap

| Users  | Infrastructure                          | Monthly Cost | Action                          |
| ------ | --------------------------------------- | ------------ | ------------------------------- |
| 0-100  | Hetzner CPX31 (4 vCPU, 8GB)             | ~$17         | Single server, everything       |
| 100-1K | Hetzner CPX41 (8 vCPU, 16GB)            | ~$27         | Upgrade VPS                     |
| 1K-5K  | Hetzner CCX33 (dedicated) + Storage Box | ~$60         | Dedicated CPU, separate storage |
| 5K-10K | 2 servers (web + workers) + managed DB  | ~$150        | Split web and workers           |
| 10K+   | Kubernetes or managed containers        | ~$300+       | Auto-scaling, multi-region      |

---

## Deployment Workflow

### CI/CD with GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_IP }}
          username: sotto
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd ~/sotto
            git pull origin main
            docker compose -f docker-compose.prod.yml build
            docker compose -f docker-compose.prod.yml up -d
            docker compose exec web npx prisma db push
```

### Zero-Downtime Deploys

Use Docker's rolling update strategy:

```yaml
deploy:
  update_config:
    parallelism: 1
    order: start-first
```

Or use Caddy's load balancing to run two instances during deployment.

---

## Quick-Start Deployment Checklist

Everything you need is in the repo. Here's the shortest path from bare VPS to live site:

```bash
# 1. On your LOCAL machine — set up the server
ssh root@YOUR_SERVER_IP "bash -s" < scripts/setup-server.sh

# 2. SSH in as sotto user
ssh sotto@YOUR_SERVER_IP

# 3. Clone and configure
git clone https://github.com/YOUR_USERNAME/sotto.git ~/sotto
cd ~/sotto
cp .env.example .env
nano .env  # Fill in all required values (see .env.example comments)

# 4. Deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm web npx prisma db push

# 5. Set up Caddy (edit domain first)
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile  # Replace sotto.fm with your domain
sudo systemctl reload caddy

# 6. Set up daily backups
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo "0 3 * * * ~/sotto/scripts/backup.sh") | crontab -

# 7. Verify
curl -s https://YOUR_DOMAIN/api/health | jq .
```

### Project Files Reference

| File                           | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `Dockerfile`                   | Multi-stage Next.js web container (standalone output)               |
| `Dockerfile.workers`           | Workers container with FFmpeg                                       |
| `docker-compose.prod.yml`      | Full production stack (web, workers, postgres, redis)               |
| `Caddyfile`                    | Reverse proxy template (HTTPS + security headers)                   |
| `.env.example`                 | All environment variables documented                                |
| `scripts/setup-server.sh`      | Automated VPS provisioning (Docker, Caddy, firewall, SSH hardening) |
| `scripts/backup.sh`            | Daily PostgreSQL backup with 30-day retention                       |
| `.github/workflows/ci.yml`     | CI pipeline (lint, typecheck, test, build)                          |
| `.github/workflows/deploy.yml` | Auto-deploy to production on push to main                           |
